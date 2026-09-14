/**
 * P44/P45 proof spec — reader fixture files, measured large-document bounds, and
 * network-disabled local work.
 *
 * Every file it writes goes through the production export path (Export dialog →
 * `usePresentationExport` → the real builder), so the artifacts a reader app opens
 * are the same bytes a student downloads.
 *
 * - P44 writes `proofs/out/p44-reader-fixture.{pptx,pdf}` plus the document facts the
 *   LibreOffice UNO script asserts against (`proofs/out/p44-reader-facts.json`). The
 *   reader round trip itself runs outside the browser:
 *   `python3 proofs/readers/libreoffice_roundtrip.py`. This spec proves only that the
 *   fixture files exist and are well formed; it does not prove reader compatibility.
 * - P45 measures two separate axes and never claims more than it measured: a deck at
 *   three aggregate ceilings (50 slides / 2 000 elements / 200 assets), whose per-slide
 *   element count and document size are well under their own limits, and a byte-scale
 *   probe (8 asset images totalling 18.85 MB, 9.0% of the 200 MiB media budget). The
 *   media budget is deliberately *not* reached by either; see the proof document.
 * - P45's offline test distinguishes a warmed builder (already imported this session)
 *   from a cold one, and fully offline from external-origin-blocked. The app-shell
 *   limitation — a route chunk that was never loaded cannot be fetched offline — is
 *   recorded rather than fixed here.
 *
 * Large generated files stay in the OS temp directory (`/tmp/stickerlab-p45`) because
 * `proofs/out` holds only small committed artifacts; the reports record their paths,
 * sizes and hashes.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'
import { elementRectInCanvas, paintedPixelsInRect, readDocument, settleDevServer } from './presentations'

const OUT = join(process.cwd(), 'proofs', 'out')
const LARGE = join(tmpdir(), 'stickerlab-p45')

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path()
  if (!path) throw new Error('the download produced no file')
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}

/**
 * Opens the export dialog, exports one format through the real controller and
 * returns the downloaded bytes. `waitMs` covers the raster/package time of large
 * decks; the default Playwright wait would time out long before that.
 */
async function exportViaDialog(page: Page, format: 'PDF' | 'PPTX', waitMs = 60_000): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export presentation' })
  await expect(dialog).toBeVisible()
  const pending = page.waitForEvent('download', { timeout: waitMs })
  pending.catch(() => null)
  await dialog.getByRole('button', { name: `Export ${format}` }).click()
  const outcome = await Promise.race([
    pending.then((download) => ({ failed: false as const, download })),
    dialog
      .getByRole('alert')
      .waitFor({ timeout: waitMs })
      .then(async () => ({ failed: true as const, message: (await dialog.getByRole('alert').allInnerTexts()).join(' ').trim() })),
  ])
  if (outcome.failed) throw new Error(`the ${format} export reported a failure instead of a download: ${outcome.message}`)
  const bytes = await readDownload(outcome.download)
  await expect(dialog.getByRole('status')).toContainText('Export ready')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  return bytes
}

/**
 * Records every `[role="status"]` text the export dialog shows, so the progress
 * samples prove the slides were packaged in document order, one at a time.
 */
async function startStatusRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      __p45Status?: { values: string[]; joined: string }
      __p45Observer?: MutationObserver
    }
    target.__p45Observer?.disconnect()
    target.__p45Status = { values: [], joined: '' }
    const record = () => {
      const values = Array.from(document.querySelectorAll('[role="status"]'))
        .map((node) => (node.textContent ?? '').trim())
        .filter(Boolean)
      const joined = values.join(' | ')
      const seen = target.__p45Status!
      if (joined === seen.joined) return
      seen.joined = joined
      // One entry per status element: the export dialog and the editor's own save
      // status are separate elements, so a joined string would hide both.
      for (const value of values) seen.values.push(value)
    }
    record()
    target.__p45Observer = new MutationObserver(record)
    target.__p45Observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  })
}

async function readStatusRecording(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __p45Status?: { values: string[] } }).__p45Status?.values ?? [])
}

/**
 * Real page count and page size, read from the PDF structure. A regular expression
 * over the raw bytes cannot work: pdf-lib writes compressed object streams, so
 * `/Type /Page` never appears in the file text.
 */
async function readPdfFacts(bytes: Buffer): Promise<{ pages: number; pageSizePt: { width: number; height: number } }> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.load(new Uint8Array(bytes))
  const { width, height } = pdf.getPage(0).getSize()
  return { pages: pdf.getPageCount(), pageSizePt: { width, height } }
}

function slideEntryNames(entries: string[]): string[] {
  return entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
}

/** Media files only: a zip listing also contains directory entries. */
function mediaEntryNames(entries: string[]): string[] {
  return entries.filter((name) => /^ppt\/media\/[^/]+$/.test(name))
}

/**
 * Export progress as the dialog reported it: the samples the PDF path emits, how
 * far they got, and whether they only ever moved forward.
 */
function progressSummary(statuses: string[], total: number) {
  const parsed = statuses
    .filter((value) => value.startsWith('Rendering slides…'))
    .map((value) => /(\d+)\/(\d+)/.exec(value))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ done: Number(match[1]), total: Number(match[2]) }))
  return {
    samples: parsed.length,
    first: parsed[0] ?? null,
    last: parsed[parsed.length - 1] ?? null,
    monotonic: parsed.every((entry, index) => index === 0 || entry.done >= parsed[index - 1]!.done),
    reachedEverySlide: parsed.length > 0 && parsed[parsed.length - 1]!.done === total && parsed[parsed.length - 1]!.total === total,
  }
}

test('P44: the export dialog writes the reader fixture PPTX and PDF', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await settleDevServer(page)

  // The P02 fixture plus the two element cases P39 left unverified in a reader: a
  // cropped, flipped and rotated picture, and a rotated text box.
  const facts = await page.evaluate(async () => {
    const fixture = await import('/src/features/presentations/model/fixtures/fixture.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const pptx = await import('/src/features/presentations/exports/pptx.ts')
    const documentModel = fixture.createFixturePresentation()

    const slide = documentModel.slides[0]!
    const image = slide.elements.find((element) => element.kind === 'image')
    if (!image || image.kind !== 'image') throw new Error('the fixture has no image element')
    image.crop = { x: 0.1, y: 0.12, width: 0.7, height: 0.62 }
    image.flipX = true
    image.rotation = 12

    slide.elements.push({
      id: 'p44-text-rotated',
      kind: 'text',
      name: 'Rotated note',
      x: 620,
      y: 560,
      width: 420,
      height: 120,
      rotation: 350,
      opacity: 1,
      visible: true,
      locked: false,
      padding: 10,
      lineHeight: 1.25,
      verticalAlign: 'top',
      paragraphs: [
        {
          alignment: 'left',
          bullet: 'none',
          bulletLevel: 0,
          runs: [{ text: 'Xoay văn bản 350 độ', fontId: 'be-vietnam-pro', size: 28, color: '#ffe7a3' }],
        },
      ],
    })

    await persistence.createIdbPresentationRepository().savePresentation(documentModel, [
      { assetId: fixture.FIXTURE_IMAGE_ASSET_ID, bytes: fixture.fixtureImagePng(), mimeType: 'image/png' },
    ])

    const frame = pptx.pptxFrame(image)
    const sizing = pptx.imageCropSizing(image)
    // 1/96-inch document units; LibreOffice reports positions in 1/100 mm.
    const hundredthsMm = (inches: number) => Math.round(inches * 2540)
    return {
      id: documentModel.id,
      title: documentModel.title,
      slideCount: documentModel.slides.length,
      slideBackgrounds: documentModel.slides.map((candidate) => candidate.background),
      expectedText: {
        slide1: ['Nghiên cứu và trình bày', 'Building a ', 'sticker', ' presentation', 'Xoay văn bản 350 độ'],
        slide2: ['Tóm tắt kết quả: ', 'ấn tượng, rõ ràng và dễ đọc.', 'Xem hướng dẫn', ' trước khi nộp bài.', 'Kết luận và đề xuất.'],
      },
      linkUrl: 'https://example.edu/guide',
      image: {
        name: image.name,
        rotation: image.rotation,
        crop: image.crop,
        flipX: image.flipX,
        flipY: image.flipY,
        // The document element box, in document units, and the source artwork size in px.
        element: { x: image.x, y: image.y, width: image.width, height: image.height },
        sourcePixels: 256,
        rotationHundredthsDeg: Math.round(image.rotation * 100),
        frameHundredthsMm: {
          x: hundredthsMm(frame.x),
          y: hundredthsMm(frame.y),
          w: hundredthsMm(frame.w),
          h: hundredthsMm(frame.h),
        },
        cropBoxHundredthsMm: {
          x: hundredthsMm(sizing.sizing.x),
          y: hundredthsMm(sizing.sizing.y),
          w: hundredthsMm(sizing.sizing.w),
          h: hundredthsMm(sizing.sizing.h),
        },
      },
      rotatedTextRotationHundredthsDeg: 35000,
      pageSizeHundredthsMm: { width: 33867, height: 19050 },
      pageSizePt: { width: 960, height: 540 },
    }
  })

  await page.goto(`/presentations/${facts.id}`)
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  const pptxBytes = await exportViaDialog(page, 'PPTX')
  const pdfBytes = await exportViaDialog(page, 'PDF')

  expect(pptxBytes.subarray(0, 2).toString('latin1')).toBe('PK')
  expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  const pdfFacts = await readPdfFacts(pdfBytes)
  expect(pdfFacts.pages).toBe(2)
  expect(pdfFacts.pageSizePt).toEqual({ width: 960, height: 540 })

  await writeFile(join(OUT, 'p44-reader-fixture.pptx'), pptxBytes)
  await writeFile(join(OUT, 'p44-reader-fixture.pdf'), pdfBytes)
  await writeFile(
    join(OUT, 'p44-reader-facts.json'),
    `${JSON.stringify(
      {
        ...facts,
        exportedAt: new Date().toISOString(),
        exportPath: 'Export dialog → usePresentationExport → exports/pptx.ts | exports/pdf.ts',
        files: { pptx: 'proofs/out/p44-reader-fixture.pptx', pptxBytes: pptxBytes.length, pdf: 'proofs/out/p44-reader-fixture.pdf', pdfBytes: pdfBytes.length },
        pdfPages: pdfFacts.pages,
        pdfPageSizePt: pdfFacts.pageSizePt,
        notProvenHere: 'Reader open/edit/save/reopen behaviour is P44 evidence produced by proofs/readers/libreoffice_roundtrip.py, not by this spec.',
      },
      null,
      2,
    )}\n`,
  )
})

test('P45: a deck at the slide, element and asset aggregate ceilings exports in measured bounds', async ({ page }) => {
  test.setTimeout(900_000)
  await mkdir(LARGE, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await settleDevServer(page)

  const seeded = await page.evaluate(async () => {
    const factories = await import('/src/features/presentations/model/factories.ts')
    const png = await import('/src/features/presentations/model/fixtures/png.ts')
    const hashing = await import('/src/lib/hash.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')

    // 50 slides, 2 000 elements and 200 assets are exactly the three aggregate limits.
    // The per-slide element limit (40 of 200) and the document-size limit (~579 KB of
    // 8 MiB) are not reached, and the artwork bytes are ~7 MB of the 200 MiB budget.
    const slideCount = 50
    const elementsPerSlide = 40
    const assetCount = 200
    const imageEdge = 96

    const documentModel = factories.createPresentationDocument({ title: 'P45 aggregate ceilings deck' })
    documentModel.slides = []

    const media: { assetId: string; bytes: Uint8Array; mimeType: 'image/png' }[] = []
    const assets = []
    for (let index = 0; index < assetCount; index += 1) {
      const hue = index / assetCount
      // Deterministic distinct artwork per asset: a solid rounded square on a
      // transparent background, written by the same encoder the fixtures use.
      const bytes = png.encodeRgbaPng(imageEdge, imageEdge, (x, y) => {
        const inside = Math.abs(x - imageEdge / 2) + Math.abs(y - imageEdge / 2) < imageEdge * 0.45
        if (!inside) return [255, 255, 255, 0]
        const channel = (offset: number) => Math.round(255 * Math.abs(((hue * 6 + offset) % 2) - 1))
        return [channel(0), channel(2), channel(4), 255]
      })
      const id = `p45-asset-${index}`
      assets.push({
        id,
        blobKey: `p45/structural/${index}.png`,
        mimeType: 'image/png' as const,
        width: imageEdge,
        height: imageEdge,
        sha256: await hashing.sha256Hex(bytes),
        byteLength: bytes.length,
        provenance: { source: 'upload' as const, label: `P45 structural artwork ${index}` },
      })
      media.push({ assetId: id, bytes, mimeType: 'image/png' })
    }
    documentModel.assets = assets

    for (let slideIndex = 0; slideIndex < slideCount; slideIndex += 1) {
      const slide = factories.createSlide({
        id: `p45-slide-${slideIndex}`,
        name: `Slide ${slideIndex + 1}`,
        background: slideIndex % 2 === 0 ? '#ffffff' : '#f6fbf8',
      })
      for (let index = 0; index < elementsPerSlide; index += 1) {
        // 5 rows × 8 columns of 160×144 cells inside the 1280×720 page.
        const cell = {
          x: (index % 8) * 160 + 8,
          y: Math.floor(index / 8) * 144 + 8,
          width: 144,
          height: 128,
        }
        const slot = index % 10
        if (slot === 0) {
          // Four image elements per slide, each a different asset: 200 in total.
          slide.elements.push(
            factories.createImageElement({
              id: `p45-image-${slideIndex}-${index}`,
              name: `Figure ${index}`,
              assetId: assets[slideIndex * 4 + index / 10]!.id,
              ...cell,
              alt: 'P45 structural artwork',
            }),
          )
        } else if (slot === 1 || slot === 2) {
          slide.elements.push(
            factories.createTextElement({
              id: `p45-text-${slideIndex}-${index}`,
              name: `Caption ${index}`,
              ...cell,
              text: `Ô ${index} · trang ${slideIndex + 1}`,
              fontId: 'be-vietnam-pro',
              size: 16,
              color: '#08152f',
            }),
          )
        } else {
          slide.elements.push(
            factories.createShapeElement({
              id: `p45-shape-${slideIndex}-${index}`,
              name: `Shape ${index}`,
              shape: slot % 3 === 0 ? 'ellipse' : 'rounded-rectangle',
              ...cell,
              fill: slot % 2 === 0 ? '#e6f7ef' : '#ffd166',
              stroke: '#08b879',
              strokeWidth: 2,
            }),
          )
        }
      }
      documentModel.slides.push(slide)
    }

    const mediaBytes = media.reduce((total, record) => total + record.bytes.length, 0)
    const saveStarted = performance.now()
    await persistence.createIdbPresentationRepository().savePresentation(documentModel, media)
    const saveMs = Math.round(performance.now() - saveStarted)

    const elementCount = documentModel.slides.reduce((total, slide) => total + slide.elements.length, 0)
    const kindCounts = { text: 0, image: 0, shape: 0 }
    for (const slide of documentModel.slides) for (const element of slide.elements) kindCounts[element.kind] += 1
    return {
      id: documentModel.id,
      title: documentModel.title,
      slideCount: documentModel.slides.length,
      elementCount,
      assetCount: documentModel.assets.length,
      kindCounts,
      mediaBytes,
      documentChars: JSON.stringify(documentModel).length,
      saveMs,
    }
  })

  expect(seeded.slideCount).toBe(50)
  expect(seeded.elementCount).toBe(2000)
  expect(seeded.assetCount).toBe(200)

  const editorOpened = Date.now()
  await page.goto(`/presentations/${seeded.id}`)
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  const openMs = Date.now() - editorOpened

  await startStatusRecording(page)
  const pdfStarted = Date.now()
  const pdfBytes = await exportViaDialog(page, 'PDF', 600_000)
  const pdfMs = Date.now() - pdfStarted
  const pdfStatuses = await readStatusRecording(page)

  await startStatusRecording(page)
  const pptxStarted = Date.now()
  const pptxBytes = await exportViaDialog(page, 'PPTX', 600_000)
  const pptxMs = Date.now() - pptxStarted
  const pptxStatuses = await readStatusRecording(page)

  const pdfFacts = await readPdfFacts(pdfBytes)
  expect(pdfFacts.pages).toBe(50)
  expect(pdfFacts.pageSizePt).toEqual({ width: 960, height: 540 })
  expect(pptxBytes.subarray(0, 2).toString('latin1')).toBe('PK')

  const { unzipSync } = await import('fflate')
  const entries = Object.keys(unzipSync(new Uint8Array(pptxBytes)))
  const slides = slideEntryNames(entries)
  const media = mediaEntryNames(entries)
  expect(slides).toHaveLength(50)
  // Each of the 200 distinct assets is embedded once and referenced by picture shapes.
  expect(media).toHaveLength(200)

  const pdfPath = join(LARGE, 'structural-max.pdf')
  const pptxPath = join(LARGE, 'structural-max.pptx')
  await writeFile(pdfPath, pdfBytes)
  await writeFile(pptxPath, pptxBytes)

  const report = {
    generatedAt: new Date().toISOString(),
    fixture: {
      ...seeded,
      limits: { maxSlides: 50, maxElements: 2000, maxAssets: 200, maxElementsPerSlide: 200, maxMediaBytes: 200 * 1024 * 1024, maxDocumentChars: 8 * 1024 * 1024 },
      coverage: 'Three aggregate ceilings are reached: 50 slides, 2 000 elements and 200 assets. The per-slide element ceiling (40/200), the document-size ceiling and the 200 MiB media budget are not; the measured numbers above record how far each fixture got.',
    },
    bounds: {
      editorOpenMs: openMs,
      pdfMs,
      pdfBytes: pdfBytes.length,
      pdfPages: pdfFacts.pages,
      pdfPageSizePt: pdfFacts.pageSizePt,
      pdfMsPerSlide: Math.round(pdfMs / seeded.slideCount),
      pptxMs,
      pptxBytes: pptxBytes.length,
      pptxMsPerSlide: Math.round(pptxMs / seeded.slideCount),
      pptxEntries: { total: entries.length, slides: slides.length, media: media.length },
      largeFiles: { pdf: pdfPath, pptx: pptxPath },
    },
    progress: {
      pdf: progressSummary(pdfStatuses, 50),
      pptx: progressSummary(pptxStatuses, 50),
      note: 'The PDF path rasterizes and reports one page at a time, so its samples reach 50/50 in order. PptxGenJS builds the whole package in one pass, so the PPTX path announces rendering and then completes; its slide and media counts are asserted from the package instead.',
    },
    environment: {
      browser: 'chromium (Playwright launchOptions.executablePath=/usr/bin/chromium)',
      viewport: '1440×900',
      note: 'JS heap sampling was dropped on purpose: without --enable-precise-memory-info Chromium quantizes performance.memory, so a heap number here would not be evidence.',
    },
  }
  await writeFile(join(OUT, 'p45-structural-max-report.json'), `${JSON.stringify(report, null, 2)}\n`)

  // Regression guards only; the recorded numbers are the evidence.
  expect(report.progress.pdf.reachedEverySlide).toBe(true)
  expect(report.progress.pdf.monotonic).toBe(true)
  expect(report.progress.pdf.samples).toBeGreaterThanOrEqual(50)
  expect(pdfBytes.length).toBeLessThan(200_000_000)
})

test('P45: a byte-heavy deck (8 × ~3 MB artwork) exports in measured bounds', async ({ page }) => {
  test.setTimeout(900_000)
  await mkdir(LARGE, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await settleDevServer(page)

  const seeded = await page.evaluate(async () => {
    const factories = await import('/src/features/presentations/model/factories.ts')
    const hashing = await import('/src/lib/hash.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')

    const edge = 1024
    const count = 8
    // Incompressible artwork: random RGBA bytes written as PNG. This is a byte-scale
    // probe for a small number of large images, not a representative photograph set
    // and not an upper bound for PNG/JPEG/WebP decode and rasterization.
    const noisePng = async (seed: number): Promise<Uint8Array> => {
      const canvas = document.createElement('canvas')
      canvas.width = edge
      canvas.height = edge
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no 2d context')
      const image = context.createImageData(edge, edge)
      let state = (seed * 2654435761 + 1) >>> 0
      for (let index = 0; index < image.data.length; index += 4) {
        state = (state * 1664525 + 1013904223) >>> 0
        image.data[index] = state & 0xff
        image.data[index + 1] = (state >>> 8) & 0xff
        image.data[index + 2] = (state >>> 16) & 0xff
        image.data[index + 3] = 255
      }
      context.putImageData(image, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('toBlob produced nothing'))), 'image/png')
      })
      return new Uint8Array(await blob.arrayBuffer())
    }

    const documentModel = factories.createPresentationDocument({ title: 'P45 byte-heavy deck' })
    documentModel.slides = []
    const media: { assetId: string; bytes: Uint8Array; mimeType: 'image/png' }[] = []
    const assets = []
    for (let index = 0; index < count; index += 1) {
      const bytes = await noisePng(index + 1)
      const id = `p45-bytes-asset-${index}`
      assets.push({
        id,
        blobKey: `p45/bytes/${index}.png`,
        mimeType: 'image/png' as const,
        width: edge,
        height: edge,
        sha256: await hashing.sha256Hex(bytes),
        byteLength: bytes.length,
        provenance: { source: 'upload' as const, label: `P45 byte-heavy artwork ${index}` },
      })
      media.push({ assetId: id, bytes, mimeType: 'image/png' })
    }
    documentModel.assets = assets

    for (let index = 0; index < count; index += 1) {
      const slide = factories.createSlide({ id: `p45-bytes-slide-${index}`, name: `Photo ${index + 1}`, background: '#ffffff' })
      slide.elements.push(
        factories.createImageElement({
          id: `p45-bytes-image-${index}`,
          name: `Photo ${index + 1}`,
          assetId: assets[index]!.id,
          x: 200,
          y: 120,
          width: 880,
          height: 480,
          alt: 'P45 byte-heavy artwork',
        }),
        factories.createTextElement({
          id: `p45-bytes-caption-${index}`,
          name: 'Caption',
          x: 200,
          y: 616,
          width: 880,
          height: 72,
          text: `Ảnh minh họa ${index + 1}: dữ liệu thực địa`,
          fontId: 'be-vietnam-pro',
          size: 24,
          color: '#08152f',
        }),
      )
      documentModel.slides.push(slide)
    }

    const mediaBytes = media.reduce((total, record) => total + record.bytes.length, 0)
    const saveStarted = performance.now()
    await persistence.createIdbPresentationRepository().savePresentation(documentModel, media)
    const saveMs = Math.round(performance.now() - saveStarted)
    return {
      id: documentModel.id,
      title: documentModel.title,
      slideCount: documentModel.slides.length,
      elementCount: count * 2,
      assetCount: documentModel.assets.length,
      mediaBytes,
      meanAssetBytes: Math.round(mediaBytes / count),
      saveMs,
    }
  })

  await page.goto(`/presentations/${seeded.id}`)
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  await startStatusRecording(page)
  const pdfStarted = Date.now()
  const pdfBytes = await exportViaDialog(page, 'PDF', 300_000)
  const pdfMs = Date.now() - pdfStarted
  const pdfStatuses = await readStatusRecording(page)

  await startStatusRecording(page)
  const pptxStarted = Date.now()
  const pptxBytes = await exportViaDialog(page, 'PPTX', 300_000)
  const pptxMs = Date.now() - pptxStarted
  const pptxStatuses = await readStatusRecording(page)

  const mediaPdfPages = (await readPdfFacts(pdfBytes)).pages
  expect(mediaPdfPages).toBe(8)
  const { unzipSync } = await import('fflate')
  const entries = Object.keys(unzipSync(new Uint8Array(pptxBytes)))
  expect(slideEntryNames(entries)).toHaveLength(8)
  expect(mediaEntryNames(entries)).toHaveLength(8)

  const pdfPath = join(LARGE, 'byte-heavy.pdf')
  const pptxPath = join(LARGE, 'byte-heavy.pptx')
  await writeFile(pdfPath, pdfBytes)
  await writeFile(pptxPath, pptxBytes)

  const report = {
    generatedAt: new Date().toISOString(),
    fixture: {
      ...seeded,
      coverage: `Bytes per asset, not element count: 8 distinct 1024×1024 incompressible PNGs totalling ${seeded.mediaBytes} bytes, ${((seeded.mediaBytes / (200 * 1024 * 1024)) * 100).toFixed(1)}% of the 200 MiB media budget, so the budget itself remains unmeasured.`,
      mediaBudgetPct: Number(((seeded.mediaBytes / (200 * 1024 * 1024)) * 100).toFixed(1)),
    },
    bounds: {
      pdfMs,
      pdfBytes: pdfBytes.length,
      pdfPages: mediaPdfPages,
      pptxMs,
      pptxBytes: pptxBytes.length,
      pptxMediaBytesStored: seeded.mediaBytes,
      pptxToMediaRatio: Number((pptxBytes.length / seeded.mediaBytes).toFixed(2)),
      largeFiles: { pdf: pdfPath, pptx: pptxPath },
    },
    progress: { pdf: progressSummary(pdfStatuses, 8), pptx: progressSummary(pptxStatuses, 8) },
  }
  await writeFile(join(OUT, 'p45-media-scale-report.json'), `${JSON.stringify(report, null, 2)}\n`)
})

test('P45: editing, saving, reopening and exporting keep working with the network disabled', async ({ page, context }) => {
  test.setTimeout(420_000)
  // A Vite re-optimization reload would drop every module the page had already
  // loaded, which is exactly the premise this test needs, so record it if it happens.
  const viteConsole: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/vite|reload|optimiz/i.test(text)) viteConsole.push(text)
  })
  const externalRequests: string[] = []
  const offlineRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') externalRequests.push(request.url())
  })
  const downloadNames: string[] = []
  page.on('download', (download) => downloadNames.push(download.suggestedFilename()))

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await settleDevServer(page)

  const id = await page.evaluate(async () => {
    const fixture = await import('/src/features/presentations/model/fixtures/fixture.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const documentModel = fixture.createFixturePresentation()
    await persistence.createIdbPresentationRepository().savePresentation(documentModel, [
      { assetId: fixture.FIXTURE_IMAGE_ASSET_ID, bytes: fixture.fixtureImagePng(), mimeType: 'image/png' },
    ])
    return documentModel.id
  })

  // Warm what "already-loaded local work" means. The export builder comes first: the
  // first lazy import of a dependency Vite has not pre-bundled reloads the page and
  // would drop the routes fetched before it.
  await page.goto(`/presentations/${id}`)
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  const pptxWarmUp = await exportViaDialog(page, 'PPTX')
  expect(pptxWarmUp.subarray(0, 2).toString('latin1')).toBe('PK')
  const downloadsAfterWarmUp = downloadNames.length

  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page.getByRole('link', { name: /^Open / }).first()).toBeVisible()
  await page.getByRole('link', { name: /^Open / }).first().click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  // Everything below runs with the browser's network stack disabled.
  await context.setOffline(true)
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.protocol === 'http:' || url.protocol === 'https:') offlineRequests.push(url.pathname)
  })

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.getByRole('textbox', { name: 'Text content' }).fill('Chỉnh sửa ngoại tuyến')
  await page.keyboard.press('Escape')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 15_000 })

  const imageBox = { x: 880, y: 400, width: 256, height: 256 }
  // Control measurement: the still-open editor, whose bitmap was decoded while the
  // network was available. The reopened measurement below is the IndexedDB claim.
  const warmImageRect = await elementRectInCanvas(page, imageBox)
  const paintedWarmOnline = await paintedPixelsInRect(page, warmImageRect)

  // A warmed builder must still package and download offline.
  const pptxOffline = await exportViaDialog(page, 'PPTX', 60_000)
  expect(pptxOffline.subarray(0, 2).toString('latin1')).toBe('PK')
  const { unzipSync } = await import('fflate')
  const offlineSlideEntries = slideEntryNames(Object.keys(unzipSync(new Uint8Array(pptxOffline))))

  // A cold builder cannot be fetched offline: record the outcome and prove no file
  // was produced, rather than assuming either behaviour.
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export presentation' })
  await expect(dialog).toBeVisible()
  const downloadsBeforeColdPdf = downloadNames.length
  await dialog.getByRole('button', { name: 'Export PDF' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30_000 })
  const coldPdfMessage = (await dialog.getByRole('alert').allInnerTexts()).join(' ').trim()
  const coldPdfDownloaded = downloadNames.length > downloadsBeforeColdPdf
  await page.keyboard.press('Escape')
  const downloadsDuringOffline = downloadNames.slice(1)

  // Client-side navigation inside already-loaded routes, then reopen from IndexedDB.
  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page).toHaveURL(/\/presentations$/)
  await page.getByRole('link', { name: /^Open / }).first().click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 15_000 })
  const reopened = await readDocument(page)

  // Measure the reopened canvas while still offline: the artwork can only be painted
  // there if it was rehydrated from IndexedDB, not from a still-decoded bitmap.
  const reopenedImageRect = await elementRectInCanvas(page, imageBox)
  let paintedAfterReopen = 0
  await expect
    .poll(async () => {
      paintedAfterReopen = await paintedPixelsInRect(page, reopenedImageRect)
      return paintedAfterReopen
    }, { timeout: 15_000, message: 'the reopened editor should repaint artwork from IndexedDB' })
    .toBeGreaterThan(1_000)

  // Reconnect. The warmed builder keeps working; the format whose module fetch
  // failed stays poisoned for this page (browsers cache a failed module import),
  // so reopen the presentation — a fresh page load — and export it there.
  await context.setOffline(false)
  const pptxAfterReconnect = await exportViaDialog(page, 'PPTX', 60_000)
  expect(pptxAfterReconnect.subarray(0, 2).toString('latin1')).toBe('PK')
  let pdfRetryInSamePage: string
  try {
    const retry = await exportViaDialog(page, 'PDF', 30_000)
    pdfRetryInSamePage = `downloaded ${retry.length} bytes`
  } catch (error) {
    pdfRetryInSamePage = `refused: ${error instanceof Error ? error.message : String(error)}`
  }

  await page.goto(`/presentations/${id}`)
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  const pdfAfterReopen = await exportViaDialog(page, 'PDF', 60_000)
  expect(pdfAfterReopen.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect((await readPdfFacts(pdfAfterReopen)).pages).toBe(2)

  const evidence = {
    generatedAt: new Date().toISOString(),
    externalRequests,
    offline: {
      warmedRoutes: ['/', '/presentations', `/presentations/${id}`],
      warmedBuilders: ['pptxgenjs (pptx)'],
      typedAndAutosavedOffline: true,
      paintedImagePixelsWarmOnline: paintedWarmOnline,
      paintedImagePixelsAfterReopen: paintedAfterReopen,
      paintedPixelsNote: 'Warm-online control: the still-open editor, whose bitmap was decoded before the network was disabled. After-reopen: measured again in the reopened editor while still offline, so those pixels can only come from artwork rehydrated from IndexedDB.',
      pptxBytesOffline: pptxOffline.length,
      offlinePptxSlides: offlineSlideEntries.length,
      coldPdf: { downloaded: coldPdfDownloaded, message: coldPdfMessage },
      reopenedText: reopened?.text ?? '',
      reopenedTextHasEdit: (reopened?.text ?? '').includes('Chỉnh sửa ngoại tuyến'),
      requestsAttemptedOffline: offlineRequests,
      downloadsWhileOffline: downloadsDuringOffline,
    },
    afterReconnect: {
      warmedPptxBytes: pptxAfterReconnect.length,
      pdfRetryInSamePage,
      pdfAfterReopenBytes: pdfAfterReopen.length,
      note: 'A failed dynamic import stays failed for the life of the page, so the cold format only exports again after the page reloads. No service worker or app-shell cache exists, which is why the plan scopes offline to already-loaded work.',
    },
    warmupDownloads: downloadsAfterWarmUp,
    viteConsole,
    knownLimitations: [
      'A route chunk or export builder that was never loaded cannot be fetched while the network is disabled; the app-shell/offline-bootstrap case is explicitly out of scope for this release.',
      'This is a browser with the network disabled, not a browser reading a cached build from an installed service worker — none is implemented.',
    ],
  }
  await writeFile(join(OUT, 'p45-offline-report.json'), `${JSON.stringify(evidence, null, 2)}\n`)

  expect(externalRequests).toEqual([])
  expect(evidence.offline.reopenedTextHasEdit).toBe(true)
  expect(paintedWarmOnline).toBeGreaterThan(1_000)
  expect(paintedAfterReopen).toBeGreaterThan(1_000)
  expect(evidence.offline.offlinePptxSlides).toBe(2)
  expect(evidence.offline.coldPdf.downloaded).toBe(false)
})
