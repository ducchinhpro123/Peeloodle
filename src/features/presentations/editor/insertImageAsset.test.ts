import { beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_IMAGE_SHA256, fixtureImagePng } from '../model/fixtures/fixture'
import { PrepareImageError, fitImageWithinSlide, preparePresentationImage } from './insertImageAsset'

const PNG = fixtureImagePng()

function pngFile(name = 'photo.png', bytes: Uint8Array = PNG): File {
  return new File([bytes], name, { type: 'image/png' })
}

/** Structurally valid JPEG: SOI, JFIF APP0, EOI. Decode is stubbed, so only the bytes matter. */
function jpegBytes(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xd9,
  ])
}

/** Static WebP: RIFF/WEBP with one 'VP8 ' chunk and no ANIM/VP8X animation flag. */
function webpBytes(): Uint8Array {
  const payload = new Uint8Array([0x9d, 0x01, 0x2a, 0x02])
  const bytes = new Uint8Array(20 + payload.length)
  const view = new DataView(bytes.buffer)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // 'RIFF'
  view.setUint32(4, bytes.length - 8, true)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // 'WEBP'
  bytes.set([0x56, 0x50, 0x38, 0x20], 12) // 'VP8 '
  view.setUint32(16, payload.length, true)
  bytes.set(payload, 20)
  return bytes
}

function stubDecodedSize(width: number, height: number): void {
  globalThis.createImageBitmap = (async () => ({ width, height, close() {} })) as unknown as typeof createImageBitmap
}

beforeEach(() => {
  stubDecodedSize(256, 256)
})

describe('preparePresentationImage', () => {
  it('turns a supported photo into a content-addressed asset plus its media record', async () => {
    const prepared = await preparePresentationImage(pngFile())

    // The fixture PNG is deterministic, so this proves a real SHA-256 was computed
    // rather than a placeholder written into the asset.
    expect(prepared.asset.sha256).toBe(FIXTURE_IMAGE_SHA256)
    expect(prepared.asset.id).toBe(`asset-${FIXTURE_IMAGE_SHA256}`)
    expect(prepared.asset.blobKey).toBe(`uploads/${FIXTURE_IMAGE_SHA256}`)
    expect(prepared.asset).toMatchObject({
      mimeType: 'image/png',
      width: 256,
      height: 256,
      provenance: { source: 'upload', label: 'photo.png' },
    })

    expect(prepared.media.assetId).toBe(prepared.asset.id)
    expect(prepared.media.mimeType).toBe('image/png')
    expect(Array.from(prepared.media.bytes)).toEqual(Array.from(PNG))
  })

  it('derives the same identity for identical bytes so a re-upload dedupes', async () => {
    const first = await preparePresentationImage(pngFile('holiday.png'))
    const second = await preparePresentationImage(pngFile('holiday-copy.png'))

    expect(second.asset.id).toBe(first.asset.id)
    expect(second.asset.sha256).toBe(first.asset.sha256)
    expect(second.asset.blobKey).toBe(first.asset.blobKey)
  })

  it('propagates the JPEG type the upload boundary accepted to the asset and its media', async () => {
    const bytes = jpegBytes()
    const prepared = await preparePresentationImage(new File([bytes], 'photo.jpg', { type: 'image/jpeg' }))

    expect(prepared.asset.mimeType).toBe('image/jpeg')
    expect(prepared.media.mimeType).toBe('image/jpeg')
    expect(prepared.media.assetId).toBe(prepared.asset.id)
    // The bytes the media record carries are the uploaded ones, unmodified.
    expect(Array.from(prepared.media.bytes)).toEqual(Array.from(bytes))
  })

  it('propagates the static WebP type the upload boundary accepted to the asset and its media', async () => {
    const bytes = webpBytes()
    const prepared = await preparePresentationImage(new File([bytes], 'photo.webp', { type: 'image/webp' }))

    expect(prepared.asset.mimeType).toBe('image/webp')
    expect(prepared.media.mimeType).toBe('image/webp')
    expect(prepared.media.assetId).toBe(prepared.asset.id)
    expect(Array.from(prepared.media.bytes)).toEqual(Array.from(bytes))
  })

  it('rejects an unsupported file without inventing an asset', async () => {
    const bmp = new File([new Uint8Array([0x42, 0x4d, 0x00, 0x00])], 'scan.bmp', { type: 'image/bmp' })

    await expect(preparePresentationImage(bmp)).rejects.toBeInstanceOf(PrepareImageError)
    await expect(preparePresentationImage(bmp)).rejects.toMatchObject({ code: 'unsupported_type' })
  })

  it('keeps the upload boundary specific about why a file was refused', async () => {
    const svg = new File([PNG], 'logo.svg', { type: 'image/svg+xml' })
    const gif = new File([PNG], 'animated.gif', { type: 'image/gif' })
    const empty = new File([], 'empty.png', { type: 'image/png' })

    await expect(preparePresentationImage(svg)).rejects.toMatchObject({ code: 'unsupported_type', message: expect.stringMatching(/SVG/) })
    await expect(preparePresentationImage(gif)).rejects.toMatchObject({ code: 'unsupported_type', message: expect.stringMatching(/GIF/) })
    await expect(preparePresentationImage(empty)).rejects.toMatchObject({ code: 'decode_failed' })
  })

  it('refuses an image above the shared pixel limit', async () => {
    stubDecodedSize(6000, 5000)

    await expect(preparePresentationImage(pngFile())).rejects.toMatchObject({ code: 'too_many_pixels' })
  })

  it('refuses a file above the shared byte limit', async () => {
    // The size gate runs before sniffing, so the byte count is the whole input.
    // validateUpload's own size arithmetic is covered by its own tests; this pins
    // the code this module maps it to.
    const oversized = pngFile()
    Object.defineProperty(oversized, 'size', { value: 15 * 1024 * 1024 + 1 })

    await expect(preparePresentationImage(oversized)).rejects.toMatchObject({ code: 'too_large', message: expect.stringMatching(/15 MB/) })
  })
})

describe('fitImageWithinSlide', () => {
  const page = { width: 1280, height: 720 }

  it('keeps a small image at its own size, centred', () => {
    expect(fitImageWithinSlide({ width: 64, height: 64 }, page)).toEqual({ x: 608, y: 328, width: 64, height: 64 })
  })

  it('scales a large photo down to the slide while preserving aspect ratio', () => {
    const placement = fitImageWithinSlide({ width: 4000, height: 2000 }, page)

    expect(placement.width / placement.height).toBeCloseTo(2, 5)
    expect(placement.width).toBeLessThanOrEqual(page.width)
    expect(placement.height).toBeLessThanOrEqual(page.height)
    expect(placement.x).toBeCloseTo((page.width - placement.width) / 2, 5)
    expect(placement.y).toBeCloseTo((page.height - placement.height) / 2, 5)
  })

  it('fits a tall portrait image inside the height rather than overflowing it', () => {
    const placement = fitImageWithinSlide({ width: 1000, height: 4000 }, page)

    expect(placement.height).toBe(720 - 48 * 2)
    expect(placement.x).toBeGreaterThanOrEqual(0)
    expect(placement.y).toBeGreaterThanOrEqual(0)
    expect(placement.x + placement.width).toBeLessThanOrEqual(page.width)
    expect(placement.y + placement.height).toBeLessThanOrEqual(page.height)
  })
})
