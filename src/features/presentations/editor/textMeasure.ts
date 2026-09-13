/**
 * Document-space text measurement for editor UI (P27 overflow feedback).
 *
 * Konva and the DOM both measure through a canvas 2D context with the same CSS
 * font string, so an offscreen canvas here reports the same widths the canvas
 * renderer uses, without pulling Konva into the editor page's chunk. Fonts must
 * already be loaded (`ensurePresentationFonts`), which the editor awaits before
 * it becomes ready.
 */

import { cssFontFor, type FontSpec } from '../rendering/textLayout'

let measureContext: CanvasRenderingContext2D | null | undefined

export function measureTextWidth(text: string, spec: FontSpec): number {
  // jsdom has no 2D context; the estimate keeps the overflow path testable and
  // never runs in a browser, where the real canvas measure is used.
  if (typeof document === 'undefined' || import.meta.env.MODE === 'test') return text.length * spec.size * 0.55
  if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d')
  if (!measureContext) return text.length * spec.size * 0.55
  measureContext.font = cssFontFor(spec)
  return measureContext.measureText(text).width
}
