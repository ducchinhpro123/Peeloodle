import { describe, expect, it } from 'vitest'
import type { CropRect, ImageLayer } from '../../types/domain'
import {
  getBrushRadiiInImage,
  getStageMetrics,
  imageLocalToScreen,
  screenToImageLocal,
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
    const m = getStageMetrics(800, 600, { zoom: 1.5, panX: 40, panY: -20 })
    expect(m.viewScale).toBeGreaterThan(0)
    expect(m.stageX).toBeDefined()
    expect(m.stageY).toBeDefined()
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
