import { DEFAULT_BODY_FONT_SIZE, DEFAULT_THEME } from '../model/factories'
import type { Theme, TextElement } from '../model/types'
import type { BridgeDefaults } from './textBridge'

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
