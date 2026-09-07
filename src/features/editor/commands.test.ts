import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryRepository, createProjectDocument } from '../../lib/persistence/repository'
import type { AssetRecord } from '../../lib/persistence/repository'
import type { Transform } from '../../types/domain'
import { HISTORY_LIMIT, resetEditorStore, useEditorStore } from './store'

function pngRecord(id = 'asset-1'): AssetRecord {
  return {
    asset: { id, mimeType: 'image/png', width: 100, height: 80, blobKey: id, provenance: 'test' },
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  }
}

afterEach(() => {
  resetEditorStore()
})

describe('editor commands', () => {
  it('inserts image and text as undoable commands', () => {
    useEditorStore.getState().createDraft('p1')
    useEditorStore.getState().addImageLayer(pngRecord())
    useEditorStore.getState().addTextLayer()
    const document = useEditorStore.getState().document!
    expect(document.layers).toHaveLength(2)
    expect(document.layers[0]?.kind).toBe('image')
    expect(document.layers[1]?.kind).toBe('text')
    expect(document.revision).toBe(2)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document?.layers).toHaveLength(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document?.layers).toHaveLength(0)
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().document?.layers[0]?.kind).toBe('image')
  })

  it('commits a multi-frame drag as one history entry', () => {
    useEditorStore.getState().createDraft('p1')
    useEditorStore.getState().addTextLayer()
    const id = useEditorStore.getState().selectedLayerId!
    const start = useEditorStore.getState().document!.layers[0]!.transform
    useEditorStore.getState().beginGesture()
    useEditorStore.getState().applyTransform(id, { ...start, x: start.x + 4 })
    useEditorStore.getState().applyTransform(id, { ...start, x: start.x + 12 })
    useEditorStore.getState().applyTransform(id, { ...start, x: start.x + 20 })
    useEditorStore.getState().commitGesture()

    expect(useEditorStore.getState().past).toHaveLength(2)
    expect(useEditorStore.getState().document?.layers[0]?.transform.x).toBe(start.x + 20)
    const revision = useEditorStore.getState().document!.revision
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document?.layers).toHaveLength(1)
    expect(useEditorStore.getState().document?.layers[0]?.transform.x).toBe(start.x)
    expect(useEditorStore.getState().document!.revision).toBeGreaterThan(revision)
  })

  it('keeps revisions increasing through undo, redo, and a branch while a save is blocked', async () => {
    const store = useEditorStore.getState()
    const repo = createMemoryRepository()
    store.createDraft('p1')
    store.updateTitle('First edit')
    store.updateTitle('Pending edit')
    const snapshot = useEditorStore.getState().document!
    let release = () => {}
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const save = blocked.then(async () => {
      await repo.saveProjectWithAssets(snapshot, [])
      store.markSaved(snapshot.revision)
    })
    const revisions = [snapshot.revision]
    store.undo()
    revisions.push(useEditorStore.getState().document!.revision)
    store.redo()
    revisions.push(useEditorStore.getState().document!.revision)
    store.undo()
    revisions.push(useEditorStore.getState().document!.revision)
    store.updateTitle('Branch edit')
    revisions.push(useEditorStore.getState().document!.revision)
    release()
    await save
    expect(revisions).toEqual([2, 3, 4, 5, 6])
    expect((await repo.getProject('p1')).title).toBe('Pending edit')
    expect(useEditorStore.getState().document!.title).toBe('Branch edit')
    expect(useEditorStore.getState().dirty).toBe(true)
    expect(useEditorStore.getState().saveStatus).toBe('unsaved')
  })

  it('preserves redo after unchanged focus/blur and a gesture returning to its start', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.updateTitle('First edit')
    store.updateTitle('Second edit')
    store.undo()
    const before = useEditorStore.getState()
    store.beginGesture()
    store.commitGesture()
    store.beginGesture()
    store.updateTitle('Temporary edit')
    store.updateTitle('First edit')
    store.commitGesture()
    expect(useEditorStore.getState().past).toEqual(before.past)
    expect(useEditorStore.getState().future).toEqual(before.future)
    expect(useEditorStore.getState().document).toEqual(before.document)
    store.redo()
    expect(useEditorStore.getState().document!.title).toBe('Second edit')
  })

  it('does not evict the oldest history entry for a no-op at the limit', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    for (let i = 1; i <= HISTORY_LIMIT; i += 1) store.updateTitle(`Edit ${i}`)
    const before = useEditorStore.getState()
    store.beginGesture()
    expect(useEditorStore.getState().past).toBe(before.past)
    store.commitGesture()
    expect(useEditorStore.getState().past).toBe(before.past)
    for (let i = 0; i < HISTORY_LIMIT; i += 1) store.undo()
    expect(useEditorStore.getState().document!.title).toBe('Untitled Sticker')
  })

  it.each(['horizontal', 'vertical'] as const)('keeps a rotated image centered during %s flips and undo', (axis) => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.addImageLayer(pngRecord())
    const id = useEditorStore.getState().selectedLayerId!
    const start = { x: 210, y: 160, rotation: 37, scaleX: 2, scaleY: 3 }
    store.applyTransform(id, start)
    const center = (t: Transform) => {
      const radians = t.rotation * Math.PI / 180
      return {
        x: t.x + 50 * t.scaleX * Math.cos(radians) - 40 * t.scaleY * Math.sin(radians),
        y: t.y + 50 * t.scaleX * Math.sin(radians) + 40 * t.scaleY * Math.cos(radians),
      }
    }
    store.flipSelected(axis)
    const flipped = useEditorStore.getState().document!.layers[0]!.transform
    expect(center(flipped).x).toBeCloseTo(center(start).x)
    expect(center(flipped).y).toBeCloseTo(center(start).y)
    expect(flipped.scaleX).toBe(axis === 'horizontal' ? -2 : 2)
    expect(flipped.scaleY).toBe(axis === 'vertical' ? -3 : 3)
    store.undo()
    expect(useEditorStore.getState().document!.layers[0]!.transform).toEqual(start)
    store.redo()
    store.flipSelected(axis)
    const restored = useEditorStore.getState().document!.layers[0]!.transform
    expect(restored.x).toBeCloseTo(start.x)
    expect(restored.y).toBeCloseTo(start.y)
    expect(restored.scaleX).toBe(start.scaleX)
    expect(restored.scaleY).toBe(start.scaleY)
  })

  it('does not record selection, zoom, or pan as document edits', () => {
    useEditorStore.getState().createDraft('p1')
    useEditorStore.getState().addTextLayer()
    const revision = useEditorStore.getState().document!.revision
    const updatedAt = useEditorStore.getState().document!.updatedAt
    useEditorStore.getState().selectLayer(null)
    useEditorStore.getState().setViewport({ zoom: 1.4, panX: 20, panY: -8 })
    expect(useEditorStore.getState().document!.revision).toBe(revision)
    expect(useEditorStore.getState().document!.updatedAt).toBe(updatedAt)
    expect(useEditorStore.getState().viewport).toEqual({ zoom: 1.4, panX: 20, panY: -8 })
    expect(useEditorStore.getState().dirty).toBe(true)
  })

  it('bounds undo history', () => {
    useEditorStore.getState().createDraft('p1')
    for (let i = 0; i < HISTORY_LIMIT + 8; i += 1) useEditorStore.getState().addTextLayer()
    expect(useEditorStore.getState().past.length).toBe(HISTORY_LIMIT)
  })

  it('keeps in-memory edits when a later save would fail', () => {
    useEditorStore.getState().hydrate(createProjectDocument({ id: 'p1', title: 'Keep me' }), [])
    useEditorStore.getState().updateTitle('Edited title')
    useEditorStore.getState().setSaveStatus('save-failed', 'Save failed')
    expect(useEditorStore.getState().document?.title).toBe('Edited title')
    expect(useEditorStore.getState().saveStatus).toBe('save-failed')
    expect(useEditorStore.getState().dirty).toBe(true)
  })

  it('treats nudge and 90-degree rotate as undoable transforms', () => {
    useEditorStore.getState().createDraft('p1')
    useEditorStore.getState().addTextLayer()
    const start = useEditorStore.getState().document!.layers[0]!.transform
    useEditorStore.getState().nudgeSelected(8, -4)
    useEditorStore.getState().rotateSelected90()
    const moved = useEditorStore.getState().document!.layers[0]!.transform
    expect(moved.x).toBe(start.x + 8)
    expect(moved.y).toBe(start.y - 4)
    expect(moved.rotation).toBe(start.rotation + 90)
    useEditorStore.getState().undo()
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document!.layers[0]!.transform).toEqual(start)
  })

  it('drops runtime assets after history no longer references them and does not keep them on save', async () => {
    const store = useEditorStore.getState()
    const repo = createMemoryRepository()
    store.createDraft('p1')
    store.addImageLayer(pngRecord('asset-a'))
    store.addImageLayer(pngRecord('asset-b'))
    expect(Object.keys(useEditorStore.getState().assets).sort()).toEqual(['asset-a', 'asset-b'])
    store.removeSelected()
    expect(Object.keys(useEditorStore.getState().assets).sort()).toEqual(['asset-a', 'asset-b'])
    store.selectLayer(useEditorStore.getState().document!.layers[0]!.id)
    store.removeSelected()
    for (let i = 0; i < HISTORY_LIMIT; i += 1) store.addTextLayer()
    expect(Object.keys(useEditorStore.getState().assets)).toEqual([])
    const snapshot = useEditorStore.getState().document!
    await repo.saveProjectWithAssets(snapshot, Object.values(useEditorStore.getState().assets))
    expect(await repo.listAssets()).toEqual([])
    await repo.saveAsset(pngRecord('other-project-asset'))
    expect((await repo.listAssets()).map((asset) => asset.id)).toContain('other-project-asset')
  })

  it('reorders layers, toggles visibility/lock, and renames layers with undo support', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.addTextLayer()
    store.addImageLayer(pngRecord('asset-1'))
    const doc = useEditorStore.getState().document!
    expect(doc.layers).toHaveLength(2)
    const textId = doc.layers[0]!.id
    const imageId = doc.layers[1]!.id

    // Reorder
    store.reorderLayer(textId, 'up')
    expect(useEditorStore.getState().document!.layers.map((l) => l.id)).toEqual([imageId, textId])
    store.undo()
    expect(useEditorStore.getState().document!.layers.map((l) => l.id)).toEqual([textId, imageId])

    // Visibility
    expect(useEditorStore.getState().document!.layers[0]!.visible).toBe(true)
    store.toggleLayerVisibility(textId)
    expect(useEditorStore.getState().document!.layers[0]!.visible).toBe(false)
    store.undo()
    expect(useEditorStore.getState().document!.layers[0]!.visible).toBe(true)

    // Lock
    expect(useEditorStore.getState().document!.layers[0]!.locked).toBe(false)
    store.toggleLayerLock(textId)
    expect(useEditorStore.getState().document!.layers[0]!.locked).toBe(true)
    store.selectLayer(textId)
    store.nudgeSelected(10, 10)
    // Nudge is blocked for locked layer
    expect(useEditorStore.getState().document!.layers[0]!.transform.x).toBe(320)
    store.undo()
    expect(useEditorStore.getState().document!.layers[0]!.locked).toBe(false)

    // Rename
    store.renameLayer(textId, 'Custom Title')
    expect(useEditorStore.getState().document!.layers[0]!.name).toBe('Custom Title')
    store.undo()
    expect(useEditorStore.getState().document!.layers[0]!.name).toBe('Text')
  })

  it('updates image filters and resets them with undo support', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.addImageLayer(pngRecord('asset-1'))
    const imageId = useEditorStore.getState().document!.layers[0]!.id

    store.updateFilters(imageId, { brightness: 25, contrast: -10 })
    const layer = useEditorStore.getState().document!.layers[0]!
    expect(layer.kind === 'image' && layer.filters).toEqual({
      brightness: 25,
      contrast: -10,
      saturation: 0,
      grayscale: 0,
    })

    store.undo()
    const undone = useEditorStore.getState().document!.layers[0]!
    expect(undone.kind === 'image' && undone.filters).toBeUndefined()

    store.redo()
    const redone = useEditorStore.getState().document!.layers[0]!
    expect(redone.kind === 'image' && redone.filters?.brightness).toBe(25)

    store.resetFilters(imageId)
    const reset = useEditorStore.getState().document!.layers[0]!
    expect(reset.kind === 'image' && reset.filters).toBeUndefined()
  })

  it('does not record a no-op gesture or mutate a locked layer', () => {
    useEditorStore.getState().createDraft('p1')
    useEditorStore.getState().addTextLayer()
    const id = useEditorStore.getState().selectedLayerId!
    const pastAfterInsert = useEditorStore.getState().past.length
    const start = useEditorStore.getState().document!.layers[0]!.transform
    useEditorStore.getState().beginGesture()
    useEditorStore.getState().applyTransform(id, start)
    useEditorStore.getState().commitGesture()
    expect(useEditorStore.getState().past).toHaveLength(pastAfterInsert)

    const locked = useEditorStore.getState().document!.layers[0]!
    useEditorStore.setState({
      document: {
        ...useEditorStore.getState().document!,
        layers: [{ ...locked, locked: true }],
      },
    })
    useEditorStore.getState().nudgeSelected(40, 0)
    useEditorStore.getState().rotateSelected90()
    expect(useEditorStore.getState().document!.layers[0]!.transform).toEqual(start)
  })
})
