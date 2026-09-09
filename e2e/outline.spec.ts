import { expect, test, type Page } from '@playwright/test'
import { downloadPng, encodeRgbaPng, inspectPngBytes, openBlankEditor, waitForCanvasInk, waitForEditor } from './liveEditor'

const cutout = encodeRgbaPng(96, 96, (x, y) => {
  const body = x >= 20 && x < 76 && y >= 20 && y < 76
  const hole = x >= 42 && x < 54 && y >= 42 && y < 54
  const detail = x >= 8 && x < 14 && y >= 8 && y < 14
  return (body && !hole) || detail ? [220, 40, 70, 255] : [0, 0, 0, 0]
})

async function outlineState(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/features/editor/store.ts')
    const state = useEditorStore.getState()
    return {
      past: state.past.length,
      gestureActive: state.gestureActive,
      outlines: state.document?.layers.map((layer) => layer.kind === 'image' ? layer.outline : undefined),
    }
  })
}

test('selected-image outline is independent, undoable, and persists without losing disabled settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openBlankEditor(page)
  const input = page.getByTestId('photo-file-input')
  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: cutout })
  await input.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: cutout })
  await waitForCanvasInk(page)

  const inspector = page.locator('.editor > .inspector')
  const toggle = inspector.getByLabel('Toggle silhouette outline')
  const color = inspector.getByLabel('Outline color')
  const thickness = inspector.getByRole('slider', { name: 'Outline thickness' })
  await expect(toggle).not.toBeChecked()
  await expect(color).toHaveValue('#ffffff')
  await expect(color).toBeDisabled()
  await expect(thickness).toHaveAttribute('aria-valuenow', '12')
  await expect(thickness).toBeDisabled()
  await expect(inspector.getByText(/opaque photo outlines its rectangle/i)).toBeVisible()

  await toggle.check()
  await color.fill('#00ff00')
  const beforeGesture = await outlineState(page)
  const box = await thickness.boundingBox()
  if (!box) throw new Error('Outline thickness slider is missing')
  await page.mouse.move(box.x + box.width * 0.27, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2, { steps: 4 })
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()

  const changedWidth = Number(await thickness.getAttribute('aria-valuenow'))
  expect(changedWidth).toBeGreaterThan(12)
  const afterGesture = await outlineState(page)
  expect(afterGesture.past).toBe(beforeGesture.past + 1)
  expect(afterGesture.outlines[0]).toBeUndefined()
  expect(afterGesture.outlines[1]).toEqual({ enabled: true, color: '#00ff00', width: changedWidth })

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(thickness).toHaveAttribute('aria-valuenow', '12')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(thickness).toHaveAttribute('aria-valuenow', String(changedWidth))

  await toggle.uncheck()
  await expect(color).toBeDisabled()
  await expect(color).toHaveValue('#00ff00')
  await expect(thickness).toBeDisabled()
  await expect(thickness).toHaveAttribute('aria-valuenow', String(changedWidth))
  await toggle.check()

  await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await page.reload()
  await waitForEditor(page)
  const reopened = page.locator('.editor > .inspector')
  await expect(reopened.getByLabel('Toggle silhouette outline')).toBeChecked()
  await expect(reopened.getByLabel('Outline color')).toHaveValue('#00ff00')
  await expect(reopened.getByRole('slider', { name: 'Outline thickness' })).toHaveAttribute('aria-valuenow', String(changedWidth))
  expect((await outlineState(page)).outlines[0]).toBeUndefined()

  for (const size of [512, 1024] as const) {
    const png = await inspectPngBytes(page, await downloadPng(page, size))
    expect(Math.max(png.width, png.height)).toBe(size)
    expect(png.colorType).toBe(6)
    expect(png.greenCount).toBeGreaterThan(20)
    expect(png.transparentCount).toBeGreaterThan(10)
  }
})

test('closing mobile properties commits an in-progress thickness drag', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await openBlankEditor(page)
  await page.getByTestId('photo-file-input').setInputFiles({ name: 'cutout.png', mimeType: 'image/png', buffer: cutout })
  await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
  const properties = page.getByRole('dialog', { name: 'Sticker properties' })
  await properties.getByLabel('Toggle silhouette outline').check()
  const thickness = properties.getByRole('slider', { name: 'Outline thickness' })
  const box = await thickness.boundingBox()
  if (!box) throw new Error('Outline thickness slider is missing')
  await page.mouse.move(box.x + box.width * 0.27, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 4 })
  const changedWidth = Number(await thickness.getAttribute('aria-valuenow'))
  expect(changedWidth).toBeGreaterThan(12)
  await page.keyboard.press('Escape')
  await expect(properties).toBeHidden()
  await page.mouse.up()

  await expect.poll(async () => (await outlineState(page)).gestureActive).toBe(false)
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Sticker properties' }).getByRole('slider', { name: 'Outline thickness' })).toHaveAttribute('aria-valuenow', '12')
})

for (const width of [1024, 390]) {
  test(`outline controls are keyboard-accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 })
    await openBlankEditor(page)
    await page.getByTestId('photo-file-input').setInputFiles({ name: 'cutout.png', mimeType: 'image/png', buffer: cutout })
    await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    const properties = page.getByRole('dialog', { name: 'Sticker properties' })
    const toggle = properties.getByLabel('Toggle silhouette outline')
    await toggle.focus()
    await toggle.press('Space')
    await expect(toggle).toBeChecked()
    const thickness = properties.getByRole('slider', { name: 'Outline thickness' })
    await thickness.focus()
    await thickness.press('ArrowRight')
    await expect(thickness).toHaveAttribute('aria-valuenow', '13')
    await expect(properties.getByLabel('Outline color')).toBeEnabled()
  })
}

test('faint pixels cannot reduce a nearby solid outline', async ({ page }) => {
  await page.goto('/create')
  const report = await page.evaluate(async () => {
    const { createImageSurface } = await import('/src/features/exports/renderDocument.ts')
    const source = document.createElement('canvas')
    source.width = source.height = 64
    const ctx = source.getContext('2d')!
    ctx.fillStyle = '#dc2846'
    ctx.fillRect(16, 16, 32, 32)
    const outline = { enabled: true, color: '#ffffff', width: 12 }
    const without = createImageSurface(source, { outline }, 64, 64).canvas as HTMLCanvasElement
    const faint = ctx.createImageData(1, 1)
    faint.data.set([255, 255, 255, 1])
    ctx.putImageData(faint, 8, 32)
    const withFaint = createImageSurface(source, { outline }, 64, 64).canvas as HTMLCanvasElement
    const sample = (canvas: HTMLCanvasElement, x: number, y: number) => Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data)
    return { without: sample(without, 19, 44), withFaint: sample(withFaint, 19, 44) }
  })
  expect(report.without[3]).toBe(255)
  expect(report.withFaint[3]).toBe(255)
})

test('outline dilation preserves faint alpha at preview and export resolutions', async ({ page }) => {
  await page.goto('/create')
  const alpha = await page.evaluate(async () => {
    const { createImageSurface } = await import('/src/features/exports/renderDocument.ts')
    const source = document.createElement('canvas')
    source.width = source.height = 2048
    const sourceContext = source.getContext('2d')!
    const pixel = sourceContext.createImageData(1, 1)
    pixel.data.set([255, 0, 0, 1])
    sourceContext.putImageData(pixel, 1024, 1024)
    const outline = { enabled: true, color: '#ffffff', width: 40 }
    const previewRatio = 1024 / (2048 + 80)
    const surfaces = [
      createImageSurface(source, { outline }, 2048, 2048).canvas as HTMLCanvasElement,
      createImageSurface(source, { outline }, 2048, 2048, undefined, undefined, previewRatio).canvas as HTMLCanvasElement,
    ]
    return surfaces.map((surface) => {
      const pixels = surface.getContext('2d')!.getImageData(0, 0, surface.width, surface.height).data
      let max = 0
      for (let index = 3; index < pixels.length; index += 4) max = Math.max(max, pixels[index]!)
      return max
    })
  })
  expect(alpha[0]).toBe(1)
  expect(alpha[1]).toBeLessThanOrEqual(1)
})

test('white outline covers black-matted photo edges', async ({ page }) => {
  await page.goto('/create')
  const fringe = await page.evaluate(async () => {
    const { createImageSurface } = await import('/src/features/exports/renderDocument.ts')
    const source = document.createElement('canvas')
    source.width = source.height = 32
    const ctx = source.getContext('2d')!
    ctx.fillStyle = '#dc2846'
    ctx.fillRect(8, 8, 16, 16)
    const edge = ctx.createImageData(1, 1)
    edge.data.set([0, 0, 0, 90])
    for (let x = 8; x < 24; x += 1) ctx.putImageData(edge, x, 8)
    const canvas = createImageSurface(source, { outline: { enabled: true, color: '#ffffff', width: 4 } }, 32, 32).canvas as HTMLCanvasElement
    return Array.from(canvas.getContext('2d')!.getImageData(20, 12, 1, 1).data)
  })
  expect(fringe[0]).toBeGreaterThan(200)
  expect(fringe[1]).toBeGreaterThan(200)
  expect(fringe[2]).toBeGreaterThan(200)
})

test('outline color alpha is present in preview and export rasters', async ({ page }) => {
  await page.goto('/create')
  const sample = await page.evaluate(async () => {
    const { createImageSurface, renderDocument } = await import('/src/features/exports/renderDocument.ts')
    const source = document.createElement('canvas')
    source.width = source.height = 32
    source.getContext('2d')!.fillRect(8, 8, 16, 16)
    const preview = createImageSurface(source, { outline: { enabled: true, color: '#00ff0080', width: 4 } }, 32, 32).canvas as HTMLCanvasElement
    const previewPixel = Array.from(preview.getContext('2d')!.getImageData(10, 20, 1, 1).data)
    const blob = await new Promise<Blob>((resolve) => source.toBlob((value) => resolve(value!), 'image/png'))
    const png = await renderDocument(
      {
        schemaVersion: 1,
        id: 'p',
        title: 't',
        createdAt: '0',
        updatedAt: '0',
        revision: 1,
        artboard: { width: 1024, height: 1024 },
        assetIds: ['a'],
        layers: [{
          id: 'img',
          name: 'Image',
          kind: 'image',
          assetId: 'a',
          opacity: 1,
          visible: true,
          locked: false,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          outline: { enabled: true, color: '#00ff0080', width: 4 },
        }],
      },
      { a: { asset: { id: 'a', mimeType: 'image/png', width: 32, height: 32, blobKey: 'a', provenance: 'test' }, blob } },
      { size: 512, bounds: 'artwork' },
    )
    const bitmap = await createImageBitmap(png)
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = bitmap.width
    exportCanvas.height = bitmap.height
    exportCanvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
    let overBlack = [0, 0, 0]
    const black = document.createElement('canvas')
    black.width = exportCanvas.width
    black.height = exportCanvas.height
    const blackContext = black.getContext('2d')!
    blackContext.fillStyle = '#000'
    blackContext.fillRect(0, 0, black.width, black.height)
    blackContext.drawImage(exportCanvas, 0, 0)
    const blackPixels = blackContext.getImageData(0, 0, black.width, black.height).data
    for (let i = 0; i < blackPixels.length; i += 4) {
      if (blackPixels[i + 1]! > overBlack[1]!) overBlack = [blackPixels[i]!, blackPixels[i + 1]!, blackPixels[i + 2]!]
    }
    return { previewPixel, overBlack }
  })
  expect(sample.previewPixel[1]).toBeGreaterThan(200)
  expect(sample.previewPixel[0]).toBeGreaterThan(80)
  expect(sample.previewPixel[3]).toBeGreaterThan(200)
  expect(sample.overBlack[1]).toBeGreaterThan(200)
  expect(sample.overBlack[0]).toBeGreaterThan(80)
})

test('shared compositor outlines transparency, holes, details, and opaque rectangles without clipping', async ({ page }) => {
  await page.goto('/create')
  const report = await page.evaluate(async () => {
    const { createImageSurface } = await import('/src/features/exports/renderDocument.ts')
    const source = document.createElement('canvas')
    source.width = source.height = 64
    const sourceContext = source.getContext('2d')!
    sourceContext.fillStyle = '#dc2846'
    sourceContext.fillRect(16, 16, 32, 32)
    sourceContext.clearRect(27, 27, 10, 10)
    sourceContext.fillRect(4, 4, 4, 4)
    const outlined = createImageSurface(source, { outline: { enabled: true, color: '#00ff00', width: 4 } }, 64, 64).canvas as HTMLCanvasElement
    const ctx = outlined.getContext('2d')!
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)

    const empty = document.createElement('canvas')
    empty.width = empty.height = 64
    const emptyOutlined = createImageSurface(empty, { outline: { enabled: true, color: '#ffffff', width: 4 } }, 64, 64).canvas as HTMLCanvasElement
    const emptyAlpha = emptyOutlined.getContext('2d')!.getImageData(0, 0, emptyOutlined.width, emptyOutlined.height).data

    const opaque = document.createElement('canvas')
    opaque.width = opaque.height = 16
    opaque.getContext('2d')!.fillRect(0, 0, 16, 16)
    const opaqueOutlined = createImageSurface(opaque, { outline: { enabled: true, color: '#ffffff', width: 4 } }, 16, 16).canvas as HTMLCanvasElement
    const opaqueContext = opaqueOutlined.getContext('2d')!

    const thin = document.createElement('canvas')
    thin.width = thin.height = 100
    thin.getContext('2d')!.fillRect(48, 48, 4, 4)
    const thickOutlined = createImageSurface(thin, { outline: { enabled: true, color: '#ffffff', width: 40 } }, 100, 100).canvas as HTMLCanvasElement
    const thickContext = thickOutlined.getContext('2d')!
    const center = 90

    const croppedSource = document.createElement('canvas')
    croppedSource.width = croppedSource.height = 64
    const croppedContext = croppedSource.getContext('2d')!
    croppedContext.fillStyle = '#dc2846'
    croppedContext.fillRect(40, 40, 8, 8)
    const cropAway = createImageSurface(croppedSource, { crop: { x: 0, y: 0, width: 32, height: 32 }, outline: { enabled: true, color: '#ffffff', width: 4 } }, 32, 32).canvas as HTMLCanvasElement
    const cropAwayAlpha = cropAway.getContext('2d')!.getImageData(0, 0, cropAway.width, cropAway.height).data
    const cropIn = createImageSurface(croppedSource, { crop: { x: 36, y: 36, width: 16, height: 16 }, outline: { enabled: true, color: '#00ff00', width: 4 } }, 16, 16).canvas as HTMLCanvasElement
    const cropInContext = cropIn.getContext('2d')!

    const solid = document.createElement('canvas')
    solid.width = solid.height = 64
    solid.getContext('2d')!.fillRect(0, 0, 64, 64)
    const mask = document.createElement('canvas')
    mask.width = mask.height = 64
    mask.getContext('2d')!.fillRect(0, 0, 32, 64)
    const masked = createImageSurface(solid, { outline: { enabled: true, color: '#00ff00', width: 4 } }, 64, 64, undefined, mask).canvas as HTMLCanvasElement
    const maskedContext = masked.getContext('2d')!
    return {
      size: [outlined.width, outlined.height],
      margin: pixel(4, 68),
      outerOutline: pixel(16, 36),
      body: pixel(24, 24),
      holeOutline: pixel(33, 36),
      holeCenter: pixel(36, 36),
      detail: pixel(10, 10),
      emptyVisible: emptyAlpha.some((_, index) => index % 4 === 3 && emptyAlpha[index]! > 0),
      opaquePadding: Array.from(opaqueContext.getImageData(2, 12, 1, 1).data),
      opaqueBody: Array.from(opaqueContext.getImageData(8, 8, 1, 1).data),
      thickDetailAlpha: Array.from({ length: 43 }, (_, offset) => thickContext.getImageData(center + offset, center, 1, 1).data[3]),
      cropAwayVisible: cropAwayAlpha.some((_, index) => index % 4 === 3 && cropAwayAlpha[index]! > 0),
      cropInOutline: Array.from(cropInContext.getImageData(4, 8, 1, 1).data),
      cropInBody: Array.from(cropInContext.getImageData(12, 12, 1, 1).data),
      maskedBody: maskedContext.getImageData(20, 36, 1, 1).data[3],
      maskedEdge: Array.from(maskedContext.getImageData(38, 36, 1, 1).data),
      maskedAway: maskedContext.getImageData(50, 36, 1, 1).data[3],
    }
  })

  expect(report.size).toEqual([72, 72])
  expect(report.margin[3]).toBe(0)
  expect(report.outerOutline.slice(0, 3)).toEqual([0, 255, 0])
  expect(report.body.slice(0, 3)).toEqual([220, 40, 70])
  expect(report.holeOutline.slice(0, 3)).toEqual([0, 255, 0])
  expect(report.holeCenter[3]).toBe(0)
  expect(report.detail[3]).toBeGreaterThan(0)
  expect(report.emptyVisible).toBe(false)
  expect(report.opaquePadding.slice(0, 3)).toEqual([255, 255, 255])
  expect(report.opaqueBody[3]).toBe(255)
  expect(report.thickDetailAlpha.slice(0, 42).every((alpha) => alpha > 0)).toBe(true)
  expect(report.thickDetailAlpha[42]).toBe(0)
  expect(report.cropAwayVisible).toBe(false)
  expect(report.cropInOutline.slice(0, 3)).toEqual([0, 255, 0])
  expect(report.cropInBody.slice(0, 3)).toEqual([220, 40, 70])
  expect(report.maskedBody).toBe(255)
  expect(report.maskedEdge.slice(0, 3)).toEqual([0, 255, 0])
  expect(report.maskedAway).toBe(0)
})
