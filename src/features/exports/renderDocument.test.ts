import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { blobBytes } from '@/lib/blob'
import { createProjectDocument } from '../../lib/persistence/repository'
import type { AssetRecord } from '../../lib/persistence/repository'
import type { ImageLayer, TextLayer } from '../../types/domain'
import { ExportError, formatCssFilter, paintText, readPngSize, renderDocument, type CanvasLike } from './renderDocument'

const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }

function pngChunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width: number, height: number, pixels: Uint8ClampedArray) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return new Blob([png], { type: 'image/png' })
}

function fakeCanvas(width: number, height: number): CanvasLike & { pixels: Uint8ClampedArray; texts: Array<{ text: string; x: number; y: number; baseline: string; font: string }> } {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const texts: Array<{ text: string; x: number; y: number; baseline: string; font: string }> = []
  const paintCenter = () => {
    const x = Math.floor(width / 2)
    const y = Math.floor(height / 2)
    const i = (y * width + x) * 4
    pixels[i] = 30
    pixels[i + 1] = 144
    pixels[i + 2] = 255
    pixels[i + 3] = 255
  }
  const ctx = {
    globalAlpha: 1,
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'top',
    save() {},
    restore() {},
    setTransform() {},
    scale() {},
    translate() {},
    rotate() {},
    clearRect() {
      pixels.fill(0)
    },
    drawImage() {
      paintCenter()
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, baseline: String(ctx.textBaseline), font: String(ctx.font) })
      paintCenter()
    },
    beginPath() {},
    arc() {},
    fillRect() {
      paintCenter()
    },
    fill() {
      paintCenter()
    },
  }
  return {
    width,
    height,
    pixels,
    texts,
    getContext: (type: '2d') => (type === '2d' ? (ctx as unknown as CanvasRenderingContext2D) : null),
    toBlob: (callback) => callback(encodePng(width, height, pixels)),
  }
}

describe('renderDocument', () => {
  it('rejects missing assets instead of reporting success', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const layer: ImageLayer = {
      id: 'img',
      name: 'Image',
      kind: 'image',
      assetId: 'missing',
      transform: identity,
      opacity: 1,
      visible: true,
      locked: false,
    }
    document.layers = [layer]
    document.assetIds = ['missing']
    await expect(renderDocument(document, new Map(), { size: 512 })).rejects.toBeInstanceOf(ExportError)
  })

  it('rejects decode failures', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const record: AssetRecord = {
      asset: { id: 'a1', mimeType: 'image/png', width: 8, height: 8, blobKey: 'a1', provenance: 'test' },
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }
    document.layers = [
      {
        id: 'img',
        name: 'Image',
        kind: 'image',
        assetId: 'a1',
        transform: identity,
        opacity: 1,
        visible: true,
        locked: false,
      },
    ]
    document.assetIds = ['a1']
    await expect(
      renderDocument(document, { a1: record }, {
        size: 512,
        createCanvas: (width, height) => fakeCanvas(width, height),
        decodeImage: async () => {
          throw new Error('boom')
        },
        waitForFonts: async () => {},
      }),
    ).rejects.toThrow(/decode/i)
  })

  it('writes a transparent PNG at the requested size without a checkerboard fill', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const text: TextLayer = {
      id: 'text',
      name: 'Text',
      kind: 'text',
      content: 'Hi',
      fontFamily: 'Inter',
      fontSize: 32,
      color: '#08152f',
      transform: { x: 40, y: 40, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 1,
      visible: true,
      locked: false,
    }
    document.layers = [text]
    const canvas = fakeCanvas(512, 512)
    const blob = await renderDocument(document, {}, {
      size: 512,
      createCanvas: () => canvas,
      waitForFonts: async () => {},
    })
    const bytes = await blobBytes(blob)
    expect(blob.type).toBe('image/png')
    expect(readPngSize(bytes)).toMatchObject({ width: 512, height: 512, colorType: 6 })
    expect(canvas.pixels[3]).toBe(0)
    expect(canvas.pixels[(256 * 512 + 256) * 4 + 3]).toBe(255)
  })

  it('draws multiline text with the same top baseline and line height as the editor', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const text: TextLayer = {
      id: 'text',
      name: 'Text',
      kind: 'text',
      content: 'Hello\nWorld',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 32,
      color: '#08152f',
      transform: { x: 40, y: 40, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 1,
      visible: true,
      locked: false,
    }
    document.layers = [text]
    const canvas = fakeCanvas(512, 512)
    await renderDocument(document, {}, {
      size: 512,
      createCanvas: () => canvas,
      waitForFonts: async () => {},
    })
    expect(canvas.texts).toEqual([
      { text: 'Hello', x: 0, y: 0, baseline: 'top', font: '32px "Plus Jakarta Sans"' },
      { text: 'World', x: 0, y: 32, baseline: 'top', font: '32px "Plus Jakarta Sans"' },
    ])
  })

  it.each([
    ['#f00', 'rgba(255, 0, 0, 1)'],
    ['#ff0000', 'rgba(255, 0, 0, 1)'],
    ['#0f08', `rgba(0, 255, 0, ${136 / 255})`],
    ['#00ff0088', `rgba(0, 255, 0, ${136 / 255})`],
  ])('renders saved text color %s without changing its color or alpha', (color, expected) => {
    const canvas = fakeCanvas(32, 32)
    const text: TextLayer = {
      id: 'text',
      name: 'Text',
      kind: 'text',
      content: 'Color',
      fontFamily: 'Inter',
      fontSize: 24,
      color,
      transform: identity,
      opacity: 1,
      visible: true,
      locked: false,
    }
    paintText(canvas.getContext('2d')!, text)
    expect(canvas.getContext('2d')!.fillStyle).toBe(expected)
  })

  it('closes owned export ImageBitmaps', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const record: AssetRecord = {
      asset: { id: 'a1', mimeType: 'image/png', width: 8, height: 8, blobKey: 'a1', provenance: 'test' },
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }
    document.layers = [
      {
        id: 'img',
        name: 'Image',
        kind: 'image',
        assetId: 'a1',
        transform: identity,
        opacity: 1,
        visible: true,
        locked: false,
      },
    ]
    document.assetIds = ['a1']
    let closed = 0
    await renderDocument(document, { a1: record }, {
      size: 512,
      createCanvas: (width, height) => fakeCanvas(width, height),
      decodeImage: async () => ({ width: 8, height: 8, close() { closed += 1 } }) as ImageBitmap,
      waitForFonts: async () => {},
    })
    expect(closed).toBe(0)
    closed = 0
    const previous = globalThis.createImageBitmap
    globalThis.createImageBitmap = async () => ({ width: 8, height: 8, close() { closed += 1 } }) as ImageBitmap
    try {
      await renderDocument(document, { a1: record }, {
        size: 512,
        createCanvas: (width, height) => fakeCanvas(width, height),
        waitForFonts: async () => {},
      })
    } finally {
      globalThis.createImageBitmap = previous
    }
    expect(closed).toBe(1)
  })

  it('formats CSS filter strings correctly', () => {
    expect(formatCssFilter()).toBe('none')
    expect(formatCssFilter({ brightness: 0, contrast: 0, saturation: 0, grayscale: 0 })).toBe('none')
    expect(formatCssFilter({ brightness: 20, contrast: -10, saturation: 15, grayscale: 30 })).toBe(
      'brightness(120%) contrast(90%) saturate(115%) grayscale(30%)',
    )
  })

  it('renders image layers with silhouette outline enabled', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const record: AssetRecord = {
      asset: { id: 'a1', mimeType: 'image/png', width: 8, height: 8, blobKey: 'a1', provenance: 'test' },
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }
    document.layers = [
      {
        id: 'img',
        name: 'Image',
        kind: 'image',
        assetId: 'a1',
        transform: identity,
        opacity: 1,
        visible: true,
        locked: false,
        outline: { enabled: true, color: '#ffffff', width: 10 },
      },
    ]
    document.assetIds = ['a1']
    const canvas = fakeCanvas(512, 512)
    await renderDocument(document, { a1: record }, {
      size: 512,
      createCanvas: () => canvas,
      decodeImage: async () => ({ width: 8, height: 8, close() {} }) as ImageBitmap,
      waitForFonts: async () => {},
    })
    expect(canvas.pixels[3]).toBe(0)
    expect(canvas.pixels[(256 * 512 + 256) * 4 + 3]).toBe(255)
  })

  it('rejects missing masks before attempting image decoding', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const record: AssetRecord = {
      asset: { id: 'a1', mimeType: 'image/png', width: 8, height: 8, blobKey: 'a1', provenance: 'test' },
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }
    document.layers = [
      {
        id: 'img',
        name: 'Image',
        kind: 'image',
        assetId: 'a1',
        maskKey: 'missing-mask-key',
        transform: identity,
        opacity: 1,
        visible: true,
        locked: false,
      },
    ]
    document.assetIds = ['a1']
    let decoded = 0
    await expect(
      renderDocument(document, { a1: record }, {
        size: 512,
        masks: {},
        decodeImage: async () => { decoded++; return { width: 8, height: 8 } as ImageBitmap },
      }),
    ).rejects.toThrow(/Missing mask missing-mask-key/)
    expect(decoded).toBe(0)
  })

  it('renders masked image layers using composite mask data', async () => {
    const document = createProjectDocument({ id: 'p1' })
    const record: AssetRecord = {
      asset: { id: 'a1', mimeType: 'image/png', width: 8, height: 8, blobKey: 'a1', provenance: 'test' },
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }
    const maskBlob = new Blob([new Uint8Array([2])], { type: 'image/png' })
    document.layers = [
      {
        id: 'img',
        name: 'Image',
        kind: 'image',
        assetId: 'a1',
        maskKey: 'mask-1',
        transform: identity,
        opacity: 1,
        visible: true,
        locked: false,
      },
    ]
    document.assetIds = ['a1']
    let closed = 0
    const previous = globalThis.createImageBitmap
    try {
      globalThis.createImageBitmap = async (source) => ({ width: source === maskBlob ? 4 : 8, height: 8, close() { closed++ } }) as ImageBitmap
      await expect(renderDocument(document, { a1: record }, {
        size: 512, masks: { 'mask-1': maskBlob }, createCanvas: (w, h) => fakeCanvas(w, h),
      })).rejects.toThrow(/Mask dimensions must match/)
      expect(closed).toBe(2)
      closed = 0
      globalThis.createImageBitmap = async (source) => {
        if (source === maskBlob) throw new Error('Corrupt PNG')
        return { width: 8, height: 8, close() { closed++ } } as ImageBitmap
      }
      await expect(renderDocument(document, { a1: record }, {
        size: 512, masks: { 'mask-1': maskBlob }, createCanvas: (w, h) => fakeCanvas(w, h),
      })).rejects.toThrow(/Could not decode mask/)
      expect(closed).toBe(1)
    } finally { globalThis.createImageBitmap = previous }
    const canvas = fakeCanvas(512, 512)
    await renderDocument(document, { a1: record }, {
      size: 512,
      masks: { 'mask-1': maskBlob },
      createCanvas: () => canvas,
      decodeImage: async () => ({ width: 8, height: 8, close() {} }) as ImageBitmap,
      waitForFonts: async () => {},
    })
    expect(canvas.pixels[3]).toBe(0)
    expect(canvas.pixels[(256 * 512 + 256) * 4 + 3]).toBe(255)
  })
})
