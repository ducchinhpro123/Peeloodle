import { ARTBOARD_SIZE, type ImageLayer, type Layer, type ProjectDocument } from '../../types/domain'
import type { AssetRecord } from '../../lib/persistence/repository'
import { cssFont, waitForFonts } from '../../lib/fonts'

export type ExportSize = 512 | 1024
export const EXPORT_SIZES: ExportSize[] = [512, 1024]
export const TEXT_LINE_HEIGHT = 1

export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

export type CanvasLike = {
  width: number
  height: number
  getContext: (type: '2d') => CanvasRenderingContext2D | null
  toBlob?: (callback: BlobCallback, type?: string, quality?: number) => void
  convertToBlob?: (options?: { type?: string }) => Promise<Blob>
}

export type RenderDocumentOptions = {
  size: ExportSize
  /** Fixed artboard for template/render probes; tight visible artwork for user downloads. */
  bounds?: 'artboard' | 'artwork'
  masks?: ReadonlyMap<string, Blob> | Record<string, Blob>
  createCanvas?: (width: number, height: number) => CanvasLike
  decodeImage?: (blob: Blob) => Promise<CanvasImageSource>
  waitForFonts?: (families: string[]) => Promise<void>
}

export async function renderDocument(
  document: ProjectDocument,
  assets: ReadonlyMap<string, AssetRecord> | Record<string, AssetRecord>,
  options: RenderDocumentOptions,
): Promise<Blob> {
  const assetMap = assets instanceof Map ? assets : new Map(Object.entries(assets))
  const maskMap =
    options.masks instanceof Map
      ? options.masks
      : options.masks
      ? new Map(Object.entries(options.masks))
      : new Map<string, Blob>()

  for (const layer of document.layers) {
    if (layer.kind !== 'image' || !layer.visible || layer.opacity <= 0) continue
    if (!assetMap.has(layer.assetId)) {
      throw new ExportError(`Missing asset ${layer.assetId} for layer ${layer.id}`)
    }
    if (layer.maskKey && !maskMap.has(layer.maskKey)) {
      throw new ExportError(`Missing mask ${layer.maskKey} for layer ${layer.id}`)
    }
  }

  const families = [...new Set(document.layers.flatMap((layer) => layer.kind === 'text' && layer.visible && layer.opacity > 0 ? [layer.fontFamily] : []))]
  await (options.waitForFonts ?? waitForFonts)(families)

  const size = options.size
  const make = options.createCanvas ?? defaultCreateCanvas
  const closeDecoded = !options.decodeImage
  const decode = options.decodeImage ?? defaultDecodeImage
  const bounds = options.bounds === 'artwork'
    ? await measureArtwork(document.layers, assetMap, maskMap, decode, closeDecoded, make)
    : null
  // Supersample the tight composition, with a two-pixel antialiasing guard.
  const scale = bounds ? (size * 2 - 4) / Math.max(bounds.width, bounds.height) : size / ARTBOARD_SIZE
  if (!Number.isFinite(scale) || scale <= 0) throw new ExportError('Artwork coordinates are too large or small to export.')
  const canvas = make(bounds ? Math.ceil(bounds.width * scale) + 4 : size, bounds ? Math.ceil(bounds.height * scale) + 4 : size)
  const ctx = require2d(canvas)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (bounds) ctx.translate(2 - bounds.x * scale, 2 - bounds.y * scale)
  ctx.scale(scale, scale)
  for (const layer of document.layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(layer.transform.x, layer.transform.y)
    ctx.rotate((layer.transform.rotation * Math.PI) / 180)
    ctx.scale(layer.transform.scaleX, layer.transform.scaleY)
    await drawLayer(ctx, layer, assetMap, maskMap, decode, closeDecoded, options.createCanvas)
    ctx.restore()
  }

  const output = bounds ? trimArtwork(canvas, size, make) : canvas
  const blob = await canvasToPng(output)
  if (blob.type && blob.type !== 'image/png') throw new ExportError('Export did not produce a PNG')
  return blob
}

type Bounds = { x: number; y: number; width: number; height: number }

function alphaBounds(canvas: CanvasLike): Bounds | null {
  const { width, height } = canvas
  const pixels = require2d(canvas).getImageData(0, 0, width, height).data
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

async function measureArtwork(
  layers: Layer[], assets: Map<string, AssetRecord>, masks: Map<string, Blob>,
  decode: (blob: Blob) => Promise<CanvasImageSource>, closeDecoded: boolean,
  make: (width: number, height: number) => CanvasLike,
): Promise<Bounds> {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0 || !layer.transform.scaleX || !layer.transform.scaleY) continue
    const local = make(1, 1)
    try {
      let x = 0, y = 0, width = 120, height = 120
      if (layer.kind === 'image') {
        const asset = assets.get(layer.assetId)!.asset
        const padding = layer.outline?.enabled ? Math.ceil(layer.outline.width) : 0
        x = y = -padding
        width = (layer.crop?.width ?? asset.width) + padding * 2
        height = (layer.crop?.height ?? asset.height) + padding * 2
      } else if (layer.kind === 'text') {
        const ctx = require2d(local)
        ctx.font = cssFont(layer.fontSize, layer.fontFamily)
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        const lines = layer.content.split('\n').map((line, index) => ({ metrics: ctx.measureText(line), y: index * layer.fontSize * TEXT_LINE_HEIGHT }))
        x = Math.min(...lines.map(({ metrics }) => -metrics.actualBoundingBoxLeft))
        y = Math.min(...lines.map(({ metrics, y }) => y - metrics.actualBoundingBoxAscent))
        width = Math.max(...lines.map(({ metrics }) => metrics.actualBoundingBoxRight)) - x
        height = Math.max(...lines.map(({ metrics, y }) => y + metrics.actualBoundingBoxDescent)) - y
      }
      if (width <= 0 || height <= 0) continue
      const originX = Math.floor(x) - 2, originY = Math.floor(y) - 2
      width = Math.ceil(x + width) - originX + 2; height = Math.ceil(y + height) - originY + 2
      // Bound native alpha measurements instead of allocating an unbounded world-sized canvas.
      if (!Number.isFinite(width * height) || width > 32767 || height > 32767 || width * height > 32_000_000) {
        throw new ExportError('Artwork is too large to measure. Use a smaller image, text size, or outline width.')
      }
      local.width = width; local.height = height
      const ctx = require2d(local)
      ctx.translate(-originX, -originY); ctx.globalAlpha = layer.opacity
      // Measure the masked silhouette once; dilating its bounds avoids painting every outline stamp twice.
      await drawLayer(ctx, layer.kind === 'image' ? { ...layer, outline: undefined } : layer, assets, masks, decode, closeDecoded, make)
      const visible = alphaBounds(local)
      if (!visible) continue
      const outline = layer.kind === 'image' && layer.outline?.enabled ? Math.ceil(layer.outline.width) : 0
      visible.x -= outline; visible.y -= outline; visible.width += outline * 2; visible.height += outline * 2
      const t = layer.transform, angle = t.rotation * Math.PI / 180
      for (const px of [visible.x + originX, visible.x + originX + visible.width]) {
        for (const py of [visible.y + originY, visible.y + originY + visible.height]) {
          const worldX = t.x + px * t.scaleX * Math.cos(angle) - py * t.scaleY * Math.sin(angle)
          const worldY = t.y + px * t.scaleX * Math.sin(angle) + py * t.scaleY * Math.cos(angle)
          left = Math.min(left, worldX); right = Math.max(right, worldX)
          top = Math.min(top, worldY); bottom = Math.max(bottom, worldY)
        }
      }
    } finally {
      // Measure one native layer at a time; do not retain full-resolution copies for every layer.
      local.width = local.height = 1
    }
  }
  if (left === Infinity) throw new ExportError('Nothing visible to export. Add or restore some artwork first.')
  if (right <= left || bottom <= top || ![left, top, right, bottom, right - left, bottom - top].every(Number.isFinite)) throw new ExportError('Artwork coordinates are too large to export.')
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function trimArtwork(canvas: CanvasLike, size: number, make: (width: number, height: number) => CanvasLike): CanvasLike {
  const bounds = alphaBounds(canvas)
  if (!bounds) throw new ExportError('Nothing visible to export. Add or restore some artwork first.')
  const scale = size / Math.max(bounds.width, bounds.height)
  const output = make(Math.max(1, Math.round(bounds.width * scale)), Math.max(1, Math.round(bounds.height * scale)))
  require2d(output).drawImage(canvas as CanvasImageSource, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, output.width, output.height)
  const edge = alphaBounds(output)
  if (!edge) throw new ExportError('Nothing visible to export. Add or restore some artwork first.')
  if (edge.width === output.width && edge.height === output.height) return output
  const trimmed = make(edge.width, edge.height)
  require2d(trimmed).drawImage(output as CanvasImageSource, edge.x, edge.y, edge.width, edge.height, 0, 0, edge.width, edge.height)
  return trimmed
}

export { downloadBlob } from './download'

export function readPngSize(bytes: Uint8Array): { width: number; height: number; colorType: number } {
  if (bytes.length < 26 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new ExportError('Not a PNG file')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: bytes[25]! }
}

export function paintText(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { kind: 'text' }>): void {
  ctx.font = cssFont(layer.fontSize, layer.fontFamily)
  ctx.fillStyle = layer.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lines = layer.content.split('\n')
  const step = layer.fontSize * TEXT_LINE_HEIGHT
  for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i]!, 0, i * step)
}

function closeImageSource(image: CanvasImageSource): void {
  if (typeof (image as ImageBitmap).close === 'function') (image as ImageBitmap).close()
}

export function formatCssFilter(filters?: import('../../types/domain').ImageFilters): string {
  if (!filters) return 'none'
  const parts: string[] = []
  if (filters.brightness !== 0) parts.push(`brightness(${100 + filters.brightness}%)`)
  if (filters.contrast !== 0) parts.push(`contrast(${100 + filters.contrast}%)`)
  if (filters.saturation !== 0) parts.push(`saturate(${100 + filters.saturation}%)`)
  if (filters.grayscale > 0) parts.push(`grayscale(${filters.grayscale}%)`)
  return parts.length > 0 ? parts.join(' ') : 'none'
}

function drawOutlinedImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  crop: import('../../types/domain').CropRect | undefined,
  width: number,
  height: number,
  outline: import('../../types/domain').LayerOutline,
  createCanvas?: (w: number, h: number) => CanvasLike,
): void {
  const makeCanvas = createCanvas ?? defaultCreateCanvas
  const silhouetteCanvas = makeCanvas(width, height)
  const sCtx = require2d(silhouetteCanvas)

  if (crop) sCtx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  else sCtx.drawImage(image, 0, 0, width, height)

  sCtx.globalCompositeOperation = 'source-in'
  sCtx.fillStyle = outline.color
  sCtx.fillRect(0, 0, width, height)

  const radius = outline.width
  const steps = Math.max(16, Math.ceil(radius * 2 * Math.PI / 2))
  for (let angle = 0; angle < Math.PI * 2; angle += (Math.PI * 2) / steps) {
    const dx = Math.cos(angle) * radius
    const dy = Math.sin(angle) * radius
    ctx.drawImage(silhouetteCanvas as unknown as CanvasImageSource, dx, dy, width, height)
  }
  if (radius > 6) {
    const half = radius / 2
    for (let angle = 0; angle < Math.PI * 2; angle += (Math.PI * 2) / (steps / 2)) {
      ctx.drawImage(silhouetteCanvas as unknown as CanvasImageSource, Math.cos(angle) * half, Math.sin(angle) * half, width, height)
    }
  }

  if (crop) ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  else ctx.drawImage(image, 0, 0, width, height)
}

/** Shared image compositing for the cached preview and document export. */
function paintImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  layer: Pick<ImageLayer, 'crop' | 'filters' | 'outline'>,
  width: number,
  height: number,
  createCanvas?: (width: number, height: number) => CanvasLike,
  maskImage?: CanvasImageSource | null,
): void {
  ctx.save()
  ctx.filter = formatCssFilter(layer.filters)
  try {
    let source = image
    let maskedCanvas: CanvasLike | null = null
    if (maskImage) {
      const makeCanvas = createCanvas ?? defaultCreateCanvas
      maskedCanvas = makeCanvas(width, height)
      const mCtx = require2d(maskedCanvas)
      if (layer.crop) {
        const crop = layer.crop
        mCtx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
        mCtx.globalCompositeOperation = 'destination-in'
        mCtx.drawImage(maskImage, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
      } else {
        mCtx.drawImage(image, 0, 0, width, height)
        mCtx.globalCompositeOperation = 'destination-in'
        mCtx.drawImage(maskImage, 0, 0, width, height)
      }
      source = maskedCanvas as unknown as CanvasImageSource
    }

    if (layer.outline?.enabled && layer.outline.width > 0) {
      if (ctx.filter !== 'none') {
        const filtered = (createCanvas ?? defaultCreateCanvas)(width, height)
        const filteredContext = require2d(filtered)
        paintImage(filteredContext, source, { crop: maskImage ? undefined : layer.crop, filters: layer.filters }, width, height, createCanvas)
        ctx.filter = 'none'
        drawOutlinedImage(ctx, filtered as CanvasImageSource, undefined, width, height, layer.outline, createCanvas)
      } else {
        drawOutlinedImage(ctx, source, maskImage ? undefined : layer.crop, width, height, layer.outline, createCanvas)
      }
    } else if (maskImage) {
      ctx.drawImage(source, 0, 0, width, height)
    } else if (layer.crop) {
      const crop = layer.crop
      ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
    } else {
      ctx.drawImage(image, 0, 0, width, height)
    }
  } finally {
    ctx.restore()
  }
}

export function createImageSurface(
  image: CanvasImageSource,
  layer: Pick<ImageLayer, 'crop' | 'filters' | 'outline'>,
  width: number,
  height: number,
  createCanvas = defaultCreateCanvas,
  maskImage?: CanvasImageSource | null,
  pixelRatio = 1,
): { canvas: CanvasLike; padding: number } {
  const padding = layer.outline?.enabled ? Math.ceil(layer.outline.width) : 0
  const makeCanvas = pixelRatio === 1 ? createCanvas : (w: number, h: number) => {
    const surface = createCanvas(Math.max(1, Math.ceil(w * pixelRatio)), Math.max(1, Math.ceil(h * pixelRatio)))
    require2d(surface).scale(surface.width / w, surface.height / h)
    return surface
  }
  const canvas = makeCanvas(width + padding * 2, height + padding * 2)
  const ctx = require2d(canvas)
  ctx.translate(padding, padding)
  paintImage(ctx, image, layer, width, height, makeCanvas, maskImage)
  return { canvas, padding }
}

async function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  assets: Map<string, AssetRecord>,
  masks: Map<string, Blob>,
  decode: (blob: Blob) => Promise<CanvasImageSource>,
  closeDecoded: boolean,
  createCanvas?: (w: number, h: number) => CanvasLike,
): Promise<void> {
  if (layer.kind === 'image') {
    const record = assets.get(layer.assetId)
    if (!record) throw new ExportError(`Missing asset ${layer.assetId}`)
    let image: CanvasImageSource
    try {
      image = await decode(record.blob)
    } catch {
      throw new ExportError(`Could not decode asset ${layer.assetId}`)
    }

    let maskImage: CanvasImageSource | null = null
    try {
      if (layer.maskKey) {
        const maskBlob = masks.get(layer.maskKey)
        if (!maskBlob) throw new ExportError(`Missing mask ${layer.maskKey} for layer ${layer.id}`)
        try {
          maskImage = await decode(maskBlob)
        } catch {
          throw new ExportError(`Could not decode mask ${layer.maskKey}`)
        }
        assertMaskDimensions(maskImage, record.asset.width, record.asset.height)
      }
      const width = layer.crop?.width ?? record.asset.width
      const height = layer.crop?.height ?? record.asset.height
      if (layer.outline?.enabled && layer.outline.width > 0) {
        // Composite once before layer opacity, rather than accumulating opacity per outline stamp.
        const { canvas, padding } = createImageSurface(image, layer, width, height, createCanvas, maskImage)
        ctx.drawImage(canvas as CanvasImageSource, -padding, -padding)
      } else {
        paintImage(ctx, image, layer, width, height, createCanvas, maskImage)
      }
    } finally {
      if (closeDecoded) {
        closeImageSource(image)
        if (maskImage) closeImageSource(maskImage)
      }
    }
    return
  }
  if (layer.kind === 'text') {
    paintText(ctx, layer)
    return
  }
  ctx.fillStyle = layer.fill
  if (layer.shape === 'circle') {
    ctx.beginPath()
    ctx.arc(60, 60, 60, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.fillRect(0, 0, 120, 120)
}

function require2d(canvas: CanvasLike): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExportError('A 2D canvas is required to export')
  ctx.imageSmoothingEnabled = true
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'
  return ctx
}

function defaultCreateCanvas(width: number, height: number): CanvasLike {
  if (typeof document === 'undefined') throw new ExportError('A 2D canvas is required to export')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function assertMaskDimensions(image: CanvasImageSource, width: number, height: number): void {
  const dimensions = image as { width: number; height: number }
  if (dimensions.width !== width || dimensions.height !== height) {
    throw new ExportError(`Mask dimensions must match the original image (${width}×${height})`)
  }
}

export async function decodeMaskImage(blob: Blob, width: number, height: number): Promise<CanvasImageSource> {
  let image: CanvasImageSource
  try { image = await defaultDecodeImage(blob) } catch { throw new ExportError('Could not decode image mask') }
  try {
    assertMaskDimensions(image, width, height)
    return image
  } catch (error) {
    closeImageSource(image)
    throw error
  }
}

async function defaultDecodeImage(blob: Blob): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image', resizeQuality: 'high' })
    } catch {
      try {
        return await createImageBitmap(blob)
      } catch {
        // Fall through to HTMLImageElement.
      }
    }
  }
  return decodeHtmlImage(blob)
}

function decodeHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    return Promise.reject(new ExportError('Could not decode image'))
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ExportError('Could not decode image'))
    }
    image.src = url
  })
}

function canvasToPng(canvas: CanvasLike): Promise<Blob> {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' })
  const toBlob = canvas.toBlob
  if (!toBlob) return Promise.reject(new ExportError('Canvas PNG export is unavailable'))
  return new Promise((resolve, reject) => {
    toBlob.call(canvas, (blob) => {
      if (!blob) reject(new ExportError('Export failed'))
      else resolve(blob)
    }, 'image/png')
  })
}
