import Konva from 'konva'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Ellipse, Image as KonvaImage, Layer, Rect, Stage, Text as KonvaText, Transformer } from 'react-konva'
import { ARTBOARD_SIZE, type Asset, type ImageLayer, type Layer as DocLayer } from '../../types/domain'
import { createImageSurface, decodeMaskImage, formatCssFilter } from '../exports/renderDocument'
import { getStageMetrics } from './maskUtils'
import { useMaskBrush, type MaskPreviewCallbacks } from './useMaskBrush'
import { useEditorStore } from './store'
import { cssFontFamily, loadFont } from '../../lib/fonts'

export default function KonvaCanvas({ urls }: { urls: Record<string, string> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Record<string, Konva.Node>>({})
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const previewCallbacks = useRef<MaskPreviewCallbacks>(new Map())
  const brush = useMaskBrush(hostRef, previewCallbacks)
  const [size, setSize] = useState({ width: 640, height: 480 })
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const document = useEditorStore((state) => state.document)
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId)
  const viewport = useEditorStore((state) => state.viewport)
  const activeTool = useEditorStore((state) => state.activeTool)
  const assets = useEditorStore((state) => state.assets)
  const masks = useEditorStore((state) => state.masks)
  const isBrush = activeTool === 'erase' || activeTool === 'restore'

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => {
      void useEditorStore.getState().finishMaskStroke?.().catch(() => undefined)
      setSize({ width: host.clientWidth, height: host.clientHeight })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const attachTransformer = useRef(() => {})
  attachTransformer.current = () => {
    const transformer = transformerRef.current
    if (!transformer) return
    const { selectedLayerId: id, document: doc, activeTool: tool } = useEditorStore.getState()
    const node = id ? nodeRefs.current[id] : undefined
    const layer = doc?.layers.find((item) => item.id === id)
    transformer.nodes(node && layer?.visible && !layer.locked && !editingTextId && !['pan', 'erase', 'restore'].includes(tool) ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }
  useEffect(() => { attachTransformer.current() }, [selectedLayerId, document, activeTool, size, viewport, editingTextId])
  if (!document) return null
  const { viewScale, stageX: x, stageY: y } = getStageMetrics(size.width, size.height, viewport)
  const bindNode = (id: string) => (node: Konva.Node | null) => {
    if (node) nodeRefs.current[id] = node
    else delete nodeRefs.current[id]
    if (id === useEditorStore.getState().selectedLayerId) attachTransformer.current()
  }
  const isEmptyTarget = (target: Konva.Node) => target.name() === 'artboard' || target === target.getStage()

  return (
    <div ref={hostRef} className={`artboard-host ${isBrush ? 'brush-active' : ''}`} data-testid="editor-canvas" {...brush.handlers}>
      <Stage width={size.width} height={size.height} scaleX={viewScale} scaleY={viewScale} x={x} y={y}
        onMouseDown={(event) => {
          if (isBrush || !isEmptyTarget(event.target)) return
          if (activeTool === 'pan') { panRef.current = { x: event.evt.clientX, y: event.evt.clientY }; return }
          useEditorStore.getState().selectLayer(null)
        }}
        onMouseMove={(event) => {
          if (!panRef.current) return
          const dx = event.evt.clientX - panRef.current.x
          const dy = event.evt.clientY - panRef.current.y
          panRef.current = { x: event.evt.clientX, y: event.evt.clientY }
          const current = useEditorStore.getState().viewport
          useEditorStore.getState().setViewport({ panX: current.panX + dx, panY: current.panY + dy })
        }}
        onMouseUp={() => { panRef.current = null }}
        onMouseLeave={() => { panRef.current = null }}
      >
        <Layer>
          <Rect name="artboard" width={ARTBOARD_SIZE} height={ARTBOARD_SIZE} listening />
          {/* Document coordinates are independent of the full-panel workspace. */}
          {document.layers.map((layer) => (
            <DocNode key={layer.id} layer={layer}
              url={layer.kind === 'image' ? urls[layer.assetId] : undefined}
              mask={layer.kind === 'image' && layer.maskKey ? masks[layer.maskKey] : undefined}
              asset={layer.kind === 'image' ? assets[layer.assetId]?.asset : undefined}
              previews={previewCallbacks.current} panMode={activeTool === 'pan'} isBrushTool={isBrush} editingText={layer.id === editingTextId} onEditText={() => setEditingTextId(layer.id)} nodeRef={bindNode(layer.id)} />
          ))}
          <Transformer ref={transformerRef} rotateEnabled enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox)} />
        </Layer>
      </Stage>
      <p className="canvas-boundary-note">Exports fit the visible artwork.</p>
      <div ref={brush.cursorRef} className="brush-cursor" data-testid="brush-cursor" aria-hidden="true" style={{ display: 'none' }} />
      {editingTextId ? <CanvasTextEditor layerId={editingTextId} node={nodeRefs.current[editingTextId]} onClose={() => setEditingTextId(null)} /> : null}
    </div>
  )
}

function readTransform(node: Konva.Node) {
  return { x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() }
}

function DocNode({ layer, url, mask, asset, previews, panMode, isBrushTool, editingText, onEditText, nodeRef }: {
  layer: DocLayer
  url?: string
  mask?: Blob
  asset?: Asset
  previews: MaskPreviewCallbacks
  panMode: boolean
  isBrushTool: boolean
  editingText: boolean
  onEditText: () => void
  nodeRef: (node: Konva.Node | null) => void
}) {
  if (!layer.visible) return null
  const handlers = {
    ...layer.transform,
    opacity: layer.opacity,
    draggable: !layer.locked && !panMode && !isBrushTool,
    onMouseDown: (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (isBrushTool) return
      event.cancelBubble = true
      if (!panMode && !layer.locked) useEditorStore.getState().selectLayer(layer.id)
    },
    onTap: (event: Konva.KonvaEventObject<TouchEvent>) => {
      if (isBrushTool) return
      event.cancelBubble = true
      if (!panMode && !layer.locked) useEditorStore.getState().selectLayer(layer.id)
    },
    onDragStart: () => {
      if (layer.locked || panMode || isBrushTool) return
      useEditorStore.getState().selectLayer(layer.id)
      useEditorStore.getState().beginGesture()
    },
    onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => useEditorStore.getState().applyTransform(layer.id, readTransform(event.target)),
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
      useEditorStore.getState().applyTransform(layer.id, readTransform(event.target))
      useEditorStore.getState().commitGesture()
    },
    onTransformStart: () => { if (!layer.locked && !panMode && !isBrushTool) useEditorStore.getState().beginGesture() },
    onTransform: (event: Konva.KonvaEventObject<Event>) => useEditorStore.getState().applyTransform(layer.id, readTransform(event.target)),
    onTransformEnd: (event: Konva.KonvaEventObject<Event>) => {
      useEditorStore.getState().applyTransform(layer.id, readTransform(event.target))
      useEditorStore.getState().commitGesture()
    },
    onDblClick: (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (layer.kind !== 'text' || layer.locked || panMode || isBrushTool) return
      event.cancelBubble = true
      useEditorStore.getState().selectLayer(layer.id)
      useEditorStore.getState().beginGesture()
      onEditText()
    },
    onDblTap: (event: Konva.KonvaEventObject<TouchEvent>) => {
      if (layer.kind !== 'text' || layer.locked || panMode || isBrushTool) return
      event.cancelBubble = true
      useEditorStore.getState().selectLayer(layer.id)
      useEditorStore.getState().beginGesture()
      onEditText()
    },
  }
  if (layer.kind === 'image') return <HydratedImage layer={layer} url={url} mask={mask} asset={asset} previews={previews} nodeRef={nodeRef} handlers={handlers} />
  if (layer.kind === 'text') return <HydratedText key={layer.fontFamily} layer={layer} handlers={handlers} nodeRef={nodeRef} hidden={editingText} />
  if (layer.shape === 'circle') return <Ellipse ref={nodeRef} {...handlers} radiusX={60} radiusY={60} offsetX={-60} offsetY={-60} fill={layer.fill} />
  return <Rect ref={nodeRef} {...handlers} width={120} height={120} fill={layer.fill} />
}

function HydratedText({ layer, handlers, nodeRef, hidden }: {
  layer: Extract<DocLayer, { kind: 'text' }>
  handlers: Record<string, unknown>
  nodeRef: (node: Konva.Node | null) => void
  hidden: boolean
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void loadFont(layer.fontFamily).then(() => {
      if (!cancelled) setReady(true)
    }).catch((error: unknown) => {
      if (!cancelled) useEditorStore.getState().setUploadError(error instanceof Error ? error.message : 'Could not load font')
    })
    return () => { cancelled = true }
  }, [layer.fontFamily])
  // Mount only after loading: Konva caches text measurements at construction time.
  return ready ? <KonvaText ref={nodeRef} {...handlers} opacity={hidden ? 0 : layer.opacity} listening={!hidden} text={layer.content} fontFamily={layer.fontFamily} fontSize={layer.fontSize} fill={layer.color} lineHeight={1} wrap="none" align="left" verticalAlign="top" /> : null
}

let measureCtx: CanvasRenderingContext2D | null = null
function measureTextBox(content: string, family: string, fontSize: number) {
  const ctx = measureCtx ?? (measureCtx = document.createElement('canvas').getContext('2d'))
  const font = `${fontSize}px ${cssFontFamily(family)}`
  if (ctx) ctx.font = font
  const lines = (content || ' ').split('\n')
  const width = Math.max(...lines.map((line) => (ctx ? ctx.measureText(line.length ? line : ' ').width : line.length * fontSize * 0.6))) + Math.max(2, fontSize * 0.08)
  return { width, height: fontSize * Math.max(lines.length, 1) }
}

function CanvasTextEditor({ layerId, node, onClose }: { layerId: string; node?: Konva.Node; onClose: () => void }) {
  const layer = useEditorStore((state) => state.document?.layers.find((item) => item.id === layerId))
  if (!layer || layer.kind !== 'text') return null
  const scale = node?.getAbsoluteScale() ?? { x: 1, y: 1 }
  const pos = node?.getAbsolutePosition() ?? { x: 24, y: 24 }
  const fontSize = layer.fontSize * Math.abs(scale.y || scale.x || 1)
  const box = measureTextBox(layer.content, layer.fontFamily, fontSize)
  const rotation = node?.getAbsoluteRotation() ?? layer.transform.rotation
  return (
    <textarea
      className="canvas-text-edit"
      aria-label="Edit canvas text"
      autoFocus
      value={layer.content}
      rows={Math.max(1, layer.content.split('\n').length)}
      style={{
        left: pos.x,
        top: pos.y,
        width: box.width,
        height: box.height,
        fontFamily: cssFontFamily(layer.fontFamily),
        fontSize,
        color: layer.color,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'top left',
      }}
      onChange={(event) => useEditorStore.getState().updateText(layer.id, { content: event.target.value })}
      onBlur={() => {
        useEditorStore.getState().commitGesture()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.blur()
      }}
    />
  )
}

function HydratedImage({ layer, url, mask, asset, previews, nodeRef, handlers }: {
  layer: ImageLayer
  url?: string
  mask?: Blob
  asset?: Asset
  previews: MaskPreviewCallbacks
  nodeRef: (node: Konva.Node | null) => void
  handlers: Record<string, unknown>
}) {
  const image = useHtmlImage(url)
  const maskImage = useMaskImage(layer.maskKey, mask, asset)
  const node = useRef<Konva.Image | null>(null)
  const { crop, outline, filters } = layer
  const padding = outline?.enabled ? Math.ceil(outline.width) : 0
  // ponytail: preview rasters cap at 1024px; raise for sharper high zoom. Masks/exports stay full-resolution.
  const previewRatio = Math.min(1, 1024 / (Math.max(crop?.width ?? asset?.width ?? 1, crop?.height ?? asset?.height ?? 1) + padding * 2))
  const processedImage = useMemo(() => {
    if (!image || !asset || (layer.maskKey && !maskImage)) return null
    if (!crop && !maskImage && !outline?.enabled && formatCssFilter(filters) === 'none') return image
    return createImageSurface(image, { crop, outline, filters }, crop?.width ?? asset.width, crop?.height ?? asset.height, undefined, maskImage, previewRatio).canvas as HTMLCanvasElement
  }, [image, crop, asset, outline, filters, maskImage, layer.maskKey, previewRatio])

  useEffect(() => {
    // Only the painted layer is recomposited, once per requested animation frame.
    previews.set(layer.id, (live) => {
      if (!node.current || !image || !asset) return
      const source = live
        ? createImageSurface(image, { crop, outline, filters }, crop?.width ?? asset.width, crop?.height ?? asset.height, undefined, live, previewRatio).canvas as HTMLCanvasElement
        : processedImage
      if (!source) return
      node.current.image(source)
      node.current.getLayer()?.batchDraw()
    })
    return () => { previews.delete(layer.id) }
  }, [previews, layer.id, image, asset, crop, outline, filters, processedImage, previewRatio])

  if (!image || !asset || !processedImage) return null
  return <KonvaImage ref={(value) => { node.current = value; nodeRef(value) }} {...handlers}
    image={processedImage} width={(crop?.width ?? asset.width) + padding * 2} height={(crop?.height ?? asset.height) + padding * 2} offsetX={padding} offsetY={padding} />
}

function useMaskImage(key: string | undefined, blob: Blob | undefined, asset: Asset | undefined) {
  const [loaded, setLoaded] = useState<{ blob: Blob; image: CanvasImageSource; width: number; height: number } | null>(null)
  const liveImage = useRef<CanvasImageSource | null>(null)
  const width = asset?.width
  const height = asset?.height
  useEffect(() => {
    if (!key || !width || !height) return
    if (!blob) { useEditorStore.getState().setUploadError('Image mask is missing. Reload or reset the mask.'); return }
    let cancelled = false
    let image: CanvasImageSource | undefined
    void decodeMaskImage(blob, width, height).then((value) => {
      image = value
      if (cancelled) { if ('close' in value && typeof value.close === 'function') value.close(); return }
      liveImage.current = value
      setLoaded({ blob, image: value, width, height })
    }).catch((error: unknown) => {
      if (!cancelled) useEditorStore.getState().setUploadError(error instanceof Error ? error.message : 'Could not decode image mask')
    })
    return () => {
      cancelled = true
      if (liveImage.current === image) liveImage.current = null
      if (image && 'close' in image && typeof image.close === 'function') image.close()
    }
  }, [key, blob, width, height])
  return key && blob && loaded?.blob === blob && loaded.image === liveImage.current &&
    loaded.width === width && loaded.height === height ? loaded.image : null
}

function useHtmlImage(url: string | undefined) {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!url) return
    const element = new window.Image()
    element.onload = () => setLoaded({ url, image: element })
    element.onerror = () => setLoaded(null)
    element.src = url
    return () => { element.onload = null; element.onerror = null }
  }, [url])
  return loaded && loaded.url === url ? loaded.image : undefined
}
