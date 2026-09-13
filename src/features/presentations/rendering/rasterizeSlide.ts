/**
 * Fixed-page slide rasterizer (P36), shared by library previews and PDF export.
 *
 * It draws the same `renderSlide` group the editor canvas uses on a detached
 * stage, so every consumer gets the same page aspect, slide order, background
 * and element transforms. The stage is never attached to the document, so no
 * viewport transform, selection frame, guide or handle can appear in the output.
 *
 * Konva is imported dynamically: the library and the export path only pay for it
 * when a raster is actually requested.
 */

import type { PresentationDocument, Slide } from '../model/types'
import type { PresentationImageSources } from './renderSlide'

export type SlideRaster = {
  bytes: Uint8Array
  /** The same bytes as a PNG data URL, for the preview cache. */
  dataUrl: string
  width: number
  height: number
}

export type RasterizeSlideInput = {
  slide: Slide
  pageSize: PresentationDocument['pageSize']
  images: PresentationImageSources
  width: number
  height: number
  /** Canvas pixels per CSS pixel; 1 gives a width×height PNG. */
  pixelRatio?: number
}

export async function rasterizeSlidePage(input: RasterizeSlideInput): Promise<SlideRaster> {
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error('A slide raster needs positive dimensions')
  }
  const [{ Konva }, { renderSlide }] = await Promise.all([
    import('./konvaText'),
    import('./renderSlide'),
  ])

  // The page group is in document units, so the scale belongs on the Stage — the
  // same place the editor puts view zoom.
  const scale = input.width / input.pageSize.width
  const stage = new Konva.Stage({
    container: window.document.createElement('div'),
    width: input.width,
    height: input.height,
    scaleX: scale,
    scaleY: scale,
  })
  try {
    const layer = new Konva.Layer()
    stage.add(layer)
    layer.add(renderSlide({ slide: input.slide, pageSize: input.pageSize, images: input.images }))
    layer.draw()
    const dataUrl = stage.toDataURL({ pixelRatio: input.pixelRatio ?? 1 })
    return { bytes: dataUrlBytes(dataUrl), dataUrl, width: input.width, height: input.height }
  } finally {
    // Releases the stage's canvases; the container div was never attached to the document.
    stage.destroy()
  }
}

/** Decodes the base64 payload of a PNG data URL into the bytes a PDF/ZIP embeds. */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) throw new Error('Not a data URL')
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
