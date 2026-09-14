import { serializeProjectDocument, type StickerLabRepository } from '../../lib/persistence/repository'
import { useEditorStore, type EditorStore } from './store'

export type SaveOutcome =
  | { kind: 'saved'; projectId: string; revision: number }
  | { kind: 'skipped' | 'superseded' | 'stroke-pending' }
  | { kind: 'save-failed'; message: string }

export type FlushOutcome =
  | { kind: 'ready' | 'superseded' }
  | { kind: 'blocked'; projectId: string; reason: 'save-failed' | 'stroke-pending' | 'newer-edits' }

type Origin = { projectId: string | undefined; workspaceEpoch: number }
type EditorSource = Pick<typeof useEditorStore, 'getState' | 'subscribe'>

function originOf(state: EditorStore): Origin {
  return { projectId: state.document?.id, workspaceEpoch: state.workspaceEpoch }
}

function hasPendingWork(state: EditorStore): boolean {
  return !!state.document && (state.dirty || state.gestureActive || !!state.maskStroke)
}

/** One coordinator per editor store, surviving route and repository changes. */
export function createDraftSaving(store: EditorSource = useEditorStore) {
  let tail: Promise<void> = Promise.resolve()
  const matches = (origin: Origin) => {
    const state = store.getState()
    return state.document?.id === origin.projectId && state.workspaceEpoch === origin.workspaceEpoch
  }

  async function requestSave(repo: StickerLabRepository, automatic = false): Promise<SaveOutcome> {
    const initial = store.getState()
    const origin = originOf(initial)
    if (!initial.document || (automatic && (!initial.dirty || initial.gestureActive || initial.maskStroke))) {
      return { kind: 'skipped' }
    }
    if (initial.maskStroke) {
      try {
        await initial.commitMaskStroke()
      } catch {
        // The brush owns its recoverable error and unfinished work.
        return { kind: matches(origin) ? 'stroke-pending' : 'superseded' }
      }
    }
    if (!matches(origin)) return { kind: 'superseded' }
    if (store.getState().maskStroke) return { kind: 'stroke-pending' }
    if (store.getState().gestureActive) store.getState().commitGesture()

    try {
      const state = store.getState()
      if (!matches(origin) || !state.document) return { kind: 'superseded' }
      // Capture before entering the queue: later edits cannot change this write.
      const document = serializeProjectDocument(state.document)
      const assetIds = new Set(document.assetIds)
      const maskKeys = new Set<string>()
      for (const layer of document.layers) {
        if (layer.kind !== 'image') continue
        assetIds.add(layer.assetId)
        if (layer.maskKey) maskKeys.add(layer.maskKey)
      }
      const assets = [...assetIds].flatMap((id) => state.assets[id] ? [state.assets[id]!] : [])
      const masks = [...maskKeys].flatMap((key) => state.masks[key] ? [{ key, blob: state.masks[key]! }] : [])
      const write = async (): Promise<SaveOutcome> => {
        if (matches(origin)) store.getState().setSaveStatus('saving')
        try {
          await repo.saveProjectWithAssets(document, assets, masks)
          if (matches(origin)) store.getState().markSaved(document.revision)
          return { kind: 'saved', projectId: document.id, revision: document.revision }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Save failed'
          if (matches(origin)) store.getState().setSaveStatus('save-failed', message)
          return { kind: 'save-failed', message }
        }
      }
      const result = tail.then(write, write)
      tail = result.then(() => undefined, () => undefined)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed'
      if (matches(origin)) store.getState().setSaveStatus('save-failed', message)
      return { kind: 'save-failed', message }
    }
  }

  async function flush(repo: StickerLabRepository, options?: { projectId: string }): Promise<FlushOutcome> {
    const initial = store.getState()
    const origin = originOf(initial)
    if (options && options.projectId !== origin.projectId) return { kind: 'superseded' }
    const result = hasPendingWork(initial) ? await requestSave(repo) : null
    // Include writes already queued by manual save or route cleanup.
    await tail
    if (!matches(origin)) return { kind: 'superseded' }
    const state = store.getState()
    if (!state.document) return { kind: 'ready' }
    if (state.maskStroke || result?.kind === 'stroke-pending') {
      return { kind: 'blocked', projectId: state.document.id, reason: 'stroke-pending' }
    }
    if (state.saveStatus === 'save-failed') {
      return { kind: 'blocked', projectId: state.document.id, reason: 'save-failed' }
    }
    if (hasPendingWork(state)) return { kind: 'blocked', projectId: state.document.id, reason: 'newer-edits' }
    return { kind: 'ready' }
  }

  function attachAutosave(repo: StickerLabRepository) {
    const epoch = store.getState().workspaceEpoch
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const belongsToAttachment = () => active && store.getState().workspaceEpoch === epoch
    const schedule = () => {
      clearTimeout(timer)
      const state = store.getState()
      if (!belongsToAttachment() || !state.document || !state.dirty || state.gestureActive || state.maskStroke) return
      const origin = originOf(state)
      timer = setTimeout(() => {
        if (belongsToAttachment() && matches(origin)) void requestSave(repo, true)
      }, 800)
    }
    const unsubscribe = store.subscribe((next, previous) => {
      // Status and view-only changes must not restart a timer or retry a failure.
      if (next.workspaceEpoch !== previous.workspaceEpoch || next.document?.id !== previous.document?.id ||
          next.document?.revision !== previous.document?.revision || next.dirty !== previous.dirty ||
          next.gestureActive !== previous.gestureActive || !!next.maskStroke !== !!previous.maskStroke) schedule()
    })
    schedule()
    return {
      pageHide: () => { if (belongsToAttachment()) void requestSave(repo) },
      shouldWarnBeforeUnload: () => belongsToAttachment() && hasPendingWork(store.getState()),
      detach: () => {
        active = false
        clearTimeout(timer)
        unsubscribe()
      },
    }
  }

  return { save: (repo: StickerLabRepository) => requestSave(repo), flush, attachAutosave }
}

export const draftSaving = createDraftSaving()
