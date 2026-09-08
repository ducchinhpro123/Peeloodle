import { describe, expect, it } from 'vitest'
import type { CropRect, ImageLayer } from '../../types/domain'
import {
  clampZoom,
  getBrushRadiiInImage,
  getStageMetrics,
  imageLocalToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToImageLocal,
  viewportAfterWheel,
  WHEEL_ZOOM_PIXEL_FACTOR,
  zoomTowardPointer,
} from './maskUtils'

describe('maskUtils coordinate mapping', () => {
  const metrics = { viewScale: 1.2, stageX: 50, stageY: 80 }
  const asset = { width: 400, height: 300 }

  it('inverts identity transform accurately', () => {
    const layer: ImageLayer = {
      id: 'img1',
      name: 'Image',
      kind: 'image',
      assetId: 'a1',
      transform: { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 1,
      visible: true,
      locked: false,
    }
    const uv = { u: 150, v: 200 }
    const screenPt = imageLocalToScreen(uv, layer, undefined, metrics)
    const recovered = screenToImageLocal(screenPt, layer, asset, metrics)
    expect(recovered.u).toBeCloseTo(uv.u)
    expect(recovered.v).toBeCloseTo(uv.v)
    expect(recovered.inBounds).toBe(true)
  })

  it('inverts rotation, non-uniform scaling, horizontal and vertical flips accurately', () => {
    const layer: ImageLayer = {
      id: 'img1',
      name: 'Image',
      kind: 'image',
      assetId: 'a1',
      transform: { x: 300, y: 250, rotation: 37, scaleX: -1.5, scaleY: -2.0 },
      opacity: 1,
      visible: true,
      locked: false,
    }
    const uv = { u: 120, v: 180 }
    const screenPt = imageLocalToScreen(uv, layer, undefined, metrics)
    const recovered = screenToImageLocal(screenPt, layer, asset, metrics)
    expect(recovered.u).toBeCloseTo(uv.u, 4)
    expect(recovered.v).toBeCloseTo(uv.v, 4)
    expect(recovered.inBounds).toBe(true)
  })

  it('inverts cropped images accurately', () => {
    const crop: CropRect = { x: 50, y: 40, width: 200, height: 150 }
    const layer: ImageLayer = {
      id: 'img1',
      name: 'Image',
      kind: 'image',
      assetId: 'a1',
      crop,
      transform: { x: 200, y: 180, rotation: 45, scaleX: 1.2, scaleY: 1.2 },
      opacity: 1,
      visible: true,
      locked: false,
    }
    // Point inside crop
    const uv = { u: 100, v: 90 }
    const screenPt = imageLocalToScreen(uv, layer, crop, metrics)
    const recovered = screenToImageLocal(screenPt, layer, asset, metrics)
    expect(recovered.u).toBeCloseTo(uv.u, 4)
    expect(recovered.v).toBeCloseTo(uv.v, 4)
    expect(recovered.inBounds).toBe(true)

    // Point outside crop bounds
    const outsidePt = imageLocalToScreen({ u: 20, v: 20 }, layer, crop, metrics)
    const recoveredOutside = screenToImageLocal(outsidePt, layer, asset, metrics)
    expect(recoveredOutside.inBounds).toBe(false)
  })

  it('computes stage metrics with zoom and pan', () => {
    const fitted = getStageMetrics(800, 600, { zoom: 1, panX: 0, panY: 0 })
    expect(fitted.viewScale).toBeCloseTo(472 / 1024)
    expect(fitted.stageX).toBeCloseTo(164)
    expect(fitted.stageY).toBeCloseTo(64)
    const portrait = getStageMetrics(360, 600, { zoom: 1, panX: 0, panY: 0 })
    expect(portrait.viewScale).toBeCloseTo(232 / 1024)
    expect(portrait.stageX).toBeCloseTo(64)
    expect(portrait.stageY).toBeCloseTo(184)
    const m = getStageMetrics(800, 600, { zoom: 1.5, panX: 40, panY: -20 })
    expect(m.viewScale).toBeCloseTo((472 / 1024) * 1.5)
    expect(m.stageX).toBeCloseTo(40 + (800 - 1024 * m.viewScale) / 2)
    expect(m.stageY).toBeCloseTo(-20 + (600 - 1024 * m.viewScale) / 2)
  })

  it('maps a document-space brush to independent inverse-scaled radii', () => {
    const layer: ImageLayer = {
      id: 'img1',
      name: 'Image',
      kind: 'image',
      assetId: 'a1',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 2 },
      opacity: 1,
      visible: true,
      locked: false,
    }
    expect(getBrushRadiiInImage(40, layer)).toEqual({ x: 10, y: 10 })
    layer.transform.scaleY = -0.5
    expect(getBrushRadiiInImage(40, layer)).toEqual({ x: 10, y: 40 })
    layer.transform.scaleX = 0
    expect(screenToImageLocal({ x: 1, y: 1 }, layer, asset, metrics).inBounds).toBe(false)
  })

})

describe('pointer-anchored viewport zoom', () => {
  function documentUnder(hostWidth: number, hostHeight: number, viewport: { zoom: number; panX: number; panY: number }, pointer: { x: number; y: number }) {
    const metrics = getStageMetrics(hostWidth, hostHeight, viewport)
    return {
      x: (pointer.x - metrics.stageX) / metrics.viewScale,
      y: (pointer.y - metrics.stageY) / metrics.viewScale,
    }
  }

  function expectAnchored(
    hostWidth: number,
    hostHeight: number,
    start: { zoom: number; panX: number; panY: number },
    pointer: { x: number; y: number },
    zooms: number[],
  ) {
    const documentPoint = documentUnder(hostWidth, hostHeight, start, pointer)
    let viewport = start
    for (const zoom of zooms) {
      viewport = zoomTowardPointer(hostWidth, hostHeight, viewport, pointer.x, pointer.y, zoom)
      const metrics = getStageMetrics(hostWidth, hostHeight, viewport)
      expect(metrics.stageX + documentPoint.x * metrics.viewScale).toBeCloseTo(pointer.x, 8)
      expect(metrics.stageY + documentPoint.y * metrics.viewScale).toBeCloseTo(pointer.y, 8)
      expect(viewport.zoom).toBe(clampZoom(zoom))
    }
    return viewport
  }

  it('keeps the artwork point under the pointer at center, edges, and with existing pan', () => {
    expectAnchored(800, 600, { zoom: 1, panX: 0, panY: 0 }, { x: 400, y: 300 }, [1.1, 1.4, 2, 3.2, 1.6, 0.8])
    expectAnchored(800, 600, { zoom: 1, panX: 0, panY: 0 }, { x: 8, y: 12 }, [1.2, 1.8, 2.5, 0.5])
    expectAnchored(800, 600, { zoom: 1, panX: 0, panY: 0 }, { x: 792, y: 588 }, [1.3, 2.2, 0.6])
    expectAnchored(800, 600, { zoom: 1.4, panX: 36, panY: -24 }, { x: 120, y: 80 }, [1.7, 2.8, 1.1, 0.4, 3.5])
    expectAnchored(1024, 768, { zoom: 0.8, panX: -50, panY: 40 }, { x: 1000, y: 20 }, [1, 1.5, 4, 0.25])
  })

  it('clamps zoom and still anchors when the effective scale is floored', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
    const limited = zoomTowardPointer(800, 600, { zoom: 3.8, panX: 10, panY: -6 }, 40, 50, 12)
    expect(limited.zoom).toBe(MAX_ZOOM)
    const again = zoomTowardPointer(800, 600, limited, 40, 50, 40)
    expect(again.zoom).toBe(MAX_ZOOM)
    expect(again.panX).toBeCloseTo(limited.panX, 8)
    expect(again.panY).toBeCloseTo(limited.panY, 8)
    const floored = expectAnchored(200, 200, { zoom: 0.25, panX: 12, panY: -8 }, { x: 20, y: 180 }, [0.3, 0.4, 1.2])
    expect(getStageMetrics(200, 200, { zoom: 0.25, panX: 0, panY: 0 }).viewScale).toBe(0.05)
    expect(floored.zoom).toBe(1.2)
  })

  it('normalizes wheel deltaMode into the same proportional zoom', () => {
    const viewport = { zoom: 1, panX: 18, panY: -9 }
    const pixel = viewportAfterWheel(800, 600, viewport, 90, 40, 100, 0)
    const line = viewportAfterWheel(800, 600, viewport, 90, 40, 100 / 16, 1)
    const page = viewportAfterWheel(800, 600, viewport, 90, 40, 100 / 600, 2)
    expect(pixel.zoom).toBeCloseTo(clampZoom(Math.exp(-100 * WHEEL_ZOOM_PIXEL_FACTOR)))
    expect(line.zoom).toBeCloseTo(pixel.zoom, 8)
    expect(page.zoom).toBeCloseTo(pixel.zoom, 8)
    expect(pixel.panX).toBeCloseTo(line.panX, 8)
    expect(pixel.panY).toBeCloseTo(page.panY, 8)
    const inward = viewportAfterWheel(800, 600, viewport, 90, 40, -80, 0)
    expect(inward.zoom).toBeGreaterThan(viewport.zoom)
    const capped = viewportAfterWheel(800, 600, { zoom: 4, panX: 0, panY: 0 }, 400, 300, -800, 0)
    expect(capped.zoom).toBe(MAX_ZOOM)
  })
})
