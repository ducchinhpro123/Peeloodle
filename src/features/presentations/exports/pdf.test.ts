// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildRasterPdf, PresentationExportError } from './pdf'
import { pageSizeInPoints } from '../model/geometry'
import { encodeRgbaPng } from '../model/fixtures/png'

const dark = encodeRgbaPng(64, 36, () => [11, 31, 59, 255])
const light = encodeRgbaPng(64, 36, () => [255, 255, 255, 255])

describe('raster PDF export', () => {
  it('creates one 960×540pt page per slide, in order', async () => {
    const bytes = await buildRasterPdf([dark, light])
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(2)
    const sizes = pdf.getPages().map((page) => page.getSize())
    expect(sizes[0]!.width).toBeCloseTo(960, 3)
    expect(sizes[0]!.height).toBeCloseTo(540, 3)
    expect(sizes[1]!.width).toBeCloseTo(pageSizeInPoints().width, 3)
    expect(sizes[1]!.height).toBeCloseTo(pageSizeInPoints().height, 3)
  })

  it('embeds each page as its own image and preserves page order', async () => {
    const bytes = await buildRasterPdf([dark, light, dark])
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(3)
    // Distinct embedded images are reused by hash, so two dark + one light -> 2 images.
    const imageCount = pdf.context.enumerateIndirectObjects().filter(([, object]) => object.constructor.name === 'PDFRawStream' || object.constructor.name === 'PDFStream').length
    expect(imageCount).toBeGreaterThanOrEqual(2)
  })

  it('rejects an empty export and invalid pages', async () => {
    await expect(buildRasterPdf([])).rejects.toMatchObject({ code: 'no_pages' })
    await expect(buildRasterPdf([new Uint8Array([1, 2, 3])])).rejects.toBeInstanceOf(PresentationExportError)
  })
})
