import type { Layer, ProjectDocument } from '../../types/domain'
import { useEditorStore } from './store'

export const TOOL_INTENTS = ['erase', 'text', 'effects', 'export'] as const
export type ToolIntent = (typeof TOOL_INTENTS)[number]

export const TOOL_INTENT_PARAM = 'tool'

export const TOOL_INTENT_LABELS: Record<ToolIntent, string> = {
  erase: 'Background Eraser',
  text: 'Text & Emoji',
  effects: 'Filters & Effects',
  export: 'Export & Share',
}

export type ToolIntentUi = {
  setInspectorTab: (tab: string) => void
  setAssetTab: (tab: string) => void
  setExportOpen: (open: boolean) => void
  setRailFocus: (focus: 'erase' | 'rotate' | 'restore' | 'outline' | 'text' | 'stickers' | 'effects' | 'layers' | null) => void
}

export function parseToolIntent(value: string | null | undefined): ToolIntent | null {
  if (value === 'erase' || value === 'text' || value === 'effects' || value === 'export') return value
  return null
}

type ToolIntentListener = (intent: ToolIntent) => void
const toolIntentListeners = new Set<ToolIntentListener>()

/** Re-apply an already-selected tool (same URL) without inserting layers. */
export function requestToolIntent(intent: ToolIntent): void {
  for (const listener of toolIntentListeners) listener(intent)
}

export function subscribeToolIntent(listener: ToolIntentListener): () => void {
  toolIntentListeners.add(listener)
  return () => { toolIntentListeners.delete(listener) }
}

export function shouldReuseCurrentToolRoute(pathname: string, search: string, intent: ToolIntent): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search
  return pathname.startsWith('/editor/') && parseToolIntent(new URLSearchParams(query).get(TOOL_INTENT_PARAM)) === intent
}

/** Same-tab tool re-entry only. Modifier and non-primary clicks keep native link behavior. */
export function isUnmodifiedPrimaryClick(event: Pick<MouseEvent, 'button' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey'>): boolean {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
}

/** Keep an already-open editor document; otherwise mint via `/create?tool=`. */
export function toolIntentHref(intent: ToolIntent, pathname: string): string {
  const match = pathname.match(/^\/editor\/([a-zA-Z0-9-]+)$/)
  if (match) return `/editor/${match[1]}?${TOOL_INTENT_PARAM}=${intent}`
  return `/create?${TOOL_INTENT_PARAM}=${intent}`
}

export function editorPathWithIntent(projectId: string, intent: ToolIntent | null): string {
  return intent ? `/editor/${projectId}?${TOOL_INTENT_PARAM}=${intent}` : `/editor/${projectId}`
}

export function isReusableOpenDocument(
  document: ProjectDocument | null,
  extras?: { dirty?: boolean; gestureActive?: boolean; finishMaskStroke?: unknown },
): boolean {
  if (!document) return false
  if (extras?.dirty || extras?.gestureActive || extras?.finishMaskStroke) return true
  return document.layers.length > 0 || document.revision > 0
}

function compatibleImage(layers: Layer[], selectedId: string | null): Layer | undefined {
  const selected = layers.find((layer) => layer.id === selectedId)
  if (selected?.kind === 'image' && selected.visible && !selected.locked) return selected
  return [...layers].reverse().find((layer) => layer.kind === 'image' && layer.visible && !layer.locked)
}

function compatibleText(layers: Layer[], selectedId: string | null): Layer | undefined {
  const selected = layers.find((layer) => layer.id === selectedId)
  if (selected?.kind === 'text') return selected
  return [...layers].reverse().find((layer) => layer.kind === 'text' && layer.visible)
}

/** Activate existing chrome. Never inserts layers (reload/back must not duplicate text). */
export function applyToolIntent(intent: ToolIntent | null, ui: ToolIntentUi): void {
  const store = useEditorStore.getState()
  const document = store.document
  if (!intent || !document) return

  if (intent === 'erase') {
    const image = compatibleImage(document.layers, store.selectedLayerId)
    if (image && image.id !== store.selectedLayerId) store.selectLayer(image.id)
    store.setTool('erase')
    ui.setInspectorTab('adjust')
    ui.setAssetTab('uploads')
    ui.setRailFocus('erase')
    ui.setExportOpen(false)
    return
  }

  if (intent === 'text') {
    const text = compatibleText(document.layers, store.selectedLayerId)
    if (text && text.id !== store.selectedLayerId) store.selectLayer(text.id)
    store.setTool('text')
    ui.setInspectorTab('adjust')
    ui.setAssetTab('stickers')
    ui.setRailFocus('text')
    ui.setExportOpen(false)
    return
  }

  if (intent === 'effects') {
    const image = compatibleImage(document.layers, store.selectedLayerId)
    if (image && image.id !== store.selectedLayerId) store.selectLayer(image.id)
    store.setTool('select')
    ui.setInspectorTab('effects')
    ui.setRailFocus('effects')
    ui.setExportOpen(false)
    return
  }

  store.setTool('select')
  ui.setExportOpen(true)
  ui.setRailFocus(null)
}

export function toolEmptyCopy(intent: ToolIntent | null, hasImage: boolean, hasText: boolean): { title: string; body: string } | null {
  if (intent === 'erase' && !hasImage) {
    return {
      title: 'Upload a photo to erase the background',
      body: 'Background Eraser needs an image layer. Automatic removal is not available — use Erase and Restore after you add a photo.',
    }
  }
  if (intent === 'effects' && !hasImage) {
    return {
      title: 'Filters need a photo or sticker',
      body: 'Select an image layer to adjust brightness, contrast, saturation, and grayscale. Upload a photo or pick a cutout first.',
    }
  }
  if (intent === 'text' && !hasText && !hasImage) {
    return {
      title: 'Add words or a sticker',
      body: 'Use Text in the tool rail or a style in the tray for editable type. Stickers & decorations are image layers, not emoji fonts.',
    }
  }
  return null
}
