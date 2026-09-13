import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Konva } from '../rendering/konvaText'
import { renderSlide, type PresentationImageSources } from '../rendering/renderSlide'
import { TextEditOverlay } from './TextEditOverlay'
import { usePresentationStore } from './store'
import { PresentationCanvasControls } from './PresentationCanvasControls'
import { PresentationSelectionFrame } from './PresentationSelectionFrame'
import { presentationViewport, clampPresentationZoom } from './viewGeometry'
import { snapToAlignment, type AlignmentGuide } from './alignmentGuides'
import {
  documentPointFromView,
  elementGeometry,
  elementWorldCenter,
  moveTransform,
  nextRotationStep,
  resizeTransform,
  rotateTransform,
  rotationFromPoint,
  type ResizeHandle,
  type TransformGeometry,
  type ViewPoint,
} from './transformGeometry'
import type { Element } from '../model/types'

type CanvasSize = { width: number; height: number }

type PanGesture = { pointerId: number; x: number; y: number; capture: HTMLElement | null }

type TransformGesture = {
  kind: 'move' | 'resize' | 'rotate'
  pointerId: number
  elementId: string
  handle: ResizeHandle | null
  /** Document point where the gesture started. */
  origin: ViewPoint
  /** Element geometry when the gesture started. */
  start: TransformGeometry
  /** Latest previewed geometry; null until the pointer actually moves. */
  current: TransformGeometry | null
  /** Rotating only: pointer angle at the previous move, and the turn so far. */
  pointerAngle: number
  rotationTurn: number
  capture: HTMLElement | null
}

export function PresentationCanvas({ images }: { images: PresentationImageSources }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const layerRef = useRef<Konva.Layer | null>(null)
  const panGesture = useRef<PanGesture | null>(null)
  const transformGesture = useRef<TransformGesture | null>(null)
  /** The group a live preview was applied to, so it can be put back on cancel. */
  const previewedNodeId = useRef<string | null>(null)
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
  const transformPreview = usePresentationStore((state) => state.view.transformPreview)
  const guides = usePresentationStore((state) => state.view.guides)
  const activeSlide = document?.slides.find((slide) => slide.id === activeSlideId) ?? document?.slides[0]
  const selectedElement = activeSlide?.elements.find((element) => element.id === selectedElementId)
  const editingElement = activeSlide?.elements.find((element) => element.id === editingElementId)
  const viewport = presentationViewport(size, document?.pageSize ?? { width: 0, height: 0 }, zoom, pan)
  // While a gesture runs, the frame and its handles describe the previewed
  // geometry; the document only changes when the gesture is committed.
  const selectedGeometry = selectedElement ? elementGeometry(selectedElement, transformPreview) : null

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

  // Live gesture feedback on the rendering layer only: the group follows the
  // pointer, and the committed document redraws it at its real geometry. A
  // cancelled gesture puts the node back where the document says it is.
  useEffect(() => {
    const layer = layerRef.current
    const id = transformPreview?.elementId ?? previewedNodeId.current
    if (!layer || !id) return
    const element = activeSlide?.elements.find((candidate) => candidate.id === id)
    const node = layer.findOne(`#${id}`) as Konva.Group | undefined
    if (element && node) {
      const geometry = elementGeometry(element, transformPreview)
      node.setAttrs({
        x: geometry.x,
        y: geometry.y,
        rotation: geometry.rotation,
        // Preview only: the group is scaled so the drag tracks the pointer. The
        // stored element keeps its own size and is re-rendered from it.
        scaleX: geometry.width / element.width,
        scaleY: geometry.height / element.height,
      })
      layer.batchDraw()
    }
    previewedNodeId.current = transformPreview?.elementId ?? null
  }, [transformPreview, activeSlide])

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

  /** One pointer position in document units, through the shared viewport mapping. */
  const pointFromClient = (clientX: number, clientY: number): ViewPoint | null => {
    const host = hostRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    return documentPointFromView({ x: clientX - rect.left, y: clientY - rect.top }, viewport)
  }

  /** The visible element under the pointer, or null over the slide background. */
  const elementAtPointer = (clientX: number, clientY: number): Element | null => {
    const stage = stageRef.current
    const host = hostRef.current
    if (!stage || !host || !activeSlide) return null
    const rect = host.getBoundingClientRect()
    const hit = stage.getIntersection({ x: clientX - rect.left, y: clientY - rect.top })
    if (!hit) return null
    const id = (hit.findAncestor('.presentation-element', true) as Konva.Group | undefined)?.id()
    return id ? activeSlide.elements.find((element) => element.id === id) ?? null : null
  }

  const beginTransform = (element: Element, kind: TransformGesture['kind'], handle: ResizeHandle | null, event: ReactPointerEvent<HTMLElement>) => {
    const origin = pointFromClient(event.clientX, event.clientY)
    if (!origin) return
    const start = elementGeometry(element, null)
    // Capture on the Konva container for every transform gesture, so move/up
    // arrive through the same host handlers as panning.
    const capture = captureTarget()
    transformGesture.current = {
      kind,
      pointerId: event.pointerId,
      elementId: element.id,
      handle,
      origin,
      start,
      current: null,
      // Rotation measures the pointer angle around the element's visual centre.
      pointerAngle: kind === 'rotate' ? rotationFromPoint(elementWorldCenter(start), origin) : 0,
      rotationTurn: 0,
      capture,
    }
    try { capture?.setPointerCapture(event.pointerId) } catch { /* Window-level pointer events still reach the host. */ }
  }

  /**
   * The candidate geometry for one pointer position. Move and resize measure
   * from the gesture's start; rotation walks the pointer angle step by step,
   * updating the gesture, so a continuous turn accumulates instead of jumping at
   * the ±180° branch cut.
   */
  const previewGeometry = (gesture: TransformGesture, point: ViewPoint): TransformGeometry => {
    if (gesture.kind === 'move') return moveTransform(gesture.start, { x: point.x - gesture.origin.x, y: point.y - gesture.origin.y })
    if (gesture.kind === 'resize') return resizeTransform(gesture.start, gesture.handle!, point)
    const step = nextRotationStep(gesture.pointerAngle, rotationFromPoint(elementWorldCenter(gesture.start), point), gesture.rotationTurn)
    gesture.pointerAngle = step.angle
    gesture.rotationTurn = step.accumulated
    return rotateTransform(gesture.start, step.accumulated)
  }

  /** Applies pointer movement to the live gesture; returns whether one is running. */
  const applyGestureMove = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    const gesture = transformGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return false
    // A mouse drag whose button was released outside the window must not keep
    // transforming on plain hover movement.
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      endTransform(event.pointerId, false)
      return true
    }
    const point = pointFromClient(event.clientX, event.clientY)
    if (!point) return true
    let current = previewGeometry(gesture, point)
    let nextGuides: AlignmentGuide[] = []
    // Move gestures snap to other visible elements and the page axes, and show
    // the matched lines. Resize and rotate keep exact pointer geometry.
    if (gesture.kind === 'move' && activeSlide && document) {
      const others = activeSlide.elements
        .filter((element) => element.id !== gesture.elementId && element.visible)
        .map((element) => elementGeometry(element, null))
      const snapped = snapToAlignment(current, others, document.pageSize)
      current = { ...current, x: snapped.x, y: snapped.y }
      nextGuides = snapped.guides
    }
    gesture.current = current
    const store = usePresentationStore.getState()
    store.setTransformPreview({ elementId: gesture.elementId, ...current })
    store.setGuides(nextGuides)
    return true
  }

  const endTransform = (pointerId: number, commit: boolean) => {
    const gesture = transformGesture.current
    if (gesture?.pointerId !== pointerId) return
    transformGesture.current = null
    if (gesture.capture?.hasPointerCapture(pointerId)) {
      try { gesture.capture.releasePointerCapture(pointerId) } catch { /* Pointer capture already ended. */ }
    }
    const store = usePresentationStore.getState()
    // A click without movement leaves no undo entry and no revision behind.
    if (commit && gesture.current) store.commitTransform(gesture.elementId, gesture.current)
    else if (gesture.current) store.setTransformPreview(null)
    store.setGuides([])
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
          const element = elementAtPointer(event.clientX, event.clientY)
          if (element) {
            usePresentationStore.getState().selectElements([element.id])
            // A locked element stays selectable so its properties are reachable,
            // but no gesture may move, resize, or rotate it.
            if (!element.locked) beginTransform(element, 'move', null, event)
            return
          }
          // Capture on the Konva container so Konva still sees pointerdown/up and can
          // report click/dblclick for element selection.
          const capture = captureTarget()
          panGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, capture }
          setPanning(true)
          try { capture?.setPointerCapture(event.pointerId) } catch { /* Window-level pointer events still update the view. */ }
        }}
        onPointerMove={(event) => {
          if (applyGestureMove(event)) return
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
        onPointerUp={(event) => {
          endTransform(event.pointerId, true)
          endPan(event.pointerId)
        }}
        onPointerCancel={(event) => {
          endTransform(event.pointerId, false)
          endPan(event.pointerId)
        }}
      />
      {selectedElement && selectedGeometry && !editingElement ? (
        <PresentationSelectionFrame
          geometry={selectedGeometry}
          viewport={viewport}
          locked={selectedElement.locked}
          onGestureStart={(kind, handle, event) => {
            // The handle gesture must not also start a pan or a move on the host.
            event.preventDefault()
            event.stopPropagation()
            beginTransform(selectedElement, kind, handle, event)
          }}
        />
      ) : null}
      {editingElement?.kind === 'text' ? (
        <TextEditOverlay element={editingElement} scale={viewport.scale} offsetX={viewport.x} offsetY={viewport.y} theme={document.theme} />
      ) : null}
      {renderError ? <p className="presentation-canvas-error" role="alert">Some artwork on this slide could not be drawn. Your saved presentation is unchanged.</p> : null}
      {activeSlide.elements.length === 0 && !renderError ? <p className="presentation-blank-slide" aria-hidden="true">Blank slide</p> : null}
      {guides.map((guide, index) => (
        <div
          key={`${guide.axis}-${guide.position}-${index}`}
          className={`presentation-guide is-${guide.axis}`}
          data-testid={`presentation-guide-${guide.axis}`}
          aria-hidden="true"
          style={guide.axis === 'x'
            ? { left: viewport.x + guide.position * viewport.scale, top: viewport.y, height: document.pageSize.height * viewport.scale }
            : { top: viewport.y + guide.position * viewport.scale, left: viewport.x, width: document.pageSize.width * viewport.scale }}
        />
      ))}
    </section>
  )
}
