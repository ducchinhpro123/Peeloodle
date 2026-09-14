// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildPresentationPptx, bytesToBase64, imageCropSizing, pptxFrame } from './pptx'
import { createImageElement, createPresentationDocument, createShapeElement, createSlide, createTextElement } from '../model/factories'
import { unitsToInches } from '../model/geometry'
import { fixtureImagePng } from '../model/fixtures/fixture'
import type { PresentationExportSnapshot } from './snapshot'
import type { PresentationDocument } from '../model/types'

function snapshotOf(document: PresentationDocument, media: Map<string, { assetId: string; bytes: Uint8Array; mimeType: 'image/png' }>): PresentationExportSnapshot {
  return { document, revision: document.revision, images: new Map(), media, warnings: [], dispose() {} }
}

/** The `<a:p>` blocks of one shape's text body, in document order. */
function paragraphsOf(xml: string, shapeName: string): string[] {
  const nameAt = xml.indexOf(`name="${shapeName}"`)
  if (nameAt < 0) throw new Error(`no shape named ${shapeName}`)
  const shape = xml.slice(xml.lastIndexOf('<p:sp>', nameAt), xml.indexOf('</p:sp>', nameAt))
  const body = shape.slice(shape.indexOf('<p:txBody>'), shape.indexOf('</p:txBody>'))
  return body.match(/<a:p>.*?<\/a:p>/g) ?? []
}

type ParagraphProperties = {
  align: string | null
  level: number | null
  marL: number | null
  indent: number | null
  bullet: string
}

/**
 * Every `<a:pPr>` block in one `<a:p>`, parsed into the properties a reader acts
 * on. PptxGenJS emits one block per run, so a paragraph with two runs must yield
 * two identical entries; anything else means a later run disagrees with the
 * paragraph and the reader can drop its bullet, indent or alignment.
 */
function paragraphPropertiesIn(paragraph: string): ParagraphProperties[] {
  return [...paragraph.matchAll(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g)].map((match) => {
    const block = match[0]!
    const opening = /^<a:pPr\b([^>]*)>/.exec(block)?.[1] ?? ''
    const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(opening)?.[1] ?? null
    const number = (name: string) => {
      const raw = attribute(name)
      return raw === null ? null : Number(raw)
    }
    const character = /<a:buChar char="&#x([0-9A-Fa-f]+);"\/>/.exec(block)
    const numbering = /<a:buAutoNum type="([^"]+)" startAt="(\d+)"\/>/.exec(block)
    return {
      align: attribute('algn'),
      level: number('lvl'),
      marL: number('marL'),
      indent: number('indent'),
      bullet: character
        ? `char:${String.fromCodePoint(parseInt(character[1]!, 16))}`
        : numbering
          ? `number:${numbering[1]}:${numbering[2]}`
          : block.includes('<a:buNone/>')
            ? 'none'
            : 'inherited',
    }
  })
}

function fixtureDocument(): { document: PresentationDocument; media: Map<string, { assetId: string; bytes: Uint8Array; mimeType: 'image/png' }> } {
  const document = createPresentationDocument({ id: 'deck', title: 'Deck' })
  const image = {
    id: 'asset-photo',
    blobKey: 'uploads/asset-photo',
    mimeType: 'image/png' as const,
    width: 256,
    height: 256,
    sha256: 'a'.repeat(64),
    byteLength: fixtureImagePng().length,
    provenance: { source: 'upload' as const, label: 'photo.png' },
  }
  document.assets = [image]
  document.slides = [
    {
      ...createSlide({ id: 'slide-1', name: 'Intro', background: '#123456' }),
      elements: [
        createTextElement({
          id: 'heading',
          name: 'Heading',
          x: 80,
          y: 80,
          width: 1120,
          height: 200,
          paragraphs: [
            {
              runs: [
                { text: 'Hello ', fontId: 'spectral', size: 48, color: '#ffffff', bold: true },
                { text: 'world', fontId: 'spectral', size: 48, color: '#08b879', italic: true, link: 'https://example.com' },
              ],
              alignment: 'center',
              bullet: 'none',
              bulletLevel: 0,
            },
          ],
        }),
        createShapeElement({ id: 'panel', name: 'Panel', x: 100, y: 300, width: 400, height: 200, shape: 'rectangle', fill: '#ff0000', stroke: '#000000', strokeWidth: 4 }),
      ],
    },
    {
      ...createSlide({ id: 'slide-2', name: 'Details', background: '#ffffff' }),
      elements: [
        createTextElement({
          id: 'bullets',
          name: 'Points',
          x: 100,
          y: 100,
          width: 800,
          height: 400,
          paragraphs: [
            { runs: [{ text: 'First', fontId: 'be-vietnam-pro', size: 28, color: '#08152f' }], alignment: 'left', bullet: 'bullet', bulletLevel: 0 },
            { runs: [{ text: 'Second', fontId: 'be-vietnam-pro', size: 28, color: '#08152f' }], alignment: 'left', bullet: 'number', bulletLevel: 1 },
          ],
        }),
        {
          ...createImageElement({ assetId: 'asset-photo', alt: 'Sample photo' }),
          id: 'photo',
          name: 'Photo',
          x: 100,
          y: 400,
          width: 400,
          height: 200,
          rotation: 45,
          crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
          flipX: true,
        },
      ],
    },
  ]
  const media = new Map([['asset-photo', { assetId: 'asset-photo', bytes: fixtureImagePng(), mimeType: 'image/png' as const }]])
  return { document, media }
}

describe('editable PPTX export', () => {
  it('keeps native text runs, hyperlinks and paragraph bullets', async () => {
    const { document, media } = fixtureDocument()
    const bytes = await buildPresentationPptx(snapshotOf(document, media))
    const files = unzipSync(bytes)
    const first = strFromU8(files['ppt/slides/slide1.xml']!)
    const second = strFromU8(files['ppt/slides/slide2.xml']!)
    const rels = strFromU8(files['ppt/slides/_rels/slide1.xml.rels']!)

    expect(first).toContain('>Hello <')
    expect(first).toContain('>world<')
    expect(first).toContain('b="1"')
    expect(first).toContain('i="1"')
    expect(first).toContain('algn="ctr"')
    expect(first).toContain('hlinkClick')
    expect(rels).toContain('https://example.com')

    expect(second).toContain('buChar')
    expect(second).toContain('buAutoNum')
    expect(second).toContain('lvl="1"')

    // Slide background from the document.
    expect(first).toContain('val="123456"')
  })

  it('embeds a separately movable picture with its crop, flip and rotation', async () => {
    const { document, media } = fixtureDocument()
    const bytes = await buildPresentationPptx(snapshotOf(document, media))
    const files = unzipSync(bytes)
    const second = strFromU8(files['ppt/slides/slide2.xml']!)

    // Crop 25% left/right of a half-width crop of a 400×200 frame.
    expect(second).toContain('srcRect l="25000" r="25000"')
    expect(second).toContain('flipH="1"')
    expect(second).toContain('rot="2700000"')
    // The media is a real embedded file, byte-identical to the source.
    const mediaEntry = Object.keys(files).find((path) => path.startsWith('ppt/media/') && path.endsWith('.png'))
    expect(mediaEntry).toBeDefined()
    expect(Array.from(files[mediaEntry!]!)).toEqual(Array.from(fixtureImagePng()))
  })

  it('keeps shapes native and editable with fill and stroke', async () => {
    const { document, media } = fixtureDocument()
    const bytes = await buildPresentationPptx(snapshotOf(document, media))
    const files = unzipSync(bytes)
    const first = strFromU8(files['ppt/slides/slide1.xml']!)

    expect(first).toContain('prst="rect"')
    expect(first).toContain('val="FF0000"')
    expect(first).toContain('val="000000"')
  })

  it('writes a multi-run paragraph as one paragraph with identical options on every run', async () => {
    // PptxGenJS emits `<a:pPr>` once per run; a run without a bullet writes
    // `<a:buNone/>`, and a run whose alignment changes starts a new paragraph that
    // readers render as an extra line. The P44 LibreOffice render showed the old
    // first-run-only version losing the bullet glyphs and indentation, so this test
    // parses every emitted property block of every paragraph and requires each run
    // to carry the paragraph's own options.
    const run = (text: string) => ({ text, fontId: 'be-vietnam-pro' as const, size: 28, color: '#08152f' })
    const document = createPresentationDocument({ id: 'deck', title: 'Deck' })
    document.slides = [
      {
        ...createSlide({ id: 'slide-1', name: 'One' }),
        elements: [
          createTextElement({
            id: 'mixed',
            name: 'Mixed',
            paragraphs: [
              { runs: [run('Đoạn một, '), run('nhấn mạnh, '), run('kết thúc.')], alignment: 'center', bullet: 'none', bulletLevel: 0 },
              { runs: [run('Kết quả chính: '), run('năng suất giảm 12%.')], alignment: 'left', bullet: 'bullet', bulletLevel: 0 },
              { runs: [run('Chi tiết phụ: '), run('đã kiểm tra lại.')], alignment: 'left', bullet: 'number', bulletLevel: 1 },
              { runs: [run('Bước một: '), run('chuẩn bị dữ liệu.')], alignment: 'left', bullet: 'number', bulletLevel: 0 },
              { runs: [run('Bước hai: '), run('trình bày kết quả.')], alignment: 'center', bullet: 'number', bulletLevel: 0 },
            ],
          }),
        ],
      },
    ]

    const bytes = await buildPresentationPptx(snapshotOf(document, new Map()))
    const xml = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']!)
    const paragraphs = paragraphsOf(xml, 'Mixed')

    // One <a:p> per document paragraph, in order: no run may start an extra one.
    expect(paragraphs).toHaveLength(5)
    expect(paragraphs[0]).toContain('Đoạn một, ')
    expect(paragraphs[0]).toContain('nhấn mạnh, ')
    expect(paragraphs[0]).toContain('kết thúc.')
    expect(paragraphs[1]).toContain('Kết quả chính: ')
    expect(paragraphs[1]).toContain('năng suất giảm 12%.')
    expect(paragraphs[2]).toContain('Chi tiết phụ: ')
    expect(paragraphs[3]).toContain('Bước một: ')
    expect(paragraphs[4]).toContain('Bước hai: ')
    expect(paragraphs[4]).toContain('trình bày kết quả.')

    const expected: ParagraphProperties[][] = [
      // Centred three-run paragraph (the fixture title's shape).
      [
        { align: 'ctr', level: null, marL: 0, indent: 0, bullet: 'none' },
        { align: 'ctr', level: null, marL: 0, indent: 0, bullet: 'none' },
        { align: 'ctr', level: null, marL: 0, indent: 0, bullet: 'none' },
      ],
      // Bulleted two-run paragraph, level 0.
      [
        { align: 'l', level: null, marL: 342900, indent: -342900, bullet: 'char:\u2022' },
        { align: 'l', level: null, marL: 342900, indent: -342900, bullet: 'char:\u2022' },
      ],
      // Numbered two-run paragraph at level 1.
      [
        { align: 'l', level: 1, marL: 685800, indent: -342900, bullet: 'number:arabicPeriod:1' },
        { align: 'l', level: 1, marL: 685800, indent: -342900, bullet: 'number:arabicPeriod:1' },
      ],
      // Numbered two-run paragraph at level 0 restarting the level counter.
      [
        { align: 'l', level: null, marL: 342900, indent: -342900, bullet: 'number:arabicPeriod:1' },
        { align: 'l', level: null, marL: 342900, indent: -342900, bullet: 'number:arabicPeriod:1' },
      ],
      // Consecutive numbered paragraph at the same level continues the count.
      [
        { align: 'ctr', level: null, marL: 342900, indent: -342900, bullet: 'number:arabicPeriod:2' },
        { align: 'ctr', level: null, marL: 342900, indent: -342900, bullet: 'number:arabicPeriod:2' },
      ],
    ]

    paragraphs.forEach((paragraph, index) => {
      // Paragraph properties are the paragraph's first child, as the schema requires.
      expect(paragraph.startsWith('<a:p><a:pPr')).toBe(true)
      const blocks = paragraphPropertiesIn(paragraph)
      // One property block per run, all identical to the paragraph's own options.
      expect(blocks).toEqual(expected[index])
    })
  })

  it('writes one slide per document slide in order', async () => {
    const { document, media } = fixtureDocument()
    const bytes = await buildPresentationPptx(snapshotOf(document, media))
    const files = unzipSync(bytes)
    expect(files['ppt/slides/slide1.xml']).toBeDefined()
    expect(files['ppt/slides/slide2.xml']).toBeDefined()
    expect(files['ppt/slides/slide3.xml']).toBeUndefined()
  })

  it('maps the element box through the rotated centre', () => {
    const element = createShapeElement({ id: 'shape', x: 100, y: 100, width: 400, height: 200, shape: 'rectangle' })
    const frame = pptxFrame({ ...element, rotation: 90 })
    expect(frame.x).toBeCloseTo(unitsToInches(-200), 6)
    expect(frame.y).toBeCloseTo(unitsToInches(200), 6)
    expect(frame.w).toBeCloseTo(unitsToInches(400), 6)
    expect(frame.h).toBeCloseTo(unitsToInches(200), 6)
  })

  it('expresses a normalized crop as the full-image box plus the visible box', () => {
    const element = createImageElement({ assetId: 'asset', width: 400, height: 200, crop: { x: 0.25, y: 0, width: 0.5, height: 1 } })
    const crop = imageCropSizing(element)
    expect(crop.w).toBeCloseTo(unitsToInches(800), 6)
    expect(crop.h).toBeCloseTo(unitsToInches(200), 6)
    expect(crop.sizing).toEqual({
      type: 'crop',
      x: unitsToInches(200),
      y: 0,
      w: unitsToInches(400),
      h: unitsToInches(200),
    })
  })

  it('encodes bytes as base64 for a data URL', () => {
    expect(bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('iVBORw==')
  })
})
