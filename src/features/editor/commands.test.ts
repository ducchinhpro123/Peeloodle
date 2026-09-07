import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryRepository, createProjectDocument } from '../../lib/persistence/repository'
import type { AssetRecord } from '../../lib/persistence/repository'
import type { Transform } from '../../types/domain'
import { HISTORY_LIMIT, resetEditorStore, useEditorStore } from './store'
import { TEXT_PRESETS } from './catalog'

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

  it('rotates cropped and flipped images around their center with one undo entry per turn', () => {
    const record = pngRecord()
    const transform = { x: 300, y: 400, scaleX: -1.5, scaleY: 0.5, rotation: 30 }
    const document = createProjectDocument({ id: 'rotation' })
    document.assetIds = [record.asset.id]
    document.layers = [{ id: 'cat', kind: 'image', name: 'Cat', assetId: record.asset.id, visible: true, locked: false, opacity: 1, transform, crop: { x: 5, y: 10, width: 60, height: 40 } }]
    const center = (t: Transform) => {
      const radians = t.rotation * Math.PI / 180
      return [t.x + 30 * t.scaleX * Math.cos(radians) - 20 * t.scaleY * Math.sin(radians), t.y + 30 * t.scaleX * Math.sin(radians) + 20 * t.scaleY * Math.cos(radians)]
    }
    const store = useEditorStore.getState()
    store.hydrate(document, [record])
    for (let turn = 1; turn <= 4; turn++) {
      store.rotateSelected90()
      const next = useEditorStore.getState().document!.layers[0]!.transform
      expect(next.rotation).toBe(30 + 90 * turn)
      expect(center(next)[0]).toBeCloseTo(center(transform)[0]!)
      expect(center(next)[1]).toBeCloseTo(center(transform)[1]!)
      expect(useEditorStore.getState().past).toHaveLength(turn)
    }
    store.undo()
    expect(useEditorStore.getState().document!.layers[0]!.transform.rotation).toBe(300)
  })

  it('replaces a cropped, flipped photo without moving its center or changing other layers, and undoes it', () => {
    const original = pngRecord()
    const replacement = { ...original, asset: { ...original.asset, id: 'replacement', blobKey: 'replacement', width: 400, height: 200 } }
    const document = createProjectDocument({ id: 'replace' })
    const transform = { x: 300, y: 400, scaleX: -1.5, scaleY: 0.5, rotation: 30 }
    document.assetIds = [original.asset.id]
    document.layers = [{ id: 'photo', kind: 'image', name: 'Your photo', assetId: original.asset.id, visible: true, locked: false, opacity: 1, transform, crop: { x: 5, y: 10, width: 60, height: 40 }, maskKey: 'mask', outline: { enabled: true, color: '#ffffff', width: 9 } }]
    const store = useEditorStore.getState()
    store.hydrate(document, [original], [{ key: 'mask', blob: original.blob }])
    store.addTextLayer({ content: 'Keep my caption' })
    const before = structuredClone(useEditorStore.getState().document!)
    store.replaceImageLayer('photo', replacement)
    const state = useEditorStore.getState()
    const photo = state.document!.layers[0]!
    if (photo.kind !== 'image') throw new Error('Missing photo')
    expect(photo).toMatchObject({ assetId: 'replacement', name: 'Your photo', outline: { width: 9 }, transform: { rotation: 30, scaleX: -0.1, scaleY: 0.1 } })
    expect(photo.crop).toBeUndefined()
    expect(photo.maskKey).toBeUndefined()
    const center = (t: Transform, w: number, h: number) => {
      const r = t.rotation * Math.PI / 180
      return [t.x + w * t.scaleX / 2 * Math.cos(r) - h * t.scaleY / 2 * Math.sin(r), t.y + w * t.scaleX / 2 * Math.sin(r) + h * t.scaleY / 2 * Math.cos(r)]
    }
    center(photo.transform, 400, 200).forEach((value, index) => expect(value).toBeCloseTo(center(transform, 60, 40)[index]!))
    expect(state.document!.layers[1]).toEqual(before.layers[1])
    expect(state.past).toHaveLength(2)
    store.undo()
    expect(useEditorStore.getState().document!.layers).toEqual(before.layers)
    expect(useEditorStore.getState().assets[original.asset.id]).toBeDefined()
    expect(useEditorStore.getState().masks.mask).toBeDefined()
    store.redo()
    expect(useEditorStore.getState().document!.layers[0]).toMatchObject({ assetId: 'replacement' })
    store.toggleLayerLock('photo')
    const locked = useEditorStore.getState().document
    store.replaceImageLayer('photo', original)
    expect(useEditorStore.getState().document).toBe(locked)
  })

  it('inserts each text preset as one complete undoable edit', () => {
    for (const preset of TEXT_PRESETS) {
      const store = useEditorStore.getState()
      store.createDraft()
      store.addTextLayer(preset)
      const layer = useEditorStore.getState().document!.layers[0]!
      expect(layer).toMatchObject({ kind: 'text', content: preset.content, fontFamily: preset.fontFamily, fontSize: preset.fontSize, color: preset.color })
      expect(useEditorStore.getState().past).toHaveLength(1)
      store.undo()
      expect(useEditorStore.getState().document!.layers).toHaveLength(0)
      store.redo()
      expect(useEditorStore.getState().document!.layers[0]).toEqual(layer)
    }
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

  it('updates image silhouette outline settings with undo support', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.addImageLayer(pngRecord('asset-1'))
    const imageId = useEditorStore.getState().document!.layers[0]!.id

    store.updateOutline(imageId, { enabled: true, color: '#08b879', width: 16 })
    const layer = useEditorStore.getState().document!.layers[0]!
    expect(layer.kind === 'image' && layer.outline).toEqual({
      enabled: true,
      color: '#08b879',
      width: 16,
    })

    store.undo()
    const undone = useEditorStore.getState().document!.layers[0]!
    expect(undone.kind === 'image' && undone.outline).toBeUndefined()

    store.redo()
    const redone = useEditorStore.getState().document!.layers[0]!
    expect(redone.kind === 'image' && redone.outline?.width).toBe(16)
  })

  it('applies and clears masks with undo support and maintains duplicate-layer mask independence', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.addImageLayer(pngRecord('asset-1'))
    const imageId = useEditorStore.getState().document!.layers[0]!.id

    const maskBlob1 = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    store.applyMask(imageId, 'mask-key-1', maskBlob1)
    let layer = useEditorStore.getState().document!.layers[0]!
    expect(layer.kind === 'image' && layer.maskKey).toBe('mask-key-1')
    expect(useEditorStore.getState().masks['mask-key-1']).toBe(maskBlob1)

    // Undo restores unmasked layer
    store.undo()
    layer = useEditorStore.getState().document!.layers[0]!
    expect(layer.kind === 'image' && layer.maskKey).toBeUndefined()

    // Redo restores mask
    store.redo()
    layer = useEditorStore.getState().document!.layers[0]!
    expect(layer.kind === 'image' && layer.maskKey).toBe('mask-key-1')

    // Duplicate layer maintains mask independence
    store.duplicateSelected()
    const doc = useEditorStore.getState().document!
    expect(doc.layers).toHaveLength(2)
    const copyId = doc.layers[1]!.id
    expect(doc.layers[1]?.kind === 'image' && doc.layers[1].maskKey).toBe('mask-key-1')

    // Edit copy mask with a new key
    const maskBlob2 = new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' })
    store.applyMask(copyId, 'mask-key-2', maskBlob2)

    // Original layer still has mask-key-1!
    const layer0 = useEditorStore.getState().document!.layers[0]!
    expect(layer0.kind === 'image' ? layer0.maskKey : undefined).toBe('mask-key-1')
    // Copy has mask-key-2
    const layer1 = useEditorStore.getState().document!.layers[1]!
    expect(layer1.kind === 'image' ? layer1.maskKey : undefined).toBe('mask-key-2')

    // Clear mask
    store.clearMask(imageId)
    const layer0Cleared = useEditorStore.getState().document!.layers[0]!
    expect(layer0Cleared.kind === 'image' ? layer0Cleared.maskKey : undefined).toBeUndefined()
    store.undo()
    const layer0Restored = useEditorStore.getState().document!.layers[0]!
    expect(layer0Restored.kind === 'image' ? layer0Restored.maskKey : undefined).toBe('mask-key-1')
  })

  it('ignores invalid and unchanged mask commands without losing redo or dirtying the document', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.addImageLayer(pngRecord('asset-1'))
    const id = useEditorStore.getState().selectedLayerId!
    store.applyMask(id, 'mask', new Blob(['mask'], { type: 'image/png' }))
    store.undo()
    const before = useEditorStore.getState()
    store.clearMask(id)
    store.clearMask('absent')
    store.applyMask('absent', 'bad', new Blob(['bad']))
    store.applyMask(id, 'empty', new Blob())
    expect(useEditorStore.getState().document).toBe(before.document)
    expect(useEditorStore.getState().future).toBe(before.future)
    expect(useEditorStore.getState().masks).toBe(before.masks)
    store.redo()
    store.toggleLayerLock(id)
    const locked = useEditorStore.getState().document
    store.clearMask(id)
    store.applyMask(id, 'replacement', new Blob(['replacement']))
    expect(useEditorStore.getState().document).toBe(locked)
  })

  it('prunes masks when ordinary edits evict their last undo references', () => {
    const store = useEditorStore.getState()
    store.createDraft('p1')
    store.addImageLayer(pngRecord('asset-1'))
    const id = useEditorStore.getState().selectedLayerId!
    store.applyMask(id, 'mask', new Blob(['mask']))
    store.clearMask(id)
    for (let i = 0; i < 60; i++) store.updateTitle(`Project ${i}`)
    expect(useEditorStore.getState().masks).toEqual({})
    expect(useEditorStore.getState().past.length).toBeLessThanOrEqual(50)
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
