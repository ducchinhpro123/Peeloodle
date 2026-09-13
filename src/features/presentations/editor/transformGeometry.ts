/**
 * Element transform geometry (P24).
 *
 * Pointer positions arrive in view pixels; document geometry is always kept in
 * 1280×720 document units. The conversions and the move/resize/rotate math live
 * here so the canvas gesture handlers and their tests share one implementation.
 * Nothing in this module reads or writes view or document state.
 */

import type { PresentationViewport } from './viewGeometry'

/** The geometry a transform gesture may change; not the element itself. */
export type TransformGeometry = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export type ViewPoint = { x: number; y: number }

/** Corner handles, named by the corner they drag. */
export type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw'

/**
 * Smallest element side in document units. The parser rejects non-positive
 * sizes, and a zero-width box would be impossible to select or grab again.
 */
export const MIN_ELEMENT_SIZE = 8

/** Element bounds in view pixels, before the frame's own rotation. */
export function transformFrameInView(geometry: TransformGeometry, viewport: PresentationViewport): TransformGeometry {
  return {
    x: viewport.x + geometry.x * viewport.scale,
    y: viewport.y + geometry.y * viewport.scale,
    width: geometry.width * viewport.scale,
    height: geometry.height * viewport.scale,
    rotation: geometry.rotation,
  }
}

/** One pointer position in view pixels (relative to the canvas host) as document units. */
export function documentPointFromView(point: ViewPoint, viewport: PresentationViewport): ViewPoint {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  }
}

/** Document position and size are stored as whole units. */
function roundUnits(value: number): number {
  return Math.round(value)
}

/** Move keeps the element's own frame: only the document-space position changes. */
export function moveTransform(start: TransformGeometry, delta: ViewPoint): TransformGeometry {
  return {
    ...start,
    x: roundUnits(start.x + delta.x),
    y: roundUnits(start.y + delta.y),
  }
}

/**
 * Resize from one corner handle. The dragged corner follows the pointer's
 * projection on the element's own axes, the opposite corner stays exactly where
 * it was, and the size is clamped so the result is always a valid document.
 */
export function resizeTransform(start: TransformGeometry, handle: ResizeHandle, pointer: ViewPoint): TransformGeometry {
  const theta = (start.rotation * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  // Element-local axes in document space: u along width, v along height.
  const u = { x: cos, y: sin }
  const v = { x: -sin, y: cos }
  const fixed = {
    x: handle === 'nw' || handle === 'sw' ? start.width : 0,
    y: handle === 'nw' || handle === 'ne' ? start.height : 0,
  }
  const fixedDoc = {
    x: start.x + fixed.x * u.x + fixed.y * v.x,
    y: start.y + fixed.x * u.y + fixed.y * v.y,
  }
  const delta = { x: pointer.x - fixedDoc.x, y: pointer.y - fixedDoc.y }
  const width = Math.max(MIN_ELEMENT_SIZE, roundUnits(Math.abs(delta.x * u.x + delta.y * u.y)))
  const height = Math.max(MIN_ELEMENT_SIZE, roundUnits(Math.abs(delta.x * v.x + delta.y * v.y)))
  return {
    x: roundUnits(fixedDoc.x - (fixed.x === 0 ? 0 : width) * u.x - (fixed.y === 0 ? 0 : height) * v.x),
    y: roundUnits(fixedDoc.y - (fixed.x === 0 ? 0 : width) * u.y - (fixed.y === 0 ? 0 : height) * v.y),
    width,
    height,
    rotation: start.rotation,
  }
}

/** Angle in degrees of a document point seen from a centre, for the rotate handle. */
export function rotationFromPoint(centre: ViewPoint, point: ViewPoint): number {
  return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI
}

/**
 * Shortest signed turn between two angles in degrees. A pointer circling past
 * the half turn must keep rotating the same way instead of jumping 360°.
 */
export function rotationDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/** Degrees are stored in [0, 360), rounded to a tenth: enough for every gesture. */
function normalizeDegrees(value: number): number {
  const wrapped = ((value % 360) + 360) % 360
  return Math.round(wrapped * 10) / 10
}

/**
 * Rotate by a delta in degrees around the element's centre. The centre is a
 * document-space point, so zoom never changes the result and the bounding box
 * keeps its place on the slide while the element spins.
 */
export function rotateTransform(start: TransformGeometry, deltaDegrees: number): TransformGeometry {
  const rotation = normalizeDegrees(start.rotation + deltaDegrees)
  const theta = (rotation * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const halfWidth = start.width / 2
  const halfHeight = start.height / 2
  const centre = { x: start.x + halfWidth, y: start.y + halfHeight }
  return {
    x: roundUnits(centre.x - (halfWidth * cos - halfHeight * sin)),
    y: roundUnits(centre.y - (halfWidth * sin + halfHeight * cos)),
    width: start.width,
    height: start.height,
    rotation,
  }
}

/**
 * Last gate before a transform command reaches the document. The parser rejects
 * non-finite positions and non-positive sizes, so unusable geometry is refused
 * here rather than thrown later, and every committed value is rounded and
 * clamped exactly like the gesture math rounds and clamps.
 */
export function normalizeTransform(geometry: TransformGeometry): TransformGeometry | null {
  const values = [geometry.x, geometry.y, geometry.width, geometry.height, geometry.rotation]
  if (!values.every((value) => Number.isFinite(value))) return null
  return {
    x: roundUnits(geometry.x),
    y: roundUnits(geometry.y),
    width: Math.max(MIN_ELEMENT_SIZE, roundUnits(geometry.width)),
    height: Math.max(MIN_ELEMENT_SIZE, roundUnits(geometry.height)),
    rotation: normalizeDegrees(geometry.rotation),
  }
}
