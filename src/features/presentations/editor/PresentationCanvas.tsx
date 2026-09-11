import { useEffect, useRef, useState } from 'react'
import { Konva } from '../rendering/konvaText'
import { renderSlide, type PresentationImageSources } from '../rendering/renderSlide'
import { TextEditOverlay } from './TextEditOverlay'
import { usePresentationStore } from './store'
import { PresentationCanvasControls } from './PresentationCanvasControls'
import { presentationViewport, clampPresentationZoom } from './viewGeometry'

type CanvasSize = { width: number; height: number }

type PanGesture = { pointerId: number; x: number; y: number; capture: HTMLElement | null }

export function PresentationCanvas({ images }: { images: PresentationImageSources }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const layerRef = useRef<Konva.Layer | null>(null)
  const panGesture = useRef<PanGesture | null>(null)
  const wasEditing = useRef(false)
  const [panning, setPanning] = useState(false)
  const [renderError, setRenderError] = useState(false)
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const document = usePresentationStore((state) => state.document)
  const activeSlideId = usePresentationStore((state) => state.view.activeSlideId)
  const selectedElementId = usePresentationStore((state) => state.view.selectedElementIds[0] ?? null)
  const editingElementId = usePresentationStore((state) => state.view.editingElementId)
  const zoom = usePresentationStore((state) => state.view.zoom)
  const pan = usePresentationStore((state) => state.view.pan)
  const activeSlide = document?.slides.find((slide) => slide.id === activeSlideId) ?? document?.slides[0]
  const selectedElement = activeSlide?.elements.find((element) => element.id === selectedElementId)
  const editingElement = activeSlide?.elements.find((element) => element.id === editingElementId)
  const viewport = presentationViewport(size, document?.pageSize ?? { width: 0, height: 0 }, zoom, pan)

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
    const layer = new Konva.Layer()
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
      const page = renderSlide({ slide: activeSlide, pageSize: document.pageSize, images, listening: true })
      if (editingElementId) {
        // The DOM overlay draws the text being edited; hide the canvas copy.
        for (const child of page.getChildren()) {
          if (child.id() === editingElementId) {
            child.visible(false)
            break
          }
        }
      }
      layer.add(page)
      setRenderError(false)
    } catch {
      // A missing decoded asset must not unmount the whole app: the preview
      // reports the problem and the rest of the editor keeps working.
      setRenderError(true)
    }
    layer.draw()
  }, [activeSlide, document, editingElementId, images])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !document) return
    stage.size({ width: Math.max(1, size.width), height: Math.max(1, size.height) })
    stage.scale({ x: viewport.scale, y: viewport.scale })
    stage.position({ x: viewport.x, y: viewport.y })
    stage.batchDraw()
  }, [document, size, viewport.scale, viewport.x, viewport.y])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const elementIdFor = (target: Konva.Node): string | null => {
      if (target === stage) return null
      const group = target.findAncestor('.presentation-element', true) as Konva.Group | undefined
      return group?.id() || null
    }
    const select = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const id = elementIdFor(event.target)
      usePresentationStore.getState().selectElements(id ? [id] : [])
    }
    const edit = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const id = elementIdFor(event.target)
      if (id) usePresentationStore.getState().startTextEdit(id)
    }
    stage.on('click tap', select)
    stage.on('dblclick dbltap', edit)
    return () => {
      stage.off('click tap', select)
      stage.off('dblclick dbltap', edit)
    }
  }, [])

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

  // Keep focus in the editor when the text overlay closes, but never steal it.
  useEffect(() => {
    const host = hostRef.current
    if (editingElementId) {
      wasEditing.current = true
      return
    }
    if (!wasEditing.current || !host) return
    wasEditing.current = false
    // `document` in this scope is the presentation document, so reach for the DOM one explicitly.
    if (window.document.activeElement === null || window.document.activeElement === window.document.body) host.focus()
  }, [editingElementId])

  const captureTarget = () => hostRef.current?.querySelector<HTMLElement>('.konvajs-content') ?? hostRef.current

  const endPan = (pointerId: number) => {
    const gesture = panGesture.current
    if (gesture?.pointerId !== pointerId) return
    panGesture.current = null
    setPanning(false)
    if (gesture.capture?.hasPointerCapture(pointerId)) {
      try { gesture.capture.releasePointerCapture(pointerId) } catch { /* Pointer capture already ended. */ }
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
        data-selected-element={selectedElementId ?? ''}
        data-editing-element={editingElementId ?? ''}
        tabIndex={-1}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          // Capture on the Konva container so Konva still sees pointerdown/up and can
          // report click/dblclick for element selection.
          const capture = captureTarget()
          panGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, capture }
          setPanning(true)
          try { capture?.setPointerCapture(event.pointerId) } catch { /* Window-level pointer events still update the view. */ }
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
      {selectedElement && !editingElement ? (
        <div
          className="presentation-selection-outline"
          aria-hidden="true"
          style={{
            left: viewport.x + selectedElement.x * viewport.scale,
            top: viewport.y + selectedElement.y * viewport.scale,
            width: selectedElement.width * viewport.scale,
            height: selectedElement.height * viewport.scale,
            transform: selectedElement.rotation ? `rotate(${selectedElement.rotation}deg)` : undefined,
            transformOrigin: 'top left',
          }}
        />
      ) : null}
      {editingElement?.kind === 'text' ? (
        <TextEditOverlay element={editingElement} scale={viewport.scale} offsetX={viewport.x} offsetY={viewport.y} theme={document.theme} />
      ) : null}
      {renderError ? <p className="presentation-canvas-error" role="alert">Some artwork on this slide could not be drawn. Your saved presentation is unchanged.</p> : null}
      {activeSlide.elements.length === 0 && !renderError ? <p className="presentation-blank-slide" aria-hidden="true">Blank slide</p> : null}
    </section>
  )
}
