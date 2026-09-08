import { expect, test, type Page } from '@playwright/test'
import {
  asymmetricPng,
  channelDiff,
  comparePreviewExportGrid,
  downloadPng,
  inspectPngBytes,
  openBlankEditor,
  probePng,
  setSlider,
  waitForCanvasInk,
  type PixelReport,
} from './liveEditor'

async function uploadPng(page: Page, buffer: Buffer, name = 'probe.png') {
  await page.getByTestId('photo-file-input').setInputFiles({ name, mimeType: 'image/png', buffer })
  await waitForCanvasInk(page, 200)
}

function desktopInspector(page: Page) {
  return page.locator('.editor > .inspector')
}

async function enableGreenOutline(page: Page) {
  const inspector = desktopInspector(page)
  await inspector.getByRole('tab', { name: 'Adjust' }).click()
  await inspector.getByLabel('Toggle silhouette outline').check()
  await inspector.getByLabel('Outline color').fill('#00ff00')
  await setSlider(inspector, 'Outline thickness', 20)
}

async function assertPreviewMatchesExport(
  page: Page,
  extra?: (png: PixelReport) => void,
  options?: { requireGreen?: boolean; maxRatio?: number },
) {
  await waitForCanvasInk(page, 80)
  const bytes = await downloadPng(page, 1024)
  const png = await inspectPngBytes(page, bytes)
  const grid = await comparePreviewExportGrid(page, bytes)
  expect(Math.max(png.width, png.height)).toBe(1024)
  expect(png.colorType).toBe(6)
  expect(png.opaqueCount).toBeGreaterThan(100)
  expect(grid.compared).toBeGreaterThan(40)
  expect(grid.ratio).toBeLessThan(options?.maxRatio ?? 0.12)
  if (options?.requireGreen) {
    expect(grid.previewGreen).toBeGreaterThan(20)
    expect(grid.exportGreen).toBeGreaterThan(20)
  }
  extra?.(png)
  return grid
}

async function startProbeEditor(page: Page, buffer = probePng) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openBlankEditor(page)
  await uploadPng(page, buffer)
}

test.describe('preview matches exported pixels', () => {
  test('preview matches exported grayscale pixels', async ({ page }) => {
    await startProbeEditor(page)
    const inspector = desktopInspector(page)
    await inspector.getByRole('tab', { name: 'Effects' }).click()
    await setSlider(inspector, 'Filter grayscale', 25)
    await assertPreviewMatchesExport(page, (png) => {
      expect(png.chroma).toBeLessThan(140)
    })
  })

  test('preview matches exported brightness pixels', async ({ page }) => {
    await startProbeEditor(page)
    const inspector = desktopInspector(page)
    await inspector.getByRole('tab', { name: 'Effects' }).click()
    await setSlider(inspector, 'Filter brightness', 25)
    await assertPreviewMatchesExport(page, (png) => {
      expect(png.center[0]).toBeGreaterThan(180)
    })
  })

  test('preview matches exported contrast pixels', async ({ page }) => {
    await startProbeEditor(page)
    const inspector = desktopInspector(page)
    await inspector.getByRole('tab', { name: 'Effects' }).click()
    await setSlider(inspector, 'Filter contrast', 25)
    await assertPreviewMatchesExport(page)
  })

  test('preview matches exported saturation pixels', async ({ page }) => {
    await startProbeEditor(page)
    const inspector = desktopInspector(page)
    await inspector.getByRole('tab', { name: 'Effects' }).click()
    await setSlider(inspector, 'Filter saturation', 25)
    await assertPreviewMatchesExport(page, (png) => {
      expect(png.chroma).toBeGreaterThan(40)
    })
  })

  test('preview matches exported outline pixels', async ({ page }) => {
    await startProbeEditor(page)
    await enableGreenOutline(page)
    await assertPreviewMatchesExport(page, (png) => {
      expect(png.greenCount).toBeGreaterThan(50)
    }, { requireGreen: true })
  })

  test('preview matches exported filtered-outline pixels', async ({ page }) => {
    await startProbeEditor(page)
    await enableGreenOutline(page)
    const inspector = desktopInspector(page)
    await inspector.getByRole('tab', { name: 'Effects' }).click()
    await setSlider(inspector, 'Filter brightness', -100)
    await assertPreviewMatchesExport(page, (png) => {
      expect(png.greenCount).toBeGreaterThan(50)
      expect(png.center[0]).toBeLessThan(40)
    }, { requireGreen: true })
  })

  test('preview matches exported rotated-outline pixels', async ({ page }) => {
    await startProbeEditor(page, asymmetricPng)
    await enableGreenOutline(page)
    await desktopInspector(page).getByRole('button', { name: 'Rotate 90°', exact: true }).click()
    const grid = await assertPreviewMatchesExport(page, (png) => {
      expect(png.greenCount).toBeGreaterThan(50)
    }, { requireGreen: true, maxRatio: 0.18 })
    expect(channelDiff(grid.previewQuadrant[0]!, grid.exportQuadrant[0]!)).toBeLessThan(48)
  })

  test('preview matches exported flipped-image pixels', async ({ page }) => {
    await startProbeEditor(page, asymmetricPng)
    await desktopInspector(page).getByRole('button', { name: 'Flip H', exact: true }).click()
    const grid = await assertPreviewMatchesExport(page, undefined, { maxRatio: 0.18 })
    const topLeft = grid.previewQuadrant[0]!
    expect(channelDiff(topLeft, grid.exportQuadrant[0]!)).toBeLessThan(48)
    expect(topLeft[2] ?? 0).toBeGreaterThan(topLeft[0] ?? 0)
  })

  test('preview matches exported sticker-cutout pixels', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openBlankEditor(page)
    await page.getByRole('button', { name: 'Stickers & decorations', exact: true }).click()
    await page.getByRole('button', { name: 'Add Meow cat', exact: true }).click()
    await waitForCanvasInk(page, 400)
    await assertPreviewMatchesExport(page, (png) => {
      expect(png.transparentCount).toBeGreaterThan(100)
    }, { maxRatio: 0.2 })
  })
})
