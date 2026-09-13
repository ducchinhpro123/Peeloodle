/**
 * DOM ↔ presentation text-model bridge (P04).
 *
 * The paragraph/run model is authoritative. This module converts it to editing
 * HTML and normalizes arbitrary DOM (including pasted markup) back into model
 * data. It never persists markup: unsupported elements are flattened to text
 * and only bold/italic and safe hyperlinks survive.
 */

import type { BulletLevel, ParagraphAlignment, TextParagraph, TextRun } from '../model/types'
import { safeLink } from '../model/links'
import { fontStackFor, isKnownFontId } from '../rendering/fonts'
import { BULLET_HANGING, BULLET_INDENT_PER_LEVEL } from '../rendering/textLayout'

export type BridgeDefaults = { fontId: string; size: number; color: string }

export const BRIDGE_ATTR = {
  paragraph: 'data-p',
  fontId: 'data-font-id',
  size: 'data-size',
  color: 'data-color',
  bold: 'data-bold',
  italic: 'data-italic',
  link: 'data-link',
  bullet: 'data-bullet',
  level: 'data-level',
  align: 'data-align',
  marker: 'data-marker',
} as const

/** Re-exported for callers that treat the bridge as the DOM-facing entry point. */
export { safeLink }

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function runStyleAttributes(run: TextRun): string {
  const attributes = [
    `${BRIDGE_ATTR.fontId}="${escapeHtml(run.fontId)}"`,
    `${BRIDGE_ATTR.size}="${run.size}"`,
    `${BRIDGE_ATTR.color}="${escapeHtml(run.color)}"`,
    `${BRIDGE_ATTR.bold}="${run.bold ? 'true' : 'false'}"`,
    `${BRIDGE_ATTR.italic}="${run.italic ? 'true' : 'false'}"`,
  ]
  if (run.link) attributes.push(`${BRIDGE_ATTR.link}="${escapeHtml(run.link)}"`)
  return attributes.join(' ')
}

/** CSS declarations for one run at a given zoom scale (document units → px). */
export function runCss(run: TextRun, scale = 1): string {
  const declarations = [
    `font-family:${fontStackFor(run.fontId)}`,
    `font-size:${run.size * scale}px`,
    `font-weight:${run.bold ? 700 : 400}`,
    `font-style:${run.italic ? 'italic' : 'normal'}`,
    `color:${run.color}`,
    'white-space:pre-wrap',
  ]
  if (run.link) declarations.push('text-decoration:underline')
  return declarations.join(';')
}

export type ParagraphHtmlOptions = {
  /** Zoom/display scale; document units are multiplied by this. */
  scale?: number
  /** Multiplier matching TextElement.lineHeight; keeps DOM line boxes in step with layout. */
  lineHeight?: number
  /** Include bullet/number marker spans (editing overlay). Default true. */
  includeMarkers?: boolean
}

/** Serializes paragraphs to editing HTML. Text is always escaped. */
export function paragraphsToHtml(paragraphs: TextParagraph[], options: ParagraphHtmlOptions = {}): string {
  const scale = options.scale ?? 1
  const includeMarkers = options.includeMarkers ?? true
  const numbers = new Map<number, number>()
  return paragraphs
    .map((paragraph, index) => {
      let markerText = ''
      if (includeMarkers && paragraph.bullet !== 'none') {
        if (paragraph.bullet === 'number') {
          const next = (numbers.get(paragraph.bulletLevel) ?? 0) + 1
          numbers.set(paragraph.bulletLevel, next)
          markerText = `${next}.`
        } else {
          markerText = '\u2022'
        }
        numbers.delete(paragraph.bulletLevel + 1)
      } else if (paragraph.bullet === 'none') {
        numbers.clear()
      }
      const bulletAttr = paragraph.bullet === 'none' ? '' : ` ${BRIDGE_ATTR.bullet}="${paragraph.bullet}" ${BRIDGE_ATTR.level}="${paragraph.bulletLevel}"`
      const markerX = paragraph.bulletLevel * BULLET_INDENT_PER_LEVEL
      const indent = paragraph.bullet === 'none' ? 0 : markerX + BULLET_HANGING
      const marker = markerText === '' ? '' : `<span ${BRIDGE_ATTR.marker}="true" contenteditable="false" style="user-select:none;display:inline-block;width:${BULLET_HANGING * scale}px">${markerText}</span>`
      const runs = paragraph.runs
        .map((run) => `<span ${runStyleAttributes(run)} style="${runCss(run, scale)}">${escapeHtml(run.text).replace(/\n/g, '<br>')}</span>`)
        .join('')
      // An empty paragraph needs a placeholder break to be a real editing line;
      // the reader normalizes a lone placeholder back to no runs.
      const content = paragraph.runs.every((run) => run.text === '') ? '<br>' : runs
      // Hanging indent mirrors the layout service: first line starts at the marker
      // x, wrapping and the text itself align to the paragraph indent.
      const indentStyle = indent > 0 ? `padding-left:${indent * scale}px;text-indent:-${BULLET_HANGING * scale}px;` : ''
      return `<p ${BRIDGE_ATTR.paragraph}="${index}" ${BRIDGE_ATTR.align}="${paragraph.alignment}"${bulletAttr} style="margin:0;text-align:${paragraph.alignment};${indentStyle}${options.lineHeight ? `line-height:${options.lineHeight};` : ''}">${marker}${content}</p>`
    })
    .join('')
}

type StyleState = { fontId: string; size: number; color: string; bold: boolean; italic: boolean; link?: string }

/** Effective inline style at one node, with the inherited defaults resolved. */
export type RunStyleState = StyleState

/**
 * Resolves the effective run style at a node by walking its ancestor elements,
 * applying the same rules `readParagraphsFromDom` uses. Exposed for the
 * selection toolbar so the DOM and the model never disagree about a run.
 */
export function runStyleAtNode(node: Node, defaults: BridgeDefaults): RunStyleState {
  const chain: Element[] = []
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    chain.unshift(current as Element)
    current = current.parentNode
  }
  let style: StyleState = { ...defaults, bold: false, italic: false }
  for (const element of chain) style = styleFromElement(element, style)
  return style
}

function styleFromElement(element: Element, inherited: StyleState): StyleState {
  const tag = element.tagName.toLowerCase()
  const next: StyleState = { ...inherited }
  const fontId = element.getAttribute(BRIDGE_ATTR.fontId)
  if (fontId && isKnownFontId(fontId)) next.fontId = fontId
  const size = Number(element.getAttribute(BRIDGE_ATTR.size))
  if (Number.isFinite(size) && size > 0) next.size = size
  const color = element.getAttribute(BRIDGE_ATTR.color)
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) next.color = color
  const bold = element.getAttribute(BRIDGE_ATTR.bold)
  const italic = element.getAttribute(BRIDGE_ATTR.italic)
  if (bold === 'true' || bold === 'false') next.bold = bold === 'true'
  if (italic === 'true' || italic === 'false') next.italic = italic === 'true'
  if (tag === 'b' || tag === 'strong') next.bold = true
  if (tag === 'i' || tag === 'em') next.italic = true
  // An element that carries the link attribute (or an anchor) decides the link for
  // its subtree: an empty/unsafe value clears an inherited one, which is how the
  // formatting toolbar removes a link from part of a linked run.
  const link = element.getAttribute(BRIDGE_ATTR.link) ?? (tag === 'a' ? element.getAttribute('href') : null)
  if (link !== null) {
    const safe = safeLink(link)
    if (safe) next.link = safe
    else delete next.link
  }
  return next
}

function sameRunStyle(a: { fontId: string; size: number; color: string; bold?: boolean; italic?: boolean; link?: string }, b: typeof a): boolean {
  return a.fontId === b.fontId && a.size === b.size && a.color === b.color && !!a.bold === !!b.bold && !!a.italic === !!b.italic && a.link === b.link
}

function collectRuns(nodes: Iterable<Node>, defaults: StyleState, options: { collapseWhitespace?: boolean }, runs: TextRun[]): void {
  const pushText = (text: string, style: StyleState) => {
    const normalized = text.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/\r\n?/g, '\n')
    if (!normalized) return
    const run: TextRun = {
      text: normalized,
      fontId: style.fontId,
      size: style.size,
      color: style.color,
      ...(style.bold ? { bold: true } : {}),
      ...(style.italic ? { italic: true } : {}),
      ...(style.link ? { link: style.link } : {}),
    }
    const last = runs.at(-1)
    if (last && sameRunStyle(last, run)) {
      last.text += normalized
      return
    }
    runs.push(run)
  }

  const walk = (node: Node, style: StyleState) => {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? ''
      // Pasted markup whitespace collapses like HTML rendering; editing DOM keeps
      // intentional spacing. Newlines inside a text node are markup formatting.
      const text = options.collapseWhitespace
        ? raw.replace(/\s+/g, ' ')
        : /\n/.test(raw)
          ? raw.replace(/\s*\n\s*/g, ' ')
          : raw
      pushText(text, style)
      return
    }
    if (node.nodeType !== 1) return
    const element = node as Element
    if (element.getAttribute(BRIDGE_ATTR.marker) === 'true') return
    const tag = element.tagName.toLowerCase()
    if (tag === 'br') {
      pushText('\n', style)
      return
    }
    if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'head') return
    // List items and table cells start a new visual line when flattened into a paragraph.
    if ((tag === 'li' || tag === 'p' || tag === 'td' || tag === 'th' || /^h[1-6]$/.test(tag)) && runs.length && !runs.at(-1)!.text.endsWith('\n')) {
      pushText('\n', style)
    }
    const next = styleFromElement(element, style)
    for (const child of element.childNodes) walk(child, next)
  }

  for (const child of nodes) walk(child, defaults)
}

function runsFromContainer(container: Element | DocumentFragment, defaults: StyleState, options: { collapseWhitespace?: boolean } = {}): TextRun[] {
  const runs: TextRun[] = []
  collectRuns(container.childNodes, defaults, options, runs)
  return runs
}

function mergeRuns(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const last = merged.at(-1)
    if (last && sameRunStyle(last, run)) last.text += run.text
    else merged.push({ ...run })
  }
  return merged
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'section', 'article'])

/**
 * True when a block's only content is the placeholder break an empty editing
 * paragraph carries (browsers need one for the block to have a line box).
 * Marker spans and whitespace are ignored.
 */
function hasOnlyPlaceholderBreak(element: Element): boolean {
  let breaks = 0
  let content = 0
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? '').trim() !== '') content += 1
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    if (child.getAttribute(BRIDGE_ATTR.marker) === 'true') continue
    if (child.tagName.toLowerCase() === 'br') {
      breaks += 1
      continue
    }
    content += 1
  }
  return content === 0 && breaks === 1
}

function paragraphFromElement(
  element: Element,
  defaults: StyleState,
  options: { collapseWhitespace?: boolean; inheritedBullet?: { bullet: 'bullet' | 'number'; level: BulletLevel } } = {},
): TextParagraph {
  const alignAttr = element.getAttribute(BRIDGE_ATTR.align)
  const alignment: ParagraphAlignment = alignAttr === 'center' || alignAttr === 'right' || alignAttr === 'justify' ? alignAttr : 'left'
  const bulletAttr = element.getAttribute(BRIDGE_ATTR.bullet)
  const levelAttr = Number(element.getAttribute(BRIDGE_ATTR.level))
  const bullet: TextParagraph['bullet'] = bulletAttr === 'bullet' || bulletAttr === 'number' ? bulletAttr : (options.inheritedBullet?.bullet ?? 'none')
  const bulletLevel = [0, 1, 2].includes(levelAttr) ? (levelAttr as BulletLevel) : (options.inheritedBullet?.level ?? 0)
  const runs = hasOnlyPlaceholderBreak(element) ? [] : mergeRuns(runsFromContainer(element, defaults, options))
  return { runs, alignment, bullet, bulletLevel }
}

/** Normalizes a live DOM subtree into model paragraphs, preserving source order. */
export function readParagraphsFromDom(
  root: Element | DocumentFragment,
  defaults: BridgeDefaults,
  options: { collapseWhitespace?: boolean } = {},
): TextParagraph[] {
  const style: StyleState = { ...defaults, bold: false, italic: false }
  const paragraphs: TextParagraph[] = []
  let inline: TextRun[] = []

  const flushInline = () => {
    const runs = mergeRuns(inline)
    if (runs.length) paragraphs.push({ runs, alignment: 'left', bullet: 'none', bulletLevel: 0 })
    inline = []
  }

  for (const node of root.childNodes) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? ''
      if (!text) continue
      if (text.trim() || inline.length > 0) {
        // Whitespace joining inline content is meaningful (`<b>a</b> <i>b</i>`);
        // whitespace between block elements is markup formatting and is ignored.
        collectRuns([node], style, options, inline)
      }
      continue
    }
    if (node.nodeType !== 1) continue
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      flushInline()
      const bullet = tag === 'ol' ? 'number' : 'bullet'
      for (const item of element.children) {
        if (item.tagName.toLowerCase() !== 'li') continue
        paragraphs.push(paragraphFromElement(item, style, { ...options, inheritedBullet: { bullet, level: 0 } }))
      }
      continue
    }
    if (BLOCK_TAGS.has(tag)) {
      flushInline()
      paragraphs.push(paragraphFromElement(element, style, options))
      continue
    }
    // Unknown wrappers (tables, spans, fonts) and inline elements contribute inline
    // text; collectRuns applies the element's own bold/italic/link styling.
    collectRuns([element], style, options, inline)
  }
  flushInline()
  return paragraphs.length ? paragraphs : [{ runs: [], alignment: 'left', bullet: 'none', bulletLevel: 0 }]
}

/**
 * Parses untrusted pasted HTML in an inert `<template>` (scripts and event
 * handlers never execute) and normalizes it to model paragraphs.
 */
export function htmlToParagraphs(html: string, defaults: BridgeDefaults): TextParagraph[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return readParagraphsFromDom(template.content, defaults, { collapseWhitespace: true })
}

export function plainTextToParagraphs(text: string, defaults: BridgeDefaults): TextParagraph[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return lines.map((line) => ({
    runs: line ? [{ text: line, fontId: defaults.fontId, size: defaults.size, color: defaults.color }] : [],
    alignment: 'left' as const,
    bullet: 'none' as const,
    bulletLevel: 0 as const,
  }))
}

export function paragraphsToPlainText(paragraphs: TextParagraph[]): string {
  return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
}
