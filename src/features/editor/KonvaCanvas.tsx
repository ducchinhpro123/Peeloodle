import Konva from 'konva'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Ellipse, Group, Image as KonvaImage, Layer, Rect, Stage, Text as KonvaText, Transformer } from 'react-konva'
import { ARTBOARD_SIZE, type Asset, type ImageLayer, type Layer as DocLayer, type TextLayer } from '../../types/domain'
import { createImageSurface, formatCssFilter } from '../exports/renderDocument'
import {
  applyBrushToMask,
  canvasToPngBlob,
  createDefaultMaskCanvas,
  getBrushRadiusInImage,
  getStageMetrics,
  interpolatePoints,
  screenToImageLocal,
} from './maskUtils'
import { useEditorStore } from './store'

export default function KonvaCanvas({ urls }: { urls: Record<string, string> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Record<string, Konva.Node>>({})
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState({ width: 640, height: 480 })

  const document = useEditorStore((state) => state.document)
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId)
  const viewport = useEditorStore((state) => state.viewport)
  const activeTool = useEditorStore((state) => state.activeTool)
  const assets = useEditorStore((state) => state.assets)
  const masks = useEditorStore((state) => state.masks)
  const brushSize = useEditorStore((state) => state.brushSize)
  const maskUrls = useBlobUrls(masks)

  const isBrush = activeTool === 'erase' || activeTool === 'restore'
  const workingMaskRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef(false)
  const strokeMutatedRef = useRef(false)
  const lastPtRef = useRef<{ u: number; v: number } | null>(null)
  const [liveMaskCanvas, setLiveMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [liveMaskLayerId, setLiveMaskLayerId] = useState<string | null>(null)
  const [liveMaskRev, setLiveMaskRev] = useState(0)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setSize({ width: host.clientWidth, height: host.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const attachTransformer = useRef(() => {})
  attachTransformer.current = () => {
    const transformer = transformerRef.current
    if (!transformer) return
    const selectedId = useEditorStore.getState().selectedLayerId
    const current = useEditorStore.getState().document
    const tool = useEditorStore.getState().activeTool
    const isBrushTool = tool === 'erase' || tool === 'restore'
    const node = selectedId ? nodeRefs.current[selectedId] : undefined
    const layer = current?.layers.find((item) => item.id === selectedId)
    transformer.nodes(node && layer && layer.visible && !layer.locked && tool !== 'pan' && !isBrushTool ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }

  useEffect(() => {
    attachTransformer.current()
  }, [selectedLayerId, document, activeTool, size, viewport])

  if (!document) return null

  const fit = Math.min((size.width - 36) / ARTBOARD_SIZE, (size.height - 36) / ARTBOARD_SIZE)
  const viewScale = Math.max(fit * viewport.zoom, 0.05)
  const x = size.width / 2 - (ARTBOARD_SIZE * viewScale) / 2 + viewport.panX
  const y = size.height / 2 - (ARTBOARD_SIZE * viewScale) / 2 + viewport.panY

  const bindNode = (id: string) => (node: Konva.Node | null) => {
    if (node) nodeRefs.current[id] = node
    else delete nodeRefs.current[id]
    if (id === useEditorStore.getState().selectedLayerId) attachTransformer.current()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isBrush || event.button !== 0) return
    const host = hostRef.current
    if (!host || !document) return

    let targetLayer = document.layers.find((l) => l.id === selectedLayerId && l.kind === 'image') as ImageLayer | undefined
    if (!targetLayer) {
      targetLayer = document.layers.slice().reverse().find((l) => l.kind === 'image' && !l.locked && l.visible) as ImageLayer | undefined
      if (targetLayer) useEditorStore.getState().selectLayer(targetLayer.id)
    }
    if (!targetLayer || targetLayer.locked || !targetLayer.visible) return
    const asset = assets[targetLayer.assetId]?.asset
    if (!asset) return

    try {
      host.setPointerCapture(event.pointerId)
    } catch {
      // ignore pointer capture error
    }
    event.preventDefault()

    const metrics = getStageMetrics(size.width, size.height, viewport)
    const hostRect = host.getBoundingClientRect()
    const screenX = event.clientX - hostRect.left
    const screenY = event.clientY - hostRect.top

    const localPt = screenToImageLocal({ x: screenX, y: screenY }, targetLayer, asset, metrics)
    const radius = getBrushRadiusInImage(brushSize, targetLayer, metrics.viewScale)

    const working = createDefaultMaskCanvas(asset.width, asset.height)
    const wCtx = working.getContext('2d')
    if (!wCtx) return

    if (targetLayer.maskKey && maskUrls[targetLayer.maskKey]) {
      const existingEl = new window.Image()
      existingEl.src = maskUrls[targetLayer.maskKey]
      if (existingEl.complete && existingEl.naturalWidth > 0) {
        wCtx.clearRect(0, 0, asset.width, asset.height)
        wCtx.drawImage(existingEl, 0, 0, asset.width, asset.height)
      }
    }

    workingMaskRef.current = working
    setLiveMaskCanvas(working)
    setLiveMaskLayerId(targetLayer.id)

    useEditorStore.getState().beginGesture()
    isDrawingRef.current = true
    strokeMutatedRef.current = false

    if (localPt.inBounds) {
      applyBrushToMask(wCtx, localPt.u, localPt.v, radius, activeTool)
      strokeMutatedRef.current = true
      setLiveMaskRev((r) => r + 1)
    }
    lastPtRef.current = { u: localPt.u, v: localPt.v }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const host = hostRef.current
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    const screenX = event.clientX - hostRect.left
    const screenY = event.clientY - hostRect.top

    if (isBrush) {
      setCursorPos({ x: screenX, y: screenY })
    }

    if (!isBrush || !isDrawingRef.current || !workingMaskRef.current || !document) return

    const targetLayer = document.layers.find((l) => l.id === liveMaskLayerId && l.kind === 'image') as ImageLayer | undefined
    if (!targetLayer) return
    const asset = assets[targetLayer.assetId]?.asset
    if (!asset) return

    const metrics = getStageMetrics(size.width, size.height, viewport)
    const localPt = screenToImageLocal({ x: screenX, y: screenY }, targetLayer, asset, metrics)
    const radius = getBrushRadiusInImage(brushSize, targetLayer, metrics.viewScale)
    const wCtx = workingMaskRef.current.getContext('2d')
    if (!wCtx) return

    if (lastPtRef.current) {
      interpolatePoints(lastPtRef.current, localPt, radius, (u, v) => {
        applyBrushToMask(wCtx, u, v, radius, activeTool)
      })
    } else {
      applyBrushToMask(wCtx, localPt.u, localPt.v, radius, activeTool)
    }
    strokeMutatedRef.current = true
    lastPtRef.current = { u: localPt.u, v: localPt.v }
    setLiveMaskRev((r) => r + 1)
  }

  const finishStroke = () => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    const working = workingMaskRef.current
    const targetLayerId = liveMaskLayerId
    const didMutate = strokeMutatedRef.current

    if (didMutate && working && targetLayerId) {
      void canvasToPngBlob(working).then((blob) => {
        const newKey = crypto.randomUUID()
        useEditorStore.getState().applyMask(targetLayerId, newKey, blob)
        useEditorStore.getState().commitGesture()
        setLiveMaskCanvas(null)
        setLiveMaskLayerId(null)
        workingMaskRef.current = null
        lastPtRef.current = null
      }).catch(() => {
        useEditorStore.getState().commitGesture()
        setLiveMaskCanvas(null)
        setLiveMaskLayerId(null)
      })
    } else {
      useEditorStore.getState().commitGesture()
      setLiveMaskCanvas(null)
      setLiveMaskLayerId(null)
      workingMaskRef.current = null
      lastPtRef.current = null
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (hostRef.current && hostRef.current.hasPointerCapture(event.pointerId)) {
        hostRef.current.releasePointerCapture(event.pointerId)
      }
    } catch {
      // ignore capture release error
    }
    finishStroke()
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (hostRef.current && hostRef.current.hasPointerCapture(event.pointerId)) {
        hostRef.current.releasePointerCapture(event.pointerId)
      }
    } catch {
      // ignore capture release error
    }
    finishStroke()
  }

  const isEmptyTarget = (target: Konva.Node | StageLike) => target.name() === 'artboard' || target === target.getStage()

  return (
    <div
      ref={hostRef}
      className={`artboard-host ${isBrush ? 'brush-active' : ''}`}
      data-testid="editor-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onPointerLeave={() => {
        if (!isDrawingRef.current) setCursorPos(null)
      }}
    >
      <Stage
        width={size.width}
        height={size.height}
        scaleX={viewScale}
        scaleY={viewScale}
        x={x}
        y={y}
        onMouseDown={(event) => {
          if (isBrush) return
          if (!isEmptyTarget(event.target)) return
          if (activeTool === 'pan') {
            panRef.current = { x: event.evt.clientX, y: event.evt.clientY }
            return
          }
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
        onMouseUp={() => {
          panRef.current = null
        }}
        onMouseLeave={() => {
          panRef.current = null
        }}
      >
        <Layer>
          <Rect name="artboard" width={ARTBOARD_SIZE} height={ARTBOARD_SIZE} listening />
          <Rect width={ARTBOARD_SIZE} height={ARTBOARD_SIZE} stroke="#ffffffaa" strokeWidth={2} listening={false} />
          <Group clipX={0} clipY={0} clipWidth={ARTBOARD_SIZE} clipHeight={ARTBOARD_SIZE}>
            {document.layers.map((layer) => (
              <DocNode
                key={layer.id}
                layer={layer}
                url={layer.kind === 'image' ? urls[layer.assetId] : undefined}
                maskUrl={layer.kind === 'image' && layer.maskKey ? maskUrls[layer.maskKey] : undefined}
                liveMaskCanvas={layer.id === liveMaskLayerId ? liveMaskCanvas : null}
                liveMaskRev={liveMaskRev}
                asset={layer.kind === 'image' ? assets[layer.assetId]?.asset : undefined}
                panMode={activeTool === 'pan'}
                isBrushTool={isBrush}
                nodeRef={bindNode(layer.id)}
              />
            ))}
          </Group>
          <Transformer
            ref={transformerRef}
            rotateEnabled
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox)}
          />
        </Layer>
      </Stage>
      {isBrush && cursorPos && (
        <div
          className="brush-cursor"
          data-testid="brush-cursor"
          style={{
            left: cursorPos.x,
            top: cursorPos.y,
            width: brushSize * viewScale,
            height: brushSize * viewScale,
            border: activeTool === 'erase' ? '2px dashed #ff4d9a' : '2px dashed #08b879',
            backgroundColor: activeTool === 'erase' ? 'rgba(255, 77, 154, 0.15)' : 'rgba(8, 184, 121, 0.15)',
          }}
        />
      )}
    </div>
  )
}

type StageLike = Konva.Node & { getStage: () => Konva.Stage | null }

function readTransform(node: Konva.Node) {
  return { x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() }
}

function DocNode({
  layer,
  url,
  maskUrl,
  liveMaskCanvas,
  liveMaskRev,
  asset,
  panMode,
  isBrushTool,
  nodeRef,
}: {
  layer: DocLayer
  url?: string
  maskUrl?: string
  liveMaskCanvas?: HTMLCanvasElement | null
  liveMaskRev?: number
  asset?: Asset
  panMode: boolean
  isBrushTool: boolean
  nodeRef: (node: Konva.Node | null) => void
}) {
  if (!layer.visible) return null
  const handlers = {
    x: layer.transform.x,
    y: layer.transform.y,
    rotation: layer.transform.rotation,
    scaleX: layer.transform.scaleX,
    scaleY: layer.transform.scaleY,
    opacity: layer.opacity,
    draggable: !layer.locked && !panMode && !isBrushTool,
    onMouseDown: (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (isBrushTool) return
      event.cancelBubble = true
      if (panMode || layer.locked) return
      useEditorStore.getState().selectLayer(layer.id)
    },
    onTap: (event: Konva.KonvaEventObject<TouchEvent>) => {
      if (isBrushTool) return
      event.cancelBubble = true
      if (panMode || layer.locked) return
      useEditorStore.getState().selectLayer(layer.id)
    },
    onDragStart: () => {
      if (layer.locked || panMode || isBrushTool) return
      useEditorStore.getState().selectLayer(layer.id)
      useEditorStore.getState().beginGesture()
    },
    onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => {
      useEditorStore.getState().applyTransform(layer.id, readTransform(event.target))
    },
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
      useEditorStore.getState().applyTransform(layer.id, readTransform(event.target))
      useEditorStore.getState().commitGesture()
    },
    onTransformStart: () => {
      if (layer.locked || panMode || isBrushTool) return
      useEditorStore.getState().beginGesture()
    },
    onTransform: (event: Konva.KonvaEventObject<Event>) => {
      useEditorStore.getState().applyTransform(layer.id, readTransform(event.target))
    },
    onTransformEnd: (event: Konva.KonvaEventObject<Event>) => {
      useEditorStore.getState().applyTransform(layer.id, readTransform(event.target))
      useEditorStore.getState().commitGesture()
    },
  }

  if (layer.kind === 'image') {
    return (
      <HydratedImage
        layer={layer}
        url={url}
        maskUrl={maskUrl}
        liveMaskCanvas={liveMaskCanvas}
        liveMaskRev={liveMaskRev}
        asset={asset}
        nodeRef={nodeRef}
        handlers={handlers}
      />
    )
  }
  if (layer.kind === 'text') {
    return <TextNode layer={layer} nodeRef={nodeRef} handlers={handlers} />
  }
  if (layer.shape === 'circle') {
    return <Ellipse ref={nodeRef} {...handlers} radiusX={60} radiusY={60} offsetX={-60} offsetY={-60} fill={layer.fill} />
  }
  return (
    <Rect
      ref={nodeRef}
      {...handlers}
      width={120}
      height={120}
      fill={layer.fill}
    />
  )
}

function TextNode({
  layer,
  nodeRef,
  handlers,
}: {
  layer: TextLayer
  nodeRef: (node: Konva.Node | null) => void
  handlers: Record<string, unknown>
}) {
  return (
    <KonvaText
      ref={nodeRef}
      {...handlers}
      text={layer.content}
      fontFamily={layer.fontFamily}
      fontSize={layer.fontSize}
      fill={layer.color}
      lineHeight={1}
      align="left"
      verticalAlign="top"
    />
  )
}

function HydratedImage({
  layer,
  url,
  maskUrl,
  liveMaskCanvas,
  liveMaskRev,
  asset,
  nodeRef,
  handlers,
}: {
  layer: ImageLayer
  url?: string
  maskUrl?: string
  liveMaskCanvas?: HTMLCanvasElement | null
  liveMaskRev?: number
  asset?: Asset
  nodeRef: (node: Konva.Node | null) => void
  handlers: Record<string, unknown>
}) {
  const image = useHtmlImage(url)
  const maskImage = useHtmlImage(maskUrl)
  const { crop, outline, filters } = layer
  const padding = outline?.enabled ? Math.ceil(outline.width) : 0

  const activeMask = liveMaskCanvas ?? (layer.maskKey ? maskImage : null)

  // Cache only image-local compositing; dragging/zooming must not rebuild it.
  const processedImage = useMemo(() => {
    void liveMaskRev
    if (!image || !asset) return null
    if (!crop && !activeMask && !outline?.enabled && formatCssFilter(filters) === 'none') return image
    const w = crop?.width ?? asset.width
    const h = crop?.height ?? asset.height
    return createImageSurface(image, { crop, outline, filters }, w, h, undefined, activeMask).canvas as HTMLCanvasElement
  }, [image, crop, asset, outline, filters, activeMask, liveMaskRev])

  if (!image || !asset) return null

  return (
    <KonvaImage
      ref={nodeRef}
      {...handlers}
      image={processedImage ?? image}
      width={(crop?.width ?? asset.width) + padding * 2}
      height={(crop?.height ?? asset.height) + padding * 2}
      offsetX={padding}
      offsetY={padding}
    />
  )
}

function useBlobUrls(blobs: Record<string, Blob>) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const created: string[] = []
    const next: Record<string, string> = {}
    for (const [id, blob] of Object.entries(blobs)) {
      try {
        const u = URL.createObjectURL(blob)
        created.push(u)
        next[id] = u
      } catch {
        next[id] = ''
      }
    }
    setUrls(next)
    return () => {
      for (const u of created) {
        try {
          URL.revokeObjectURL(u)
        } catch {
          // ignore revoke error
        }
      }
    }
  }, [blobs])
  return urls
}

function useHtmlImage(url: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement | undefined>()
  useEffect(() => {
    if (!url) {
      setImage(undefined)
      return
    }
    const element = new window.Image()
    element.onload = () => setImage(element)
    element.onerror = () => setImage(undefined)
    element.src = url
    return () => {
      element.onload = null
      element.onerror = null
    }
  }, [url])
  return image
}
