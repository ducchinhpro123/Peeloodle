import { beforeEach, describe, expect, it } from 'vitest'
import { usePresentationStore } from './store'
import { createPresentationDocument, createShapeElement, createTextElement } from '../model/factories'
import { PRESENTATION_LIMITS } from '../model/limits'
import type { PresentationDocument } from '../model/types'

function reset(document: PresentationDocument = createPresentationDocument({ id: 'doc-1', title: 'Deck', now: '2026-09-10T00:00:00.000Z' })): PresentationDocument {
  usePresentationStore.getState().loadDocument(document, { saved: true })
  return document
}

function state() {
  return usePresentationStore.getState()
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

  it('refuses to remove the last slide', () => {
    const only = state().document!.slides[0]!.id
    expect(state().removeSlide(only)).toBe(false)
    expect(state().document!.slides).toHaveLength(1)
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
