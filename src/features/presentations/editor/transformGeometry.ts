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
 * The projections are signed towards the handle's own outward direction, so a
 * pointer dragged past the pinned corner clamps at the minimum size instead of
 * flipping the element over to the other side.
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
  const outward = {
    x: handle === 'nw' || handle === 'sw' ? -1 : 1,
    y: handle === 'nw' || handle === 'ne' ? -1 : 1,
  }
  const width = Math.max(MIN_ELEMENT_SIZE, roundUnits((delta.x * u.x + delta.y * u.y) * outward.x))
  const height = Math.max(MIN_ELEMENT_SIZE, roundUnits((delta.x * v.x + delta.y * v.y) * outward.y))
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

/** The element's local (0…width, 0…height) point in document units after its rotation. */
function localPointInDocument(geometry: TransformGeometry, point: ViewPoint): ViewPoint {
  const theta = (geometry.rotation * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  return {
    x: geometry.x + point.x * cos - point.y * sin,
    y: geometry.y + point.x * sin + point.y * cos,
  }
}

/**
 * The element's visual centre in document coordinates. Rotation turns the
 * element around its stored origin, so the centre moves with the angle and is
 * not simply `x + width / 2`: an element at 90° has its centre beside its origin.
 */
export function elementWorldCenter(geometry: TransformGeometry): ViewPoint {
  return localPointInDocument(geometry, { x: geometry.width / 2, y: geometry.height / 2 })
}

/** The stored origin that puts the element's midpoint at `centre` for an angle. */
function originForCenter(centre: ViewPoint, size: ViewPoint, rotation: number): ViewPoint {
  const theta = (rotation * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const half = { x: size.x / 2, y: size.y / 2 }
  return {
    x: centre.x - (half.x * cos - half.y * sin),
    y: centre.y - (half.x * sin + half.y * cos),
  }
}

/**
 * Replaces the rotation while keeping the element's visual centre where it is.
 * The canvas gesture and the numeric Rotation field both go through here, so an
 * already-rotated element turns in place instead of jumping to a new position.
 */
export function withRotation(start: TransformGeometry, rotation: number): TransformGeometry {
  const turned = normalizeDegrees(rotation)
  const centre = elementWorldCenter(start)
  const origin = originForCenter(centre, { x: start.width, y: start.height }, turned)
  return {
    x: roundUnits(origin.x),
    y: roundUnits(origin.y),
    width: start.width,
    height: start.height,
    rotation: turned,
  }
}

/**
 * Shortest signed turn between two angles in degrees. A pointer circling past
 * the half turn must keep rotating the same way instead of jumping 360°.
 */
export function rotationDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/**
 * One step of a continuous rotation gesture: the shortest turn from the previous
 * pointer angle added to the turn so far. Measuring from the gesture's first
 * angle instead would jump a full turn whenever the pointer crosses ±180° and
 * could never pass a half turn.
 */
export function nextRotationStep(previousAngle: number, angle: number, accumulated: number): { angle: number; accumulated: number } {
  return { angle, accumulated: accumulated + rotationDelta(previousAngle, angle) }
}

/** Degrees are stored in [0, 360), rounded to a tenth: enough for every gesture. */
function normalizeDegrees(value: number): number {
  const wrapped = ((value % 360) + 360) % 360
  return Math.round(wrapped * 10) / 10
}

/**
 * Rotate by a delta in degrees around the element's visual centre. The centre is
 * a document-space point, so zoom never changes the result and the element keeps
 * its place on the slide while it spins.
 */
export function rotateTransform(start: TransformGeometry, deltaDegrees: number): TransformGeometry {
  return withRotation(start, start.rotation + deltaDegrees)
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
