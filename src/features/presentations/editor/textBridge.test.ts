import { describe, expect, it } from 'vitest'
import { BRIDGE_ATTR, htmlToParagraphs, paragraphsToHtml, paragraphsToPlainText, plainTextToParagraphs, readParagraphsFromDom, runCss, safeLink } from './textBridge'
import { BULLET_HANGING, BULLET_INDENT_PER_LEVEL } from '../rendering/textLayout'
import { createFixturePresentation } from '../model/fixtures/fixture'
import type { TextParagraph } from '../model/types'

const defaults = { fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }

function fixtureParagraphs(): TextParagraph[] {
  const document = createFixturePresentation()
  const title = document.slides[0]!.elements.find((element) => element.id === 'fixture-text-title')
  const bullets = document.slides[1]!.elements.find((element) => element.id === 'fixture-text-bullets')
  if (title?.kind !== 'text' || bullets?.kind !== 'text') throw new Error('fixture text missing')
  return [...title.paragraphs, ...bullets.paragraphs]
}

function readHtml(html: string): TextParagraph[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return readParagraphsFromDom(template.content, defaults)
}

describe('text bridge', () => {
  it('escapes text so markup cannot leak into the DOM', () => {
    const html = paragraphsToHtml([{ runs: [{ text: '<script>alert(1)</script>', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'none', bulletLevel: 0 }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    const read = readHtml(html)
    expect(read[0]!.runs[0]!.text).toBe('<script>alert(1)</script>')
  })

  it('round-trips the fixture paragraphs through HTML', () => {
    const paragraphs = fixtureParagraphs()
    const read = readHtml(paragraphsToHtml(paragraphs))
    expect(read).toHaveLength(paragraphs.length)
    for (let i = 0; i < paragraphs.length; i += 1) {
      expect(read[i]!.alignment).toBe(paragraphs[i]!.alignment)
      expect(read[i]!.bullet).toBe(paragraphs[i]!.bullet)
      expect(read[i]!.bulletLevel).toBe(paragraphs[i]!.bulletLevel)
      expect(paragraphsToPlainText([read[i]!])).toBe(paragraphsToPlainText([paragraphs[i]!]))
    }
    const readLink = read.flatMap((paragraph) => paragraph.runs).find((run) => run.link)
    expect(readLink?.link).toBe('https://example.edu/guide')
    const readBold = read.flatMap((paragraph) => paragraph.runs).find((run) => run.bold && run.text.includes('Tóm tắt'))
    expect(readBold?.text).toBe('Tóm tắt kết quả: ')
    const readItalic = read.flatMap((paragraph) => paragraph.runs).find((run) => run.italic)
    expect(readItalic?.text).toBe('sticker')
  })

  it('normalizes pasted markup and drops unsupported styling', () => {
    const html = `
      <h1 class="big" style="font-size:72px">Heading</h1>
      <p>Plain <b>bold</b> and <i>italic</i> and <u>underline</u></p>
      <p><a href="javascript:alert(1)">bad</a> <a href="https://good.example/x">good</a></p>
      <table><tr><td>cell one</td><td>cell two</td></tr></table>
      <ul><li>first</li><li>second</li></ul>
    `
    const paragraphs = htmlToParagraphs(html, defaults)
    const text = paragraphsToPlainText(paragraphs)
    expect(text).toContain('Heading')
    expect(text).toContain('Plain bold and italic and underline')
    expect(text).toContain('bad')
    expect(text).toContain('good')
    expect(text).toContain('cell one')
    expect(text).toContain('cell two')
    expect(text).toContain('first')
    expect(text).toContain('second')

    const runs = paragraphs.flatMap((paragraph) => paragraph.runs)
    const bad = runs.find((run) => run.text.includes('bad'))
    expect(bad?.link).toBeUndefined()
    const good = runs.find((run) => run.text.includes('good'))
    expect(good?.link).toBe('https://good.example/x')
    const bold = runs.find((run) => run.text === 'bold')
    expect(bold?.bold).toBe(true)
    const italic = runs.find((run) => run.text === 'italic')
    expect(italic?.italic).toBe(true)
    // Unsupported markup is flattened to plain text, not persisted as markup.
    expect(JSON.stringify(paragraphs)).not.toContain('underline</u>')
    expect(runs.find((run) => run.text === 'Heading')?.size).toBe(defaults.size)

    const listParagraphs = paragraphs.filter((paragraph) => paragraph.bullet !== 'none')
    expect(listParagraphs.map((paragraph) => paragraph.bullet)).toEqual(['bullet', 'bullet'])
  })

  it('keeps list structure for a top-level ordered list', () => {
    const paragraphs = htmlToParagraphs('<ol><li>one</li><li>two</li></ol>', defaults)
    expect(paragraphs.map((paragraph) => paragraph.bullet)).toEqual(['number', 'number'])
  })

  it('converts pasted plain text into one paragraph per line', () => {
    const paragraphs = plainTextToParagraphs('dòng một\ndòng hai\n\ncuối', defaults)
    expect(paragraphs).toHaveLength(4)
    expect(paragraphs[0]!.runs[0]!.text).toBe('dòng một')
    expect(paragraphs[2]!.runs).toEqual([])
  })

  it('round-trips an empty paragraph through its placeholder break', () => {
    const paragraphs: TextParagraph[] = [
      { runs: [{ text: 'before', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
      { runs: [], alignment: 'left', bullet: 'none', bulletLevel: 0 },
      { runs: [{ text: 'after', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
    ]
    const html = paragraphsToHtml(paragraphs)
    expect(html).toContain('<br>')
    const read = readHtml(html)
    expect(read.map((paragraph) => paragraphsToPlainText([paragraph]))).toEqual(['before', '', 'after'])
    expect(read[1]!.runs).toEqual([])
  })

  it('normalizes non-breaking spaces and collapses markup whitespace', () => {
    const paragraphs = htmlToParagraphs('<p>a&nbsp;b</p>\n<p>\n  spaced   out\n</p>', defaults)
    expect(paragraphs[0]!.runs[0]!.text).toBe('a b')
    expect(paragraphs[1]!.runs[0]!.text).toBe(' spaced out ')
  })

  it('increments numbered markers when serializing', () => {
    const html = paragraphsToHtml([
      { runs: [{ text: 'one', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'number', bulletLevel: 0 },
      { runs: [{ text: 'two', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'number', bulletLevel: 0 },
    ])
    expect(html).toContain('>1.</span>')
    expect(html).toContain('>2.</span>')
    // Markers must not be read back as document text.
    const read = readHtml(html)
    expect(paragraphsToPlainText(read)).toBe('one\ntwo')
  })

  it('keeps bold and italic separate across adjacent inline tags and preserves the space between them', () => {
    for (const html of ['<p><b>bold</b> <i>italic</i></p>', '<b>bold</b> <i>italic</i>']) {
      const paragraphs = htmlToParagraphs(html, defaults)
      // The full text matters: dropping the whitespace-only node produced "bolditalic".
      expect(paragraphsToPlainText(paragraphs).trim(), html).toBe('bold italic')
      const runs = paragraphs.flatMap((paragraph) => paragraph.runs)
      expect(runs.find((run) => run.text.trim() === 'bold')?.bold, html).toBe(true)
      expect(runs.find((run) => run.text.trim() === 'italic')?.italic, html).toBe(true)
      expect(runs.find((run) => run.text.trim() === 'bold')?.italic ?? false, html).toBe(false)
    }
  })

  it('keeps spaces between inline elements in block paragraphs', () => {
    const paragraphs = htmlToParagraphs('<p>one <b>two</b> <i>three</i> four</p>', defaults)
    expect(paragraphsToPlainText(paragraphs)).toBe('one two three four')
  })

  it('indents bullet levels in generated HTML to match the layout service', () => {
    const html = paragraphsToHtml([
      { runs: [{ text: 'first', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'bullet', bulletLevel: 0 },
      { runs: [{ text: 'nested', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'bullet', bulletLevel: 2 },
    ])
    const template = document.createElement('template')
    template.innerHTML = html
    const paragraphs = [...template.content.querySelectorAll('p')]
    expect(paragraphs[0]!.style.paddingLeft).toBe(`${BULLET_HANGING}px`)
    expect(paragraphs[0]!.style.textIndent).toBe(`-${BULLET_HANGING}px`)
    const nestedIndent = 2 * BULLET_INDENT_PER_LEVEL + BULLET_HANGING
    expect(paragraphs[1]!.style.paddingLeft).toBe(`${nestedIndent}px`)
    expect(paragraphs[1]!.style.textIndent).toBe(`-${BULLET_HANGING}px`)
    // Marker boxes occupy the hanging width so text starts at the layout indent.
    const marker = paragraphs[1]!.querySelector(`[${BRIDGE_ATTR.marker}]`) as HTMLElement
    expect(marker.style.width).toBe(`${BULLET_HANGING}px`)
    // Round trip keeps the bullet level.
    const read = readHtml(html)
    expect(read.map((paragraph) => paragraph.bulletLevel)).toEqual([0, 2])
  })

  it('only accepts safe hyperlink schemes', () => {
    expect(safeLink('https://example.edu')).toBe('https://example.edu')
    expect(safeLink('mailto:teacher@example.edu')).toBe('mailto:teacher@example.edu')
    expect(safeLink('javascript:alert(1)')).toBeUndefined()
    expect(safeLink('data:text/html;base64,PHN2Zz4=')).toBeUndefined()
    expect(safeLink('/relative/path')).toBeUndefined()
    expect(safeLink('')).toBeUndefined()
  })

  it('emits CSS that marks links and keeps document units at scale 1', () => {
    const css = runCss({ text: 'x', fontId: 'spectral', size: 32, color: '#ff0000', bold: true, italic: true, link: 'https://example.edu' })
    expect(css).toContain('font-size:32px')
    expect(css).toContain('font-weight:700')
    expect(css).toContain('font-style:italic')
    expect(css).toContain('text-decoration:underline')
    expect(runCss({ text: 'x', fontId: 'spectral', size: 32, color: '#ff0000' }, 0.5)).toContain('font-size:16px')
  })

  it('reads our own paragraph attributes back without deriving from CSS', () => {
    const html = `<p ${BRIDGE_ATTR.paragraph}="0" ${BRIDGE_ATTR.align}="center"><span ${BRIDGE_ATTR.fontId}="spectral" ${BRIDGE_ATTR.size}="40" ${BRIDGE_ATTR.color}="#123456" ${BRIDGE_ATTR.bold}="true" ${BRIDGE_ATTR.italic}="false" style="font-size:99px">Hi</span></p>`
    const read = readHtml(html)
    expect(read[0]!.alignment).toBe('center')
    expect(read[0]!.runs[0]).toMatchObject({ fontId: 'spectral', size: 40, color: '#123456', bold: true, text: 'Hi' })
    expect(read[0]!.runs[0]!.italic).toBeUndefined()
  })
})
