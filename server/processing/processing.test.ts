// @vitest-environment node
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { processAssetBytes } from './index'
import { inspectRasterHeader, normalizeRaster } from './raster'
import { inspectSvg, rasterizeSvg } from './svg'
import { ProcessingError } from './errors'
import { fixtureImagePng } from '../../src/features/presentations/model/fixtures/fixture'

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#08b879"/><stop offset="1" stop-color="#0b1f3b"/></linearGradient></defs>
  <rect width="120" height="80" rx="8" fill="url(#g)"/>
  <circle cx="30" cy="40" r="18" fill="#ffd166"/>
</svg>`

async function webpFixture(width = 40, height = 30): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 4, background: { r: 8, g: 184, b: 121, alpha: 0.5 } } }).webp().toBuffer())
}

function animatedWebpHeader(): Uint8Array {
  // RIFF/WEBP with a VP8X chunk whose animation flag is set, then ANIM.
  const bytes = new Uint8Array(12 + 8 + 10 + 8 + 6)
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i)
  }
  writeAscii(0, 'RIFF')
  bytes[4] = bytes.length - 8
  writeAscii(8, 'WEBP')
  writeAscii(12, 'VP8X')
  bytes[16] = 10
  bytes[20] = 0x02 // animation flag
  writeAscii(22, 'ANIM')
  bytes[26] = 6
  return bytes
}

function apngHeader(): Uint8Array {
  const png = fixtureImagePng()
  // Insert an acTL chunk right after IHDR (offset 8 + 25).
  const acTL = new Uint8Array([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0])
  const out = new Uint8Array(png.length + acTL.length)
  out.set(png.subarray(0, 33), 0)
  out.set(acTL, 33)
  out.set(png.subarray(33), 33 + acTL.length)
  return out
}

function oversizedPngHeader(width: number, height: number): Uint8Array {
  const png = fixtureImagePng()
  const out = png.slice(0, 33)
  const view = new DataView(out.buffer, out.byteOffset)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return out
}

const HOSTILE_SVGS: Array<{ name: string; svg: string }> = [
  { name: 'script element', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>' },
  { name: 'event handler', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" onload="alert(1)"/></svg>' },
  { name: 'external image', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://evil.example/x.png" width="10" height="10"/></svg>' },
  { name: 'external use', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><use href="https://evil.example/a.svg#x"/></svg>' },
  { name: 'foreignObject', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject width="10" height="10"><div>x</div></foreignObject></svg>' },
  { name: 'doctype entity', svg: '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&xxe;</text></svg>' },
  { name: 'style import', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>@import url("https://evil.example/x.css");</style><rect width="10" height="10"/></svg>' },
  { name: 'javascript url', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="url(javascript:alert(1))"/></svg>' },
  { name: 'text element', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="0" y="5">hi</text></svg>' },
  { name: 'huge dimensions', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="10" height="10"/></svg>' },
  { name: 'too many nodes', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${'<rect width="1" height="1"/>'.repeat(5200)}</svg>` },
  { name: 'deep nesting', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${'<g>'.repeat(70)}${'</g>'.repeat(70)}</svg>` },
  { name: 'unknown element', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><video src="x"/></svg>' },
]

describe('raster processing', () => {
  it('normalizes the fixture PNG and produces a bounded WebP thumbnail', async () => {
    const result = await processAssetBytes(fixtureImagePng())
    expect(result.sourceFormat).toBe('png')
    expect(result.width).toBe(256)
    expect(result.height).toBe(256)
    const pngMeta = await sharp(result.png).metadata()
    expect(pngMeta.format).toBe('png')
    expect(pngMeta.hasAlpha).toBe(true)
    const thumbMeta = await sharp(result.thumbnail).metadata()
    expect(thumbMeta.format).toBe('webp')
    expect(thumbMeta.width).toBeLessThanOrEqual(512)
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('accepts a real static WebP', async () => {
    const result = await processAssetBytes(await webpFixture())
    expect(result.sourceFormat).toBe('webp')
    expect(result.width).toBe(40)
    expect(result.height).toBe(30)
  })

  it('returns the actual derivative dimensions for a downscaled source', async () => {
    const wide = new Uint8Array(await sharp({ create: { width: 5000, height: 10, channels: 4, background: { r: 8, g: 184, b: 121, alpha: 1 } } }).png().toBuffer())
    const result = await processAssetBytes(wide)
    expect(result.width).toBe(4096)
    expect(result.height).toBe(8)
    const meta = await sharp(result.png).metadata()
    expect(meta.width).toBe(4096)
    expect(meta.height).toBe(8)
  })

  it('rejects animated WebP before decoding', () => {
    expect(() => inspectRasterHeader(animatedWebpHeader())).toThrowError(expect.objectContaining({ code: 'animated_image' }))
  })

  it('rejects animated PNG (acTL) before decoding', () => {
    expect(() => inspectRasterHeader(apngHeader())).toThrowError(expect.objectContaining({ code: 'animated_image' }))
  })

  it('rejects oversized dimensions from the header without decoding pixels', async () => {
    const bytes = oversizedPngHeader(30000, 30000)
    await expect(normalizeRaster(bytes)).rejects.toMatchObject({ code: 'dimension_too_large' })
  })

  it('rejects GIF, JPEG and unknown bytes', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0])
    await expect(processAssetBytes(gif)).rejects.toMatchObject({ code: 'unsupported_type' })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])
    await expect(processAssetBytes(jpeg)).rejects.toMatchObject({ code: 'unsupported_type' })
    await expect(processAssetBytes(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({ code: 'unsupported_type' })
  })

  it('rejects files over the source size limit', () => {
    const big = new Uint8Array(16 * 1024 * 1024)
    big.set(fixtureImagePng())
    expect(() => inspectRasterHeader(big)).toThrowError(expect.objectContaining({ code: 'file_too_large' }))
  })
})

describe('SVG processing', () => {
  it('accepts and rasterizes a static SVG', async () => {
    const inspection = inspectSvg(new TextEncoder().encode(VALID_SVG))
    expect(inspection.width).toBe(120)
    expect(inspection.height).toBe(80)
    const result = await processAssetBytes(new TextEncoder().encode(VALID_SVG))
    expect(result.sourceFormat).toBe('svg')
    expect(result.width).toBe(120)
    const meta = await sharp(result.png).metadata()
    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
    expect(result.thumbnail.length).toBeGreaterThan(50)
  })

  it.each(HOSTILE_SVGS)('rejects hostile SVG: $name', ({ svg }) => {
    expect(() => inspectSvg(new TextEncoder().encode(svg))).toThrow(ProcessingError)
  })

  it('rejects nested SVG that would shrink the recorded root bounds', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><svg width="100" height="100"><rect width="10" height="10"/></svg></svg>'
    expect(() => inspectSvg(new TextEncoder().encode(svg))).toThrowError(expect.objectContaining({ code: 'dimension_too_large' }))
  })

  it('allows an ordinary nested SVG inside bounded root dimensions', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><svg width="60" height="40" x="10" y="10"><rect width="20" height="20" fill="#08b879"/></svg></svg>'
    const inspection = inspectSvg(new TextEncoder().encode(svg))
    expect(inspection.width).toBe(120)
    expect(inspection.height).toBe(80)
    expect(rasterizeSvg(new TextEncoder().encode(svg)).png.length).toBeGreaterThan(50)
  })

  it('rejects an SVG over the source size limit', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${'<!-- padding -->'.repeat(200000)}</svg>`
    expect(() => inspectSvg(new TextEncoder().encode(svg))).toThrowError(expect.objectContaining({ code: 'file_too_large' }))
  })

  it('rejects malformed XML', () => {
    expect(() => inspectSvg(new TextEncoder().encode('<svg width="10" height="10"><rect'))).toThrowError(expect.objectContaining({ code: 'svg_unsafe' }))
  })

  it('rejects notes text elements rather than rendering undeterministic fonts', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="1" y="5">x</text></svg>'
    expect(() => rasterizeSvg(new TextEncoder().encode(svg))).toThrowError(expect.objectContaining({ code: 'unsupported_feature' }))
  })
})
