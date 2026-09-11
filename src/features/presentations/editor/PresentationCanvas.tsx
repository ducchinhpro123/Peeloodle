import { useEffect, useRef, useState } from 'react'
import { Konva } from '../rendering/konvaText'
import { renderSlide, type PresentationImageSources } from '../rendering/renderSlide'
import { usePresentationStore } from './store'
import { PresentationCanvasControls } from './PresentationCanvasControls'
import { presentationViewport, clampPresentationZoom } from './viewGeometry'

type CanvasSize = { width: number; height: number }

export function PresentationCanvas({ images }: { images: PresentationImageSources }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const layerRef = useRef<Konva.Layer | null>(null)
  const panGesture = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const [renderError, setRenderError] = useState(false)
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const document = usePresentationStore((state) => state.document)
  const activeSlideId = usePresentationStore((state) => state.view.activeSlideId)
  const zoom = usePresentationStore((state) => state.view.zoom)
  const pan = usePresentationStore((state) => state.view.pan)
  const activeSlide = document?.slides.find((slide) => slide.id === activeSlideId) ?? document?.slides[0]

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setSize({ width: host.clientWidth, height: host.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || stageRef.current) return
    const stage = new Konva.Stage({ container: host, width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) })
    const layer = new Konva.Layer({ listening: false })
    stage.add(layer)
    stageRef.current = stage
    layerRef.current = layer
    return () => {
      stage.destroy()
      stageRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer || !document || !activeSlide) return
    layer.destroyChildren()
    try {
      layer.add(renderSlide({ slide: activeSlide, pageSize: document.pageSize, images }))
      setRenderError(false)
    } catch {
      // A missing decoded asset must not unmount the whole app: the preview
      // reports the problem and the rest of the editor keeps working.
      setRenderError(true)
    }
    layer.draw()
  }, [activeSlide, document, images])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !document) return
    const viewport = presentationViewport(size, document.pageSize, zoom, { x: pan.x, y: pan.y })
    stage.size({ width: Math.max(1, size.width), height: Math.max(1, size.height) })
    stage.scale({ x: viewport.scale, y: viewport.scale })
    stage.position({ x: viewport.x, y: viewport.y })
    stage.batchDraw()
  }, [document, pan.x, pan.y, size, zoom])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      const current = usePresentationStore.getState().view.zoom
      usePresentationStore.getState().setZoom(clampPresentationZoom(current * (event.deltaY < 0 ? 1.1 : 0.9)))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [])

  const endPan = (pointerId: number) => {
    const host = hostRef.current
    if (panGesture.current?.pointerId !== pointerId) return
    panGesture.current = null
    setPanning(false)
    if (host?.hasPointerCapture(pointerId)) {
      try { host.releasePointerCapture(pointerId) } catch { /* Pointer capture already ended. */ }
    }
  }

  if (!document || !activeSlide) return null

  return (
    <section className="presentation-canvas-panel" aria-label="Slide canvas">
      <PresentationCanvasControls />
      <div
        ref={hostRef}
        className={`presentation-canvas${panning ? ' is-panning' : ''}`}
        data-testid="presentation-canvas"
        data-document-width={document.pageSize.width}
        data-document-height={document.pageSize.height}
        data-view-zoom={zoom}
        data-view-pan-x={pan.x}
        data-view-pan-y={pan.y}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          panGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
          setPanning(true)
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Window-level pointer events still update the view. */ }
        }}
        onPointerMove={(event) => {
          const gesture = panGesture.current
          if (!gesture || gesture.pointerId !== event.pointerId) return
          // A mouse drag whose button was released outside the window must not
          // keep panning on plain hover movement.
          if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
            endPan(event.pointerId)
            return
          }
          const dx = event.clientX - gesture.x
          const dy = event.clientY - gesture.y
          gesture.x = event.clientX
          gesture.y = event.clientY
          const currentPan = usePresentationStore.getState().view.pan
          usePresentationStore.getState().setPan({ x: currentPan.x + dx, y: currentPan.y + dy })
        }}
        onPointerUp={(event) => endPan(event.pointerId)}
        onPointerCancel={(event) => endPan(event.pointerId)}
      />
      {renderError ? <p className="presentation-canvas-error" role="alert">Some artwork on this slide could not be drawn. Your saved presentation is unchanged.</p> : null}
      {activeSlide.elements.length === 0 && !renderError ? <p className="presentation-blank-slide" aria-hidden="true">Blank slide</p> : null}
    </section>
  )
}
