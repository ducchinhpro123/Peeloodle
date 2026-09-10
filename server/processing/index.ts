/**
 * Trusted single-asset processing entry point (P07).
 *
 * The endpoint will call this with bytes fetched from restricted Storage for a
 * claimed job; it never accepts URLs and never trusts a client MIME type.
 * Runs sequentially per invocation in bounded batches (see PROCESSING_LIMITS).
 */

import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { looksLikeSvgMarkup, sniffImageFormat } from '../../src/lib/imageFormat'
import { ProcessingError } from './errors'
import { PROCESSING_LIMITS } from './limits'
import { normalizeRaster } from './raster'
import { rasterizeSvg } from './svg'

export type ProcessedAsset = {
  sourceFormat: 'png' | 'webp' | 'svg'
  sourceBytes: number
  sourceSha256: string
  /** Approved derivative dimensions. */
  width: number
  height: number
  /** Normalized PNG used for insertion/export. */
  png: Uint8Array
  /** Bounded WebP preview. */
  thumbnail: Uint8Array
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function processAssetBytes(bytes: Uint8Array): Promise<ProcessedAsset> {
  if (bytes.length === 0) throw new ProcessingError('decode_failed', 'Uploaded file is empty')
  const sourceSha256 = sha256Hex(bytes)

  if (looksLikeSvgMarkup(bytes)) {
    const rasterized = rasterizeSvg(bytes)
    const thumbnail = await sharp(rasterized.png, { failOn: 'error' })
      .resize({ width: PROCESSING_LIMITS.raster.thumbnailEdge, height: PROCESSING_LIMITS.raster.thumbnailEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    return {
      sourceFormat: 'svg',
      sourceBytes: bytes.length,
      sourceSha256,
      width: rasterized.width,
      height: rasterized.height,
      png: rasterized.png,
      thumbnail: new Uint8Array(thumbnail),
    }
  }

  const format = sniffImageFormat(bytes)
  if (format === 'image/gif') throw new ProcessingError('unsupported_type', 'GIF is not accepted')
  if (format !== 'image/png' && format !== 'image/webp') {
    throw new ProcessingError('unsupported_type', 'Only PNG, static WebP and static SVG are accepted')
  }
  const normalized = await normalizeRaster(bytes)
  return {
    sourceFormat: format === 'image/png' ? 'png' : 'webp',
    sourceBytes: bytes.length,
    sourceSha256,
    width: normalized.width,
    height: normalized.height,
    png: normalized.png,
    thumbnail: normalized.thumbnail,
  }
}
