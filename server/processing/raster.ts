/**
 * Strict PNG / static-WebP processing (P07, productionized in P56).
 *
 * Trusted-side rules: claim-independent sniffing, animation and dimension
 * checks before decode, a hard pixel limit passed to the decoder, and outputs
 * that are re-encoded as our own PNG/WebP derivatives with metadata stripped.
 */

import sharp from 'sharp'
import { isAnimatedPng, isAnimatedWebp, pngDimensions, sniffImageFormat, webpDimensions } from '../../src/lib/imageFormat'
import { ProcessingError } from './errors'
import { PROCESSING_LIMITS } from './limits'

export type RasterFormat = 'png' | 'webp'

export type RasterInspection = {
  format: RasterFormat
  width: number
  height: number
}

export type NormalizedRaster = RasterInspection & {
  /** Normalized PNG derivative (alpha preserved, metadata stripped). */
  png: Uint8Array
  /** Bounded WebP thumbnail for lists and previews. */
  thumbnail: Uint8Array
}

/** Header-level checks that need no decoding. Dimensions are read from the
 * file header so decompression bombs are rejected before any pixel decode. */
export function inspectRasterHeader(bytes: Uint8Array): RasterInspection {
  const limits = PROCESSING_LIMITS.raster
  if (bytes.length > limits.maxSourceBytes) throw new ProcessingError('file_too_large', 'Image exceeds the source size limit')
  const sniffed = sniffImageFormat(bytes)
  if (sniffed !== 'image/png' && sniffed !== 'image/webp') {
    throw new ProcessingError('unsupported_type', 'Only PNG and static WebP are accepted')
  }
  if (sniffed === 'image/png' && isAnimatedPng(bytes)) throw new ProcessingError('animated_image', 'Animated PNG is not accepted')
  if (sniffed === 'image/webp' && isAnimatedWebp(bytes)) throw new ProcessingError('animated_image', 'Animated WebP is not accepted')
  const format: RasterFormat = sniffed === 'image/png' ? 'png' : 'webp'
  const dimensions = format === 'png' ? pngDimensions(bytes) : webpDimensions(bytes)
  if (dimensions) {
    if (dimensions.width > limits.maxSourceDimension || dimensions.height > limits.maxSourceDimension) {
      throw new ProcessingError('dimension_too_large', 'Image dimensions exceed the limit')
    }
    if (dimensions.width * dimensions.height > limits.maxPixels) throw new ProcessingError('too_many_pixels', 'Image exceeds the pixel limit')
  }
  return { format, width: dimensions?.width ?? 0, height: dimensions?.height ?? 0 }
}

export async function normalizeRaster(bytes: Uint8Array): Promise<NormalizedRaster> {
  const limits = PROCESSING_LIMITS.raster
  const header = inspectRasterHeader(bytes)

  let metadata: Awaited<ReturnType<typeof guard.metadata>>
  const guard = sharp(bytes, { failOn: 'error', limitInputPixels: limits.maxPixels, animated: false })
  try {
    metadata = await guard.metadata()
  } catch {
    throw new ProcessingError('decode_failed', 'The image could not be decoded')
  }

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ProcessingError('decode_failed', 'The image has no valid dimensions')
  }
  if (metadata.pages && metadata.pages > 1) throw new ProcessingError('animated_image', 'Animated images are not accepted')
  if (metadata.format !== header.format) throw new ProcessingError('unsupported_type', 'Image bytes do not match a supported format')
  if (header.width > 0 && (header.width !== width || header.height !== height)) {
    throw new ProcessingError('decode_failed', 'Image header dimensions do not match the decoded image')
  }
  if (width > limits.maxSourceDimension || height > limits.maxSourceDimension) {
    throw new ProcessingError('dimension_too_large', 'Image dimensions exceed the limit')
  }
  if (width * height > limits.maxPixels) throw new ProcessingError('too_many_pixels', 'Image exceeds the pixel limit')

  const pipeline = sharp(bytes, { failOn: 'error', limitInputPixels: limits.maxPixels, animated: false, page: 0 }).resize({
    width: limits.maxOutputEdge,
    height: limits.maxOutputEdge,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const png = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer()
  const thumbnail = await pipeline
    .clone()
    .resize({ width: limits.thumbnailEdge, height: limits.thumbnailEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()

  return { format: header.format, width, height, png: new Uint8Array(png), thumbnail: new Uint8Array(thumbnail) }
}
