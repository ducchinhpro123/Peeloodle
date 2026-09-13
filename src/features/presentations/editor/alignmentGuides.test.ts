import { describe, expect, it } from 'vitest'
import { alignToSlide, snapToAlignment } from './alignmentGuides'
import type { TransformGeometry } from './transformGeometry'

/** A plain document-unit rectangle; rotation never affects snapping. */
function geometry(x: number, y: number, width: number, height: number): TransformGeometry {
  return { x, y, width, height, rotation: 0 }
}

const PAGE = { width: 1280, height: 720 }

describe('snapToAlignment', () => {
  it('snaps an edge to another element edge', () => {
    const moving = geometry(104, 40, 100, 60)
    const others = [geometry(100, 300, 260, 80)]
    expect(snapToAlignment(moving, others, PAGE)).toEqual({
      x: 100,
      y: 40,
      guides: [{ axis: 'x', position: 100 }],
    })
  })

  it('snaps a centre to another element centre', () => {
    const moving = geometry(300, 100, 100, 60)
    const others = [geometry(200, 400, 300, 100)]
    expect(snapToAlignment(moving, others, PAGE)).toEqual({
      x: 300,
      y: 100,
      guides: [{ axis: 'x', position: 350 }],
    })
  })

  it('snaps to the page centre on both axes', () => {
    expect(snapToAlignment(geometry(596, 40, 80, 40), [], PAGE)).toEqual({
      x: 600,
      y: 40,
      guides: [{ axis: 'x', position: 640 }],
    })
    expect(snapToAlignment(geometry(500, 334, 80, 60), [], PAGE)).toEqual({
      x: 500,
      y: 330,
      guides: [{ axis: 'y', position: 360 }],
    })
  })

  it('snaps to the page edges', () => {
    const moving = geometry(4, 676, 100, 40)
    expect(snapToAlignment(moving, [], PAGE)).toEqual({
      x: 0,
      y: 680,
      guides: [
        { axis: 'x', position: 0 },
        { axis: 'y', position: 720 },
      ],
    })
  })

  it('snaps at the threshold but not beyond it', () => {
    const edge = geometry(100, 300, 260, 80)
    // Exactly six units away snaps; seven is left alone.
    expect(snapToAlignment(geometry(106, 40, 20, 20), [edge], PAGE)).toMatchObject({ x: 100 })
    expect(snapToAlignment(geometry(107, 40, 20, 20), [edge], PAGE)).toMatchObject({ x: 107 })
    // A caller-supplied threshold overrides the six-unit default.
    expect(snapToAlignment(geometry(106, 40, 20, 20), [edge], PAGE, 2)).toMatchObject({ x: 106 })
    expect(snapToAlignment(geometry(104, 40, 20, 20), [edge], PAGE, 4)).toMatchObject({ x: 100 })
  })

  it('snaps both axes in one call', () => {
    const moving = geometry(104, 206, 100, 60)
    const others = [geometry(100, 200, 200, 100)]
    expect(snapToAlignment(moving, others, PAGE)).toEqual({
      x: 100,
      y: 200,
      guides: [
        { axis: 'x', position: 100 },
        { axis: 'y', position: 200 },
      ],
    })
  })

  it('reports one guide per axis even when several candidates share the line', () => {
    const moving = geometry(104, 40, 100, 60)
    const others = [geometry(100, 300, 200, 80), geometry(100, 500, 400, 80)]
    const result = snapToAlignment(moving, others, PAGE)
    expect(result.guides).toEqual([{ axis: 'x', position: 100 }])
  })

  it('leaves the position unchanged and the guides empty when nothing is close', () => {
    const moving = geometry(500, 500, 100, 50)
    const others = [geometry(0, 0, 40, 40)]
    expect(snapToAlignment(moving, others, PAGE)).toEqual({ x: 500, y: 500, guides: [] })
  })

  it('does not mutate the moving element, the others or the page size', () => {
    const moving = Object.freeze(geometry(104, 206, 100, 60))
    const others = [Object.freeze(geometry(100, 200, 200, 100))]
    const page = Object.freeze({ width: PAGE.width, height: PAGE.height })
    const before = { moving: { ...moving }, others: others.map((other) => ({ ...other })), page: { ...page } }
    snapToAlignment(moving, others, page)
    alignToSlide(moving, page, 'center-horizontal')
    expect(moving).toEqual(before.moving)
    expect(others).toEqual(before.others)
    expect(page).toEqual(before.page)
  })
})

describe('alignToSlide', () => {
  it('moves only the aligned axis to the slide edges and centrelines', () => {
    const element = geometry(100, 80, 200, 100)
    expect(alignToSlide(element, PAGE, 'left')).toEqual({ x: 0, y: 80 })
    expect(alignToSlide(element, PAGE, 'center-horizontal')).toEqual({ x: 540, y: 80 })
    expect(alignToSlide(element, PAGE, 'right')).toEqual({ x: 1080, y: 80 })
    expect(alignToSlide(element, PAGE, 'top')).toEqual({ x: 100, y: 0 })
    expect(alignToSlide(element, PAGE, 'middle-vertical')).toEqual({ x: 100, y: 310 })
    expect(alignToSlide(element, PAGE, 'bottom')).toEqual({ x: 100, y: 620 })
  })

  it('rounds the aligned position to whole document units', () => {
    const element = geometry(10, 7, 32, 12)
    const page = { width: 101, height: 51 }
    expect(alignToSlide(element, page, 'center-horizontal')).toEqual({ x: 35, y: 7 })
    expect(alignToSlide(element, page, 'middle-vertical')).toEqual({ x: 10, y: 20 })
    expect(alignToSlide(element, page, 'right')).toEqual({ x: 69, y: 7 })
    expect(alignToSlide(element, page, 'bottom')).toEqual({ x: 10, y: 39 })
  })
})
