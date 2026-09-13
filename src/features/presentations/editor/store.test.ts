import { beforeEach, describe, expect, it } from 'vitest'
import { coverCrop, planImageInsert, planImageReplacement, reconcileHeldMedia, usePresentationStore } from './store'
import { createPresentationDocument, createShapeElement, createTextElement } from '../model/factories'
import { PRESENTATION_LIMITS } from '../model/limits'
import { MIN_ELEMENT_SIZE } from './transformGeometry'
import type { PreparedPresentationImage } from './insertImageAsset'
import type { PresentationMediaRecord } from '@/lib/persistence/presentations/repository'
import type { PresentationAsset, PresentationDocument } from '../model/types'

function reset(document: PresentationDocument = createPresentationDocument({ id: 'doc-1', title: 'Deck', now: '2026-09-10T00:00:00.000Z' })): PresentationDocument {
  usePresentationStore.getState().loadDocument(document, { saved: true })
  return document
}

function state() {
  return usePresentationStore.getState()
}

/** Stored bytes the document itself accounts for. */
function storedBytes(): number {
  return state().document!.assets.reduce((sum, asset) => sum + asset.byteLength, 0)
}

/** A document holding exactly one stored asset of `byteLength` bytes. */
function documentWithStoredAsset(byteLength: number, sha: string): PresentationDocument {
  const document = createPresentationDocument({ id: 'doc-1', title: 'Deck', now: '2026-09-10T00:00:00.000Z' })
  document.assets = [
    {
      id: `asset-${sha}`,
      blobKey: `uploads/${sha}`,
      mimeType: 'image/png',
      width: 4,
      height: 4,
      sha256: sha,
      byteLength,
      provenance: { source: 'upload', label: 'stored.png' },
    },
  ]
  return document
}

describe('presentation command store', () => {
  beforeEach(() => {
    reset()
  })

  it('loads a validated document and tracks saved/dirty state', () => {
    expect(state().document?.title).toBe('Deck')
    expect(state().dirty).toBe(false)
    expect(state().view.activeSlideId).toBe(state().document!.slides[0]!.id)

    state().loadDocument(createPresentationDocument({ id: 'doc-2', title: 'New' }), { saved: false })
    expect(state().dirty).toBe(true)
    expect(state().savedRevision).toBe(-1)

    state().markSaving()
    expect(state().saving).toBe(true)
    state().markSaved(state().document!.revision)
    expect(state().dirty).toBe(false)
    expect(state().saving).toBe(false)

    state().setSlideBackground(state().document!.slides[0]!.id, '#123456')
    expect(state().dirty).toBe(true)
    state().markSaveFailed('disk full')
    expect(state().saveError).toBe('disk full')
    expect(state().document?.slides[0]!.background).toBe('#123456')
  })

  it('keeps view actions out of the document and history', () => {
    const before = state().document!
    state().selectSlide(before.slides[0]!.id)
    state().setZoom(2)
    state().setPan({ x: 10, y: 20 })
    state().selectElements([])
    expect(state().document).toBe(before)
    expect(state().dirty).toBe(false)
    expect(state().past).toHaveLength(0)
    expect(state().view.zoom).toBe(2)
    expect(state().view.pan).toEqual({ x: 10, y: 20 })
  })

  it('keeps a live transform preview in view state only', () => {
    state().addElement(createShapeElement({ id: 'preview-me' }))
    const before = state().document!
    const history = state().past.length
    const dirty = state().dirty

    state().setTransformPreview({ elementId: 'preview-me', x: 300, y: 90, width: 600, height: 160, rotation: 30 })
    expect(state().view.transformPreview).toEqual({ elementId: 'preview-me', x: 300, y: 90, width: 600, height: 160, rotation: 30 })
    // Nothing is written while the gesture is still in progress.
    expect(state().document).toBe(before)
    expect(state().past).toHaveLength(history)
    expect(state().dirty).toBe(dirty)

    state().setTransformPreview(null)
    expect(state().view.transformPreview).toBeNull()
    expect(state().document).toBe(before)
  })

  it('shows alignment guides without touching the document', () => {
    state().addElement(createShapeElement({ id: 'dragged' }))
    const before = state().document
    const history = state().past.length
    const revision = state().document!.revision
    const dirty = state().dirty

    state().setGuides([{ axis: 'x', position: 400 }, { axis: 'y', position: 225 }])

    expect(state().view.guides).toEqual([{ axis: 'x', position: 400 }, { axis: 'y', position: 225 }])
    expect(state().document).toBe(before)
    expect(state().document!.revision).toBe(revision)
    expect(state().past).toHaveLength(history)
    expect(state().dirty).toBe(dirty)

    state().setGuides([])
    expect(state().view.guides).toEqual([])
  })

  it('gives a new slide the document theme background', () => {
    const theme = state().document!.theme
    state().setTheme({ ...theme, colors: { ...theme.colors, background: '#123456' } })
    const id = state().addSlide()!
    const slide = state().document!.slides.find((candidate) => candidate.id === id)!
    expect(slide.background).toBe('#123456')
  })

  it('changes theme defaults without restyling existing elements', () => {
    const styled = createTextElement({ id: 'styled', fontId: 'spectral', size: 30, color: '#111111', text: 'Keep me' })
    state().addElement(styled)
    const before = structuredClone(state().document!.slides[0]!.elements[0]!)

    const theme = state().document!.theme
    state().setTheme({ ...theme, bodyFontId: 'spectral', colors: { ...theme.colors, text: '#ff0000', accent: '#00ff00' } })

    expect(state().document!.slides[0]!.elements[0]!).toEqual(before)
    expect(state().document!.theme).toMatchObject({ bodyFontId: 'spectral', colors: { text: '#ff0000', accent: '#00ff00' } })
  })

  it('groups slide background changes into one undo entry', () => {
    const slideId = state().document!.slides[0]!.id
    const history = state().past.length
    state().setSlideBackground(slideId, '#111111', { historyGroup: `slide-bg:${slideId}` })
    state().setSlideBackground(slideId, '#222222', { historyGroup: `slide-bg:${slideId}` })
    expect(state().past).toHaveLength(history + 1)
    state().endHistoryGroup()
    state().setSlideBackground(slideId, '#333333')
    expect(state().past).toHaveLength(history + 2)
    state().undo()
    expect(state().document!.slides[0]!.background).toBe('#222222')
  })

  it('commits one completed gesture as one history entry and clears the preview', () => {
    state().addElement(createShapeElement({ id: 'drag-me', x: 80, y: 80, width: 600, height: 160 }))
    const history = state().past.length

    state().setTransformPreview({ elementId: 'drag-me', x: 300, y: 90, width: 600, height: 160, rotation: 0 })
    state().commitTransform('drag-me', { x: 300, y: 90, width: 600, height: 160, rotation: 0 })
    const element = state().document!.slides[0]!.elements[0]!
    expect({ x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation })
      .toEqual({ x: 300, y: 90, width: 600, height: 160, rotation: 0 })
    expect(state().past).toHaveLength(history + 1)
    expect(state().view.transformPreview).toBeNull()
    expect(state().dirty).toBe(true)

    // The next gesture is its own entry, and undo restores the pre-gesture state.
    state().commitTransform('drag-me', { x: 320, y: 90, width: 600, height: 160, rotation: 0 })
    expect(state().past).toHaveLength(history + 2)
    state().undo()
    expect(state().document!.slides[0]!.elements[0]!.x).toBe(300)
  })

  it('refuses to commit transforms for locked elements or unusable geometry', () => {
    state().addElement(createShapeElement({ id: 'locked', locked: true, x: 40, y: 40, width: 200, height: 100 }))
    const history = state().past.length

    state().commitTransform('locked', { x: 500, y: 500, width: 200, height: 100, rotation: 0 })
    state().commitTransform('missing', { x: 500, y: 500, width: 200, height: 100, rotation: 0 })
    state().commitTransform('locked', { x: Number.NaN, y: 0, width: 200, height: 100, rotation: 0 })
    state().toggleElementLocked('locked')
    // Unlocking is a document command of its own; the refused transforms below add nothing.
    expect(state().past).toHaveLength(history + 1)
    state().commitTransform('locked', { x: 500, y: 500, width: Number.POSITIVE_INFINITY, height: 100, rotation: 0 })
    state().commitTransform('locked', { x: 500, y: 500, width: 2, height: 100, rotation: 0 })

    const element = state().document!.slides[0]!.elements[0]!
    // Only the last call was a usable transform, and its tiny width was clamped.
    expect({ x: element.x, y: element.y, width: element.width, height: element.height }).toEqual({ x: 500, y: 500, width: MIN_ELEMENT_SIZE, height: 100 })
    expect(state().past).toHaveLength(history + 2)
  })

  it('opens and closes the text editor as view state only', () => {
    const slideId = state().document!.slides[0]!.id
    const text = createTextElement({ id: 'text-1' })
    state().addElement(text)
    const revisions = state().document!.revision
    const history = state().past.length
    const dirty = state().dirty

    state().startTextEdit('text-1')
    expect(state().view.editingElementId).toBe('text-1')
    expect(state().view.selectedElementIds).toEqual(['text-1'])
    expect(state().dirty).toBe(dirty)
    expect(state().document!.revision).toBe(revisions)

    state().endTextEdit()
    expect(state().view.editingElementId).toBeNull()

    // Non-text and unknown elements cannot be opened, and switching slides closes the editor.
    state().addElement(createShapeElement({ id: 'shape-1' }))
    state().startTextEdit('shape-1')
    expect(state().view.editingElementId).toBeNull()
    state().startTextEdit('missing')
    expect(state().view.editingElementId).toBeNull()
    state().startTextEdit('text-1')
    state().selectSlide(slideId)
    expect(state().view.editingElementId).toBeNull()
    expect(state().past).toHaveLength(history + 1)
  })

  it('drops a stale editing target when undo removes the element', () => {
    state().addElement(createTextElement({ id: 'text-1' }))
    state().startTextEdit('text-1')
    state().undo()
    expect(state().view.editingElementId).toBeNull()
    expect(state().document!.slides[0]!.elements).toHaveLength(0)
  })

  it('clears the editing target when its element or slide goes away', () => {
    const first = state().document!.slides[0]!.id
    state().addElement(createTextElement({ id: 'text-1' }))
    state().startTextEdit('text-1')
    state().removeElement('text-1')
    expect(state().view.editingElementId).toBeNull()

    state().addElement(createTextElement({ id: 'text-2' }))
    state().startTextEdit('text-2')
    const second = state().addSlide(first)
    expect(state().view.editingElementId).toBeNull()
    expect(state().view.activeSlideId).toBe(second)

    // Removing the slide that holds the edited element drops the target too.
    state().selectSlide(second!)
    state().startTextEdit('text-2')
    state().removeSlide(second!)
    expect(state().view.activeSlideId).toBe(first)
    expect(state().view.editingElementId).toBeNull()
  })

  it('adds, duplicates, reorders and removes slides', () => {
    const first = state().document!.slides[0]!.id
    const element = createShapeElement({ id: 'shape-1' })
    state().addElement(element)
    const second = state().addSlide(first)
    expect(second).not.toBeNull()
    expect(state().document!.slides).toHaveLength(2)
    expect(state().view.activeSlideId).toBe(second)

    const copy = state().duplicateSlide(first)
    expect(copy).not.toBeNull()
    expect(state().document!.slides).toHaveLength(3)
    const source = state().document!.slides.find((slide) => slide.id === first)!
    const duplicated = state().document!.slides.find((slide) => slide.id === copy)!
    expect(duplicated.elements[0]!.id).not.toBe(source.elements[0]!.id)
    expect(duplicated.name).toContain('copy')

    state().reorderSlide(copy!, 0)
    expect(state().document!.slides[0]!.id).toBe(copy)

    expect(state().removeSlide(copy!)).toBe(true)
    expect(state().document!.slides).toHaveLength(2)
    expect(state().view.activeSlideId).toBe(state().document!.slides[0]!.id)
  })

  it('selects the adjacent slide when the active slide is removed', () => {
    const first = state().document!.slides[0]!.id
    const second = state().addSlide(first)!
    const third = state().addSlide(second)!

    state().selectSlide(second)
    state().removeSlide(second)
    expect(state().view.activeSlideId).toBe(third)

    state().removeSlide(third)
    expect(state().view.activeSlideId).toBe(first)
  })

  it('refuses to remove the last slide', () => {
    const only = state().document!.slides[0]!.id
    expect(state().removeSlide(only)).toBe(false)
    expect(state().document!.slides).toHaveLength(1)
  })

  it('duplicates an element with a fresh id, an offset and one undo entry', () => {
    state().addElement(createShapeElement({ id: 'original', x: 100, y: 80, width: 200, height: 120 }))
    const history = state().past.length

    const copyId = state().duplicateElement('original')!

    expect(copyId).not.toBe('original')
    const elements = state().document!.slides[0]!.elements
    expect(elements.map((element) => element.id)).toEqual(['original', copyId])
    expect(elements[1]!).toMatchObject({ name: 'Element 1 copy', x: 124, y: 104, width: 200, height: 120 })
    expect(state().view.selectedElementIds).toEqual([copyId])
    expect(state().past).toHaveLength(history + 1)

    state().undo()
    expect(state().document!.slides[0]!.elements.map((element) => element.id)).toEqual(['original'])
  })

  it('refuses to duplicate a missing element', () => {
    expect(state().duplicateElement('missing')).toBeNull()
  })

  it('inserts, updates, reorders and removes elements', () => {
    const a = createShapeElement({ id: 'a' })
    const b = createShapeElement({ id: 'b' })
    state().addElement(a)
    state().addElement(b)
    expect(state().view.selectedElementIds).toEqual(['b'])
    expect(state().document!.slides[0]!.elements.map((element) => element.id)).toEqual(['a', 'b'])

    state().reorderElement('b', 0)
    expect(state().document!.slides[0]!.elements.map((element) => element.id)).toEqual(['b', 'a'])

    state().updateElement('a', { x: 200, opacity: 0.5 })
    const updated = state().document!.slides[0]!.elements.find((element) => element.id === 'a')
    expect(updated?.x).toBe(200)
    expect(updated?.opacity).toBe(0.5)

    state().removeElement('a')
    expect(state().view.selectedElementIds).toEqual(['b'])
    expect(state().document!.slides[0]!.elements).toHaveLength(1)

    state().toggleElementLocked('b')
    expect(state().document!.slides[0]!.elements[0]!.locked).toBe(true)
    state().transformElement('b', { x: 999 })
    expect(state().document!.slides[0]!.elements[0]!.x).not.toBe(999)
    state().toggleElementVisible('b')
    expect(state().document!.slides[0]!.elements[0]!.visible).toBe(false)
  })

  it('updates rich text and restores it with undo', () => {
    const text = createTextElement({ id: 't', text: 'before' })
    state().addElement(text)
    state().updateText('t', [
      {
        runs: [
          { text: 'xin chào', fontId: 'be-vietnam-pro', size: 28, color: '#08152f', bold: true },
          { text: ' thế giới', fontId: 'be-vietnam-pro', size: 28, color: '#08152f' },
        ],
        alignment: 'center',
        bullet: 'none',
        bulletLevel: 0,
      },
    ])
    const element = state().document!.slides[0]!.elements[0]!
    expect(element.kind).toBe('text')
    if (element.kind !== 'text') throw new Error('expected text')
    expect(element.paragraphs[0]!.runs[0]!.bold).toBe(true)
    state().undo()
    const restored = state().document!.slides[0]!.elements[0]!
    if (restored.kind !== 'text') throw new Error('expected text')
    expect(restored.paragraphs[0]!.runs[0]!.text).toBe('before')
  })

  it('groups one gesture into one undo entry', () => {
    const element = createShapeElement({ id: 'drag-me' })
    state().addElement(element)
    const afterInsert = state().past.length
    state().transformElement('drag-me', { x: 100 })
    state().transformElement('drag-me', { x: 140 })
    state().transformElement('drag-me', { x: 180 })
    expect(state().past.length).toBe(afterInsert + 1)
    state().endHistoryGroup()
    state().transformElement('drag-me', { x: 200 })
    expect(state().past.length).toBe(afterInsert + 2)
    state().undo()
    expect(state().document!.slides[0]!.elements[0]!.x).toBe(180)
    state().undo()
    expect(state().document!.slides[0]!.elements[0]!.x).toBe(80)
  })

  it('undoes across slides and keeps history when switching slides', () => {
    const first = state().document!.slides[0]!.id
    state().addElement(createShapeElement({ id: 's1' }))
    const second = state().addSlide(first)!
    state().addElement(createShapeElement({ id: 's2' }))
    state().undo() // remove s2
    expect(state().document!.slides.find((slide) => slide.id === second)!.elements).toHaveLength(0)
    state().undo() // remove slide 2
    expect(state().document!.slides).toHaveLength(1)
    expect(state().past.length).toBe(1)
    state().undo() // remove s1
    expect(state().document!.slides[0]!.elements).toHaveLength(0)
    expect(state().past).toHaveLength(0)
    state().redo()
    expect(state().document!.slides[0]!.elements).toHaveLength(1)
    state().selectSlide(first)
    expect(state().past.length).toBeGreaterThan(0)
  })

  it('bounds history entries and clears redo on a new edit', () => {
    for (let i = 0; i < PRESENTATION_LIMITS.historyEntries + 10; i += 1) {
      state().addSlide()
    }
    expect(state().past.length).toBeLessThanOrEqual(PRESENTATION_LIMITS.historyEntries)
    state().undo()
    expect(state().future.length).toBe(1)
    state().addSlide()
    expect(state().future).toHaveLength(0)
  })

  it('does not erase redo history on a no-op command', () => {
    state().addElement(createShapeElement({ id: 'x' }))
    state().undo()
    expect(state().future).toHaveLength(1)
    const revision = state().document!.revision
    const pastLength = state().past.length
    const slideId = state().document!.slides[0]!.id
    // Reordering the only slide to its current position must not dirty the document.
    state().reorderSlide(slideId, 0)
    expect(state().document!.revision).toBe(revision)
    expect(state().past).toHaveLength(pastLength)
    expect(state().future).toHaveLength(1)
    // Redo still works after the no-op.
    state().redo()
    expect(state().document!.slides[0]!.elements).toHaveLength(1)
  })

  it('ignores commands that change nothing', () => {
    state().addElement(createShapeElement({ id: 'x', x: 80 }))
    const revision = state().document!.revision
    const pastLength = state().past.length
    const dirty = state().dirty
    const slide = state().document!.slides[0]!
    state().updateElement('x', { x: 80 })
    state().setSlideBackground(slide.id, slide.background)
    state().renameSlide(slide.id, slide.name)
    state().removeElement('missing-element')
    state().reorderElement('x', 0)
    state().setTheme(state().document!.theme)
    expect(state().document!.revision).toBe(revision)
    expect(state().past).toHaveLength(pastLength)
    expect(state().dirty).toBe(dirty)
  })

  it('treats structurally identical nested patches as no-ops', () => {
    const text = createTextElement({ id: 'text-keep', text: 'giữ nguyên' })
    state().addElement(text)
    const revision = state().document!.revision
    const pastLength = state().past.length
    const current = state().document!.slides[0]!.elements.find((element) => element.id === 'text-keep')!
    if (current.kind !== 'text') throw new Error('expected text')
    state().updateElement('text-keep', { paragraphs: structuredClone(current.paragraphs) })
    state().updateElement('text-keep', { crop: undefined })
    expect(state().document!.revision).toBe(revision)
    expect(state().past).toHaveLength(pastLength)
  })

  it('removing an unknown slide is a no-op that preserves redo', () => {
    state().addElement(createShapeElement({ id: 'x' }))
    state().undo()
    expect(state().future).toHaveLength(1)
    const revision = state().document!.revision
    const pastLength = state().past.length
    expect(state().removeSlide('missing-slide')).toBe(false)
    expect(state().document!.revision).toBe(revision)
    expect(state().past).toHaveLength(pastLength)
    expect(state().future).toHaveLength(1)
  })

  it('refuses to add an element with an id that already exists', () => {
    state().addElement(createShapeElement({ id: 'dup' }))
    const revision = state().document!.revision
    const pastLength = state().past.length
    expect(state().addElement(createShapeElement({ id: 'dup' }))).toBeNull()
    expect(state().document!.revision).toBe(revision)
    expect(state().past).toHaveLength(pastLength)
  })

  it('keeps one history entry when a grouped update changes nothing on the last frame', () => {
    state().addElement(createShapeElement({ id: 'drag', x: 80 }))
    const before = state().past.length
    state().transformElement('drag', { x: 100 })
    state().transformElement('drag', { x: 100 })
    state().transformElement('drag', { x: 100 })
    expect(state().past).toHaveLength(before + 1)
  })

  it('validates documents on load and never stores raw input', () => {
    const bad = { ...createPresentationDocument(), schemaVersion: 99 }
    expect(() => state().loadDocument(bad as unknown as PresentationDocument)).toThrow()
  })

  it('keeps selection valid when undoing element removal', () => {
    const element = createShapeElement({ id: 'keep' })
    state().addElement(element)
    state().selectElements(['keep'])
    expect(state().view.selectedElementIds).toEqual(['keep'])
    state().removeElement('keep')
    expect(state().view.selectedElementIds).toEqual([])
    state().undo()
    expect(state().document!.slides[0]!.elements[0]!.id).toBe('keep')
    // Undo restores content; selection is allowed to stay empty rather than resurrecting stale ids.
    expect(state().view.selectedElementIds).toEqual([])
  })
})

describe('presentation image insertion', () => {
  function preparedImage(imageSha = 'a'.repeat(64), width = 400, height = 300): PreparedPresentationImage {
    const asset: PresentationAsset = {
      id: `asset-${imageSha}`,
      blobKey: `uploads/${imageSha}`,
      mimeType: 'image/png',
      width,
      height,
      sha256: imageSha,
      byteLength: 4,
      provenance: { source: 'upload', label: 'photo.png' },
    }
    return { asset, media: { assetId: asset.id, bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' } }
  }

  beforeEach(() => {
    reset()
  })

  it('inserts a stored image as one history entry and keeps its bytes out of the document', () => {
    const prepared = preparedImage()
    const before = state().past.length

    const id = state().insertImage(prepared)

    expect(id).toBeTruthy()
    expect(state().past).toHaveLength(before + 1)
    expect(state().dirty).toBe(true)
    expect(state().view.selectedElementIds).toEqual([id])
    expect(state().document!.slides[0]!.elements[0]!).toMatchObject({
      kind: 'image',
      assetId: prepared.asset.id,
      name: 'Image',
      // 400×300 at its own size, centred on the 1280×720 page.
      x: 440,
      y: 210,
      width: 400,
      height: 300,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    })
    expect(state().document!.assets).toEqual([prepared.asset])

    // The bytes are held for the save and never enter the document JSON.
    expect(state().pendingMedia).toHaveLength(1)
    expect(state().pendingMedia[0]!.assetId).toBe(prepared.asset.id)
    expect(JSON.stringify(state().document)).not.toContain('bytes')
  })

  it('removes the inserted element with undo', () => {
    const id = state().insertImage(preparedImage())!
    expect(state().mediaForSave()).toHaveLength(1)

    state().undo()
    expect(state().document!.slides[0]!.elements).toHaveLength(0)
    // Undo restores the pre-insert snapshot, so the asset record goes with it.
    expect(state().document!.assets).toHaveLength(0)
    // The bytes stay held while redo can still reach them, but a save may only
    // submit what the document references.
    expect(state().pendingMedia).toHaveLength(1)
    expect(state().mediaForSave()).toEqual([])

    state().redo()
    expect(state().document!.slides[0]!.elements[0]!.id).toBe(id)
    expect(state().mediaForSave()).toHaveLength(1)
  })

  it('releases held bytes once no snapshot can reach them', () => {
    state().insertImage(preparedImage())
    state().undo()
    expect(state().pendingMedia).toHaveLength(1)

    // A new command clears redo, so nothing can reference the bytes any more.
    state().addElement(createShapeElement({ id: 'after-undo' }))
    expect(state().future).toHaveLength(0)
    expect(state().pendingMedia).toEqual([])
  })

  it('keeps held bytes across undo and redo while the snapshot chain references them', () => {
    state().insertImage(preparedImage())
    state().undo()
    state().redo()
    expect(state().pendingMedia).toHaveLength(1)
    state().undo()
    expect(state().pendingMedia).toHaveLength(1)
    state().redo()
    expect(state().mediaForSave()).toHaveLength(1)
  })

  it('reuses one asset record and one media record for identical bytes', () => {
    const prepared = preparedImage()
    const first = state().insertImage(prepared)!
    const second = state().insertImage(prepared)!

    expect(first).not.toBe(second)
    expect(state().document!.assets).toHaveLength(1)
    expect(state().document!.slides[0]!.elements).toHaveLength(2)
    expect(state().pendingMedia).toHaveLength(1)
    expect(state().past).toHaveLength(2)
  })

  it('names each further image on the slide', () => {
    state().insertImage(preparedImage('b'.repeat(64)))
    state().insertImage(preparedImage('c'.repeat(64)))

    expect(state().document!.slides[0]!.elements.map((element) => element.name)).toEqual(['Image', 'Image 2'])
  })

  it('refuses to insert without an open document', () => {
    state().closeDocument()

    expect(state().insertImage(preparedImage())).toBeNull()
  })

  it('refuses a new asset at the asset limit but still allows one the document holds', () => {
    const full = createPresentationDocument({ id: 'full', now: '2026-09-10T00:00:00.000Z' })
    full.assets = Array.from({ length: PRESENTATION_LIMITS.maxAssets }, (_, index) => ({
      id: `asset-${index.toString(16).padStart(64, '0')}`,
      blobKey: `uploads/${index}`,
      mimeType: 'image/png' as const,
      width: 4,
      height: 4,
      sha256: index.toString(16).padStart(64, '0'),
      byteLength: 4,
      provenance: { source: 'upload' as const, label: 'seeded' },
    }))
    reset(full)

    expect(state().insertImage(preparedImage('d'.repeat(64)))).toBeNull()
    expect(state().document!.assets).toHaveLength(PRESENTATION_LIMITS.maxAssets)
    expect(state().insertImage(preparedImage('0'.repeat(64)))).toBeTruthy()
  })

  it('drops held media for the stored assets only', () => {
    const first = preparedImage('e'.repeat(64))
    const second = preparedImage('f'.repeat(64))
    state().insertImage(first)
    state().insertImage(second)
    expect(state().pendingMedia).toHaveLength(2)

    state().clearPendingMedia([first.asset.id])
    expect(state().pendingMedia.map((record) => record.assetId)).toEqual([second.asset.id])

    state().clearPendingMedia([first.asset.id, second.asset.id])
    expect(state().pendingMedia).toEqual([])
  })

  it('never carries held media into the next document', () => {    state().insertImage(preparedImage())
    expect(state().pendingMedia).toHaveLength(1)

    reset(createPresentationDocument({ id: 'doc-2', now: '2026-09-10T00:00:00.000Z' }))
    expect(state().pendingMedia).toEqual([])

    state().insertImage(preparedImage('9'.repeat(64)))
    state().closeDocument()
    expect(state().pendingMedia).toEqual([])
  })

  it('refuses an image that would exceed the media budget, before mutating anything', () => {
    // The artwork already stored fills almost the whole budget.
    reset(documentWithStoredAsset(PRESENTATION_LIMITS.maxMediaBytes - 1, '1'.repeat(64)))

    const document = state().document!
    const history = state().past.length
    const pending = state().pendingMedia.length

    const check = state().checkImageInsert(preparedImage('2'.repeat(64)))
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected a refusal')
    expect(check.reason).toBe('media-limit')
    // The message has to be actionable: the limit, what is stored, and the file.
    expect(check.message).toContain(`${PRESENTATION_LIMITS.maxMediaBytes / (1024 * 1024)}.0 MB`)
    expect(check.message).toContain('photo.png')

    // The command refuses for the same reason, and nothing moved.
    expect(state().insertImage(preparedImage('2'.repeat(64)))).toBeNull()
    expect(state().document).toBe(document)
    expect(state().past).toHaveLength(history)
    expect(state().pendingMedia).toHaveLength(pending)
  })

  it('still accepts re-inserting artwork the presentation already holds when the budget is full', () => {
    // The whole budget is accounted for by that one stored asset.
    reset(documentWithStoredAsset(PRESENTATION_LIMITS.maxMediaBytes, '5'.repeat(64)))

    // A genuinely new asset has no room.
    const refused = state().checkImageInsert(preparedImage('6'.repeat(64)))
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('expected a refusal')
    expect(refused.reason).toBe('media-limit')

    // The same bytes again add no storage, so refusing it would be wrong: this is
    // what the known-asset exemption in the byte budget exists for.
    expect(state().checkImageInsert(preparedImage('5'.repeat(64))).ok).toBe(true)
    expect(state().insertImage(preparedImage('5'.repeat(64)))).not.toBeNull()
    expect(state().document!.assets).toHaveLength(1)
  })

  it('never charges the media budget twice for identical content', () => {
    state().insertImage(preparedImage('3'.repeat(64)))
    expect(state().document!.assets).toHaveLength(1)
    expect(storedBytes()).toBe(4)

    state().insertImage(preparedImage('3'.repeat(64)))

    expect(state().document!.assets).toHaveLength(1)
    expect(storedBytes()).toBe(4)
    expect(state().pendingMedia).toHaveLength(1)
  })

  it('plans a replacement that keeps placement and flips and center-crops the new image', () => {
    state().insertImage(preparedImage())
    const element = state().document!.slides[0]!.elements[0]!
    if (element.kind !== 'image') throw new Error('expected image')
    state().updateElement(element.id, { flipX: true, x: 100, y: 50, width: 300, height: 300 })

    const replacement = preparedImage('b'.repeat(64), 400, 300)
    const plan = planImageReplacement(state().document!, element.id, replacement)!

    const replaced = plan.document.slides[0]!.elements[0]!
    if (replaced.kind !== 'image') throw new Error('expected image')
    expect(replaced).toMatchObject({ x: 100, y: 50, width: 300, height: 300, flipX: true, assetId: replacement.asset.id, alt: 'photo.png' })
    // The 4:3 image is cover-cropped to the square box, not stretched.
    expect(replaced.crop).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 })
    expect(plan.document.assets.map((asset) => asset.id)).toContain(replacement.asset.id)
    // The original document is untouched: the plan is what gets persisted first.
    expect(element.assetId).not.toBe(replacement.asset.id)
  })

  it('cover-crops a wider image to the box aspect instead of stretching it', () => {
    const wide = preparedImage('c'.repeat(64), 800, 200)
    expect(coverCrop(wide, { width: 300, height: 300 })).toEqual({ x: 0.375, y: 0, width: 0.25, height: 1 })
  })

  it('replaces an image as one undo entry and restores the original', () => {
    const first = preparedImage()
    state().insertImage(first)
    const element = state().document!.slides[0]!.elements[0]!
    if (element.kind !== 'image') throw new Error('expected image')
    const history = state().past.length

    const second = preparedImage('d'.repeat(64), 200, 400)
    expect(state().replaceImage(element.id, second)).toBe(true)
    expect(state().past).toHaveLength(history + 1)
    const replaced = state().document!.slides[0]!.elements[0]!
    if (replaced.kind !== 'image') throw new Error('expected image')
    expect(replaced.assetId).toBe(second.asset.id)
    // A portrait image is cropped to the 400×300 box, not squashed into it.
    expect(replaced.crop).toEqual({ x: 0, y: 0.3125, width: 1, height: 0.375 })
    expect(state().mediaForSave().map((record) => record.assetId)).toContain(second.asset.id)

    state().undo()
    const restored = state().document!.slides[0]!.elements[0]!
    if (restored.kind !== 'image') throw new Error('expected image')
    expect(restored.assetId).toBe(first.asset.id)
    expect(restored.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })

    state().redo()
    const again = state().document!.slides[0]!.elements[0]!
    if (again.kind !== 'image') throw new Error('expected image')
    expect(again.assetId).toBe(second.asset.id)
  })

  it('refuses to replace anything that is not a selected image', () => {
    const text = createTextElement({ id: 'not-an-image' })
    state().addElement(text)
    const history = state().past.length
    expect(state().replaceImage('not-an-image', preparedImage())).toBe(false)
    expect(state().replaceImage('missing', preparedImage())).toBe(false)
    expect(state().past).toHaveLength(history)
  })

  it('plans an insert without mutating the document or the store', () => {    const before = state().document!

    const plan = planImageInsert(before, preparedImage('5'.repeat(64)))

    expect(plan).not.toBeNull()
    expect(plan!.document.revision).toBe(before.revision + 1)
    expect(plan!.document.assets[0]!.byteLength).toBe(4)
    // The plan is what gets persisted first, so building it must change nothing.
    expect(before.slides[0]!.elements).toHaveLength(0)
    expect(before.assets).toHaveLength(0)
    expect(state().document).toBe(before)
    expect(state().pendingMedia).toEqual([])
    expect(state().past).toHaveLength(0)
  })

  it('adopts an already-persisted insert without leaving the editor dirty', () => {
    const document = state().document!
    const image = preparedImage('6'.repeat(64))
    const plan = planImageInsert(document, image)!
    const history = state().past.length

    state().adoptPersistedInsert(plan, image)

    // The revision the plan carries is the one that was written.
    expect(state().document!.revision).toBe(plan.document.revision)
    expect(state().savedRevision).toBe(plan.document.revision)
    expect(state().dirty).toBe(false)
    expect(state().saving).toBe(false)
    expect(state().saveError).toBeNull()
    expect(state().past).toHaveLength(history + 1)
    expect(state().view.selectedElementIds).toEqual([plan.elementId])
    expect(state().document!.assets[0]!.byteLength).toBe(4)
    // The bytes are already stored, so nothing is held as pending.
    expect(state().pendingMedia).toEqual([])
  })
})

describe('bounded media retention', () => {
  function documentWithAsset(documentId: string, assetId: string, byteLength: number): PresentationDocument {
    const document = createPresentationDocument({ id: documentId })
    document.assets = [{
      id: assetId,
      blobKey: `uploads/${assetId}`,
      mimeType: 'image/png',
      width: 4,
      height: 4,
      sha256: assetId.padEnd(64, '0'),
      byteLength,
      provenance: { source: 'upload', label: `${assetId}.png` },
    }]
    return document
  }

  function record(assetId: string, byteLength: number): PresentationMediaRecord {
    return { assetId, bytes: new Uint8Array(byteLength), mimeType: 'image/png' }
  }

  it('releases unreachable bytes and trims the oldest snapshot when over budget', () => {
    const current = documentWithAsset('doc-current', 'asset-c', 10)
    const past = [{ document: documentWithAsset('doc-past', 'asset-a', 10), bytes: 1 }]
    const future = [{ document: documentWithAsset('doc-future', 'asset-b', 10), bytes: 1 }]
    const pendingMedia = [record('asset-a', 10), record('asset-b', 10), record('asset-c', 10)]

    const result = reconcileHeldMedia({ document: current, past, future, pendingMedia, maxBytes: 25 })

    // A's snapshot is the oldest, so it goes first; its bytes are released with it.
    expect(result.past).toEqual([])
    expect(result.future).toEqual(future)
    expect(result.pendingMedia.map((item) => item.assetId)).toEqual(['asset-b', 'asset-c'])
  })

  it('drops bytes nothing references without trimming history', () => {
    const current = documentWithAsset('doc-current', 'asset-c', 10)
    const past = [{ document: documentWithAsset('doc-past', 'asset-a', 10), bytes: 1 }]

    const result = reconcileHeldMedia({
      document: current,
      past,
      future: [],
      pendingMedia: [record('asset-a', 10), record('asset-c', 10), record('asset-orphan', 10)],
      maxBytes: 1024,
    })

    expect(result.past).toEqual(past)
    expect(result.pendingMedia.map((item) => item.assetId)).toEqual(['asset-a', 'asset-c'])
  })

  it('never releases bytes the current document still needs', () => {
    const current = documentWithAsset('doc-current', 'asset-current', 100)

    const result = reconcileHeldMedia({
      document: current,
      past: [],
      future: [],
      pendingMedia: [record('asset-current', 100)],
      maxBytes: 10,
    })

    expect(result.pendingMedia.map((item) => item.assetId)).toEqual(['asset-current'])
  })
})
