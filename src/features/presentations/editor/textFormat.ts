/**
 * Selection-aware text formatting (P26).
 *
 * Formatting never uses `execCommand`: it wraps the selected text nodes in spans
 * that carry the same `data-*` attributes `paragraphsToHtml` emits, so the
 * existing `readParagraphsFromDom` normalization turns them into model runs.
 * That keeps one conversion path between DOM and the paragraph/run model.
 */

import { BRIDGE_ATTR, runStyleAtNode, type BridgeDefaults, type RunStyleState } from './textBridge'
import { isKnownFontId } from '../rendering/fonts'
import type { BulletKind, BulletLevel, ParagraphAlignment } from '../model/types'

export type RunStylePatch = {
  bold?: boolean
  italic?: boolean
  fontId?: string
  size?: number
  color?: string
  link?: string
}

/** What the toolbar shows for the current selection. `null` means mixed/unknown. */
export type TextFormatState = {
  bold: boolean
  italic: boolean
  fontId: string | null
  size: number | null
  color: string | null
  /** The common link across the selection, or null when mixed/none. */
  link: string | null
}

export type ParagraphStylePatch = {
  alignment?: ParagraphAlignment
  bullet?: BulletKind
  bulletLevel?: BulletLevel
}

export type ParagraphFormatState = {
  alignment: ParagraphAlignment | null
  bullet: BulletKind | null
  bulletLevel: BulletLevel | null
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

/** A caret inside a word formats that word, matching common editor behaviour. */
function expandToWord(range: Range): Range {
  if (!range.collapsed) return range
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return range
  const text = node.textContent ?? ''
  const offset = range.startOffset
  let start = offset
  let end = offset
  while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start -= 1
  while (end < text.length && WORD_CHAR.test(text[end]!)) end += 1
  if (start === end) return range
  const expanded = document.createRange()
  expanded.setStart(node, start)
  expanded.setEnd(node, end)
  return expanded
}

function textNodesInRange(root: HTMLElement, range: Range): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    const text = current as Text
    if (range.intersectsNode(text)) {
      const start = text === range.startContainer ? range.startOffset : 0
      const end = text === range.endContainer ? range.endOffset : text.length
      if (end > start) nodes.push(text)
    }
    current = walker.nextNode()
  }
  return nodes
}

function patchAttributes(span: HTMLElement, patch: RunStylePatch): void {
  if (patch.fontId !== undefined) span.setAttribute(BRIDGE_ATTR.fontId, patch.fontId)
  if (patch.size !== undefined) span.setAttribute(BRIDGE_ATTR.size, String(patch.size))
  if (patch.color !== undefined) span.setAttribute(BRIDGE_ATTR.color, patch.color)
  if (patch.bold !== undefined) span.setAttribute(BRIDGE_ATTR.bold, patch.bold ? 'true' : 'false')
  if (patch.italic !== undefined) span.setAttribute(BRIDGE_ATTR.italic, patch.italic ? 'true' : 'false')
  if (patch.link !== undefined) span.setAttribute(BRIDGE_ATTR.link, patch.link)
}

/** The live selection inside `root`, word-expanded when collapsed; null when outside. */
function selectionRange(root: HTMLElement): Range | null {
  const selection = window.getSelection?.()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return expandToWord(range)
}

/**
 * Applies one style patch to every selected text node, splitting at the range
 * boundaries so only the selected characters change. Returns false when there is
 * nothing to format (no selection, outside the field, or an empty word).
 */
export function applyRunStyleToSelection(root: HTMLElement, patch: RunStylePatch): boolean {
  const range = selectionRange(root)
  if (!range || range.collapsed) return false
  const nodes = textNodesInRange(root, range)
  const wrapped: HTMLElement[] = []
  for (const node of nodes) {
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    if (end <= start) continue
    let target = node
    if (start > 0) target = node.splitText(start)
    if (end - start < target.length) target.splitText(end - start)
    const span = document.createElement('span')
    patchAttributes(span, patch)
    target.parentNode?.insertBefore(span, target)
    span.appendChild(target)
    wrapped.push(span)
  }
  if (wrapped.length === 0) return false
  const selection = window.getSelection?.()
  if (selection) {
    const after = document.createRange()
    after.setStartBefore(wrapped[0]!)
    after.setEndAfter(wrapped[wrapped.length - 1]!)
    selection.removeAllRanges()
    selection.addRange(after)
  }
  return true
}

function stateFromStyles(styles: RunStyleState[]): TextFormatState {
  const uniform = <T,>(pick: (style: RunStyleState) => T): T | null => {
    const first = pick(styles[0]!)
    return styles.every((style) => pick(style) === first) ? first : null
  }
  return {
    bold: styles.every((style) => style.bold),
    italic: styles.every((style) => style.italic),
    fontId: uniform((style) => style.fontId),
    size: uniform((style) => style.size),
    color: uniform((style) => style.color),
    link: uniform((style) => style.link ?? null),
  }
}

/** Applies alignment/bullet attributes to every paragraph the selection touches. */
export function applyParagraphStyleToSelection(root: HTMLElement, patch: ParagraphStylePatch): boolean {
  const blocks = paragraphsInSelection(root)
  if (blocks.length === 0) return false
  let changed = false
  for (const block of blocks) {
    if (patch.alignment !== undefined && block.getAttribute(BRIDGE_ATTR.align) !== patch.alignment) {
      block.setAttribute(BRIDGE_ATTR.align, patch.alignment)
      block.style.textAlign = patch.alignment
      changed = true
    }
    if (patch.bullet !== undefined) {
      const current = block.getAttribute(BRIDGE_ATTR.bullet) ?? 'none'
      if (current !== patch.bullet) {
        block.setAttribute(BRIDGE_ATTR.bullet, patch.bullet)
        if (patch.bullet === 'none') block.removeAttribute(BRIDGE_ATTR.level)
        else if (block.getAttribute(BRIDGE_ATTR.level) === null) block.setAttribute(BRIDGE_ATTR.level, '0')
        changed = true
      }
    }
    if (patch.bulletLevel !== undefined) {
      const current = Number(block.getAttribute(BRIDGE_ATTR.level) ?? '0')
      if (current !== patch.bulletLevel) {
        block.setAttribute(BRIDGE_ATTR.level, String(patch.bulletLevel))
        changed = true
      }
    }
  }
  return changed
}

/** The uniform paragraph attributes across the selection; mixed reads as null. */
export function readParagraphStyle(root: HTMLElement): ParagraphFormatState {
  const blocks = paragraphsInSelection(root)
  if (blocks.length === 0) return { alignment: null, bullet: null, bulletLevel: null }
  const uniform = <T,>(pick: (block: HTMLElement) => T): T | null => {
    const first = pick(blocks[0]!)
    return blocks.every((block) => pick(block) === first) ? first : null
  }
  const alignmentOf = (block: HTMLElement): ParagraphAlignment => {
    const value = block.getAttribute(BRIDGE_ATTR.align)
    return value === 'center' || value === 'right' || value === 'justify' ? value : 'left'
  }
  const bulletOf = (block: HTMLElement): BulletKind => {
    const value = block.getAttribute(BRIDGE_ATTR.bullet)
    return value === 'bullet' || value === 'number' ? value : 'none'
  }
  const levelOf = (block: HTMLElement): BulletLevel => {
    const value = Number(block.getAttribute(BRIDGE_ATTR.level) ?? '0')
    return value === 1 || value === 2 ? value : 0
  }
  return { alignment: uniform(alignmentOf), bullet: uniform(bulletOf), bulletLevel: uniform(levelOf) }
}

/** Block elements a browser may create for a new paragraph (Enter/`execCommand`). */
const BLOCK_SELECTOR = 'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, section, article'

/**
 * The field's paragraph blocks: seeded blocks carry `data-p`, but a paragraph the
 * browser created while typing does not, so block elements count too.
 */
export function paragraphBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((child): child is HTMLElement =>
    child.hasAttribute(BRIDGE_ATTR.paragraph) || child.matches(BLOCK_SELECTOR))
}

/** The paragraph block (`<p data-p>` or a browser-created block) containing `node`. */
export function paragraphBlockForNode(root: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement
      if (element.hasAttribute(BRIDGE_ATTR.paragraph) || element.matches(BLOCK_SELECTOR)) return element
    }
    current = current.parentNode
  }
  return null
}

/** The paragraph blocks the selection touches. */
export function paragraphsInSelection(root: HTMLElement): HTMLElement[] {
  const range = selectionRange(root)
  if (!range) return []
  return paragraphBlocks(root).filter((block) => range.intersectsNode(block))
}

function isMarkerNode(node: Node): boolean {
  return node.parentElement?.closest(`[${BRIDGE_ATTR.marker}]`) !== null
}

/** Caret offset in visible paragraph text, ignoring bullet/number marker spans. */
export function caretOffsetInParagraph(block: Element, node: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let offset = 0
  let current = walker.nextNode()
  while (current) {
    const text = current as Text
    if (text === node) return offset + nodeOffset
    if (!isMarkerNode(text)) offset += text.textContent?.length ?? 0
    current = walker.nextNode()
  }
  return offset
}

/** Puts the caret back at a visible-text offset after a paragraph re-seed. */
export function placeCaretAtParagraphOffset(block: Element, offset: number): void {
  const selection = window.getSelection?.()
  if (!selection) return
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let current = walker.nextNode()
  while (current) {
    const text = current as Text
    if (!isMarkerNode(text)) {
      if (remaining <= text.length) {
        const range = document.createRange()
        range.setStart(text, remaining)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
        return
      }
      remaining -= text.length
    }
    current = walker.nextNode()
  }
  const range = document.createRange()
  range.selectNodeContents(block)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** The effective style of the selection; mixed values read as null. */
export function readSelectionStyle(root: HTMLElement, defaults: BridgeDefaults): TextFormatState {
  const range = selectionRange(root)
  const anchor = range?.startContainer ?? root
  const nodes = range ? textNodesInRange(root, range) : []
  const styles = nodes.length > 0
    ? nodes.map((node) => runStyleAtNode(node, defaults))
    : [runStyleAtNode(anchor, defaults)]
  return stateFromStyles(styles)
}

/** Validates a patch against the known fonts before it reaches the DOM. */
export function isApplicablePatch(patch: RunStylePatch): boolean {
  return patch.fontId === undefined || isKnownFontId(patch.fontId)
}
