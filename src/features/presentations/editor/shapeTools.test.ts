import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '../model/factories'
import { createSlideShape, type ShapeInsertKind } from './shapeTools'

const PAGE = { width: 1280, height: 720 }

const BLOCK_KINDS = ['rectangle', 'rounded-rectangle', 'ellipse'] as const satisfies readonly ShapeInsertKind[]
const LINE_KINDS = ['line', 'arrow'] as const satisfies readonly ShapeInsertKind[]
const ALL_KINDS = [...BLOCK_KINDS, ...LINE_KINDS] as const

const DEFAULT_NAMES: Record<ShapeInsertKind, string> = {
  rectangle: 'Rectangle',
  'rounded-rectangle': 'Rounded rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
}

describe('createSlideShape', () => {
  it.each(ALL_KINDS)('creates a %s shape element of the requested kind', (kind) => {
    const element = createSlideShape(kind, PAGE)
    expect(element.kind).toBe('shape')
    expect(element.shape).toBe(kind)
  })

  it.each(ALL_KINDS)('centres a %s on a 1280x720 page with a positive size', (kind) => {
    const element = createSlideShape(kind, PAGE)
    const expected =
      kind === 'line' || kind === 'arrow'
        ? { x: 400, y: 280, width: 480, height: 160 }
        : { x: 400, y: 225, width: 480, height: 270 }
    expect({ x: element.x, y: element.y, width: element.width, height: element.height }).toEqual(expected)
  })

  it('positions relative to the supplied page size, rounding half units', () => {
    const page = { width: 1001, height: 701 }
    expect(createSlideShape('rectangle', page)).toMatchObject({ x: 261, y: 216 })
    expect(createSlideShape('line', page)).toMatchObject({ x: 261, y: 271 })
  })

  it.each(LINE_KINDS)('draws a %s with the theme text stroke and no fill', (kind) => {
    const element = createSlideShape(kind, PAGE)
    expect(element.fill).toBeNull()
    expect(element.stroke).toBe(DEFAULT_THEME.colors.text)
    expect(element.strokeWidth).toBe(4)
  })

  it.each(BLOCK_KINDS)('fills a %s with the theme accent and no outline', (kind) => {
    const element = createSlideShape(kind, PAGE)
    expect(element.fill).toBe(DEFAULT_THEME.colors.accent)
    expect(element.stroke).toBeNull()
    expect(element.strokeWidth).toBe(0)
  })

  it.each(ALL_KINDS)('labels a new %s with its human-readable name', (kind) => {
    expect(createSlideShape(kind, PAGE).name).toBe(DEFAULT_NAMES[kind])
  })

  it('lets the caller override the default name', () => {
    expect(createSlideShape('ellipse', PAGE, { name: 'Highlight' }).name).toBe('Highlight')
  })

  it('keeps the factory defaults it does not set', () => {
    const element = createSlideShape('rounded-rectangle', PAGE)
    expect(element.rotation).toBe(0)
    expect(element.opacity).toBe(1)
    expect(element.visible).toBe(true)
    expect(element.locked).toBe(false)
    expect(element.id).toBeTruthy()
  })

  it('gives each inserted shape a fresh id', () => {
    const first = createSlideShape('rectangle', PAGE)
    const second = createSlideShape('rectangle', PAGE)
    expect(first.id).not.toBe(second.id)
  })
})
