import Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text as KonvaText, Transformer } from 'react-konva'
import { ARTBOARD_SIZE, type Asset, type ImageLayer, type Layer as DocLayer, type TextLayer } from '../../types/domain'
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
    const node = selectedId ? nodeRefs.current[selectedId] : undefined
    const layer = current?.layers.find((item) => item.id === selectedId)
    transformer.nodes(node && layer && layer.visible && !layer.locked && tool !== 'pan' ? [node] : [])
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

  const isEmptyTarget = (target: Konva.Node | StageLike) => target.name() === 'artboard' || target === target.getStage()

  return (
    <div ref={hostRef} className="artboard-host" data-testid="editor-canvas">
      <Stage
        width={size.width}
        height={size.height}
        scaleX={viewScale}
        scaleY={viewScale}
        x={x}
        y={y}
        onMouseDown={(event) => {
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
                asset={layer.kind === 'image' ? assets[layer.assetId]?.asset : undefined}
                panMode={activeTool === 'pan'}
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
  asset,
  panMode,
  nodeRef,
}: {
  layer: DocLayer
  url?: string
  asset?: Asset
  panMode: boolean
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
    draggable: !layer.locked && !panMode,
    onMouseDown: (event: Konva.KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true
      if (panMode || layer.locked) return
      useEditorStore.getState().selectLayer(layer.id)
    },
    onTap: (event: Konva.KonvaEventObject<TouchEvent>) => {
      event.cancelBubble = true
      if (panMode || layer.locked) return
      useEditorStore.getState().selectLayer(layer.id)
    },
    onDragStart: () => {
      if (layer.locked || panMode) return
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
      if (layer.locked || panMode) return
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
    return <HydratedImage layer={layer} url={url} asset={asset} nodeRef={nodeRef} handlers={handlers} />
  }
  if (layer.kind === 'text') {
    return <TextNode layer={layer} nodeRef={nodeRef} handlers={handlers} />
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
  asset,
  nodeRef,
  handlers,
}: {
  layer: ImageLayer
  url?: string
  asset?: Asset
  nodeRef: (node: Konva.Node | null) => void
  handlers: Record<string, unknown>
}) {
  const image = useHtmlImage(url)
  const imageNodeRef = useRef<Konva.Image | null>(null)

  useEffect(() => {
    const node = imageNodeRef.current
    if (!node) return
    const filters = layer.filters
    const hasFilter =
      filters &&
      (filters.brightness !== 0 || filters.contrast !== 0 || filters.saturation !== 0 || filters.grayscale !== 0)
    if (hasFilter) {
      const activeFilters: Array<(imageData: ImageData) => void> = []
      if (filters.brightness !== 0) {
        activeFilters.push(Konva.Filters.Brighten)
        node.brightness(filters.brightness / 100)
      }
      if (filters.contrast !== 0) {
        activeFilters.push(Konva.Filters.Contrast)
        node.contrast(filters.contrast)
      }
      if (filters.saturation !== 0) {
        activeFilters.push(Konva.Filters.HSL)
        node.saturation(filters.saturation / 100)
      }
      if (filters.grayscale !== 0) {
        activeFilters.push(Konva.Filters.Grayscale)
      }
      node.filters(activeFilters)
      try {
        node.cache()
      } catch {
        // caching may fail if image is not cross-origin ready
      }
    } else {
      node.filters([])
      try {
        node.clearCache()
      } catch {
        // clearCache ignore
      }
    }
  }, [layer.filters, image])

  if (!image || !asset) return null
  const crop = layer.crop

  const combinedRef = (node: Konva.Image | null) => {
    imageNodeRef.current = node
    nodeRef(node)
  }

  return (
    <KonvaImage
      ref={combinedRef}
      {...handlers}
      image={image}
      width={crop?.width ?? asset.width}
      height={crop?.height ?? asset.height}
      crop={crop}
    />
  )
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
