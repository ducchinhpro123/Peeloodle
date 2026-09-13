import { describe, expect, it } from 'vitest'
import { documentPointFromView, MIN_ELEMENT_SIZE, moveTransform, normalizeTransform, resizeTransform, rotateTransform, rotationDelta, rotationFromPoint, transformFrameInView } from './transformGeometry'

describe('transformGeometry', () => {
  it('maps element frames into view pixels with the shared viewport scale', () => {
    const element = { x: 100, y: 200, width: 400, height: 200, rotation: 0 }
    expect(transformFrameInView(element, { scale: 0.75, x: 40, y: -10 }))
      .toEqual({ x: 115, y: 140, width: 300, height: 150, rotation: 0 })
  })

  it('reads a pointer back in document units, so the same drag fits every zoom', () => {
    const element = { x: 100, y: 200, width: 400, height: 200, rotation: 0 }
    const frame = transformFrameInView(element, { scale: 0.75, x: 40, y: -10 })
    expect(documentPointFromView({ x: frame.x, y: frame.y }, { scale: 0.75, x: 40, y: -10 })).toEqual({ x: 100, y: 200 })
    // A 25% larger viewport scale maps the same document point to a different pixel.
    const zoomedIn = { scale: 1.5, x: -100, y: 20 }
    expect(documentPointFromView({ x: -100 + 150, y: 20 + 300 }, zoomedIn)).toEqual({ x: 100, y: 200 })
  })

  it('moves an element by the document-space pointer delta', () => {
    const start = { x: 100, y: 200, width: 400, height: 200, rotation: 0 }
    expect(moveTransform(start, { x: 40.2, y: -12.6 }))
      .toEqual({ x: 140, y: 187, width: 400, height: 200, rotation: 0 })
    expect(moveTransform(start, { x: 0, y: 0 })).toEqual(start)
  })

  it('resizes from a corner handle and keeps the opposite corner fixed', () => {
    const start = { x: 100, y: 100, width: 200, height: 100, rotation: 0 }
    // The south-east corner follows the pointer; the north-west origin stays put.
    expect(resizeTransform(start, 'se', { x: 340, y: 230 }))
      .toEqual({ x: 100, y: 100, width: 240, height: 130, rotation: 0 })
    // Dragging the north-west corner keeps the south-east corner fixed instead.
    expect(resizeTransform(start, 'nw', { x: 80, y: 70 }))
      .toEqual({ x: 80, y: 70, width: 220, height: 130, rotation: 0 })
  })

  it('resizes a rotated element along its own axes, still pinning the opposite corner', () => {
    const start = { x: 100, y: 100, width: 200, height: 100, rotation: 90 }
    expect(resizeTransform(start, 'se', { x: -30, y: 340 }))
      .toEqual({ x: 100, y: 100, width: 240, height: 130, rotation: 90 })
  })

  it('never lets a resize collapse the element below a usable size', () => {
    const start = { x: 100, y: 100, width: 200, height: 100, rotation: 0 }
    expect(resizeTransform(start, 'se', { x: 100, y: 100 }))
      .toEqual({ x: 100, y: 100, width: MIN_ELEMENT_SIZE, height: MIN_ELEMENT_SIZE, rotation: 0 })
  })

  it('rotates an element around its centre and leaves that centre where it was', () => {
    const start = { x: 100, y: 100, width: 200, height: 100, rotation: 0 }
    // Centre (200, 150): a quarter turn moves the origin to (250, 50).
    expect(rotateTransform(start, 90)).toEqual({ x: 250, y: 50, width: 200, height: 100, rotation: 90 })
    expect(rotationFromPoint({ x: 200, y: 150 }, { x: 200, y: 50 })).toBe(-90)
  })

  it('takes the shortest way round when a rotation crosses the half turn', () => {
    expect(rotationDelta(-170, 170)).toBe(-20)
    expect(rotationDelta(170, -170)).toBe(20)
    expect(rotationDelta(-90, 0)).toBe(90)
  })

  it('refuses unusable geometry and clamps what it accepts', () => {
    expect(normalizeTransform({ x: 10, y: 10, width: 0, height: 4, rotation: -30 }))
      .toEqual({ x: 10, y: 10, width: MIN_ELEMENT_SIZE, height: MIN_ELEMENT_SIZE, rotation: 330 })
    expect(normalizeTransform({ x: 0.4, y: 0.6, width: 10.4, height: 10, rotation: 45.26 }))
      .toEqual({ x: 0, y: 1, width: 10, height: 10, rotation: 45.3 })
    expect(normalizeTransform({ x: Number.NaN, y: 0, width: 10, height: 10, rotation: 0 })).toBeNull()
    expect(normalizeTransform({ x: 0, y: 0, width: 10, height: 10, rotation: Number.POSITIVE_INFINITY })).toBeNull()
  })
})
