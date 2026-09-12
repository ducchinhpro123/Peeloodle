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
import type { PresentationMediaRecord } from '@/lib/persistence/presentations/repository'
import { PRESENTATION_LIMITS } from '../model/limits'
import { serializePresentationDocument } from '../model/parse'
import { createImageElement, createSlide, nextSlideName } from '../model/factories'
import { fitImageWithinSlide, type PreparedPresentationImage } from './insertImageAsset'
import type { Element, PresentationDocument, Slide, TextParagraph, Theme } from '../model/types'

export type PresentationViewState = {
  activeSlideId: string | null
  selectedElementIds: string[]
  /** Text element whose DOM editor is open; view state only. */
  editingElementId: string | null
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
  /** Bytes for media that is not persisted yet. Never part of the document JSON. */
  pendingMedia: PresentationMediaRecord[]

  loadDocument(document: PresentationDocument, options?: { saved?: boolean }): void
  closeDocument(): void
  markSaving(): void
  markSaved(revision: number): void
  markSaveFailed(message: string): void
  /** Drops held media once it is stored (or all of it when called without ids). */
  clearPendingMedia(assetIds?: string[]): void
  /** The held media a save may submit: only what the current document references. */
  mediaForSave(): PresentationMediaRecord[]

  selectSlide(slideId: string): void
  selectElements(ids: string[]): void
  toggleElementSelection(id: string, additive?: boolean): void
  startTextEdit(elementId: string): void
  endTextEdit(): void
  setZoom(zoom: number): void
  setPan(pan: { x: number; y: number }): void

  addSlide(afterSlideId?: string): string | null
  duplicateSlide(slideId: string): string | null
  renameSlide(slideId: string, name: string): void
  reorderSlide(slideId: string, targetIndex: number): void
  removeSlide(slideId: string): boolean
  setSlideBackground(slideId: string, background: string): void

  addElement(element: Element): string | null
  insertImage(image: PreparedPresentationImage, options?: { slideId?: string }): string | null
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

const initialView: PresentationViewState = { activeSlideId: null, selectedElementIds: [], editingElementId: null, zoom: 1, pan: { x: 0, y: 0 } }

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

/** Structural comparison so nested patches with equal content are not treated as changes. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export const usePresentationStore = create<PresentationStoreState>()((set, get) => {
  /** Validates, bumps the revision and records one undo entry. Updaters return
   * `false` for a no-op so redo history and the revision are left untouched. */
  const commit = (updater: (draft: PresentationDocument) => boolean | void, options: { historyGroup?: string } = {}): boolean => {
    const current = get().document
    if (!current) return false
    const draft = structuredClone(current)
    const changed = updater(draft)
    if (changed === false) return false
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
    return true
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
    pendingMedia: [],

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
        // Media held for the previous document must never leak into this one.
        pendingMedia: [],
      })
    },

    closeDocument() {
      set({ document: null, view: initialView, savedRevision: -1, dirty: false, saving: false, saveError: null, past: [], future: [], lastHistoryGroup: null, pendingMedia: [] })
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

    clearPendingMedia(assetIds) {
      const pending = get().pendingMedia
      if (!assetIds) {
        if (pending.length > 0) set({ pendingMedia: [] })
        return
      }
      const keep = pending.filter((record) => !assetIds.includes(record.assetId))
      if (keep.length !== pending.length) set({ pendingMedia: keep })
    },

    mediaForSave() {
      const document = get().document
      if (!document) return []
      const referenced = new Set(document.assets.map((asset) => asset.id))
      // Held bytes are a superset of what the document needs: undoing an insert
      // removes the asset from the document but keeps its bytes available for redo.
      // Submitting an unreferenced record makes a save fail (`invalid_asset`), so
      // the save path must always come through here.
      return get().pendingMedia.filter((record) => referenced.has(record.assetId))
    },

    selectSlide(slideId) {
      const document = get().document
      if (!document || !document.slides.some((slide) => slide.id === slideId)) return
      set({ view: { ...get().view, activeSlideId: slideId, selectedElementIds: [], editingElementId: null } })
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

    startTextEdit(elementId) {
      const document = get().document
      const element = document?.slides.flatMap((slide) => slide.elements).find((candidate) => candidate.id === elementId)
      if (element?.kind !== 'text') return
      set({ view: { ...get().view, selectedElementIds: [elementId], editingElementId: elementId } })
    },

    endTextEdit() {
      if (get().view.editingElementId === null) return
      set({ view: { ...get().view, editingElementId: null } })
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
      set({ view: { ...get().view, activeSlideId: slide.id, selectedElementIds: [], editingElementId: null } })
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
      set({ view: { ...get().view, activeSlideId: copy.id, selectedElementIds: [], editingElementId: null } })
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
      if (!document.slides.some((slide) => slide.id === slideId)) return false
      const remaining = document.slides.filter((slide) => slide.id !== slideId)
      const survivor = selectSurvivor(remaining, slideId)
      commit((draft) => {
        draft.slides = draft.slides.filter((slide) => slide.id !== slideId)
        return true
      })
      const editingWasRemoved = get().view.editingElementId !== null
        && document.slides.some((slide) => slide.id === slideId && slide.elements.some((element) => element.id === get().view.editingElementId))
      if (get().view.activeSlideId === slideId) set({ view: { ...get().view, activeSlideId: survivor, selectedElementIds: [], editingElementId: null } })
      else if (editingWasRemoved) set({ view: { ...get().view, editingElementId: null } })
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
      if (slide.elements.some((candidate) => candidate.id === element.id)) return null
      commit((draft) => {
        const target = draft.slides.find((candidate) => candidate.id === slide.id)
        if (!target) return false
        target.elements.push(structuredClone(element))
        return true
      })
      set({ view: { ...get().view, selectedElementIds: [element.id] } })
      return element.id
    },

    insertImage(image, options) {
      const document = get().document
      if (!document) return null
      const slide = options?.slideId
        ? document.slides.find((candidate) => candidate.id === options.slideId)
        : activeSlide()
      if (!slide) return null
      if (slide.elements.length >= PRESENTATION_LIMITS.maxElementsPerSlide) return null
      // Re-inserting identical bytes reuses the asset record, so it only has to
      // respect the asset limit when this content is new to the document.
      const knownAsset = document.assets.some((asset) => asset.id === image.asset.id)
      if (!knownAsset && document.assets.length >= PRESENTATION_LIMITS.maxAssets) return null

      const placement = fitImageWithinSlide(image.asset, document.pageSize)
      const imageCount = slide.elements.filter((element) => element.kind === 'image').length
      const element = createImageElement({
        assetId: image.asset.id,
        name: imageCount === 0 ? 'Image' : `Image ${imageCount + 1}`,
        alt: image.asset.provenance.label,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      })

      const applied = commit((draft) => {
        const target = draft.slides.find((candidate) => candidate.id === slide.id)
        if (!target) return false
        if (!draft.assets.some((asset) => asset.id === image.asset.id)) draft.assets.push(structuredClone(image.asset))
        target.elements.push(structuredClone(element))
        return true
      })
      // The commit can refuse (no-op updater). Returning an element id would then
      // claim an insertion that never happened, and the caller's null check is the
      // only thing standing between a refused insert and a broken element.
      if (!applied) return null

      // The bytes stay outside the document and are attached to the next save.
      // ponytail: an undone insert keeps its asset record and bytes until the
      // document is closed; P25 owns bounded media retention.
      if (!get().pendingMedia.some((record) => record.assetId === image.media.assetId)) {
        set({ pendingMedia: [...get().pendingMedia, image.media] })
      }
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
          if (sameValue(target[key], value as unknown)) continue
          target[key] = structuredClone(value as unknown)
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
      set({
        view: {
          ...get().view,
          selectedElementIds: get().view.selectedElementIds.filter((id) => id !== elementId),
          editingElementId: get().view.editingElementId === elementId ? null : get().view.editingElementId,
        },
      })
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
  const editingElementId = view.editingElementId !== null && slide?.elements.some((element) => element.id === view.editingElementId && element.kind === 'text')
    ? view.editingElementId
    : null
  return { ...view, activeSlideId, selectedElementIds: view.selectedElementIds.filter((id) => ids.has(id)), editingElementId }
}
