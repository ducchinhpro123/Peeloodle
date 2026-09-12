/**
 * Truthful save/autosave for the presentation editor (P19).
 *
 * The store owns the document; this hook only turns completed commands into
 * writes and reports what really happened. Every write passes the revision the
 * editor last persisted as `baseRevision`, so a newer revision written by
 * another tab is reported as a conflict instead of being overwritten.
 *
 * Autosave waits for a *completed* command: a new document revision with the
 * history group closed. A drag, a slider gesture, or an open text session holds
 * one history group, so nothing is written mid-gesture.
 *
 * Insertion and conflict recovery go through the same single write path
 * (`serialize`), so there is never a second, concurrent writer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isPersistenceError } from '@/lib/persistence/repository'
import type { PresentationMediaRecord, PresentationRepository } from '@/lib/persistence/presentations/repository'
import { clonePresentationDocumentWithNewIds } from '../model/factories'
import { PRESENTATION_LIMITS } from '../model/limits'
import type { PresentationDocument } from '../model/types'
import type { PreparedPresentationImage } from './insertImageAsset'
import { flushActiveTextEdit } from './textEditSession'
import { planImageInsert, usePresentationStore, type ImageInsertRefusalReason } from './store'

export type PresentationSaveStatus = 'clean' | 'saving' | 'saved' | 'failed' | 'conflict'
export type PresentationSaveState = { status: PresentationSaveStatus; message: string | null }

export type PersistOutcome = { ok: true } | { ok: false; reason: 'failed' | 'conflict'; message: string }
export type PersistInsertOutcome =
  | { ok: true; elementId: string }
  | { ok: false; reason: ImageInsertRefusalReason | 'failed' | 'conflict'; message: string }
export type ConflictRecoveryOutcome = { ok: true; copyId: string } | { ok: false; message: string }

/** Quiet time after the last completed command before an automatic save. */
export const AUTOSAVE_DELAY_MS = 750

const SAVE_FAILED_MESSAGE = 'This presentation could not be written to local storage. Your changes are still here and stay editable — press Save to try again.'
const SAVE_CONFLICT_MESSAGE = 'A newer version of this presentation was saved in another tab or window after you opened it. Your changes are still here and were not written over it.'

const CONFLICT_COPY_SUFFIX = ' (conflict copy)'

type SaveResult = 'saved' | 'skipped' | 'failed' | 'conflict'

export function usePresentationSave(input: { repository: PresentationRepository; documentId: string | null }): {
  state: PresentationSaveState
  saveNow: () => Promise<void>
  requestSave: () => void
  saveBeforeLeave: () => Promise<boolean>
  persistInsert: (image: PreparedPresentationImage, options?: { slideId?: string }) => Promise<PersistInsertOutcome>
  keepMineAsCopy: () => Promise<ConflictRecoveryOutcome>
} {
  const { repository, documentId } = input
  const [state, setState] = useState<PresentationSaveState>({ status: 'clean', message: null })
  const pendingRef = useRef(0)
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  const publish = useCallback((next: PresentationSaveState) => {
    setState((current) => (current.status === next.status && current.message === next.message ? current : next))
  }, [])

  /**
   * One serialization point for every write. A write starts immediately when
   * nothing is in flight, so the visible 'saving' state is not deferred, and is
   * queued behind the current one otherwise: two writers can never overlap.
   */
  const serialize = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    pendingRef.current += 1
    const start = () => task().finally(() => { pendingRef.current -= 1 })
    if (pendingRef.current === 1) {
      const run = start()
      chain.current = run.then(() => undefined, () => undefined)
      return run
    }
    const run = chain.current.then(start, start)
    chain.current = run.then(() => undefined, () => undefined)
    return run
  }, [])

  const performSave = useCallback(async (): Promise<SaveResult> => {
    const stillCurrent = () => documentId !== null && usePresentationStore.getState().document?.id === documentId
    // Commit anything still on screen before the clean check, so an explicit Save can
    // never report "saved" for text the user can see but that was never written.
    flushActiveTextEdit()
    const start = usePresentationStore.getState()
    if (documentId === null || start.document?.id !== documentId) return 'skipped'
    // An unchanged revision is never re-submitted, so a clean document is not re-written.
    if (!start.dirty || start.document.revision === start.savedRevision) {
      publish({ status: 'saved', message: null })
      return 'skipped'
    }

    const pending = usePresentationStore.getState()
    const document = pending.document
    if (!document || document.id !== documentId) return 'skipped'
    if (!pending.dirty || document.revision === pending.savedRevision) {
      publish({ status: 'saved', message: null })
      return 'skipped'
    }

    // `mediaForSave` is the only safe source of bytes: a record the document no
    // longer references (an undone insert) makes the repository reject the write.
    const media = pending.mediaForSave()
    const baseRevision = pending.savedRevision
    pending.markSaving()
    publish({ status: 'saving', message: null })

    try {
      await repository.savePresentation(document, media, { baseRevision })
    } catch (error) {
      if (!stillCurrent()) return 'skipped'
      const failed = usePresentationStore.getState()
      if (isPersistenceError(error) && error.code === 'revision_conflict') {
        failed.markSaveFailed(SAVE_CONFLICT_MESSAGE)
        publish({ status: 'conflict', message: SAVE_CONFLICT_MESSAGE })
        return 'conflict'
      }
      const message = describeSaveFailure(error)
      failed.markSaveFailed(message)
      publish({ status: 'failed', message })
      return 'failed'
    }

    if (!stillCurrent()) return 'saved'
    const stored = usePresentationStore.getState()
    // The revision that was written, not the latest one: edits made while the
    // write was in flight must keep the document dirty.
    stored.markSaved(document.revision)
    // Only the assetIds this write persisted. Recomputing `mediaForSave()` here
    // could include artwork inserted during the write, whose bytes were never
    // stored — dropping those would make every later save fail on missing media.
    stored.clearPendingMedia(media.map((record) => record.assetId))
    publish({ status: 'saved', message: null })
    return 'saved'
  }, [documentId, publish, repository])

  const runSave = useCallback((): Promise<SaveResult> => serialize(performSave), [performSave, serialize])

  const saveNow = useCallback(async (): Promise<void> => {
    await runSave()
  }, [runSave])

  const requestSave = useCallback(() => {
    void saveNow()
  }, [saveNow])

  /**
   * Writes an explicit document through the same single write path. Store
   * bookkeeping belongs to the caller: a caller that is adopting a persisted
   * document owns the saved revision, and one that is only probing must not
   * clear `dirty` for work that was not part of this revision.
   */
  const persistDocument = useCallback(
    (next: PresentationDocument, media: PresentationMediaRecord[]): Promise<PersistOutcome> =>
      serialize(async () => {
        if (documentId === null || next.id !== documentId) {
          return { ok: false as const, reason: 'failed' as const, message: SAVE_FAILED_MESSAGE }
        }
        // Read the base revision here, inside the serialized task, not at click time:
        // a save that completes while this task waits in the queue advances the stored
        // revision, and a stale base would then report a conflict for our own write.
        const baseRevision = usePresentationStore.getState().savedRevision
        usePresentationStore.getState().markSaving()
        publish({ status: 'saving', message: null })
        try {
          await repository.savePresentation(next, media, { baseRevision })
          return { ok: true as const }
        } catch (error) {
          if (isPersistenceError(error) && error.code === 'revision_conflict') {
            usePresentationStore.getState().markSaveFailed(SAVE_CONFLICT_MESSAGE)
            publish({ status: 'conflict', message: SAVE_CONFLICT_MESSAGE })
            return { ok: false as const, reason: 'conflict' as const, message: SAVE_CONFLICT_MESSAGE }
          }
          const message = describeSaveFailure(error)
          usePresentationStore.getState().markSaveFailed(message)
          publish({ status: 'failed', message })
          return { ok: false as const, reason: 'failed' as const, message }
        }
      }),
    [documentId, publish, repository, serialize],
  )

  /**
   * Persist first, then adopt: an inserted image is never presented as added
   * before the document and its bytes are committed together. On any failure the
   * document, its assets, held media and history are all left untouched, so there
   * is no half-inserted element and no orphaned media to clean up.
   */
  const persistInsert = useCallback(
    async (image: PreparedPresentationImage, options?: { slideId?: string }): Promise<PersistInsertOutcome> => {
      const store = usePresentationStore.getState()
      const document = store.document
      if (!document || document.id !== documentId) {
        return { ok: false, reason: 'no-slide', message: 'Open a presentation before adding an image.' }
      }
      const check = store.checkImageInsert(image, options)
      if (!check.ok) return { ok: false, reason: check.reason, message: check.message }

      const plan = planImageInsert(document, image, {
        slideId: options?.slideId ?? usePresentationStore.getState().view.activeSlideId,
      })
      if (!plan) return { ok: false, reason: 'no-slide', message: 'There is no slide to add this image to.' }

      const media = pendingMediaFor(image)
      const outcome = await persistDocument(plan.document, media)
      if (!outcome.ok) return { ok: false, reason: outcome.reason, message: outcome.message }

      usePresentationStore.getState().adoptPersistedInsert(plan, image)
      publish({ status: 'saved', message: null })
      return { ok: true, elementId: plan.elementId }
    },
    [documentId, persistDocument, publish],
  )

  /**
   * A stale revision must not dead-end the editor. Keep the local work as an
   * independent copy, then load the newer stored revision so the user is no
   * longer editing something that can never be written.
   */
  const keepMineAsCopy = useCallback(async (): Promise<ConflictRecoveryOutcome> => {
    const source = usePresentationStore.getState().document
    if (!source || source.id !== documentId) return { ok: false, message: 'There is no open presentation to copy.' }
    flushActiveTextEdit()

    const local = usePresentationStore.getState().document
    if (!local || local.id !== documentId) return { ok: false, message: 'There is no open presentation to copy.' }
    const copy = clonePresentationDocumentWithNewIds(local, { title: conflictCopyTitle(local.title) })

    const outcome = await serialize(async (): Promise<ConflictRecoveryOutcome> => {
      // The copy uses new asset ids, so its media must be re-keyed by content.
      const held = usePresentationStore.getState().mediaForSave()
      const media = await mediaForCopy(repository, local, copy, held)
      if (!media.ok) return { ok: false, message: media.message }
      try {
        await repository.savePresentation(copy, media.records)
      } catch (error) {
        return { ok: false, message: describeSaveFailure(error) }
      }
      return { ok: true, copyId: copy.id }
    })

    if (!outcome.ok) {
      usePresentationStore.getState().markSaveFailed(outcome.message)
      publish({ status: 'failed', message: outcome.message })
      return outcome
    }

    // Reopen the newer stored revision; the user's own work is safe in the copy.
    try {
      const newer = await repository.getPresentation(documentId!)
      if (usePresentationStore.getState().document?.id === documentId) {
        usePresentationStore.getState().loadDocument(newer, { saved: true })
        publish({ status: 'clean', message: null })
      }
    } catch (error) {
      const message = describeSaveFailure(error)
      usePresentationStore.getState().markSaveFailed(message)
      publish({ status: 'failed', message })
      return { ok: false, message }
    }
    return outcome
  }, [documentId, publish, repository, serialize])

  /**
   * Used by the editor's own exit link: commit anything still on screen, wait for
   * the write rather than scheduling one, and report whether it is safe to leave.
   * A clean document reports true without writing anything.
   */
  const saveBeforeLeave = useCallback(async (): Promise<boolean> => {
    flushActiveTextEdit()
    // At most two passes: the first writes what is committed, the second writes an
    // edit that landed while the first was in flight. A clean document writes nothing.
    for (let pass = 0; pass < 2; pass += 1) {
      const result = await runSave()
      if (result === 'failed' || result === 'conflict') return false
      const store = usePresentationStore.getState()
      // Nothing open: leaving cannot lose this document's work.
      if (documentId === null || store.document?.id !== documentId) return true
      // An edit that landed while the write was in flight keeps this dirty; one
      // more pass writes it instead of refusing to leave with unsaved work.
      if (!store.dirty) return true
    }
    return false
  }, [documentId, runSave])

  useEffect(() => {
    setState({ status: 'clean', message: null })
  }, [documentId])

  useEffect(() => {
    if (documentId === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      const store = usePresentationStore.getState()
      if (store.document?.id !== documentId || !store.dirty) return
      // An open history group is a gesture in progress (a text session today).
      if (store.lastHistoryGroup !== null) return
      timer = setTimeout(() => {
        void saveNow()
      }, AUTOSAVE_DELAY_MS)
    }
    const unsubscribe = usePresentationStore.subscribe((next, previous) => {
      if (
        next.document?.id !== previous.document?.id ||
        next.document?.revision !== previous.document?.revision ||
        next.dirty !== previous.dirty ||
        next.lastHistoryGroup !== previous.lastHistoryGroup
      ) {
        schedule()
      }
    })
    schedule()
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [documentId, saveNow])

  // Unsaved local work must not disappear behind a silent tab close. Browsers
  // show their own generic prompt; this only asks for one.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const store = usePresentationStore.getState()
      if (!store.dirty || store.document?.id !== documentId) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [documentId])

  return { state, saveNow, requestSave, saveBeforeLeave, persistInsert, keepMineAsCopy }
}

/** The bytes for a just-prepared image, unless the document already holds them. */
function pendingMediaFor(image: PreparedPresentationImage): PresentationMediaRecord[] {
  const store = usePresentationStore.getState()
  const document = store.document
  const stored = document?.assets.some((asset) => asset.id === image.media.assetId) ?? false
  if (stored) return []
  if (store.pendingMedia.some((record) => record.assetId === image.media.assetId)) return []
  return [image.media]
}

/**
 * Media for the conflict copy. The clone gets new asset ids, so every record has
 * to be re-keyed by content: held bytes where the editor still has them, and the
 * already-stored bytes fetched back for everything else.
 */
async function mediaForCopy(
  repository: PresentationRepository,
  source: PresentationDocument,
  copy: PresentationDocument,
  held: PresentationMediaRecord[],
): Promise<{ ok: true; records: PresentationMediaRecord[] } | { ok: false; message: string }> {
  const heldByAssetId = new Map(held.map((record) => [record.assetId, record]))
  const records: PresentationMediaRecord[] = []
  for (const asset of copy.assets) {
    const original = source.assets.find((candidate) => candidate.sha256 === asset.sha256)
    if (!original) return { ok: false, message: 'The copy could not be prepared because its artwork no longer matches the original.' }
    const existing = heldByAssetId.get(original.id)
    if (existing) {
      records.push({ ...existing, assetId: asset.id })
      continue
    }
    try {
      const stored = await repository.getMedia(original.id)
      records.push({ assetId: asset.id, bytes: stored.bytes, mimeType: stored.mimeType })
    } catch {
      return { ok: false, message: 'The copy could not be prepared because some of its artwork could not be read back.' }
    }
  }
  return { ok: true, records }
}

function conflictCopyTitle(title: string): string {
  const room = PRESENTATION_LIMITS.maxTitleLength - CONFLICT_COPY_SUFFIX.length
  return `${title.slice(0, Math.max(0, room))}${CONFLICT_COPY_SUFFIX}`
}

function describeSaveFailure(error: unknown): string {
  if (isPersistenceError(error) && error.code === 'not_found') {
    return 'This presentation was removed from this browser. Your changes are still here — copy them out before closing this tab.'
  }
  return SAVE_FAILED_MESSAGE
}
