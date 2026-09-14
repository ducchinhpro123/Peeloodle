import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRepository, type AssetRecord } from '../../lib/persistence/repository'
import { createDraftSaving } from './draftSaving'
import { resetEditorStore, useEditorStore } from './store'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function blockNextWrite(repo: ReturnType<typeof createMemoryRepository>) {
  const started = deferred()
  const release = deferred()
  const write = repo.saveProjectWithAssets.bind(repo)
  const spy = vi.spyOn(repo, 'saveProjectWithAssets').mockImplementationOnce(async (...args) => {
    started.resolve()
    await release.promise
    return write(...args)
  })
  return { started: started.promise, release: release.resolve, spy }
}

const state = () => useEditorStore.getState()
let saving: ReturnType<typeof createDraftSaving>
let repo: ReturnType<typeof createMemoryRepository>
const detachments: Array<() => void> = []
function attach() {
  const attachment = saving.attachAutosave(repo)
  detachments.push(attachment.detach)
  return attachment
}

beforeEach(() => {
  vi.useFakeTimers()
  resetEditorStore()
  state().createDraft('draft-a')
  saving = createDraftSaving()
  repo = createMemoryRepository()
})
afterEach(() => {
  detachments.splice(0).forEach((detach) => detach())
  resetEditorStore()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('draft saving', () => {
  it('writes a clean draft when explicitly saved, but a clean flush does not create a project', async () => {
    expect(await saving.flush(repo)).toEqual({ kind: 'ready' })
    expect(await repo.listProjects()).toEqual([])
    expect(await saving.save(repo)).toMatchObject({ kind: 'saved', projectId: 'draft-a', revision: 0 })
    expect((await repo.getProject('draft-a')).revision).toBe(0)
    expect(state()).toMatchObject({ dirty: false, saveStatus: 'saved-locally' })
  })

  it('commits a gesture before capture and retains one undo entry', async () => {
    state().beginGesture()
    state().updateTitle('First frame')
    state().updateTitle('Final frame')
    expect(await saving.flush(repo)).toEqual({ kind: 'ready' })
    expect((await repo.getProject('draft-a')).title).toBe('Final frame')
    expect(state().past).toHaveLength(1)
    state().undo()
    expect(state().document?.title).toBe('Untitled Sticker')
  })

  it('does not let an earlier saved revision clear newer edits', async () => {
    state().updateTitle('Before')
    const gate = blockNextWrite(repo)
    const first = saving.save(repo)
    await gate.started
    state().updateTitle('After')
    gate.release()
    expect(await first).toMatchObject({ kind: 'saved' })
    expect((await repo.getProject('draft-a')).title).toBe('Before')
    expect(state()).toMatchObject({ dirty: true, saveStatus: 'unsaved' })
    await saving.save(repo)
    expect((await repo.getProject('draft-a')).title).toBe('After')
  })

  it('captures queued content before waiting and keeps writes ordered', async () => {
    state().updateTitle('First')
    const gate = blockNextWrite(repo)
    const first = saving.save(repo)
    await gate.started
    state().updateTitle('Second')
    const second = saving.save(repo)
    state().updateTitle('Not requested')
    gate.release()
    await Promise.all([first, second])
    expect(gate.spy.mock.calls.map(([document]) => document.title)).toEqual(['First', 'Second'])
    expect((await repo.getProject('draft-a')).title).toBe('Second')
    expect(state().dirty).toBe(true)
  })

  it('retains originating repositories across workspace reset without changing the new draft status', async () => {
    state().updateTitle('Old workspace')
    const gate = blockNextWrite(repo)
    const first = saving.save(repo)
    await gate.started
    resetEditorStore()
    state().createDraft('draft-a')
    state().updateTitle('New workspace')
    const other = createMemoryRepository()
    gate.release()
    await first
    expect(state()).toMatchObject({ dirty: true, saveStatus: 'unsaved' })
    await saving.save(other)
    expect((await repo.getProject('draft-a')).title).toBe('Old workspace')
    expect((await other.getProject('draft-a')).title).toBe('New workspace')
  })

  it('finishes a delayed mask stroke and persists the captured image and mask', async () => {
    const record: AssetRecord = {
      asset: { id: 'photo', blobKey: 'photo', mimeType: 'image/png', width: 20, height: 20, provenance: 'test' },
      blob: new Blob(['original'], { type: 'image/png' }),
    }
    state().addImageLayer(record)
    const layerId = state().selectedLayerId!
    const gate = deferred()
    const mask = new Blob(['mask'], { type: 'image/png' })
    useEditorStore.getState().beginMaskStroke({ layerId, commit: async () => {
      await gate.promise
      state().applyMask(layerId, 'mask-a', mask)
      useEditorStore.getState().abandonMaskStroke()
    } })
    const result = saving.flush(repo)
    expect(await repo.listProjects()).toEqual([])
    gate.resolve()
    expect(await result).toEqual({ kind: 'ready' })
    expect((await repo.getProject('draft-a')).layers[0]).toMatchObject({ maskKey: 'mask-a' })
    expect((await repo.getAsset('photo')).blob).toBe(record.blob)
    expect(await repo.getMask('mask-a')).toBe(mask)
  })

  it.each(['project', 'workspace'] as const)('does not capture a replacement %s after delayed stroke completion', async (replacement) => {
    const gate = deferred()
    useEditorStore.getState().beginMaskStroke({ layerId: 'layer', commit: () => gate.promise })
    const result = saving.flush(repo)
    if (replacement === 'workspace') resetEditorStore()
    state().createDraft(replacement === 'workspace' ? 'draft-a' : 'draft-b')
    state().updateTitle('Replacement')
    gate.resolve()
    expect(await result).toEqual({ kind: 'superseded' })
    expect(await repo.listProjects()).toEqual([])
    expect(state()).toMatchObject({ dirty: true, saveStatus: 'unsaved' })
  })

  it('preserves a rejected stroke and its recoverable error', async () => {
    const stroke = { layerId: 'layer', commit: async () => { throw new Error('Encoding failed') } }
    useEditorStore.getState().beginMaskStroke(stroke)
    useEditorStore.setState({ uploadError: 'Encoding failed' })
    expect(await saving.flush(repo)).toEqual({ kind: 'blocked', projectId: 'draft-a', reason: 'stroke-pending' })
    expect(state().maskStroke).toBe(stroke)
    expect(state().uploadError).toBe('Encoding failed')
    expect(await repo.listProjects()).toEqual([])
  })

  it('retains failed work and permits a later retry', async () => {
    state().updateTitle('Keep me')
    repo.injectWriteFailure()
    expect(await saving.flush(repo)).toEqual({ kind: 'blocked', projectId: 'draft-a', reason: 'save-failed' })
    expect(state()).toMatchObject({ dirty: true, saveStatus: 'save-failed' })
    expect(state().document?.title).toBe('Keep me')
    expect(await saving.flush(repo)).toEqual({ kind: 'ready' })
    expect((await repo.getProject('draft-a')).title).toBe('Keep me')
  })

  it('does not poison an already queued save when the preceding write fails', async () => {
    state().updateTitle('First')
    repo.injectWriteFailure()
    const gate = blockNextWrite(repo)
    const first = saving.save(repo)
    await gate.started
    state().updateTitle('Second')
    const second = saving.save(repo)
    gate.release()
    expect(await first).toMatchObject({ kind: 'save-failed' })
    expect(await second).toMatchObject({ kind: 'saved' })
    expect((await repo.getProject('draft-a')).title).toBe('Second')
    expect(state()).toMatchObject({ dirty: false, saveStatus: 'saved-locally' })
  })

  it('waits for an in-flight manual save even when the draft is clean', async () => {
    const gate = blockNextWrite(repo)
    const manual = saving.save(repo)
    await gate.started
    let flushed = false
    const result = saving.flush(repo).then((outcome) => { flushed = true; return outcome })
    await Promise.resolve()
    expect(flushed).toBe(false)
    gate.release()
    await manual
    expect(await result).toEqual({ kind: 'ready' })
    expect(gate.spy).toHaveBeenCalledTimes(1)
  })

  it('persists only referenced blobs while history keeps removed images and masks available', async () => {
    const record: AssetRecord = {
      asset: { id: 'removed', blobKey: 'removed', mimeType: 'image/png', width: 20, height: 20, provenance: 'test' },
      blob: new Blob(['original'], { type: 'image/png' }),
    }
    state().addImageLayer(record)
    state().applyMask(state().selectedLayerId!, 'removed-mask', new Blob(['mask']))
    state().removeSelected()
    state().addTextLayer({ content: 'Only text' })
    expect(state().assets.removed).toBeDefined()
    expect(state().masks['removed-mask']).toBeDefined()
    expect(await saving.flush(repo)).toEqual({ kind: 'ready' })
    expect(await repo.listAssets()).toEqual([])
    await expect(repo.getMask('removed-mask')).rejects.toThrow()
    expect((await repo.getProject('draft-a')).layers).toHaveLength(1)
  })

  it('blocks replacement when edits arrive during a flush', async () => {
    state().updateTitle('Captured')
    const gate = blockNextWrite(repo)
    const result = saving.flush(repo)
    await gate.started
    state().updateTitle('Still editing')
    gate.release()
    expect(await result).toEqual({ kind: 'blocked', projectId: 'draft-a', reason: 'newer-edits' })
    expect(state().document?.title).toBe('Still editing')
  })

  it('blocks replacement when an unchanged-revision gesture begins during a flush', async () => {
    state().updateTitle('Captured')
    const gate = blockNextWrite(repo)
    const result = saving.flush(repo)
    await gate.started
    state().beginGesture()
    state().updateTitle('Uncommitted')
    gate.release()
    expect(await result).toMatchObject({ kind: 'blocked', reason: 'newer-edits' })
    expect(state().gestureActive).toBe(true)
  })

  it('ignores cleanup for a departed project', async () => {
    state().createDraft('draft-b')
    state().updateTitle('Replacement')
    expect(await saving.flush(repo, { projectId: 'draft-a' })).toEqual({ kind: 'superseded' })
    expect(await repo.listProjects()).toEqual([])
  })

  it('reports superseded when the project changes after capture but still completes its write', async () => {
    state().updateTitle('Original')
    const gate = blockNextWrite(repo)
    const result = saving.flush(repo)
    await gate.started
    state().createDraft('draft-b')
    gate.release()
    expect(await result).toEqual({ kind: 'superseded' })
    expect((await repo.getProject('draft-a')).title).toBe('Original')
    expect(state().saveStatus).toBe('idle')
  })
})

describe('autosave attachment', () => {
  it('debounces edits for 800 ms without restarting for view or status changes', async () => {
    const write = vi.spyOn(repo, 'saveProjectWithAssets')
    attach()
    state().updateTitle('First')
    await vi.advanceTimersByTimeAsync(500)
    state().updateTitle('Second')
    await vi.advanceTimersByTimeAsync(500)
    state().setViewport({ zoom: 2, panX: 5 })
    state().selectLayer(null)
    state().setSaveStatus('unsaved')
    await vi.advanceTimersByTimeAsync(299)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect((await repo.getProject('draft-a')).title).toBe('Second')
    await vi.advanceTimersByTimeAsync(5000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('waits for gesture completion and mask completion', async () => {
    attach()
    state().beginGesture()
    state().updateTitle('Gesture')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await repo.listProjects()).toEqual([])
    state().commitGesture()
    useEditorStore.getState().beginMaskStroke({ layerId: 'layer', commit: async () => {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await repo.listProjects()).toEqual([])
    useEditorStore.getState().abandonMaskStroke()
    await vi.advanceTimersByTimeAsync(800)
    expect((await repo.getProject('draft-a')).title).toBe('Gesture')
  })

  it('does not retry failed autosaves from status updates', async () => {
    const write = vi.spyOn(repo, 'saveProjectWithAssets')
    repo.injectWriteFailure()
    attach()
    state().updateTitle('Keep me')
    await vi.advanceTimersByTimeAsync(800)
    expect(state().saveStatus).toBe('save-failed')
    await vi.advanceTimersByTimeAsync(10000)
    expect(write).toHaveBeenCalledTimes(1)
    state().updateTitle('Retry after edit')
    await vi.advanceTimersByTimeAsync(800)
    expect((await repo.getProject('draft-a')).title).toBe('Retry after edit')
  })

  it('cancels timers on detach and safely reattaches', async () => {
    const write = vi.spyOn(repo, 'saveProjectWithAssets')
    const first = attach()
    state().updateTitle('Pending')
    first.detach()
    first.pageHide()
    expect(first.shouldWarnBeforeUnload()).toBe(false)
    await vi.advanceTimersByTimeAsync(800)
    expect(write).not.toHaveBeenCalled()
    attach()
    await vi.advanceTimersByTimeAsync(800)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps captured writes alive after detach', async () => {
    const attachment = attach()
    const gate = blockNextWrite(repo)
    state().updateTitle('Captured')
    await vi.advanceTimersByTimeAsync(800)
    await gate.started
    attachment.detach()
    gate.release()
    await vi.advanceTimersByTimeAsync(0)
    expect((await repo.getProject('draft-a')).title).toBe('Captured')
  })

  it('does not use a departed workspace repository for timers or page hide', async () => {
    const attachment = attach()
    state().updateTitle('Old workspace')
    resetEditorStore()
    state().createDraft('draft-a')
    state().updateTitle('New workspace')
    attachment.pageHide()
    await vi.advanceTimersByTimeAsync(800)
    expect(await repo.listProjects()).toEqual([])
    expect(attachment.shouldWarnBeforeUnload()).toBe(false)
  })

  it('warns about unsaved work and saves it on page hide before the debounce', async () => {
    const attachment = attach()
    expect(attachment.shouldWarnBeforeUnload()).toBe(false)
    state().updateTitle('Leaving')
    expect(attachment.shouldWarnBeforeUnload()).toBe(true)
    attachment.pageHide()
    await vi.advanceTimersByTimeAsync(0)
    expect((await repo.getProject('draft-a')).title).toBe('Leaving')
    expect(attachment.shouldWarnBeforeUnload()).toBe(false)
  })
})
