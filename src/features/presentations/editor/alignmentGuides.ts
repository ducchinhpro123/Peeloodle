/**
 * Alignment guides and snapping (P31).
 *
 * A drag can lock the moving rectangle's left edge, centre or right edge onto
 * the same three lines of every other element and of the page itself. The
 * candidates are compared in document units, so which guide matches does not
 * change with zoom; this module only computes the snapped position and the
 * lines to draw - the caller decides whether to apply them, and the guides
 * never enter a saved document or an export.
 */

import type { TransformGeometry } from './transformGeometry'

export type AlignmentAxis = 'x' | 'y'

/** One snapped line in document coordinates. */
export type AlignmentGuide = { axis: AlignmentAxis; position: number }

/** The snapped top-left corner and the lines that matched; one guide per axis at most. */
export type SnapResult = { x: number; y: number; guides: AlignmentGuide[] }

/** Default snap distance in document units, small enough to feel deliberate. */
const DEFAULT_SNAP_THRESHOLD = 6

/** The moving rectangle's left/centre/right (or top/middle/bottom) anchor lines. */
function anchorsFor(geometry: TransformGeometry, axis: AlignmentAxis): number[] {
  const start = axis === 'x' ? geometry.x : geometry.y
  const size = axis === 'x' ? geometry.width : geometry.height
  return [start, start + size / 2, start + size]
}

/**
 * The candidate line closest to any moving anchor, when that distance is within
 * the threshold, together with the offset that puts the anchor on the line. The
 * first candidate wins a tie, so the result depends only on the order of
 * `others` and never on a floating-point comparison accident.
 */
function closestSnap(anchors: number[], candidates: number[], threshold: number): { delta: number; position: number } | null {
  let best: { delta: number; position: number } | null = null
  for (const anchor of anchors) {
    for (const candidate of candidates) {
      const delta = candidate - anchor
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, position: candidate }
      }
    }
  }
  return best
}

/**
 * Snap a moving rectangle's edges and centres to the edges and centres of the
 * other elements and to the page's edges and centre. Each axis is resolved
 * independently: the smallest anchor-to-candidate distance at or below the
 * threshold moves the rectangle by exactly that distance, and the matched line
 * is returned as a guide. Inputs are read-only; nothing is mutated.
 */
export function snapToAlignment(
  moving: TransformGeometry,
  others: TransformGeometry[],
  pageSize: { width: number; height: number },
  threshold = DEFAULT_SNAP_THRESHOLD,
): SnapResult {
  const xCandidates: number[] = []
  const yCandidates: number[] = []
  for (const other of others) {
    xCandidates.push(other.x, other.x + other.width / 2, other.x + other.width)
    yCandidates.push(other.y, other.y + other.height / 2, other.y + other.height)
  }
  xCandidates.push(0, pageSize.width / 2, pageSize.width)
  yCandidates.push(0, pageSize.height / 2, pageSize.height)

  const guides: AlignmentGuide[] = []
  let x = moving.x
  let y = moving.y
  const xSnap = closestSnap(anchorsFor(moving, 'x'), xCandidates, threshold)
  if (xSnap) {
    x += xSnap.delta
    guides.push({ axis: 'x', position: xSnap.position })
  }
  const ySnap = closestSnap(anchorsFor(moving, 'y'), yCandidates, threshold)
  if (ySnap) {
    y += ySnap.delta
    guides.push({ axis: 'y', position: ySnap.position })
  }
  return { x, y, guides }
}

/** The slide edges and centrelines an element can be aligned to explicitly. */
export type SlideAlignment = 'left' | 'center-horizontal' | 'right' | 'top' | 'middle-vertical' | 'bottom'

/**
 * Explicitly align one element to the slide. Only the named axis moves; the
 * other keeps its current value, and the result is whole document units.
 */
export function alignToSlide(
  geometry: TransformGeometry,
  pageSize: { width: number; height: number },
  alignment: SlideAlignment,
): { x: number; y: number } {
  switch (alignment) {
    case 'left':
      return { x: 0, y: Math.round(geometry.y) }
    case 'center-horizontal':
      return { x: Math.round((pageSize.width - geometry.width) / 2), y: Math.round(geometry.y) }
    case 'right':
      return { x: Math.round(pageSize.width - geometry.width), y: Math.round(geometry.y) }
    case 'top':
      return { x: Math.round(geometry.x), y: 0 }
    case 'middle-vertical':
      return { x: Math.round(geometry.x), y: Math.round((pageSize.height - geometry.height) / 2) }
    case 'bottom':
      return { x: Math.round(geometry.x), y: Math.round(pageSize.height - geometry.height) }
  }
}
