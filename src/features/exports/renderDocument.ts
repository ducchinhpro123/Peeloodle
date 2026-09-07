import { ARTBOARD_SIZE, type Layer, type ProjectDocument } from '../../types/domain'
import type { AssetRecord } from '../../lib/persistence/repository'

export type ExportSize = 512 | 1024
export const EXPORT_SIZES: ExportSize[] = [512, 1024]

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
  for (const layer of document.layers) {
    if (layer.kind !== 'image' || !layer.visible) continue
    if (!assetMap.has(layer.assetId)) {
      throw new ExportError(`Missing asset ${layer.assetId} for layer ${layer.id}`)
    }
  }

  const families = [...new Set(document.layers.filter((layer) => layer.kind === 'text').map((layer) => layer.fontFamily))]
  await (options.waitForFonts ?? defaultWaitForFonts)(families)

  const size = options.size
  const canvas = (options.createCanvas ?? defaultCreateCanvas)(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExportError('A 2D canvas is required to export')

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, size, size)
  const scale = size / ARTBOARD_SIZE
  ctx.scale(scale, scale)

  const decode = options.decodeImage ?? defaultDecodeImage
  for (const layer of document.layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(layer.transform.x, layer.transform.y)
    ctx.rotate((layer.transform.rotation * Math.PI) / 180)
    ctx.scale(layer.transform.scaleX, layer.transform.scaleY)
    await drawLayer(ctx, layer, assetMap, decode)
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

async function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  assets: Map<string, AssetRecord>,
  decode: (blob: Blob) => Promise<CanvasImageSource>,
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
    const crop = layer.crop
    if (crop) ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    else ctx.drawImage(image, 0, 0, record.asset.width, record.asset.height)
    return
  }
  if (layer.kind === 'text') {
    ctx.font = `${layer.fontSize}px ${layer.fontFamily}`
    ctx.fillStyle = layer.color
    ctx.textBaseline = 'top'
    ctx.fillText(layer.content, 0, 0)
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

async function defaultWaitForFonts(families: string[]): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts) return
  await Promise.all(families.map((family) => fonts.load(`16px ${family}`).catch(() => undefined)))
  await fonts.ready.catch(() => undefined)
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
