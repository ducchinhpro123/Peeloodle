import { useEffect, useRef, type PointerEvent, type RefObject } from 'react'
import type { ImageLayer } from '../../types/domain'
import { canvasToPngBlob, getBrushRadiiInImage, getStageMetrics, screenToImageLocal } from './maskUtils'
import { createMaskPainter, loadMaskCanvas } from './maskPainter'
import type { MaskStroke } from './maskStroke'
import { useEditorStore } from './store'

export type MaskPreviewCallbacks = Map<string, (canvas: HTMLCanvasElement | null) => void>
type LocalPoint = { u: number; v: number }

/** Pointer/encoding lifetime is separate from serializable history and React rendering. */
export function useMaskBrush(hostRef: RefObject<HTMLDivElement>, previews: RefObject<MaskPreviewCallbacks>) {
  const cursorRef = useRef<HTMLDivElement>(null)
  const active = useRef<{
    pointerId: number
    paint: (event: PointerEvent<HTMLDivElement>) => void
    finish: () => Promise<void>
  } | null>(null)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((next, previous) => {
      const changedView = next.activeTool !== previous.activeTool || next.selectedLayerId !== previous.selectedLayerId ||
        next.viewport !== previous.viewport || next.brushSize !== previous.brushSize || next.document?.id !== previous.document?.id
      if (changedView || next.document !== previous.document) void active.current?.finish().catch(() => undefined)
      if (changedView && cursorRef.current) cursorRef.current.style.display = 'none'
    })
    return () => {
      unsubscribe()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      void active.current?.finish().catch(() => undefined)
    }
  }, [])

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    const state = useEditorStore.getState()
    if (active.current || state.maskStroke || state.gestureActive || event.button !== 0 ||
        (state.activeTool !== 'erase' && state.activeTool !== 'restore')) return
    const host = hostRef.current
    const doc = state.document
    if (!host || !doc) return
    const candidate = doc.layers.find((layer) => layer.id === state.selectedLayerId && layer.kind === 'image') ??
      [...doc.layers].reverse().find((layer) => layer.kind === 'image' && layer.visible && !layer.locked)
    if (!candidate || candidate.kind !== 'image' || candidate.locked || !candidate.visible) return
    const layer: ImageLayer = structuredClone(candidate)
    const asset = state.assets[layer.assetId]?.asset
    if (!asset) return
    const metrics = getStageMetrics(host.clientWidth, host.clientHeight, state.viewport)
    const radii = getBrushRadiiInImage(state.brushSize, layer)
    if (![radii.x, radii.y].every((radius) => Number.isFinite(radius) && radius > 0)) return
    const mode = state.activeTool
    const sourceBlob = layer.maskKey ? state.masks[layer.maskKey] : undefined
    if (layer.maskKey && !sourceBlob) {
      state.setUploadError('The image mask is missing. Reload or reset the mask before painting.')
      return
    }
    const point = (event: PointerEvent<HTMLDivElement>) => {
      const rect = host.getBoundingClientRect()
      return screenToImageLocal({ x: event.clientX - rect.left, y: event.clientY - rect.top }, layer, asset, metrics)
    }
    const first = point(event)
    if (!Number.isFinite(first.u) || !Number.isFinite(first.v)) return
    state.selectLayer(layer.id)
    state.setUploadError(null)
    event.preventDefault()
    try { host.setPointerCapture(event.pointerId) } catch { /* Pointer-up still finalizes without capture. */ }
    let phase: 'drawing' | 'finishing' | 'failed' = 'drawing'
    let canvas: HTMLCanvasElement | undefined
    let painter: ReturnType<typeof createMaskPainter> | undefined
    let last: LocalPoint | undefined
    const queued: LocalPoint[] = [first]
    let pending: Promise<void> | null = null
    let failureMessage: string | null = null
    // Registered with the store as soon as painting starts; its commit is what
    // saves, exports and tool switches await.
    const session: MaskStroke = { layerId: layer.id, commit: () => finish() }

    const isCurrent = () => {
      const current = useEditorStore.getState()
      const target = current.document?.layers.find((item) => item.id === layer.id)
      return current.maskStroke === session && current.document?.id === doc.id && target?.kind === 'image' &&
        target.maskKey === layer.maskKey && target.visible && !target.locked
    }
    const preview = () => {
      if (frame.current !== null || !canvas) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        if (canvas && isCurrent()) previews.current?.get(layer.id)?.(canvas)
      })
    }
    const paintPoint = (next: LocalPoint) => {
      if (!painter) { queued.push(next); return }
      painter.paint(last ?? next, next, radii, mode)
      last = next
      preview()
    }
    const ready = loadMaskCanvas(asset.width, asset.height, sourceBlob).then((loaded) => {
      canvas = loaded
      painter = createMaskPainter(loaded, layer.crop)
      for (const p of queued) paintPoint(p)
      queued.length = 0
    })
    // A release/save may arrive after decoding fails; keep that failure observable to finish().
    void ready.catch(() => undefined)

    const clean = () => {
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
      previews.current?.get(layer.id)?.(null)
      if (active.current?.finish === finish) active.current = null
      if (useEditorStore.getState().maskStroke === session) useEditorStore.getState().abandonMaskStroke()
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
    }
    const finish = (): Promise<void> => {
      if (pending) return pending
      phase = 'finishing'
      pending = (async () => {
        await ready
        if (!isCurrent() || !canvas || !painter?.hasChanges()) { clean(); return }
        const blob = await canvasToPngBlob(canvas)
        if (isCurrent()) {
          const current = useEditorStore.getState()
          current.applyMask(layer.id, crypto.randomUUID(), blob)
          if (failureMessage && current.uploadError === failureMessage) current.setUploadError(null)
        }
        clean()
      })().catch((error: unknown) => {
        phase = 'failed'
        pending = null
        if (!canvas) clean()
        if (useEditorStore.getState().document?.id === doc.id) {
          const message = error instanceof Error ? error.message : 'Could not finish the mask stroke'
          failureMessage = canvas ? `${message}. Save to retry; the stroke is retained.` : `${message}. Reload or reset the mask before painting.`
          useEditorStore.getState().setUploadError(failureMessage)
          useEditorStore.getState().setSaveStatus('save-failed', message)
        } else {
          clean()
        }
        throw error
      })
      return pending
    }
    active.current = {
      pointerId: event.pointerId,
      finish,
      paint: (next) => {
        if (phase === 'drawing' && next.pointerId === event.pointerId) paintPoint(point(next))
      },
    }
    useEditorStore.getState().beginMaskStroke(session)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = useEditorStore.getState()
    const cursor = cursorRef.current
    const host = hostRef.current
    if (host && cursor && (state.activeTool === 'erase' || state.activeTool === 'restore')) {
      const box = host.getBoundingClientRect()
      const { viewScale } = getStageMetrics(host.clientWidth, host.clientHeight, state.viewport)
      cursor.style.display = 'block'
      cursor.style.left = `${event.clientX - box.left}px`
      cursor.style.top = `${event.clientY - box.top}px`
      cursor.style.width = cursor.style.height = `${state.brushSize * viewScale}px`
      cursor.style.border = `2px dashed ${state.activeTool === 'erase' ? '#ff4d9a' : '#08b879'}`
    }
    active.current?.paint(event)
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (active.current?.pointerId === event.pointerId) void active.current.finish().catch(() => undefined)
  }

  return {
    cursorRef,
    handlers: {
      onPointerDown: pointerDown,
      onPointerMove: pointerMove,
      onPointerUp: pointerEnd,
      onPointerCancel: pointerEnd,
      onLostPointerCapture: pointerEnd,
      onPointerLeave: () => { if (!active.current && cursorRef.current) cursorRef.current.style.display = 'none' },
    },
  }
}
