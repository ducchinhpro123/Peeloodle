import type { Asset, CropRect, ImageLayer } from '../../types/domain'
import { ARTBOARD_SIZE } from '../../types/domain'
import type { Viewport } from './store'

export type Point = { x: number; y: number }
export type ImageLocalPoint = { u: number; v: number; inBounds: boolean }

export function getStageMetrics(
  hostWidth: number,
  hostHeight: number,
  viewport: Viewport,
): { viewScale: number; stageX: number; stageY: number } {
  const fit = Math.min((hostWidth - 36) / ARTBOARD_SIZE, (hostHeight - 36) / ARTBOARD_SIZE)
  const viewScale = Math.max(fit * viewport.zoom, 0.05)
  const stageX = hostWidth / 2 - (ARTBOARD_SIZE * viewScale) / 2 + viewport.panX
  const stageY = hostHeight / 2 - (ARTBOARD_SIZE * viewScale) / 2 + viewport.panY
  return { viewScale, stageX, stageY }
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

/**
 * Calculates the brush radius in image-local coordinates so that the
 * visual brush circle matches brushSize (in screen/artboard pixels).
 */
export function getBrushRadiusInImage(
  brushSize: number,
  layer: ImageLayer,
  viewScale: number,
): number {
  const avgScale = (Math.abs(layer.transform.scaleX) + Math.abs(layer.transform.scaleY)) / 2 || 1
  return Math.max(1, (brushSize / 2) / (avgScale * viewScale))
}

/**
 * Interpolates between two points so fast movements do not leave gaps.
 */
export function interpolatePoints(
  from: { u: number; v: number },
  to: { u: number; v: number },
  radius: number,
  onStep: (u: number, v: number) => void,
): void {
  const dx = to.u - from.u
  const dy = to.v - from.v
  const dist = Math.hypot(dx, dy)
  const stepSize = Math.max(1, radius / 3)
  const steps = Math.ceil(dist / stepSize)
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    onStep(from.u + dx * t, from.v + dy * t)
  }
}

/**
 * Paints a brush stamp onto the mask canvas context.
 * In erase mode: punches transparent hole using destination-out.
 * In restore mode: paints opaque white (alpha 255) using source-over.
 */
export function applyBrushToMask(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  radius: number,
  mode: 'erase' | 'restore',
): void {
  ctx.save()
  if (mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(255,255,255,1)'
  }
  ctx.beginPath()
  ctx.arc(u, v, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Creates a fully opaque white mask canvas representing an unmasked image.
 */
export function createDefaultMaskCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  return canvas
}

/**
 * Inverts a mask canvas in-place (alpha = 255 - alpha).
 */
export function invertMaskCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 255
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255 - a
  }
  ctx.putImageData(imgData, 0, 0)
}

/**
 * Resets a mask canvas so all pixels are restored/opaque.
 */
export function clearMaskCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

/**
 * Erases a mask canvas entirely.
 */
export function eraseAllMaskCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

/**
 * Converts canvas to PNG Blob with fallback.
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
