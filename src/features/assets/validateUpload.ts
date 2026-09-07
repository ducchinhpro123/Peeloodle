export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const MAX_UPLOAD_PIXELS = 25_000_000
export const SUPPORTED_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type SupportedUploadMimeType = (typeof SUPPORTED_UPLOAD_MIME_TYPES)[number]

export type UploadValidationErrorCode =
  | 'unsupported_type'
  | 'file_too_large'
  | 'too_many_pixels'
  | 'decode_failed'
  | 'animated_image'
  | 'svg_not_allowed'

export class UploadValidationError extends Error {
  readonly code: UploadValidationErrorCode

  constructor(code: UploadValidationErrorCode, message: string) {
    super(message)
    this.name = 'UploadValidationError'
    this.code = code
  }
}

export type DecodedImageSize = { width: number; height: number }
export type DecodeImageSize = (blob: Blob) => Promise<DecodedImageSize>
export type ValidateUploadOptions = { decodeImageSize?: DecodeImageSize }

export type ValidatedUpload = {
  blob: Blob
  mimeType: SupportedUploadMimeType
  width: number
  height: number
}

const PREFIX_BYTES = 64 * 1024

export async function validateUpload(file: File, options: ValidateUploadOptions = {}): Promise<ValidatedUpload> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError('file_too_large', 'Images must be 15 MB or smaller')
  }
  if (file.size <= 0) throw new UploadValidationError('decode_failed', 'The image file is empty')

  const prefix = await readBlobBytes(file.slice(0, Math.min(file.size, PREFIX_BYTES)))
  if (isLabeledSvg(file) || looksLikeSvgMarkup(prefix)) {
    throw new UploadValidationError('svg_not_allowed', 'SVG uploads are not supported')
  }
  if (isGif(file, prefix)) throw new UploadValidationError('unsupported_type', 'GIF uploads are not supported')

  const mimeType = resolveMimeType(file, prefix)
  if (!mimeType) throw new UploadValidationError('unsupported_type', 'Use a PNG, JPEG, or static WebP image')
  if (mimeType === 'image/png' && isAnimatedPng(prefix)) {
    throw new UploadValidationError('animated_image', 'Animated PNG uploads are not supported')
  }
  if (mimeType === 'image/webp' && isAnimatedWebp(prefix)) {
    throw new UploadValidationError('animated_image', 'Animated WebP uploads are not supported')
  }

  let decoded: DecodedImageSize
  try {
    decoded = await (options.decodeImageSize ?? decodeImageSize)(file)
  } catch (error) {
    if (error instanceof UploadValidationError) throw error
    throw new UploadValidationError('decode_failed', 'The image could not be decoded')
  }

  const width = decoded.width
  const height = decoded.height
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new UploadValidationError('decode_failed', 'The image could not be decoded')
  }
  if (width * height > MAX_UPLOAD_PIXELS) {
    throw new UploadValidationError('too_many_pixels', 'Images must be 25 megapixels or smaller')
  }

  return { blob: file, mimeType, width, height }
}

export async function decodeImageSize(blob: Blob): Promise<DecodedImageSize> {
  if (typeof createImageBitmap === 'function') {
    try {
      return sizeFromBitmap(await createImageBitmap(blob, { imageOrientation: 'from-image' }))
    } catch {
      try {
        return sizeFromBitmap(await createImageBitmap(blob))
      } catch {
        // Fall through to HTMLImageElement.
      }
    }
  }
  return decodeWithImageElement(blob)
}

function sizeFromBitmap(bitmap: ImageBitmap): DecodedImageSize {
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

function decodeWithImageElement(blob: Blob): Promise<DecodedImageSize> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    return Promise.reject(new UploadValidationError('decode_failed', 'The image could not be decoded'))
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    const fail = () => {
      URL.revokeObjectURL(url)
      reject(new UploadValidationError('decode_failed', 'The image could not be decoded'))
    }
    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      URL.revokeObjectURL(url)
      if (width <= 0 || height <= 0) fail()
      else resolve({ width, height })
    }
    image.onerror = fail
    image.src = url
  })
}

function resolveMimeType(file: File, bytes: Uint8Array): SupportedUploadMimeType | undefined {
  const sniffed = sniffMime(bytes)
  if (!sniffed || sniffed === 'image/gif') return undefined
  const declared = normalizeDeclaredMime(file.type)
  if (declared && sniffed !== declared) return undefined
  return sniffed
}

function normalizeDeclaredMime(type: string): SupportedUploadMimeType | undefined {
  const mime = type.toLowerCase()
  if (mime === 'image/jpg') return 'image/jpeg'
  return SUPPORTED_UPLOAD_MIME_TYPES.find((supported) => supported === mime)
}

function sniffMime(bytes: Uint8Array): SupportedUploadMimeType | 'image/gif' | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (isWebp(bytes)) return 'image/webp'
  if (isGifBytes(bytes)) return 'image/gif'
  return undefined
}

function isLabeledSvg(file: File): boolean {
  return file.type.toLowerCase().includes('svg') || file.name.toLowerCase().endsWith('.svg')
}

function looksLikeSvgMarkup(bytes: Uint8Array): boolean {
  if (sniffMime(bytes)) return false
  const header = new TextDecoder().decode(bytes).trimStart().toLowerCase()
  return header.startsWith('<svg') || (header.startsWith('<?xml') && header.includes('<svg'))
}

function isGif(file: File, bytes: Uint8Array): boolean {
  return file.type.toLowerCase() === 'image/gif' || file.name.toLowerCase().endsWith('.gif') || isGifBytes(bytes)
}

function isGifBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && ascii(bytes, 0, 3) === 'GIF' && (ascii(bytes, 3, 3) === '87a' || ascii(bytes, 3, 3) === '89a')
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
}

function isAnimatedPng(bytes: Uint8Array): boolean {
  if (sniffMime(bytes) !== 'image/png' || bytes.length < 24) return false
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = readU32be(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    if (type === 'acTL') return true
    if (type === 'IDAT' || type === 'IEND') return false
    const next = offset + 12 + length
    if (next <= offset) break
    offset = next
  }
  return false
}

function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (!isWebp(bytes)) return false
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const fourcc = ascii(bytes, offset, 4)
    const size = readU32le(bytes, offset + 4)
    if (fourcc === 'ANIM') return true
    if (fourcc === 'VP8X' && offset + 9 <= bytes.length && (bytes[offset + 8] & 0x02) !== 0) return true
    const padded = size + (size & 1)
    offset += 8 + padded
    if (padded < 0) break
  }
  return false
}

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsArrayBuffer(blob)
  })
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16) + (bytes[offset + 3]! << 24)
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}
