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
    if (layer.kind !== 'image' || !layer.visible) continue
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
  const canvas = (options.createCanvas ?? defaultCreateCanvas)(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExportError('A 2D canvas is required to export')

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, size, size)
  const scale = size / ARTBOARD_SIZE
  ctx.scale(scale, scale)

  const closeDecoded = !options.decodeImage
  const decode = options.decodeImage ?? defaultDecodeImage
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

  const blob = await canvasToPng(canvas)
  if (blob.type && blob.type !== 'image/png') throw new ExportError('Export did not produce a PNG')
  return blob
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

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
  const sCtx = silhouetteCanvas.getContext('2d')
  if (!sCtx) throw new ExportError('A 2D canvas is required to render the outline')

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
      const mCtx = maskedCanvas.getContext('2d')
      if (!mCtx) throw new ExportError('A 2D canvas is required to apply the mask')
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
        const filteredContext = filtered.getContext('2d')
        if (!filteredContext) throw new ExportError('A 2D canvas is required for image filters')
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
    surface.getContext('2d')?.scale(surface.width / w, surface.height / h)
    return surface
  }
  const canvas = makeCanvas(width + padding * 2, height + padding * 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExportError('A 2D canvas is required for image compositing')
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
      return await createImageBitmap(blob)
    } catch {
      // Fall through to HTMLImageElement.
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
