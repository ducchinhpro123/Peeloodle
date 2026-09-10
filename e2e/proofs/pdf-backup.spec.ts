/**
 * P06 proof — raster PDF pages and a bounded ZIP backup built from the fixture.
 *
 * Renders both fixture slides through Konva at 1920×1080, builds the PDF with
 * the production `buildRasterPdf`, and writes a real backup archive with the
 * production writer. The Node side saves both files for inspection
 * (pdfinfo/pdftoppm/unzip).
 */

import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'proofs', 'out')

test('P06: fixture renders to a 2-page PDF and a verifiable backup', async ({ page }) => {
  await page.goto('/')
  // The Vite dev client performs one dep-optimizer reload shortly after first
  // load; wait it out so the evaluation below cannot be destroyed mid-run.
  await page.waitForLoadState('load')
  await page.waitForTimeout(900)
  const result = await page.evaluate(async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const layoutModule: any = await import('/src/features/presentations/rendering/textLayout.ts')
    const konvaModule: any = await import('/src/features/presentations/rendering/konvaText.ts')
    const fonts: any = await import('/src/features/presentations/rendering/fonts.ts')
    const fixture: any = await import('/src/features/presentations/model/fixtures/fixture.ts')
    const pdfModule: any = await import('/src/features/presentations/exports/pdf.ts')
    const backupModule: any = await import('/src/features/presentations/exports/backup.ts')
    const parseModule: any = await import('/src/features/presentations/model/parse.ts')
    const Konva = konvaModule.Konva

    await fonts.ensurePresentationFonts()
    const measureCtx = document.createElement('canvas').getContext('2d')!
    const measure = (text: string, spec: any) => {
      measureCtx.font = layoutModule.cssFontFor(spec)
      return measureCtx.measureText(text).width
    }

    const documentModel = fixture.createFixturePresentation()
    const scale = 1.5 // 1280×720 → 1920×1080

    // Load the transparent fixture image once.
    const pngBytes = fixture.fixtureImagePng()
    const imageUrl = URL.createObjectURL(new Blob([pngBytes], { type: 'image/png' }))
    const image = new Image()
    image.src = imageUrl
    await image.decode()

    async function renderSlide(slide: any): Promise<string> {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:0;top:-5000px;'
      document.body.appendChild(host)
      const stage = new Konva.Stage({ container: host, width: 1280 * scale, height: 720 * scale })
      const layer = new Konva.Layer()
      stage.add(layer)
      layer.add(new Konva.Rect({ x: 0, y: 0, width: 1280 * scale, height: 720 * scale, fill: slide.background, listening: false }))

      for (const element of slide.elements) {
        if (!element.visible) continue
        const base = {
          x: element.x * scale,
          y: element.y * scale,
          opacity: element.opacity,
          rotation: element.rotation,
          listening: false,
        }
        if (element.kind === 'shape') {
          if (element.shape === 'ellipse') {
            layer.add(new Konva.Ellipse({ ...base, x: (element.x + element.width / 2) * scale, y: (element.y + element.height / 2) * scale, radiusX: (element.width / 2) * scale, radiusY: (element.height / 2) * scale, fill: element.fill ?? undefined, stroke: element.stroke ?? undefined, strokeWidth: element.strokeWidth * scale }))
          } else if (element.shape === 'line' || element.shape === 'arrow') {
            layer.add(new Konva.Line({ ...base, points: [0, 0, element.width * scale, 0], stroke: element.stroke ?? '#000000', strokeWidth: Math.max(1, element.strokeWidth * scale) }))
          } else {
            layer.add(new Konva.Rect({ ...base, width: element.width * scale, height: element.height * scale, fill: element.fill ?? undefined, stroke: element.stroke ?? undefined, strokeWidth: element.strokeWidth * scale, cornerRadius: element.shape === 'rounded-rectangle' ? 24 * scale : 0 }))
          }
          continue
        }
        if (element.kind === 'image') {
          layer.add(
            new Konva.Image({
              ...base,
              width: element.width * scale,
              height: element.height * scale,
              image,
              crop: {
                x: element.crop.x * image.naturalWidth,
                y: element.crop.y * image.naturalHeight,
                width: element.crop.width * image.naturalWidth,
                height: element.crop.height * image.naturalHeight,
              },
              scaleX: (element.flipX ? -1 : 1) * scale,
              scaleY: (element.flipY ? -1 : 1) * scale,
            }),
          )
          continue
        }
        // Text
        const layout = layoutModule.layoutTextElement(element, measure)
        const textLayer = new Konva.Group({ opacity: element.opacity, x: (element.x + element.padding) * scale, y: (element.y + element.padding) * scale })
        for (const line of layout.lines) {
          if (line.bullet && line.firstInParagraph) {
            textLayer.add(
              new Konva.Text({
                x: line.bullet.x * scale,
                y: (line.y + (line.height - 18) / 2) * scale,
                text: line.bullet.marker,
                fontFamily: fonts.fontFamilyFor('be-vietnam-pro'),
                fontSize: 18 * scale,
                fill: '#08152f',
                listening: false,
              }),
            )
          }
          for (const run of line.runs) {
            textLayer.add(
              new Konva.Text({
                x: run.x * scale,
                y: (line.y + (line.height - run.run.size) / 2) * scale,
                text: run.text,
                fontFamily: fonts.fontFamilyFor(run.run.fontId),
                fontSize: run.run.size * scale,
                fontStyle: `${run.run.bold ? 'bold' : 'normal'} ${run.run.italic ? 'italic' : 'normal'}`,
                fill: run.run.color,
                lineHeight: 1,
                listening: false,
              }),
            )
          }
        }
        layer.add(textLayer)
      }
      layer.draw()
      const dataUrl: string = stage.toDataURL({ pixelRatio: 1 })
      stage.destroy()
      host.remove()
      return dataUrl
    }

    const pageDataUrls: string[] = []
    for (const slide of documentModel.slides) pageDataUrls.push(await renderSlide(slide))
    const pngPages = pageDataUrls.map((dataUrl) => {
      const binary = atob(dataUrl.split(',')[1]!)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return bytes
    })

    const pdfBytes = await pdfModule.buildRasterPdf(pngPages)
    const backupBytes = await backupModule.createBackupArchive(documentModel, new Map([['fixture-asset-transparent', pngBytes]]))
    const parsed = await backupModule.parseBackupArchive(backupBytes, { parseDocument: parseModule.parsePresentationDocument })

    const toBase64 = (bytes: Uint8Array) => {
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    }

    URL.revokeObjectURL(imageUrl)
    return {
      pdfBase64: toBase64(pdfBytes),
      backupBase64: toBase64(backupBytes),
      pdfBytes: pdfBytes.length,
      backupBytes: backupBytes.length,
      renderSizes: pngPages.map((bytes) => bytes.length),
      backupPaths: parsed.manifest.entries.map((entry: any) => entry.path),
      restoredSlideCount: parsed.document.slides.length,
      restoredMediaBytes: parsed.media.get('fixture-asset-transparent').length,
    }
  })

  expect(result.renderSizes).toHaveLength(2)
  expect(result.backupPaths).toEqual(['document.json', 'media/fixture-asset-transparent.png'])
  expect(result.restoredSlideCount).toBe(2)
  expect(result.restoredMediaBytes).toBeGreaterThan(1000)

  await writeFile(join(OUT, 'p06-fixture-render.pdf'), Buffer.from(result.pdfBase64, 'base64'))
  await writeFile(join(OUT, 'p06-backup.zip'), Buffer.from(result.backupBase64, 'base64'))
  await writeFile(
    join(OUT, 'p06-report.json'),
    `${JSON.stringify({ pdfBytes: result.pdfBytes, backupBytes: result.backupBytes, renderSizes: result.renderSizes, backupPaths: result.backupPaths, restoredSlideCount: result.restoredSlideCount }, null, 2)}\n`,
  )
})
