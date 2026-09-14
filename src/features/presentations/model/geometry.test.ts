import { describe, expect, it } from 'vitest'
import {
  POINTS_PER_INCH,
  UNITS_PER_INCH,
  inchesToUnits,
  pageSizeInInches,
  pageSizeInPoints,
  pointsToUnits,
  unitsToInches,
  unitsToPoints,
} from './geometry'
import { PRESENTATION_PAGE_HEIGHT, PRESENTATION_PAGE_WIDTH } from './types'
import { createFixturePresentation } from './fixtures/fixture'

describe('presentation geometry', () => {
  it('converts document units to inches and points', () => {
    expect(UNITS_PER_INCH).toBe(96)
    expect(POINTS_PER_INCH).toBe(72)
    expect(unitsToInches(96)).toBe(1)
    expect(unitsToPoints(96)).toBe(72)
    expect(inchesToUnits(13.333)).toBeCloseTo(1280 - 0.032, 3)
    expect(pointsToUnits(54)).toBeCloseTo(72, 10)
  })

  it('maps the 1280×720 document to 13⅓×7½ inches and 960×540 points', () => {
    const inches = pageSizeInInches()
    expect(inches.width).toBeCloseTo(40 / 3, 10)
    expect(inches.height).toBeCloseTo(7.5, 10)
    const points = pageSizeInPoints()
    expect(points.width).toBe(960)
    expect(points.height).toBe(540)
    expect(unitsToInches(PRESENTATION_PAGE_WIDTH)).toBeCloseTo(13.3333, 4)
    expect(unitsToPoints(PRESENTATION_PAGE_HEIGHT)).toBe(540)
  })

  it('converts fixture coordinates and font sizes exactly', () => {
    const doc = createFixturePresentation()
    const panel = doc.slides[0]!.elements[0]!
    expect(unitsToInches(panel.x)).toBeCloseTo(0.5, 10)
    expect(unitsToPoints(panel.x)).toBe(36)
    expect(unitsToPoints(panel.width)).toBe(888)
    const title = doc.slides[0]!.elements[1]!
    expect(title.kind).toBe('text')
    if (title.kind !== 'text') throw new Error('fixture title must be text')
    expect(unitsToPoints(title.paragraphs[0]!.runs[0]!.size)).toBe(54)
  })

})
