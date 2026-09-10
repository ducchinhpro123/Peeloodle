/**
 * PDF export: one fixed-visual raster page per slide.
 *
 * Documented limitation for this release: the PDF is image-based. Text
 * selection and PDF hyperlinks are not provided; PPTX is the editable path.
 * Slides are rasterized by the shared fixed-page renderer (P36) before this
 * module embeds them, so no editor controls or viewport transforms can leak in.
 */

import { PDFDocument } from 'pdf-lib'
import { pageSizeInPoints } from '../model/geometry'

export const PDF_RASTER_PAGE_WIDTH_PX = 1920
export const PDF_RASTER_PAGE_HEIGHT_PX = 1080

export type PresentationExportErrorCode = 'no_pages' | 'invalid_page' | 'pdf_failed'

export class PresentationExportError extends Error {
  readonly code: PresentationExportErrorCode

  constructor(code: PresentationExportErrorCode, message: string) {
    super(message)
    this.name = 'PresentationExportError'
    this.code = code
  }
}

/** Builds an ordered image-based PDF; page size is exactly 960×540 points. */
export async function buildRasterPdf(pngPages: Uint8Array[]): Promise<Uint8Array> {
  if (pngPages.length === 0) throw new PresentationExportError('no_pages', 'A PDF needs at least one slide')
  const pdf = await PDFDocument.create()
  const { width, height } = pageSizeInPoints()
  for (const [index, bytes] of pngPages.entries()) {
    if (bytes.length === 0) throw new PresentationExportError('invalid_page', `Slide ${index + 1} has no rendered image`)
    let image
    try {
      image = await pdf.embedPng(bytes)
    } catch {
      throw new PresentationExportError('invalid_page', `Slide ${index + 1} is not a valid PNG`)
    }
    const page = pdf.addPage([width, height])
    page.drawImage(image, { x: 0, y: 0, width, height })
  }
  pdf.setProducer('StickerLab')
  pdf.setCreator('StickerLab presentations')
  return pdf.save()
}
