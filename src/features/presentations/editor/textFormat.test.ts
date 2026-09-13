import { afterEach, describe, expect, it } from 'vitest'
import { paragraphsToHtml, readParagraphsFromDom, runStyleAtNode } from './textBridge'
import { applyParagraphStyleToSelection, applyRunStyleToSelection, readParagraphStyle, readSelectionStyle } from './textFormat'
import type { TextParagraph } from '../model/types'

const DEFAULTS = { fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }

function paragraph(runs: TextParagraph['runs']): TextParagraph[] {
  return [{ runs, alignment: 'left', bullet: 'none', bulletLevel: 0 }]
}

const hosts: HTMLElement[] = []

function hostWith(paragraphs: TextParagraph[]): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = paragraphsToHtml(paragraphs)
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

function textNode(host: HTMLElement): Text {
  return host.querySelector('span')!.firstChild as Text
}

function select(node: Node, start: number, end: number): void {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function collapseTo(node: Node, offset: number): void {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  for (const host of hosts.splice(0)) host.remove()
})

describe('selection text formatting', () => {
  it('splits a selection into a bold run and an untouched run', () => {
    const host = hostWith(paragraph([{ text: 'Xin chào', ...DEFAULTS }]))
    select(textNode(host), 0, 3)

    expect(applyRunStyleToSelection(host, { bold: true })).toBe(true)

    const runs = readParagraphsFromDom(host, DEFAULTS)[0]!.runs
    expect(runs.map((run) => ({ text: run.text, bold: run.bold ?? false }))).toEqual([
      { text: 'Xin', bold: true },
      { text: ' chào', bold: false },
    ])
  })

  it('toggles the selected run back off', () => {
    const host = hostWith(paragraph([{ text: 'Xin chào', ...DEFAULTS }]))
    select(textNode(host), 0, 3)
    applyRunStyleToSelection(host, { bold: true })
    // The apply leaves the selection over the wrapped run.
    applyRunStyleToSelection(host, { bold: false })

    const runs = readParagraphsFromDom(host, DEFAULTS)[0]!.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]!.text).toBe('Xin chào')
    expect(runs[0]!.bold).toBeUndefined()
  })

  it('applies font, size and color to the selection only', () => {
    const host = hostWith(paragraph([{ text: 'Xin chào', ...DEFAULTS }]))
    select(textNode(host), 4, 8)

    expect(applyRunStyleToSelection(host, { fontId: 'spectral', size: 32, color: '#b42338' })).toBe(true)

    const runs = readParagraphsFromDom(host, DEFAULTS)[0]!.runs
    expect(runs[0]).toMatchObject({ text: 'Xin ', fontId: DEFAULTS.fontId, size: 24, color: DEFAULTS.color })
    expect(runs[1]).toMatchObject({ text: 'chào', fontId: 'spectral', size: 32, color: '#b42338' })
  })

  it('formats the word under a collapsed caret', () => {
    const host = hostWith(paragraph([{ text: 'Xin chào', ...DEFAULTS }]))
    collapseTo(textNode(host), 1)

    expect(applyRunStyleToSelection(host, { italic: true })).toBe(true)

    const runs = readParagraphsFromDom(host, DEFAULTS)[0]!.runs
    expect(runs.map((run) => ({ text: run.text, italic: run.italic ?? false }))).toEqual([
      { text: 'Xin', italic: true },
      { text: ' chào', italic: false },
    ])
  })

  it('reads the uniform selection style and reports mixed selections as not bold', () => {
    const host = hostWith(paragraph([{ text: 'Xin chào', ...DEFAULTS }]))
    select(textNode(host), 0, 3)
    applyRunStyleToSelection(host, { bold: true })

    const bold = readSelectionStyle(host, DEFAULTS)
    expect(bold).toEqual({ bold: true, italic: false, fontId: DEFAULTS.fontId, size: DEFAULTS.size, color: DEFAULTS.color, link: null })

    // The whole paragraph mixes bold and plain, so bold reads false.
    const whole = host.querySelector('p')!
    const range = document.createRange()
    range.selectNodeContents(whole)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(readSelectionStyle(host, DEFAULTS).bold).toBe(false)
  })

  it('refuses a selection outside the field and leaves the DOM untouched', () => {
    const host = hostWith(paragraph([{ text: 'Xin chào', ...DEFAULTS }]))
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    document.body.appendChild(outside)
    hosts.push(outside)
    select(outside.firstChild!, 0, 3)

    expect(applyRunStyleToSelection(host, { bold: true })).toBe(false)
    expect(readParagraphsFromDom(host, DEFAULTS)[0]!.runs[0]!.bold).toBeUndefined()
  })

  it('resolves inherited run style at a node', () => {
    const host = hostWith(paragraph([{ text: 'Xin', ...DEFAULTS, bold: true }]))
    const style = runStyleAtNode(textNode(host), DEFAULTS)
    expect(style).toMatchObject({ fontId: DEFAULTS.fontId, size: DEFAULTS.size, color: DEFAULTS.color, bold: true, italic: false })
  })

  it('applies alignment and bullet attributes to every touched paragraph', () => {
    const host = hostWith([
      { runs: [{ text: 'First', ...DEFAULTS }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
      { runs: [{ text: 'Second', ...DEFAULTS }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
    ])
    const range = document.createRange()
    range.selectNodeContents(host)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(applyParagraphStyleToSelection(host, { alignment: 'center', bullet: 'number' })).toBe(true)
    const paragraphs = readParagraphsFromDom(host, DEFAULTS)
    expect(paragraphs.map((paragraph) => paragraph.alignment)).toEqual(['center', 'center'])
    expect(paragraphs.map((paragraph) => paragraph.bullet)).toEqual(['number', 'number'])
    expect(readParagraphStyle(host)).toEqual({ alignment: 'center', bullet: 'number', bulletLevel: 0 })
  })

  it('changes bullet level and removes bullets', () => {
    const host = hostWith([{ runs: [{ text: 'Item', ...DEFAULTS }], alignment: 'left', bullet: 'bullet', bulletLevel: 1 }])
    collapseTo(textNode(host), 1)

    expect(applyParagraphStyleToSelection(host, { bulletLevel: 2 })).toBe(true)
    expect(readParagraphsFromDom(host, DEFAULTS)[0]!.bulletLevel).toBe(2)
    expect(applyParagraphStyleToSelection(host, { bullet: 'none' })).toBe(true)
    expect(readParagraphsFromDom(host, DEFAULTS)[0]!.bullet).toBe('none')
  })

  it('applies and removes a link on the selected run', () => {
    const host = hostWith(paragraph([{ text: 'Xin chào', ...DEFAULTS }]))
    select(textNode(host), 0, 3)

    expect(applyRunStyleToSelection(host, { link: 'https://example.com' })).toBe(true)
    expect(readParagraphsFromDom(host, DEFAULTS)[0]!.runs[0]).toMatchObject({ text: 'Xin', link: 'https://example.com' })
    expect(readSelectionStyle(host, DEFAULTS).link).toBe('https://example.com')

    // An empty data-link clears the link again.
    expect(applyRunStyleToSelection(host, { link: '' })).toBe(true)
    expect(readParagraphsFromDom(host, DEFAULTS)[0]!.runs[0]!.link).toBeUndefined()
    expect(readSelectionStyle(host, DEFAULTS).link).toBeNull()
  })
})
