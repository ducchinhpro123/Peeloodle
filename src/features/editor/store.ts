import { create } from 'zustand'
import { createProjectDocument, serializeProjectDocument } from '../../lib/persistence/repository'
import type { AssetRecord, MaskRecord } from '../../lib/persistence/repository'
import type { ImageFilters, Layer, LayerOutline, ProjectDocument, TextLayer, Transform } from '../../types/domain'
import { fitImageToArtboard } from '../assets/assetLoader'

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved-locally' | 'save-failed'
export type EditorTool = 'select' | 'pan' | 'text' | 'rotate' | 'erase' | 'restore'
export type Viewport = { zoom: number; panX: number; panY: number }

export const HISTORY_LIMIT = 50
export type TextStyle = Pick<TextLayer, 'content' | 'fontFamily' | 'fontSize' | 'color'>

const defaultViewport: Viewport = { zoom: 1, panX: 0, panY: 0 }

export type EditorStore = {
  workspaceEpoch: number
  document: ProjectDocument | null
  assets: Record<string, AssetRecord>
  masks: Record<string, Blob>
  brushSize: number
  finishMaskStroke: (() => Promise<void>) | null
  selectedLayerId: string | null
  viewport: Viewport
  past: ProjectDocument[]
  future: ProjectDocument[]
  saveStatus: SaveStatus
  saveError: string | null
  loadError: string | null
  loading: boolean
  dirty: boolean
  gestureActive: boolean
  gestureStart: ProjectDocument | null
  activeTool: EditorTool
  uploadError: string | null
  createDraft: (id?: string) => string
  hydrate: (document: ProjectDocument, records: AssetRecord[], masks?: MaskRecord[]) => void
  setLoadError: (message: string) => void
  setLoading: (loading: boolean) => void
  selectLayer: (id: string | null) => void
  setViewport: (viewport: Partial<Viewport>) => void
  setTool: (tool: EditorTool) => void
  setBrushSize: (size: number) => void
  setUploadError: (message: string | null) => void
  beginGesture: () => void
  commitGesture: () => void
  addImageLayer: (record: AssetRecord, name?: string) => void
  replaceImageLayer: (id: string, record: AssetRecord) => void
  addTextLayer: (style?: Partial<TextStyle>) => void
  updateText: (id: string, patch: Partial<Pick<TextLayer, 'content' | 'fontFamily' | 'fontSize' | 'color'>>) => void
  updateTitle: (title: string) => void
  applyTransform: (id: string, transform: Transform) => void
  removeSelected: () => void
  duplicateSelected: () => void
  nudgeSelected: (dx: number, dy: number) => void
  rotateSelected90: () => void
  flipSelected: (axis: 'horizontal' | 'vertical') => void
  reorderLayer: (id: string, direction: 'up' | 'down') => void
  toggleLayerVisibility: (id: string) => void
  toggleLayerLock: (id: string) => void
  renameLayer: (id: string, name: string) => void
  updateFilters: (id: string, filters: Partial<ImageFilters>) => void
  resetFilters: (id: string) => void
  updateOutline: (id: string, outline: Partial<LayerOutline>) => void
  applyMask: (layerId: string, maskKey: string, maskBlob: Blob) => void
  clearMask: (layerId: string) => void
  undo: () => void
  redo: () => void
  setSaveStatus: (status: SaveStatus, error?: string | null) => void
  markSaved: (revision: number) => void
  reset: () => void
}

function cloneDocument(document: ProjectDocument): ProjectDocument {
  return serializeProjectDocument(document)
}

function touch(document: ProjectDocument): ProjectDocument {
  return { ...document, updatedAt: new Date().toISOString(), revision: document.revision + 1 }
}

function sameContent(a: ProjectDocument, b: ProjectDocument): boolean {
  const left = serializeProjectDocument(a)
  const right = serializeProjectDocument(b)
  return left.title === right.title && JSON.stringify(left.layers) === JSON.stringify(right.layers) && JSON.stringify(left.assetIds) === JSON.stringify(right.assetIds)
}

function replaceLayer(document: ProjectDocument, id: string, update: (layer: Layer) => Layer): ProjectDocument {
  return { ...document, layers: document.layers.map((layer) => (layer.id === id ? update(layer) : layer)) }
}

function uniqueAssetIds(layers: Layer[]): string[] {
  const ids: string[] = []
  for (const layer of layers) {
    if (layer.kind === 'image' && !ids.includes(layer.assetId)) ids.push(layer.assetId)
  }
  return ids
}

function assetsFor(assets: Record<string, AssetRecord>, docs: Array<ProjectDocument | null | undefined>): Record<string, AssetRecord> {
  const ids = new Set<string>()
  for (const doc of docs) {
    if (!doc) continue
    for (const id of doc.assetIds) ids.add(id)
    for (const layer of doc.layers) {
      if (layer.kind === 'image') ids.add(layer.assetId)
    }
  }
  let dropped = false
  const next: Record<string, AssetRecord> = {}
  for (const [id, record] of Object.entries(assets)) {
    if (ids.has(id)) next[id] = record
    else dropped = true
  }
  return dropped ? next : assets
}

function masksFor(masks: Record<string, Blob>, docs: Array<ProjectDocument | null | undefined>): Record<string, Blob> {
  const keys = new Set<string>()
  for (const doc of docs) {
    if (!doc) continue
    for (const layer of doc.layers) {
      if (layer.kind === 'image' && layer.maskKey) keys.add(layer.maskKey)
    }
  }
  let dropped = false
  const next: Record<string, Blob> = {}
  for (const [key, blob] of Object.entries(masks)) {
    if (keys.has(key)) next[key] = blob
    else dropped = true
  }
  return dropped ? next : masks
}

function resetState(): Pick<
  EditorStore,
  | 'document'
  | 'assets'
  | 'masks'
  | 'brushSize'
  | 'finishMaskStroke'
  | 'selectedLayerId'
  | 'viewport'
  | 'past'
  | 'future'
  | 'saveStatus'
  | 'saveError'
  | 'loadError'
  | 'loading'
  | 'dirty'
  | 'gestureActive'
  | 'gestureStart'
  | 'activeTool'
  | 'uploadError'
> {
  return {
    document: null,
    assets: {},
    masks: {},
    brushSize: 30,
    finishMaskStroke: null,
    selectedLayerId: null,
    viewport: { ...defaultViewport },
    past: [],
    future: [],
    saveStatus: 'idle',
    saveError: null,
    loadError: null,
    loading: false,
    dirty: false,
    gestureActive: false,
    gestureStart: null,
    activeTool: 'select',
    uploadError: null,
  }
}

function withHistory(state: EditorStore): Pick<EditorStore, 'past' | 'future' | 'masks'> {
  if (!state.document || state.gestureActive) return { past: state.past, future: state.future, masks: state.masks }
  const past = [...state.past, cloneDocument(state.document)]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, future: [], masks: masksFor(state.masks, [state.document, ...past]) }
}

function selected(state: EditorStore): Layer | undefined {
  return state.document?.layers.find((layer) => layer.id === state.selectedLayerId)
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...resetState(),
  workspaceEpoch: 0,

  createDraft: (id) => {
    const document = createProjectDocument({ id, title: 'Untitled Sticker' })
    set({ ...resetState(), document })
    return document.id
  },

  hydrate: (document, records, maskRecords = []) => {
    const assets: Record<string, AssetRecord> = {}
    for (const record of records) assets[record.asset.id] = record
    const masks: Record<string, Blob> = {}
    for (const record of maskRecords) masks[record.key] = record.blob
    set({
      ...resetState(),
      document: cloneDocument(document),
      assets,
      masks,
      selectedLayerId: document.layers.at(-1)?.id ?? null,
      saveStatus: 'saved-locally',
    })
  },

  setLoadError: (message) => set({ loadError: message, loading: false, document: get().document?.id ? get().document : null }),

  setLoading: (loading) => set({ loading }),

  selectLayer: (id) => {
    const state = get()
    if (id !== state.selectedLayerId && !state.finishMaskStroke) state.commitGesture()
    set({ selectedLayerId: id })
  },

  setViewport: (viewport) => set({ viewport: { ...get().viewport, ...viewport } }),

  setTool: (tool) => set({ activeTool: tool }),

  setBrushSize: (size) => { if (Number.isFinite(size)) set({ brushSize: Math.max(4, Math.min(120, Math.round(size))) }) },

  setUploadError: (message) => set({ uploadError: message }),

  beginGesture: () => {
    const state = get()
    if (!state.document || state.gestureActive) return
    set({ gestureActive: true, gestureStart: cloneDocument(state.document) })
  },

  commitGesture: () => {
    const state = get()
    if (!state.gestureActive || !state.document) {
      set({ gestureActive: false, gestureStart: null })
      return
    }
    const start = state.gestureStart
    if (!start || sameContent(start, state.document)) {
      set({ gestureActive: false, gestureStart: null })
      return
    }
    const past = [...state.past, start].slice(-HISTORY_LIMIT)
    const document = touch(state.document)
    set({
      gestureActive: false,
      gestureStart: null,
      past,
      future: [],
      document,
      assets: assetsFor(state.assets, [document, ...past]),
      masks: masksFor(state.masks, [document, ...past]),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  addImageLayer: (record, name = 'Image') => {
    const state = get()
    if (!state.document) return
    const history = withHistory(state)
    const layerId = crypto.randomUUID()
    const layers: Layer[] = [
      ...state.document.layers,
      {
        id: layerId,
        name,
        kind: 'image',
        assetId: record.asset.id,
        transform: fitImageToArtboard(record.asset.width, record.asset.height),
        opacity: 1,
        visible: true,
        locked: false,
      },
    ]
    const document = touch({
      ...state.document,
      layers,
      assetIds: uniqueAssetIds(layers),
    })
    const assets = { ...state.assets, [record.asset.id]: record }
    set({
      ...history,
      assets: assetsFor(assets, [document, ...history.past, ...history.future]),
      document,
      selectedLayerId: layerId,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
      uploadError: null,
      activeTool: 'select',
    })
  },

  replaceImageLayer: (id, record) => {
    const state = get()
    const layer = state.document?.layers.find((item) => item.id === id)
    if (!state.document || layer?.kind !== 'image' || layer.locked || state.gestureActive) return
    const original = state.assets[layer.assetId]?.asset
    if (!original) return
    const t = layer.transform
    const width = layer.crop?.width ?? original.width
    const height = layer.crop?.height ?? original.height
    const scale = Math.min(Math.abs(width * t.scaleX) / record.asset.width, Math.abs(height * t.scaleY) / record.asset.height)
    const scaleX = Math.sign(t.scaleX) * scale
    const scaleY = Math.sign(t.scaleY) * scale
    const dx = (width * t.scaleX - record.asset.width * scaleX) / 2
    const dy = (height * t.scaleY - record.asset.height * scaleY) / 2
    const radians = t.rotation * Math.PI / 180
    const transform = { ...t, scaleX, scaleY, x: t.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: t.y + dx * Math.sin(radians) + dy * Math.cos(radians) }
    // Fit without stretching; old crop/mask coordinates cannot apply to a different photo.
    const layers = state.document.layers.map((item) => item.id === id
      ? { ...layer, assetId: record.asset.id, crop: undefined, maskKey: undefined, transform }
      : item)
    const document = touch({ ...state.document, layers, assetIds: uniqueAssetIds(layers) })
    const history = withHistory(state)
    set({ ...history, document, assets: assetsFor({ ...state.assets, [record.asset.id]: record }, [document, ...history.past, ...history.future]), masks: masksFor(state.masks, [document, ...history.past, ...history.future]), dirty: true, uploadError: null, saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved' })
  },

  addTextLayer: (style = {}) => {
    const state = get()
    if (!state.document) return
    const history = withHistory(state)
    const layerId = crypto.randomUUID()
    const layer: TextLayer = {
      id: layerId,
      name: style.content ?? 'Text',
      kind: 'text',
      content: style.content ?? 'Text',
      fontFamily: style.fontFamily ?? 'Plus Jakarta Sans',
      fontSize: style.fontSize ?? 64,
      color: style.color ?? '#08152f',
      transform: { x: 320, y: 430, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 1,
      visible: true,
      locked: false,
    }
    const document = touch({ ...state.document, layers: [...state.document.layers, layer] })
    set({
      ...history,
      document,
      assets: assetsFor(state.assets, [document, ...history.past, ...history.future]),
      selectedLayerId: layerId,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
      activeTool: 'select',
    })
  },

  updateText: (id, patch) => {
    const state = get()
    if (!state.document) return
    const apply = (document: ProjectDocument) =>
      replaceLayer(document, id, (layer) => (layer.kind === 'text' ? { ...layer, ...patch } : layer))
    if (state.gestureActive) {
      set({ document: apply(state.document) })
      return
    }
    const history = withHistory(state)
    set({
      ...history,
      document: touch(apply(state.document)),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  updateTitle: (title) => {
    const state = get()
    if (!state.document) return
    if (state.gestureActive) {
      set({ document: { ...state.document, title } })
      return
    }
    const history = withHistory(state)
    set({
      ...history,
      document: touch({ ...state.document, title }),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  applyTransform: (id, transform) => {
    const state = get()
    if (!state.document) return
    const layer = state.document.layers.find((item) => item.id === id)
    if (!layer || layer.locked) return
    const apply = (document: ProjectDocument) => replaceLayer(document, id, (item) => ({ ...item, transform }))
    if (state.gestureActive) {
      set({ document: apply(state.document) })
      return
    }
    const history = withHistory(state)
    set({
      ...history,
      document: touch(apply(state.document)),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  removeSelected: () => {
    const state = get()
    const layer = selected(state)
    if (!state.document || !layer || layer.locked) return
    const history = withHistory(state)
    const layers = state.document.layers.filter((item) => item.id !== layer.id)
    const document = touch({ ...state.document, layers, assetIds: uniqueAssetIds(layers) })
    set({
      ...history,
      document,
      assets: assetsFor(state.assets, [document, ...history.past, ...history.future]),
      selectedLayerId: null,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  duplicateSelected: () => {
    const state = get()
    const layer = selected(state)
    if (!state.document || !layer) return
    const history = withHistory(state)
    const copy: Layer = {
      ...layer,
      id: crypto.randomUUID(),
      name: `${layer.name} copy`,
      transform: { ...layer.transform, x: layer.transform.x + 24, y: layer.transform.y + 24 },
      locked: false,
    }
    const layers = [...state.document.layers, copy]
    const document = touch({ ...state.document, layers, assetIds: uniqueAssetIds(layers) })
    set({
      ...history,
      document,
      assets: assetsFor(state.assets, [document, ...history.past, ...history.future]),
      selectedLayerId: copy.id,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  nudgeSelected: (dx, dy) => {
    const state = get()
    const layer = selected(state)
    if (!state.document || !layer || layer.locked) return
    get().applyTransform(layer.id, { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy })
  },

  rotateSelected90: () => {
    const state = get()
    const layer = selected(state)
    if (!state.document || !layer || layer.locked) return
    const transform = layer.transform
    const asset = layer.kind === 'image' ? state.assets[layer.assetId]?.asset : undefined
    if (layer.kind === 'image' && asset) {
      const radians = transform.rotation * Math.PI / 180
      const halfWidth = (layer.crop?.width ?? asset.width) * transform.scaleX / 2
      const halfHeight = (layer.crop?.height ?? asset.height) * transform.scaleY / 2
      const dx = halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians)
      const dy = halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians)
      // A quarter turn keeps the visible image center fixed, including crops and flips.
      get().applyTransform(layer.id, { ...transform, x: transform.x + dx + dy, y: transform.y + dy - dx, rotation: transform.rotation + 90 })
    } else {
      get().applyTransform(layer.id, { ...transform, rotation: transform.rotation + 90 })
    }
  },

  flipSelected: (axis) => {
    const state = get()
    const layer = selected(state)
    if (!state.document || !layer || layer.locked || layer.kind !== 'image') return
    const asset = state.assets[layer.assetId]?.asset
    if (!asset) return
    const transform = layer.transform
    const radians = (transform.rotation * Math.PI) / 180
    const dx = axis === 'horizontal' ? (layer.crop?.width ?? asset.width) * transform.scaleX : 0
    const dy = axis === 'vertical' ? (layer.crop?.height ?? asset.height) * transform.scaleY : 0
    get().applyTransform(layer.id, {
      ...transform,
      x: transform.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: transform.y + dx * Math.sin(radians) + dy * Math.cos(radians),
      scaleX: axis === 'horizontal' ? -transform.scaleX : transform.scaleX,
      scaleY: axis === 'vertical' ? -transform.scaleY : transform.scaleY,
    })
  },

  reorderLayer: (id, direction) => {
    const state = get()
    if (!state.document) return
    const layers = [...state.document.layers]
    const index = layers.findIndex((item) => item.id === id)
    if (index === -1) return
    const targetIndex = direction === 'up' ? index + 1 : index - 1
    if (targetIndex < 0 || targetIndex >= layers.length) return
    const [item] = layers.splice(index, 1)
    layers.splice(targetIndex, 0, item!)
    const history = withHistory(state)
    const document = touch({ ...state.document, layers })
    set({
      ...history,
      document,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  toggleLayerVisibility: (id) => {
    const state = get()
    if (!state.document) return
    const history = withHistory(state)
    const document = touch(replaceLayer(state.document, id, (layer) => ({ ...layer, visible: !layer.visible })))
    set({
      ...history,
      document,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  toggleLayerLock: (id) => {
    const state = get()
    if (!state.document) return
    const history = withHistory(state)
    const document = touch(replaceLayer(state.document, id, (layer) => ({ ...layer, locked: !layer.locked })))
    set({
      ...history,
      document,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  renameLayer: (id, name) => {
    const state = get()
    if (!state.document) return
    const trimmed = name.trim() || 'Layer'
    const apply = (doc: ProjectDocument) => replaceLayer(doc, id, (layer) => ({ ...layer, name: trimmed }))
    if (state.gestureActive) {
      set({ document: apply(state.document) })
      return
    }
    const history = withHistory(state)
    set({
      ...history,
      document: touch(apply(state.document)),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  updateFilters: (id, patch) => {
    const state = get()
    if (!state.document) return
    const defaultFilters: ImageFilters = { brightness: 0, contrast: 0, saturation: 0, grayscale: 0 }
    const apply = (doc: ProjectDocument) =>
      replaceLayer(doc, id, (l) => {
        if (l.kind !== 'image') return l
        const current = l.filters ?? defaultFilters
        return { ...l, filters: { ...current, ...patch } }
      })
    if (state.gestureActive) {
      set({ document: apply(state.document) })
      return
    }
    const history = withHistory(state)
    set({
      ...history,
      document: touch(apply(state.document)),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  resetFilters: (id) => {
    const state = get()
    if (!state.document) return
    const history = withHistory(state)
    const apply = (doc: ProjectDocument) =>
      replaceLayer(doc, id, (l) => (l.kind === 'image' ? { ...l, filters: undefined } : l))
    set({
      ...history,
      document: touch(apply(state.document)),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  updateOutline: (id, patch) => {
    const state = get()
    if (!state.document) return
    const defaultOutline: LayerOutline = { enabled: true, color: '#ffffff', width: 12 }
    const apply = (doc: ProjectDocument) =>
      replaceLayer(doc, id, (l) => {
        if (l.kind !== 'image') return l
        const current = l.outline ?? defaultOutline
        return { ...l, outline: { ...current, ...patch } }
      })
    if (state.gestureActive) {
      set({ document: apply(state.document) })
      return
    }
    const history = withHistory(state)
    set({
      ...history,
      document: touch(apply(state.document)),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  applyMask: (layerId, maskKey, maskBlob) => {
    const state = get()
    const layer = state.document?.layers.find((item) => item.id === layerId)
    if (!state.document || layer?.kind !== 'image' || layer.locked || layer.maskKey === maskKey || !maskKey || maskBlob.size === 0) return
    const history = withHistory(state)
    const document = touch(
      replaceLayer(state.document, layerId, (layer) =>
        layer.kind === 'image' ? { ...layer, maskKey } : layer,
      ),
    )
    const nextMasks = { ...state.masks, [maskKey]: maskBlob }
    set({
      ...history,
      document,
      masks: masksFor(nextMasks, [document, ...history.past, ...history.future]),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  clearMask: (layerId) => {
    const state = get()
    const layer = state.document?.layers.find((item) => item.id === layerId)
    if (!state.document || layer?.kind !== 'image' || layer.locked || !layer.maskKey) return
    const history = withHistory(state)
    const document = touch(
      replaceLayer(state.document, layerId, (layer) =>
        layer.kind === 'image' ? { ...layer, maskKey: undefined } : layer,
      ),
    )
    set({
      ...history,
      document,
      masks: masksFor(state.masks, [document, ...history.past, ...history.future]),
      uploadError: null,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
    })
  },

  undo: () => {
    const state = get()
    if (state.finishMaskStroke || state.gestureActive || !state.document || state.past.length === 0) return
    const previous = state.past[state.past.length - 1]!
    const document = touch({ ...previous, revision: state.document.revision })
    const past = state.past.slice(0, -1)
    const future = [...state.future, cloneDocument(state.document)]
    set({
      document,
      past,
      future,
      assets: assetsFor(state.assets, [document, ...past, ...future]),
      masks: masksFor(state.masks, [document, ...past, ...future]),
      selectedLayerId: previous.layers.some((layer) => layer.id === state.selectedLayerId) ? state.selectedLayerId : null,
      dirty: true,
      saveStatus: 'unsaved',
    })
  },

  redo: () => {
    const state = get()
    if (state.finishMaskStroke || state.gestureActive || !state.document || state.future.length === 0) return
    const next = state.future[state.future.length - 1]!
    const document = touch({ ...next, revision: state.document.revision })
    const future = state.future.slice(0, -1)
    const past = [...state.past, cloneDocument(state.document)]
    set({
      document,
      future,
      past,
      assets: assetsFor(state.assets, [document, ...past, ...future]),
      masks: masksFor(state.masks, [document, ...past, ...future]),
      selectedLayerId: next.layers.some((layer) => layer.id === state.selectedLayerId) ? state.selectedLayerId : null,
      dirty: true,
      saveStatus: 'unsaved',
    })
  },

  setSaveStatus: (status, error = null) => set({ saveStatus: status, saveError: error }),

  markSaved: (revision) => {
    const state = get()
    if (!state.document || state.document.revision !== revision) {
      set({ saveStatus: state.dirty ? 'unsaved' : state.saveStatus })
      return
    }
    set({ dirty: false, saveStatus: 'saved-locally', saveError: null })
  },

  reset: () => set({ ...resetState(), workspaceEpoch: get().workspaceEpoch + 1 }),
}))

export function resetEditorStore(): void {
  useEditorStore.getState().reset()
}

export function saveStatusLabel(status: SaveStatus, dirty: boolean): string {
  if (status === 'saving') return 'Saving'
  if (status === 'saved-locally') return 'Saved locally'
  if (status === 'save-failed') return 'Save failed'
  if (status === 'unsaved' || dirty) return 'Unsaved changes'
  return 'Not saved yet'
}
