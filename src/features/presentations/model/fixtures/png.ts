/**
 * Test/proof-only PNG encoder. Writes an uncompressed (deflate "stored") RGBA
 * PNG so fixtures need no binary files and no platform decoder. Deterministic
 * output keeps the fixture SHA-256 stable across environments.
 */

import { crc32 } from '../../../../lib/imageFormat'

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crcInput = out.subarray(4, 8 + data.length)
  view.setUint32(8 + data.length, crc32(crcInput))
  return out
}

function storedZlib(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  let offset = 0
  do {
    const length = Math.min(65535, raw.length - offset)
    const final = offset + length >= raw.length
    const header = new Uint8Array(5)
    header[0] = final ? 1 : 0
    header[1] = length & 0xff
    header[2] = (length >>> 8) & 0xff
    header[3] = ~length & 0xff
    header[4] = (~length >>> 8) & 0xff
    blocks.push(header, raw.subarray(offset, offset + length))
    offset += length
  } while (offset < raw.length)
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, adler32(raw))
  blocks.push(tail)
  const total = blocks.reduce((sum, block) => sum + block.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const block of blocks) {
    out.set(block, cursor)
    cursor += block.length
  }
  return out
}

export type Rgba = [number, number, number, number]

/** Encode an RGBA PNG. `pixel(x, y)` defaults to opaque white. */
export function encodeRgbaPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba = () => [255, 255, 255, 255],
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('PNG dimensions must be positive integers')
  }
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y)
      const i = rowStart + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', storedZlib(raw)), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}
