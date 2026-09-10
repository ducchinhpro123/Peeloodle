/**
 * Geometry conversions between presentation document units and physical units.
 *
 * Document units are 1/96 inch (CSS px at 100% zoom), matching the architecture
 * contract: a 1280×720 document is 13⅓×7½ inches (standard 16:9 PowerPoint) and
 * 960×540 points. Font sizes are stored in document units and convert to points
 * with the same ratio. Conversions are centralized here and tested in
 * geometry.test.ts.
 */

import { PRESENTATION_PAGE_HEIGHT, PRESENTATION_PAGE_WIDTH } from './types'

export const UNITS_PER_INCH = 96
export const POINTS_PER_INCH = 72

export function unitsToInches(units: number): number {
  return units / UNITS_PER_INCH
}

export function inchesToUnits(inches: number): number {
  return inches * UNITS_PER_INCH
}

export function unitsToPoints(units: number): number {
  return (units * POINTS_PER_INCH) / UNITS_PER_INCH
}

export function pointsToUnits(points: number): number {
  return (points * UNITS_PER_INCH) / POINTS_PER_INCH
}

/** PPTX/PDF page size in inches: 40/3 × 15/2 (13.333…×7.5). */
export function pageSizeInInches(): { width: number; height: number } {
  return { width: unitsToInches(PRESENTATION_PAGE_WIDTH), height: unitsToInches(PRESENTATION_PAGE_HEIGHT) }
}

/** PDF page size in points: 960×540. */
export function pageSizeInPoints(): { width: number; height: number } {
  return { width: unitsToPoints(PRESENTATION_PAGE_WIDTH), height: unitsToPoints(PRESENTATION_PAGE_HEIGHT) }
}

export type Rect = { x: number; y: number; width: number; height: number }

/** Element bounds in document units, ordered left→right independently of zoom. */
export function normalizeRect(rect: Rect): Rect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x
  const y = rect.height < 0 ? rect.y + rect.height : rect.y
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Slide order is the array order; this guards against accidental re-sorting. */
export function slideIdsInOrder(slides: ReadonlyArray<{ id: string }>): string[] {
  return slides.map((slide) => slide.id)
}
