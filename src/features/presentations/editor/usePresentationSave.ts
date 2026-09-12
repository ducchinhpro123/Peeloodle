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
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isPersistenceError } from '@/lib/persistence/repository'
import type { PresentationRepository } from '@/lib/persistence/presentations/repository'
import { readParagraphsFromDom } from './textBridge'
import { bridgeDefaultsFor, textHistoryGroup } from './textEditSession'
import { usePresentationStore } from './store'

export type PresentationSaveStatus = 'clean' | 'saving' | 'saved' | 'failed' | 'conflict'
export type PresentationSaveState = { status: PresentationSaveStatus; message: string | null }

/** Quiet time after the last completed command before an automatic save. */
export const AUTOSAVE_DELAY_MS = 750

const SAVE_FAILED_MESSAGE = 'This presentation could not be written to local storage. Your changes are still here and stay editable — press Save to try again.'
const SAVE_CONFLICT_MESSAGE = 'A newer version of this presentation was saved in another tab or window after you opened it. Your changes are still here and were not written over it.'

/** The DOM editing field owned by `TextEditOverlay`. */
const TEXT_EDIT_FIELD_SELECTOR = '[data-testid="text-edit-field"]'

type SaveResult = 'saved' | 'skipped' | 'failed' | 'conflict'

export function usePresentationSave(input: { repository: PresentationRepository; documentId: string | null }): {
  state: PresentationSaveState
  saveNow: () => Promise<void>
  requestSave: () => void
} {
  const { repository, documentId } = input
  const [state, setState] = useState<PresentationSaveState>({ status: 'clean', message: null })
  const inFlight = useRef(false)
  const queued = useRef(false)

  const publish = useCallback((next: PresentationSaveState) => {
    setState((current) => (current.status === next.status && current.message === next.message ? current : next))
  }, [])

  const performSave = useCallback(async (): Promise<SaveResult> => {
    const stillCurrent = () => documentId !== null && usePresentationStore.getState().document?.id === documentId
    const start = usePresentationStore.getState()
    if (documentId === null || start.document?.id !== documentId) return 'skipped'
    // An unchanged revision is never re-submitted, so a clean document is not re-written.
    if (!start.dirty || start.document.revision === start.savedRevision) {
      publish({ status: 'saved', message: null })
      return 'skipped'
    }

    flushActiveTextSession()

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

  const saveNow = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      // Never two writes at once. The request is served after the current one.
      queued.current = true
      return
    }
    inFlight.current = true
    try {
      let result: SaveResult
      do {
        queued.current = false
        result = await performSave()
      } while (queued.current && (result === 'saved' || result === 'skipped'))
    } finally {
      inFlight.current = false
    }
  }, [performSave])

  const requestSave = useCallback(() => {
    void saveNow()
  }, [saveNow])

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

  return { state, saveNow, requestSave }
}

/**
 * Commits the text currently on screen before a write, through the same history
 * group the overlay uses, so flushing never adds an undo entry and never closes
 * the session. A rejected command (an over-long box) keeps the last committed
 * text: the overlay owns that error and a save must not fail because of it.
 */
function flushActiveTextSession(): void {
  const store = usePresentationStore.getState()
  const elementId = store.view.editingElementId
  if (elementId === null) return
  const host = document.querySelector<HTMLElement>(TEXT_EDIT_FIELD_SELECTOR)
  if (!host) return
  const element = store.document?.slides.flatMap((slide) => slide.elements).find((candidate) => candidate.id === elementId)
  if (element?.kind !== 'text') return
  try {
    store.updateText(elementId, readParagraphsFromDom(host, bridgeDefaultsFor(element, store.document?.theme)), {
      historyGroup: textHistoryGroup(elementId),
    })
  } catch {
    // Keep the committed text; the session stays open with its own alert.
  }
}

function describeSaveFailure(error: unknown): string {
  if (isPersistenceError(error) && error.code === 'not_found') {
    return 'This presentation was removed from this browser. Your changes are still here — copy them out before closing this tab.'
  }
  return SAVE_FAILED_MESSAGE
}
