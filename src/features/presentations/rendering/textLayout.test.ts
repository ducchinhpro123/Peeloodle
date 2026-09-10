import { describe, expect, it } from 'vitest'
import { layoutParagraphs, layoutTextElement, type FontSpec, type MeasureText } from './textLayout'
import type { TextElement, TextParagraph } from '../model/types'

/** Deterministic measurer: every character is half the font size wide. */
const fakeMeasure: MeasureText = (text: string, spec: FontSpec) => text.length * spec.size * 0.5

function paragraph(text: string, options: Partial<TextParagraph> = {}): TextParagraph {
  return {
    runs: [{ text, fontId: 'be-vietnam-pro', size: 20, color: '#000000' }],
    alignment: 'left',
    bullet: 'none',
    bulletLevel: 0,
    ...options,
  }
}

const base = { padding: 0, lineHeight: 1.2, measure: fakeMeasure }
// With size 20 the fake measurer makes each character exactly 10 units wide.

describe('presentation text layout', () => {
  it('wraps words at word boundaries', () => {
    const result = layoutParagraphs([paragraph('aaa bbb ccc')], { ...base, width: 90 })
    expect(result.lines.map((line) => line.text)).toEqual(['aaa bbb', 'ccc'])
    expect(result.lines[0]!.runs[0]!.width).toBe(70)
    expect(result.contentHeight).toBeCloseTo(48, 5)
  })

  it('hard-splits a word that cannot fit a line', () => {
    const result = layoutParagraphs([paragraph('abcdefghij')], { ...base, width: 60 })
    expect(result.lines.map((line) => line.text)).toEqual(['abcdef', 'ghij'])
  })

  it('keeps explicit newlines as hard breaks and preserves empty paragraphs', () => {
    const result = layoutParagraphs([paragraph('one\ntwo'), paragraph('')], { ...base, width: 200 })
    expect(result.lines.map((line) => line.text)).toEqual(['one', 'two', ''])
    expect(result.lines[2]!.runs).toEqual([])
  })

  it('hangs bullet text and indents nested levels', () => {
    const result = layoutParagraphs([paragraph('item one', { bullet: 'bullet' }), paragraph('nested', { bullet: 'bullet', bulletLevel: 1 })], {
      ...base,
      width: 200,
    })
    const first = result.lines[0]!
    expect(first.bullet).toMatchObject({ kind: 'bullet', marker: '\u2022', level: 0, x: 0 })
    expect(first.indent).toBe(26)
    const nested = result.lines[1]!
    expect(nested.bullet!.x).toBe(32)
    expect(nested.indent).toBe(32 + 26)
    expect(first.availableWidth).toBe(200 - 26)
    expect(first.firstInParagraph).toBe(true)
    expect(first.lastInParagraph).toBe(true)
  })

  it('marks wrapped bullet lines so markers are drawn once per paragraph', () => {
    const result = layoutParagraphs([paragraph('alpha beta gamma delta epsilon', { bullet: 'bullet' })], { ...base, width: 120 })
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.lines[0]!.firstInParagraph).toBe(true)
    expect(result.lines.slice(1).every((line) => !line.firstInParagraph)).toBe(true)
  })

  it('numbers consecutive numbered paragraphs and resets on a normal paragraph', () => {
    const result = layoutParagraphs([paragraph('first', { bullet: 'number' }), paragraph('second', { bullet: 'number' }), paragraph('plain'), paragraph('again', { bullet: 'number' })], {
      ...base,
      width: 200,
    })
    expect(result.lines.map((line) => line.bullet?.marker)).toEqual(['1.', '2.', undefined, '1.'])
  })

  it('aligns lines inside the available width', () => {
    const center = layoutParagraphs([paragraph('aa', { alignment: 'center' })], { ...base, width: 100, measure: fakeMeasure })
    // 'aa' is 20 wide in a 100-wide box: centred at 40.
    expect(center.lines[0]!.runs[0]!.x).toBeCloseTo(40, 5)

    const right = layoutParagraphs([paragraph('aa', { alignment: 'right' })], { ...base, width: 100 })
    expect(right.lines[0]!.runs[0]!.x).toBeCloseTo(80, 5)

    const justified = layoutParagraphs([paragraph('a b c d e f', { alignment: 'justify' })], { ...base, width: 100 })
    expect(justified.lines.length).toBeGreaterThan(1)
    const firstLine = justified.lines[0]!
    expect(firstLine.align).toBe('justify')
    const nonLast = justified.lines.slice(0, -1)
    for (const line of nonLast) {
      expect(line.runs.at(-1)!.x + line.runs.at(-1)!.width).toBeCloseTo(100, 4)
    }
    const lastLine = justified.lines.at(-1)!
    expect(lastLine.runs[0]!.x).toBe(0)
  })

  it('offsets content vertically for middle and bottom alignment', () => {
    const element: TextElement = {
      id: 't',
      kind: 'text',
      name: 't',
      x: 0,
      y: 0,
      width: 200,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      padding: 0,
      lineHeight: 1.2,
      verticalAlign: 'middle',
      paragraphs: [paragraph('one line')],
    }
    const result = layoutTextElement(element, fakeMeasure)
    // One line of 24 units inside 300: offset 138.
    expect(result.lines[0]!.y).toBeCloseTo(138, 5)
    expect(result.overflow).toBe(false)
  })

  it('reports overflow when content is taller than the element', () => {
    const result = layoutParagraphs([paragraph('a b c d e f g h')], { ...base, width: 100, height: 30 })
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.overflow).toBe(true)
  })

  it('uses the largest run size on the line for line height', () => {
    const result = layoutParagraphs(
      [
        {
          runs: [
            { text: 'small ', fontId: 'be-vietnam-pro', size: 10, color: '#000000' },
            { text: 'BIG', fontId: 'be-vietnam-pro', size: 40, color: '#000000' },
          ],
          alignment: 'left',
          bullet: 'none',
          bulletLevel: 0,
        },
      ],
      { ...base, width: 400 },
    )
    expect(result.lines[0]!.height).toBeCloseTo(48, 5)
  })

  it('wraps Vietnamese text using the same measurement rules', () => {
    const result = layoutParagraphs([paragraph('Nghiên cứu và trình bày kết quả')], { ...base, width: 120 })
    expect(result.lines.length).toBeGreaterThan(1)
    const joined = result.lines.map((line) => line.text).join(' ')
    expect(joined.replace(/\s+/g, ' ')).toContain('Nghiên cứu')
    expect(joined.replace(/\s+/g, ' ')).toContain('kết quả')
  })

  it('reports unknown font IDs so the editor can warn', () => {
    const result = layoutParagraphs(
      [
        {
          runs: [{ text: 'x', fontId: 'comic-sans-9000', size: 20, color: '#000000' }],
          alignment: 'left',
          bullet: 'none',
          bulletLevel: 0,
        },
      ],
      { ...base, width: 200 },
    )
    expect(result.missingFontIds).toEqual(['comic-sans-9000'])
  })

  it('does not invent spaces between runs split mid-word', () => {
    const result = layoutParagraphs(
      [
        {
          runs: [
            { text: 'stic', fontId: 'be-vietnam-pro', size: 20, color: '#000000' },
            { text: 'ker', fontId: 'be-vietnam-pro', size: 20, color: '#000000', bold: true },
          ],
          alignment: 'left',
          bullet: 'none',
          bulletLevel: 0,
        },
      ],
      { ...base, width: 400 },
    )
    expect(result.lines[0]!.text).toBe('sticker')
    expect(result.lines[0]!.runs).toHaveLength(2)
    expect(result.lines[0]!.runs[1]!.x).toBeCloseTo(40, 5)
  })
})
