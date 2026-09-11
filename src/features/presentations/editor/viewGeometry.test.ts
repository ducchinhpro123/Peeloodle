import { describe, expect, it } from 'vitest'
import { clampPresentationZoom, presentationViewport, PRESENTATION_MAX_ZOOM, PRESENTATION_MIN_ZOOM } from './viewGeometry'

describe('presentationViewport', () => {
  it('fits a fixed 16:9 page without stretching its document coordinates', () => {
    expect(presentationViewport(
      { width: 1000, height: 700 },
      { width: 1280, height: 720 },
      1,
      { x: 0, y: 0 },
    )).toEqual({ scale: 0.78125, x: 0, y: 68.75 })
  })

  it('applies zoom and pan only to the viewport mapping', () => {
    expect(presentationViewport(
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
      1.5,
      { x: 24, y: -12 },
    )).toEqual({ scale: 1.5, x: -296, y: -192 })
  })

  it('falls back to 100% when the panel has no measurable size yet', () => {
    expect(presentationViewport(
      { width: 0, height: 0 },
      { width: 1280, height: 720 },
      1,
      { x: 0, y: 0 },
    )).toEqual({ scale: 1, x: -640, y: -360 })
  })
})

describe('clampPresentationZoom', () => {
  it('keeps every zoom entry point inside the shared range', () => {
    expect(clampPresentationZoom(0.05)).toBe(PRESENTATION_MIN_ZOOM)
    expect(clampPresentationZoom(12)).toBe(PRESENTATION_MAX_ZOOM)
    expect(clampPresentationZoom(1.25)).toBe(1.25)
  })
})
