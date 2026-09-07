import Konva from 'konva'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Ellipse, Group, Image as KonvaImage, Layer, Rect, Stage, Text as KonvaText, Transformer } from 'react-konva'
import { ARTBOARD_SIZE, type Asset, type ImageLayer, type Layer as DocLayer } from '../../types/domain'
import { createImageSurface, decodeMaskImage, formatCssFilter } from '../exports/renderDocument'
import { getStageMetrics } from './maskUtils'
import { useMaskBrush, type MaskPreviewCallbacks } from './useMaskBrush'
import { useEditorStore } from './store'

export default function KonvaCanvas({ urls }: { urls: Record<string, string> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Record<string, Konva.Node>>({})
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const previewCallbacks = useRef<MaskPreviewCallbacks>(new Map())
  const brush = useMaskBrush(hostRef, previewCallbacks)
  const [size, setSize] = useState({ width: 640, height: 480 })
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
    transformer.nodes(node && layer?.visible && !layer.locked && !['pan', 'erase', 'restore'].includes(tool) ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }
  useEffect(() => { attachTransformer.current() }, [selectedLayerId, document, activeTool, size, viewport])
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
          <Rect width={ARTBOARD_SIZE} height={ARTBOARD_SIZE} stroke="#ffffffaa" strokeWidth={2} listening={false} />
          <Group clipX={0} clipY={0} clipWidth={ARTBOARD_SIZE} clipHeight={ARTBOARD_SIZE}>
            {document.layers.map((layer) => (
              <DocNode key={layer.id} layer={layer}
                url={layer.kind === 'image' ? urls[layer.assetId] : undefined}
                mask={layer.kind === 'image' && layer.maskKey ? masks[layer.maskKey] : undefined}
                asset={layer.kind === 'image' ? assets[layer.assetId]?.asset : undefined}
                previews={previewCallbacks.current} panMode={activeTool === 'pan'} isBrushTool={isBrush} nodeRef={bindNode(layer.id)} />
            ))}
          </Group>
          <Transformer ref={transformerRef} rotateEnabled enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox)} />
        </Layer>
      </Stage>
      <div ref={brush.cursorRef} className="brush-cursor" data-testid="brush-cursor" aria-hidden="true" style={{ display: 'none' }} />
    </div>
  )
}

function readTransform(node: Konva.Node) {
  return { x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() }
}

function DocNode({ layer, url, mask, asset, previews, panMode, isBrushTool, nodeRef }: {
  layer: DocLayer
  url?: string
  mask?: Blob
  asset?: Asset
  previews: MaskPreviewCallbacks
  panMode: boolean
  isBrushTool: boolean
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
  }
  if (layer.kind === 'image') return <HydratedImage layer={layer} url={url} mask={mask} asset={asset} previews={previews} nodeRef={nodeRef} handlers={handlers} />
  if (layer.kind === 'text') return <KonvaText ref={nodeRef} {...handlers} text={layer.content} fontFamily={layer.fontFamily} fontSize={layer.fontSize} fill={layer.color} lineHeight={1} align="left" verticalAlign="top" />
  if (layer.shape === 'circle') return <Ellipse ref={nodeRef} {...handlers} radiusX={60} radiusY={60} offsetX={-60} offsetY={-60} fill={layer.fill} />
  return <Rect ref={nodeRef} {...handlers} width={120} height={120} fill={layer.fill} />
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
