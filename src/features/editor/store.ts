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

export const useEditorStore = create<EditorStore>((set, get) => {
  /**
   * The shared tail of every committed edit: record the new revision, prune
   * assets and masks against the document and history that can still reach them,
   * mark dirty, and keep a write that is already in flight marked as saving.
   * Every edit path ends here, so a new command cannot forget an invariant.
   */
  const publishEdit = (input: {
    past: ProjectDocument[]
    document: ProjectDocument
    future?: ProjectDocument[]
    assets?: Record<string, AssetRecord>
    masks?: Record<string, Blob>
    result?: Partial<EditorStore>
  }): void => {
    const state = get()
    const future = input.future ?? []
    const assets = input.assets ?? state.assets
    const masks = input.masks ?? state.masks
    set({
      past: input.past,
      future,
      document: input.document,
      assets: assetsFor(assets, [input.document, ...input.past, ...future]),
      masks: masksFor(masks, [input.document, ...input.past, ...future]),
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'unsaved',
      ...input.result,
    })
  }

  /**
   * One edit command. Without an open gesture it records history, bumps the
   * revision and prunes; six live-preview commands pass `gesture: 'defer'` so a
   * drag, slider or open text session mutates the working document only and
   * `commitGesture` records the single entry when it ends.
   */
  const commitEdit = (input: {
    apply: (document: ProjectDocument) => ProjectDocument
    gesture?: 'commit' | 'defer'
    asset?: AssetRecord
    mask?: { key: string; blob: Blob }
    result?: Partial<EditorStore>
  }): boolean => {
    const state = get()
    if (!state.document) return false
    const next = input.apply(state.document)
    if (input.gesture === 'defer' && state.gestureActive) {
      set({ document: next })
      return true
    }
    const history = withHistory(state)
    publishEdit({
      past: history.past,
      future: history.future,
      document: touch(next),
      assets: input.asset ? { ...state.assets, [input.asset.asset.id]: input.asset } : state.assets,
      masks: input.mask ? { ...state.masks, [input.mask.key]: input.mask.blob } : state.masks,
      result: input.result,
    })
    return true
  }

  return {
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

    setViewport: (viewport) => {
      const current = get().viewport
      const zoom = viewport.zoom ?? current.zoom
      const next = {
        zoom: Number.isFinite(zoom) ? Math.min(4, Math.max(0.25, zoom)) : current.zoom,
        panX: viewport.panX ?? current.panX,
        panY: viewport.panY ?? current.panY,
      }
      if (next.zoom === current.zoom && next.panX === current.panX && next.panY === current.panY) return
      set({ viewport: next })
    },

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
      if (!state.gestureActive || !state.document || !state.gestureStart) {
        set({ gestureActive: false, gestureStart: null })
        return
      }
      if (sameContent(state.gestureStart, state.document)) {
        set({ gestureActive: false, gestureStart: null })
        return
      }
      publishEdit({
        past: [...state.past, state.gestureStart].slice(-HISTORY_LIMIT),
        document: touch(state.document),
        result: { gestureActive: false, gestureStart: null },
      })
    },

    addImageLayer: (record, name = 'Image') => {
      const state = get()
      if (!state.document) return
      const layerId = crypto.randomUUID()
      commitEdit({
        apply: (document) => {
          const layers: Layer[] = [
            ...document.layers,
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
          return { ...document, layers, assetIds: uniqueAssetIds(layers) }
        },
        asset: record,
        result: {
          selectedLayerId: layerId,
          uploadError: null,
          activeTool: state.activeTool === 'erase' || state.activeTool === 'restore' ? state.activeTool : 'select',
        },
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
      commitEdit({
        // Fit without stretching; old crop/mask coordinates cannot apply to a different photo.
        apply: (document) => {
          const layers = document.layers.map((item) => item.id === id
            ? { ...layer, assetId: record.asset.id, crop: undefined, maskKey: undefined, transform }
            : item)
          return { ...document, layers, assetIds: uniqueAssetIds(layers) }
        },
        asset: record,
        result: { uploadError: null },
      })
    },

    addTextLayer: (style = {}) => {
      const state = get()
      if (!state.document) return
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
      commitEdit({
        apply: (document) => ({ ...document, layers: [...document.layers, layer] }),
        result: { selectedLayerId: layerId, activeTool: 'select' },
      })
    },

    updateText: (id, patch) => {
      commitEdit({
        apply: (document) => replaceLayer(document, id, (layer) => (layer.kind === 'text' ? { ...layer, ...patch } : layer)),
        gesture: 'defer',
      })
    },

    updateTitle: (title) => {
      commitEdit({
        apply: (document) => ({ ...document, title }),
        gesture: 'defer',
      })
    },

    applyTransform: (id, transform) => {
      const state = get()
      const layer = state.document?.layers.find((item) => item.id === id)
      if (!state.document || !layer || layer.locked) return
      commitEdit({
        apply: (document) => replaceLayer(document, id, (item) => ({ ...item, transform })),
        gesture: 'defer',
      })
    },

    removeSelected: () => {
      const state = get()
      const layer = selected(state)
      if (!state.document || !layer || layer.locked) return
      commitEdit({
        apply: (document) => {
          const layers = document.layers.filter((item) => item.id !== layer.id)
          return { ...document, layers, assetIds: uniqueAssetIds(layers) }
        },
        result: { selectedLayerId: null },
      })
    },

    duplicateSelected: () => {
      const state = get()
      const layer = selected(state)
      if (!state.document || !layer) return
      const copy: Layer = {
        ...layer,
        id: crypto.randomUUID(),
        name: `${layer.name} copy`,
        transform: { ...layer.transform, x: layer.transform.x + 24, y: layer.transform.y + 24 },
        locked: false,
      }
      commitEdit({
        apply: (document) => {
          const layers = [...document.layers, copy]
          return { ...document, layers, assetIds: uniqueAssetIds(layers) }
        },
        result: { selectedLayerId: copy.id },
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
      const index = state.document.layers.findIndex((item) => item.id === id)
      if (index === -1) return
      const targetIndex = direction === 'up' ? index + 1 : index - 1
      if (targetIndex < 0 || targetIndex >= state.document.layers.length) return
      commitEdit({
        apply: (document) => {
          const layers = [...document.layers]
          const [item] = layers.splice(index, 1)
          layers.splice(targetIndex, 0, item!)
          return { ...document, layers }
        },
      })
    },

    toggleLayerVisibility: (id) => {
      commitEdit({ apply: (document) => replaceLayer(document, id, (layer) => ({ ...layer, visible: !layer.visible })) })
    },

    toggleLayerLock: (id) => {
      commitEdit({ apply: (document) => replaceLayer(document, id, (layer) => ({ ...layer, locked: !layer.locked })) })
    },

    renameLayer: (id, name) => {
      const trimmed = name.trim() || 'Layer'
      commitEdit({
        apply: (document) => replaceLayer(document, id, (layer) => ({ ...layer, name: trimmed })),
        gesture: 'defer',
      })
    },

    updateFilters: (id, patch) => {
      const defaultFilters: ImageFilters = { brightness: 0, contrast: 0, saturation: 0, grayscale: 0 }
      commitEdit({
        apply: (document) => replaceLayer(document, id, (layer) => {
          if (layer.kind !== 'image') return layer
          const current = layer.filters ?? defaultFilters
          return { ...layer, filters: { ...current, ...patch } }
        }),
        gesture: 'defer',
      })
    },

    resetFilters: (id) => {
      commitEdit({
        apply: (document) => replaceLayer(document, id, (layer) => (layer.kind === 'image' ? { ...layer, filters: undefined } : layer)),
      })
    },

    updateOutline: (id, patch) => {
      const defaultOutline: LayerOutline = { enabled: true, color: '#ffffff', width: 12 }
      commitEdit({
        apply: (document) => replaceLayer(document, id, (layer) => {
          if (layer.kind !== 'image') return layer
          const current = layer.outline ?? defaultOutline
          return { ...layer, outline: { ...current, ...patch } }
        }),
        gesture: 'defer',
      })
    },

    applyMask: (layerId, maskKey, maskBlob) => {
      const state = get()
      const layer = state.document?.layers.find((item) => item.id === layerId)
      if (!state.document || layer?.kind !== 'image' || layer.locked || layer.maskKey === maskKey || !maskKey || maskBlob.size === 0) return
      commitEdit({
        apply: (document) => replaceLayer(document, layerId, (item) => (item.kind === 'image' ? { ...item, maskKey } : item)),
        mask: { key: maskKey, blob: maskBlob },
      })
    },

    clearMask: (layerId) => {
      const state = get()
      const layer = state.document?.layers.find((item) => item.id === layerId)
      if (!state.document || layer?.kind !== 'image' || layer.locked || !layer.maskKey) return
      commitEdit({
        apply: (document) => replaceLayer(document, layerId, (item) => (item.kind === 'image' ? { ...item, maskKey: undefined } : item)),
        result: { uploadError: null },
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
  }
})

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
