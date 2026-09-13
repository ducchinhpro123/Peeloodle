import { DEFAULT_BODY_FONT_SIZE, DEFAULT_THEME } from '../model/factories'
import type { Theme, TextElement } from '../model/types'
import type { BridgeDefaults } from './textBridge'
import type { ParagraphFormatState, ParagraphStylePatch, RunStylePatch, TextFormatState } from './textFormat'

/**
 * Session helpers for DOM text editing (P17). Kept free of JSX so the overlay
 * module stays a component-only module and these stay unit-testable.
 */

/** One text session is one undo entry; every keystroke commits inside this group. */
export function textHistoryGroup(elementId: string): string {
  return `text:${elementId}`
}

/**
 * The DOM field being edited belongs to `TextEditOverlay`, so a save must ask the
 * overlay to commit rather than reaching into the document by test id. Renaming
 * the overlay's markup can then never silently turn the flush into a no-op.
 */
let activeFlush: (() => void) | null = null

export function registerActiveTextEditFlush(flush: (() => void) | null): void {
  activeFlush = flush
}

export function flushActiveTextEdit(): void {
  if (activeFlush === null) return
  try {
    activeFlush()
  } catch {
    // A rejected command (an over-long box) keeps the last committed text: the
    // overlay owns that error, and a save must not fail because of it.
  }
}

/** Fallback style for text that carries no run of its own, preferring the document theme. */
export function bridgeDefaultsFor(element: TextElement, theme?: Pick<Theme, 'bodyFontId' | 'colors'>): BridgeDefaults {
  const run = element.paragraphs.flatMap((paragraph) => paragraph.runs)[0]
  return {
    fontId: run?.fontId ?? theme?.bodyFontId ?? DEFAULT_THEME.bodyFontId,
    size: run?.size ?? DEFAULT_BODY_FONT_SIZE,
    color: run?.color ?? theme?.colors?.text ?? DEFAULT_THEME.colors.text ?? '#08152f',
  }
}

/**
 * The formatting toolbar belongs to the editor page, but the DOM field and its
 * selection belong to `TextEditOverlay`, so the overlay registers a controller
 * for the life of the session (the same seam the save flush uses).
 */
export type TextFormatController = {
  /** Applies a patch to the live selection and commits the session. */
  apply(patch: RunStylePatch): void
  /** The effective style of the current selection, for active states. */
  read(): TextFormatState
  /** Applies alignment/bullet attributes to the paragraphs in the selection. */
  applyParagraph(patch: ParagraphStylePatch): void
  /** The uniform paragraph attributes of the selection. */
  readParagraph(): ParagraphFormatState
  /** Applies or removes a link on the selection; invalid URLs are refused. */
  applyLink(href: string | null): { ok: true } | { ok: false; message: string }
  /** The element's line-height multiplier, changed as one history entry. */
  setLineHeight(value: number): void
  /** The element's current line-height multiplier. */
  lineHeight(): number
}

let activeFormat: TextFormatController | null = null
const formatListeners = new Set<() => void>()

export function registerActiveTextEditFormat(controller: TextFormatController | null): void {
  activeFormat = controller
  for (const listener of formatListeners) listener()
}

export function activeTextEditFormat(): TextFormatController | null {
  return activeFormat
}

export function subscribeActiveTextEditFormat(listener: () => void): () => void {
  formatListeners.add(listener)
  return () => formatListeners.delete(listener)
}
