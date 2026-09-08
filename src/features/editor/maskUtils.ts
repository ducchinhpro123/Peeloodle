import type { Asset, CropRect, ImageLayer } from '../../types/domain'
import { ARTBOARD_SIZE } from '../../types/domain'
import type { Viewport } from './store'

export type Point = { x: number; y: number }
export type ImageLocalPoint = { u: number; v: number; inBounds: boolean }

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4
export const WHEEL_ZOOM_PIXEL_FACTOR = 0.0015

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function getStageMetrics(
  hostWidth: number,
  hostHeight: number,
  viewport: Viewport,
): { viewScale: number; stageX: number; stageY: number } {
  // Contain the full artboard with 64px around it for resize and rotation handles.
  const fit = (Math.min(hostWidth, hostHeight) - 128) / ARTBOARD_SIZE
  const viewScale = Math.max(fit * viewport.zoom, 0.05)
  const stageX = (hostWidth - ARTBOARD_SIZE * viewScale) / 2 + viewport.panX
  const stageY = (hostHeight - ARTBOARD_SIZE * viewScale) / 2 + viewport.panY
  return { viewScale, stageX, stageY }
}

/** Host-relative CSS pixels. Uses getStageMetrics() so pan accounts for centering and the 0.05 scale floor. */
export function zoomTowardPointer(
  hostWidth: number,
  hostHeight: number,
  viewport: Viewport,
  pointerX: number,
  pointerY: number,
  nextZoom: number,
): Viewport {
  const zoom = clampZoom(nextZoom)
  const current = getStageMetrics(hostWidth, hostHeight, viewport)
  if (current.viewScale <= 0 || ![pointerX, pointerY].every(Number.isFinite)) return { ...viewport, zoom }
  const documentX = (pointerX - current.stageX) / current.viewScale
  const documentY = (pointerY - current.stageY) / current.viewScale
  const centered = getStageMetrics(hostWidth, hostHeight, { zoom, panX: 0, panY: 0 })
  return {
    zoom,
    panX: pointerX - documentX * centered.viewScale - centered.stageX,
    panY: pointerY - documentY * centered.viewScale - centered.stageY,
  }
}

export function normalizedWheelDeltaY(deltaY: number, deltaMode: number, pageSize = 400): number {
  if (!Number.isFinite(deltaY)) return 0
  if (deltaMode === 1) return deltaY * 16
  if (deltaMode === 2) return deltaY * (Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 400)
  return deltaY
}

export function viewportAfterWheel(
  hostWidth: number,
  hostHeight: number,
  viewport: Viewport,
  pointerX: number,
  pointerY: number,
  deltaY: number,
  deltaMode: number,
): Viewport {
  const factor = Math.exp(-normalizedWheelDeltaY(deltaY, deltaMode, hostHeight) * WHEEL_ZOOM_PIXEL_FACTOR)
  return zoomTowardPointer(hostWidth, hostHeight, viewport, pointerX, pointerY, viewport.zoom * factor)
}

/**
 * Converts screen/pointer coordinates (relative to canvas host) into image-local (u, v)
 * coordinates on the source asset (0..asset.width, 0..asset.height).
 * Fully accounts for stage zoom/pan, layer translation, rotation, scale, horizontal/vertical flips, and crop.
 */
export function screenToImageLocal(
  screenPoint: Point,
  layer: ImageLayer,
  asset: Pick<Asset, 'width' | 'height'>,
  metrics: { viewScale: number; stageX: number; stageY: number },
): ImageLocalPoint {
  if (!Number.isFinite(layer.transform.scaleX) || !Number.isFinite(layer.transform.scaleY) ||
      layer.transform.scaleX === 0 || layer.transform.scaleY === 0 || metrics.viewScale <= 0) {
    return { u: NaN, v: NaN, inBounds: false }
  }
  // 1. Host relative -> Artboard coordinates (0..1024)
  const artX = (screenPoint.x - metrics.stageX) / metrics.viewScale
  const artY = (screenPoint.y - metrics.stageY) / metrics.viewScale

  // 2. Layer transform inversion:
  // Forward transform was: translate(layer.x, layer.y) -> rotate(rotation) -> scale(scaleX, scaleY)
  const dx = artX - layer.transform.x
  const dy = artY - layer.transform.y

  const rad = -(layer.transform.rotation * Math.PI) / 180
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad)

  const lx = rx / layer.transform.scaleX
  const ly = ry / layer.transform.scaleY

  const crop = layer.crop
  const u = (crop ? crop.x : 0) + lx
  const v = (crop ? crop.y : 0) + ly

  const inBounds = crop
    ? lx >= 0 && lx <= crop.width && ly >= 0 && ly <= crop.height
    : u >= 0 && u <= asset.width && v >= 0 && v <= asset.height

  return { u, v, inBounds }
}

/**
 * Converts image-local (u, v) back to screen coordinates.
 * Inverts screenToImageLocal for testing and cursor positioning.
 */
export function imageLocalToScreen(
  localPoint: { u: number; v: number },
  layer: ImageLayer,
  crop: CropRect | undefined,
  metrics: { viewScale: number; stageX: number; stageY: number },
): Point {
  const lx = localPoint.u - (crop ? crop.x : 0)
  const ly = localPoint.v - (crop ? crop.y : 0)

  const sx = lx * layer.transform.scaleX
  const sy = ly * layer.transform.scaleY

  const rad = (layer.transform.rotation * Math.PI) / 180
  const rx = sx * Math.cos(rad) - sy * Math.sin(rad)
  const ry = sx * Math.sin(rad) + sy * Math.cos(rad)

  const artX = rx + layer.transform.x
  const artY = ry + layer.transform.y

  return {
    x: metrics.stageX + artX * metrics.viewScale,
    y: metrics.stageY + artY * metrics.viewScale,
  }
}

/** Inverse-scaled radii for a circular document-space brush. */
export function getBrushRadiiInImage(brushSize: number, layer: ImageLayer): { x: number; y: number } {
  // Size is a document-pixel diameter. Viewport zoom only scales the cursor.
  return { x: brushSize / (2 * Math.abs(layer.transform.scaleX)), y: brushSize / (2 * Math.abs(layer.transform.scaleY)) }
}

/**
 * Creates a fully opaque white mask canvas representing an unmasked image.
 */
export function createDefaultMaskCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('A 2D canvas is required for mask editing')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Encodes once per completed stroke, rejecting failed encodes.
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (canvas.toBlob) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to encode mask canvas to PNG'))
      }, 'image/png')
    })
  }
  return Promise.reject(new Error('Canvas toBlob is not supported in this environment'))
}
