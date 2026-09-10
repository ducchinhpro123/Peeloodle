import { describe, expect, it } from 'vitest'
import { crc32, inspectImageBytes, jpegDimensions, pngDimensions, webpDimensions } from './imageFormat'
import { encodeRgbaPng } from '../features/presentations/model/fixtures/png'

function animatedWebp(animated: boolean): Uint8Array {
  const bytes = new Uint8Array(30)
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i)
  }
  writeAscii(0, 'RIFF')
  bytes[4] = bytes.length - 8
  writeAscii(8, 'WEBP')
  writeAscii(12, 'VP8X')
  bytes[16] = 10
  bytes[20] = animated ? 0x02 : 0x00
  bytes[24] = 99 // canvas width - 1
  bytes[25] = 0
  bytes[26] = 0
  bytes[27] = 49 // canvas height - 1
  return bytes
}

function minimalJpeg(width: number, height: number): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]
  return new Uint8Array([0xff, 0xd8, ...sof, 0xff, 0xd9])
}

describe('image byte inspection', () => {
  it('validates the fixture PNG and reports its dimensions', () => {
    const bytes = encodeRgbaPng(64, 48)
    expect(inspectImageBytes(bytes)).toEqual({ width: 64, height: 48, format: 'image/png' })
    expect(pngDimensions(bytes)).toEqual({ width: 64, height: 48 })
  })

  it('rejects truncated PNGs that have no image data', () => {
    const truncated = encodeRgbaPng(64, 48).slice(0, 33)
    expect(inspectImageBytes(truncated)).toBeUndefined()
    // The header alone still parses; only structural validation catches it.
    expect(pngDimensions(truncated)).toEqual({ width: 64, height: 48 })
  })

  it('rejects PNGs with a corrupted chunk checksum', () => {
    const bytes = encodeRgbaPng(64, 48)
    const corrupted = bytes.slice()
    corrupted[60] = corrupted[60]! ^ 0xff
    expect(inspectImageBytes(corrupted)).toBeUndefined()
    expect(crc32(bytes.subarray(12, 29))).toBeGreaterThan(0)
  })

  it('validates static WebP containers and rejects animated ones', () => {
    const staticWebp = animatedWebp(false)
    expect(webpDimensions(staticWebp)).toEqual({ width: 100, height: 50 })
    expect(inspectImageBytes(staticWebp)).toEqual({ width: 100, height: 50, format: 'image/webp' })
    expect(inspectImageBytes(animatedWebp(true))).toBeUndefined()
  })

  it('rejects WebP files whose RIFF size disagrees with the bytes', () => {
    const bytes = animatedWebp(false).slice(0, 24)
    expect(inspectImageBytes(bytes)).toBeUndefined()
  })

  it('reads JPEG SOF dimensions and requires the EOI trailer', () => {
    const jpeg = minimalJpeg(320, 200)
    expect(jpegDimensions(jpeg)).toEqual({ width: 320, height: 200 })
    expect(inspectImageBytes(jpeg)).toEqual({ width: 320, height: 200, format: 'image/jpeg' })
    expect(inspectImageBytes(jpeg.slice(0, jpeg.length - 2))).toBeUndefined()
    expect(inspectImageBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined()
  })

  it('never treats GIF or unknown bytes as images', () => {
    expect(inspectImageBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0]))).toBeUndefined()
    expect(inspectImageBytes(new Uint8Array([1, 2, 3, 4]))).toBeUndefined()
  })
})
