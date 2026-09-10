/**
 * Presentation command store (P11).
 *
 * The serializable document is the single source of truth; Konva/DOM layers
 * read from it. All document mutations go through commands that create a new
 * validated revision and one undo entry (optionally grouped so one drag or
 * slider gesture produces one entry). Selection, zoom, pan and slide navigation
 * live in `view` and never dirty the document.
 */

import { create } from 'zustand'
import { PRESENTATION_LIMITS } from '../model/limits'
import { serializePresentationDocument } from '../model/parse'
import { createSlide, nextSlideName } from '../model/factories'
import type { Element, PresentationDocument, Slide, TextParagraph, Theme } from '../model/types'

export type PresentationViewState = {
  activeSlideId: string | null
  selectedElementIds: string[]
  zoom: number
  pan: { x: number; y: number }
}

type HistoryEntry = { document: PresentationDocument; bytes: number }

export type PresentationStoreState = {
  document: PresentationDocument | null
  view: PresentationViewState
  /** Revision known to be persisted; -1 means the document was never saved. */
  savedRevision: number
  dirty: boolean
  saving: boolean
  saveError: string | null
  past: HistoryEntry[]
  future: HistoryEntry[]
  lastHistoryGroup: string | null

  loadDocument(document: PresentationDocument, options?: { saved?: boolean }): void
  closeDocument(): void
  markSaving(): void
  markSaved(revision: number): void
  markSaveFailed(message: string): void

  selectSlide(slideId: string): void
  selectElements(ids: string[]): void
  toggleElementSelection(id: string, additive?: boolean): void
  setZoom(zoom: number): void
  setPan(pan: { x: number; y: number }): void

  addSlide(afterSlideId?: string): string | null
  duplicateSlide(slideId: string): string | null
  renameSlide(slideId: string, name: string): void
  reorderSlide(slideId: string, targetIndex: number): void
  removeSlide(slideId: string): boolean
  setSlideBackground(slideId: string, background: string): void

  addElement(element: Element): string | null
  updateElement(elementId: string, patch: Partial<Element>, options?: { historyGroup?: string }): void
  transformElement(elementId: string, patch: Partial<Pick<Element, 'x' | 'y' | 'width' | 'height' | 'rotation'>>, options?: { historyGroup?: string }): void
  removeElement(elementId: string): void
  reorderElement(elementId: string, targetIndex: number): void
  toggleElementLocked(elementId: string): void
  toggleElementVisible(elementId: string): void
  updateText(elementId: string, paragraphs: TextParagraph[], options?: { historyGroup?: string }): void
  setTheme(theme: Theme): void

  endHistoryGroup(): void
  undo(): void
  redo(): void
}

const initialView: PresentationViewState = { activeSlideId: null, selectedElementIds: [], zoom: 1, pan: { x: 0, y: 0 } }

function estimateBytes(document: PresentationDocument): number {
  try {
    return JSON.stringify(document).length
  } catch {
    return 0
  }
}

function withRevision(current: PresentationDocument, next: PresentationDocument): PresentationDocument {
  next.revision = current.revision + 1
  next.updatedAt = new Date().toISOString()
  return next
}

function cloneElementWithNewId(element: Element): Element {
  const copy = structuredClone(element)
  copy.id = crypto.randomUUID()
  return copy
}

export const usePresentationStore = create<PresentationStoreState>()((set, get) => {
  /** Validates, bumps the revision and records one undo entry. Updaters return
   * `false` for a no-op so redo history and the revision are left untouched. */
  const commit = (updater: (draft: PresentationDocument) => boolean | void, options: { historyGroup?: string } = {}): void => {
    const current = get().document
    if (!current) return
    const draft = structuredClone(current)
    const changed = updater(draft)
    if (changed === false) return
    const next = serializePresentationDocument(withRevision(current, draft))
    const group = options.historyGroup
    const merge = group !== undefined && group === get().lastHistoryGroup
    let past = get().past
    if (!merge) {
      past = [...past, { document: current, bytes: estimateBytes(current) }]
      while (past.length > PRESENTATION_LIMITS.historyEntries || (past.length > 1 && past.reduce((sum, entry) => sum + entry.bytes, 0) > PRESENTATION_LIMITS.historySoftBytes)) {
        past = past.slice(1)
      }
    }
    set({
      document: next,
      past,
      future: [],
      lastHistoryGroup: group ?? null,
      dirty: next.revision !== get().savedRevision,
    })
  }

  const activeSlide = (): Slide | undefined => {
    const { document, view } = get()
    if (!document) return undefined
    return document.slides.find((slide) => slide.id === view.activeSlideId) ?? document.slides[0]
  }

  const selectSurvivor = (slides: Slide[], removedId: string): string => {
    const index = slides.findIndex((slide) => slide.id === removedId)
    const survivor = slides[Math.max(0, Math.min(index, slides.length - 1))] ?? slides[0]!
    return survivor.id
  }

  return {
    document: null,
    view: initialView,
    savedRevision: -1,
    dirty: false,
    saving: false,
    saveError: null,
    past: [],
    future: [],
    lastHistoryGroup: null,

    loadDocument(document, options) {
      const clean = serializePresentationDocument(document)
      const saved = options?.saved ?? true
      set({
        document: clean,
        view: { ...initialView, activeSlideId: clean.slides[0]?.id ?? null },
        savedRevision: saved ? clean.revision : -1,
        dirty: !saved,
        saving: false,
        saveError: null,
        past: [],
        future: [],
        lastHistoryGroup: null,
      })
    },

    closeDocument() {
      set({ document: null, view: initialView, savedRevision: -1, dirty: false, saving: false, saveError: null, past: [], future: [], lastHistoryGroup: null })
    },

    markSaving() {
      set({ saving: true, saveError: null })
    },

    markSaved(revision) {
      const document = get().document
      set({ saving: false, saveError: null, savedRevision: revision, dirty: document ? document.revision !== revision : false })
    },

    markSaveFailed(message) {
      set({ saving: false, saveError: message })
    },

    selectSlide(slideId) {
      const document = get().document
      if (!document || !document.slides.some((slide) => slide.id === slideId)) return
      set({ view: { ...get().view, activeSlideId: slideId, selectedElementIds: [] } })
    },

    selectElements(ids) {
      const document = get().document
      if (!document) return
      const slide = activeSlide()
      const valid = slide ? ids.filter((id) => slide.elements.some((element) => element.id === id)) : []
      set({ view: { ...get().view, selectedElementIds: valid } })
    },

    toggleElementSelection(id, additive = false) {
      const current = get().view.selectedElementIds
      if (!additive) {
        set({ view: { ...get().view, selectedElementIds: current.includes(id) ? [] : [id] } })
        return
      }
      set({ view: { ...get().view, selectedElementIds: current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id] } })
    },

    setZoom(zoom) {
      set({ view: { ...get().view, zoom: Math.min(8, Math.max(0.1, zoom)) } })
    },

    setPan(pan) {
      set({ view: { ...get().view, pan } })
    },

    addSlide(afterSlideId) {
      const document = get().document
      if (!document) return null
      if (document.slides.length >= PRESENTATION_LIMITS.maxSlides) return null
      const slide = createSlide({ name: nextSlideName(document.slides) })
      const anchor = afterSlideId ?? get().view.activeSlideId ?? document.slides.at(-1)!.id
      commit((draft) => {
        const index = draft.slides.findIndex((candidate) => candidate.id === anchor)
        draft.slides.splice(index === -1 ? draft.slides.length : index + 1, 0, slide)
      })
      set({ view: { ...get().view, activeSlideId: slide.id, selectedElementIds: [] } })
      return slide.id
    },

    duplicateSlide(slideId) {
      const document = get().document
      if (!document) return null
      if (document.slides.length >= PRESENTATION_LIMITS.maxSlides) return null
      const source = document.slides.find((slide) => slide.id === slideId)
      if (!source) return null
      const copy: Slide = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} copy`, elements: source.elements.map(cloneElementWithNewId) }
      commit((draft) => {
        const index = draft.slides.findIndex((slide) => slide.id === slideId)
        draft.slides.splice(index + 1, 0, copy)
      })
      set({ view: { ...get().view, activeSlideId: copy.id, selectedElementIds: [] } })
      return copy.id
    },

    renameSlide(slideId, name) {
      const trimmed = name.trim()
      if (!trimmed) return
      commit((draft) => {
        const slide = draft.slides.find((candidate) => candidate.id === slideId)
        if (!slide || slide.name === trimmed) return false
        slide.name = trimmed.slice(0, 200)
        return true
      })
    },

    reorderSlide(slideId, targetIndex) {
      commit((draft) => {
        const index = draft.slides.findIndex((slide) => slide.id === slideId)
        if (index === -1) return false
        const clamped = Math.max(0, Math.min(targetIndex, draft.slides.length - 1))
        if (clamped === index) return false
        const [slide] = draft.slides.splice(index, 1)
        draft.slides.splice(clamped, 0, slide!)
        return true
      })
    },

    removeSlide(slideId) {
      const document = get().document
      if (!document || document.slides.length <= 1) return false
      const remaining = document.slides.filter((slide) => slide.id !== slideId)
      const survivor = selectSurvivor(remaining, slideId)
      commit((draft) => {
        draft.slides = draft.slides.filter((slide) => slide.id !== slideId)
      })
      if (get().view.activeSlideId === slideId) set({ view: { ...get().view, activeSlideId: survivor, selectedElementIds: [] } })
      return true
    },

    setSlideBackground(slideId, background) {
      commit((draft) => {
        const slide = draft.slides.find((candidate) => candidate.id === slideId)
        if (!slide || slide.background === background) return false
        slide.background = background
        return true
      })
    },

    addElement(element) {
      const document = get().document
      const slide = activeSlide()
      if (!document || !slide) return null
      if (slide.elements.length >= PRESENTATION_LIMITS.maxElementsPerSlide) return null
      commit((draft) => {
        const target = draft.slides.find((candidate) => candidate.id === slide.id)
        target?.elements.push(structuredClone(element))
      })
      set({ view: { ...get().view, selectedElementIds: [element.id] } })
      return element.id
    },

    updateElement(elementId, patch, options) {
      commit((draft) => {
        const element = draft.slides.flatMap((slide) => slide.elements).find((candidate) => candidate.id === elementId)
        if (!element) return false
        const target = element as unknown as Record<string, unknown>
        let changed = false
        for (const [key, value] of Object.entries(patch)) {
          if (Object.is(target[key], value)) continue
          target[key] = structuredClone(value)
          changed = true
        }
        return changed
      }, options)
    },

    transformElement(elementId, patch, options) {
      const element = get()
        .document?.slides.flatMap((slide) => slide.elements)
        .find((candidate) => candidate.id === elementId)
      if (!element || element.locked) return
      get().updateElement(elementId, patch as Partial<Element>, { historyGroup: options?.historyGroup ?? `transform:${elementId}` })
    },

    removeElement(elementId) {
      commit((draft) => {
        let removed = false
        for (const slide of draft.slides) {
          const before = slide.elements.length
          slide.elements = slide.elements.filter((element) => element.id !== elementId)
          if (slide.elements.length !== before) removed = true
        }
        return removed
      })
      set({ view: { ...get().view, selectedElementIds: get().view.selectedElementIds.filter((id) => id !== elementId) } })
    },

    reorderElement(elementId, targetIndex) {
      commit((draft) => {
        const slide = draft.slides.find((candidate) => candidate.elements.some((element) => element.id === elementId))
        if (!slide) return false
        const index = slide.elements.findIndex((element) => element.id === elementId)
        const clamped = Math.max(0, Math.min(targetIndex, slide.elements.length - 1))
        if (index === clamped) return false
        const [element] = slide.elements.splice(index, 1)
        slide.elements.splice(clamped, 0, element!)
        return true
      })
    },

    toggleElementLocked(elementId) {
      commit((draft) => {
        const element = draft.slides.flatMap((slide) => slide.elements).find((candidate) => candidate.id === elementId)
        if (!element) return false
        element.locked = !element.locked
        return true
      })
    },

    toggleElementVisible(elementId) {
      commit((draft) => {
        const element = draft.slides.flatMap((slide) => slide.elements).find((candidate) => candidate.id === elementId)
        if (!element) return false
        element.visible = !element.visible
        return true
      })
    },

    updateText(elementId, paragraphs, options) {
      commit((draft) => {
        const element = draft.slides.flatMap((slide) => slide.elements).find((candidate) => candidate.id === elementId)
        if (element?.kind !== 'text') return false
        if (JSON.stringify(element.paragraphs) === JSON.stringify(paragraphs)) return false
        element.paragraphs = structuredClone(paragraphs)
        return true
      }, options)
    },

    setTheme(theme) {
      commit((draft) => {
        if (JSON.stringify(draft.theme) === JSON.stringify(theme)) return false
        draft.theme = structuredClone(theme)
        return true
      })
    },

    endHistoryGroup() {
      set({ lastHistoryGroup: null })
    },

    undo() {
      const { document, past, future } = get()
      const entry = past.at(-1)
      if (!document || !entry) return
      const restored = withRevision(document, structuredClone(entry.document))
      const remaining = past.slice(0, -1)
      const nextFuture = [...future, { document, bytes: estimateBytes(document) }].slice(-PRESENTATION_LIMITS.historyEntries)
      set({
        document: restored,
        past: remaining,
        future: nextFuture,
        lastHistoryGroup: null,
        dirty: restored.revision !== get().savedRevision,
        view: ensureView(restored, get().view),
      })
    },

    redo() {
      const { document, past, future } = get()
      const entry = future.at(-1)
      if (!document || !entry) return
      const restored = withRevision(document, structuredClone(entry.document))
      const remaining = future.slice(0, -1)
      const nextPast = [...past, { document, bytes: estimateBytes(document) }].slice(-PRESENTATION_LIMITS.historyEntries)
      set({
        document: restored,
        past: nextPast,
        future: remaining,
        lastHistoryGroup: null,
        dirty: restored.revision !== get().savedRevision,
        view: ensureView(restored, get().view),
      })
    },
  }
})

function ensureView(document: PresentationDocument, view: PresentationViewState): PresentationViewState {
  const slideExists = document.slides.some((slide) => slide.id === view.activeSlideId)
  const activeSlideId = slideExists ? view.activeSlideId : (document.slides[0]?.id ?? null)
  const slide = document.slides.find((candidate) => candidate.id === activeSlideId)
  const ids = new Set(slide?.elements.map((element) => element.id) ?? [])
  return { ...view, activeSlideId, selectedElementIds: view.selectedElementIds.filter((id) => ids.has(id)) }
}
