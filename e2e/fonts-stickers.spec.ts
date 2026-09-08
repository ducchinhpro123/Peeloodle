import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  compareLiveTextToPaintedFamily,
  comparePngTextToPaintedFamily,
  comparePreviewExportGrid,
  doubleClickArtwork,
  downloadPng,
  inspectPngBytes,
  openBlankEditor,
  waitForCanvasInk,
  waitForEditor,
} from './liveEditor'

const families = ['Fredoka', 'Baloo 2', 'Luckiest Guy', 'Chewy', 'Pacifico', 'Bangers']
const screenshots = '/tmp/grok-goal-6ad089e281f0/implementer/fonts-stickers'

function cssFamily(family: string) {
  return /[^\w-]/.test(family) ? JSON.stringify(family) : family
}

async function expectFontReady(page: Page, family: string, root?: Locator) {
  await expect((root ?? page).getByLabel('Font family')).toHaveValue(family)
  await expect.poll(() => page.evaluate((spec) => document.fonts.check(spec), `64px ${cssFamily(family)}`)).toBe(true)
}

async function measureFamily(page: Page, family: string, lines: string[]) {
  return page.evaluate(({ family, lines }) => {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) throw new Error('no ctx')
    const quoted = /[^\w-]/.test(family) ? JSON.stringify(family) : family
    ctx.font = `64px ${quoted}`
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width))
    ctx.font = '64px Arial'
    const fallbackWidth = Math.max(...lines.map((line) => ctx.measureText(line).width))
    return { width, fallbackWidth, loaded: document.fonts.check(`64px ${quoted}`) }
  }, { family, lines })
}

function inspector(page: Page, width: number) {
  return width < 1150 ? page.getByRole('dialog', { name: 'Sticker properties' }) : page.locator('.editor > .inspector')
}

for (const family of families) {
  test(`${family} loads, survives reopening, and matches real exported text pixels`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openBlankEditor(page)
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByLabel('Text content').fill('Good Vibes!\nMEOW!')
    await page.getByLabel('Font family').selectOption(family)
    await expectFontReady(page, family)
    await waitForCanvasInk(page, 200)
    const canvasFamily = await page.evaluate(() => {
      const text = (window as unknown as { Konva?: { stages: Array<{ findOne: (name: string) => { fontFamily: () => string } | null }> } }).Konva?.stages[0]?.findOne('Text')
      return text?.fontFamily() ?? ''
    })
    expect(canvasFamily).toBe(family)
    const metrics = await measureFamily(page, family, ['Good Vibes!', 'MEOW!'])
    expect(metrics.loaded).toBe(true)
    expect(Math.abs(metrics.width - metrics.fallbackWidth)).toBeGreaterThan(1)

    await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved locally')
    const firstBytes = await downloadPng(page, 1024)
    const first = await inspectPngBytes(page, firstBytes)
    const grid = await comparePreviewExportGrid(page, firstBytes)
    expect(Math.max(first.width, first.height)).toBe(1024)
    expect(first.colorType).toBe(6)
    expect(first.opaqueCount).toBeGreaterThan(1000)
    expect(first.transparentCount).toBeGreaterThan(100)
    expect(first.maxAlpha).toBeGreaterThan(200)
    expect(grid.compared).toBeGreaterThan(40)
    const liveMatch = await compareLiveTextToPaintedFamily(page, family)
    const pngMatch = await comparePngTextToPaintedFamily(page, firstBytes, family, ['Good Vibes!', 'MEOW!'], 64, '#08152f')
    const arialLive = await compareLiveTextToPaintedFamily(page, 'Arial')
    const arialPng = await comparePngTextToPaintedFamily(page, firstBytes, 'Arial', ['Good Vibes!', 'MEOW!'], 64, '#08152f')
    expect(liveMatch.silhouette, `live color ${liveMatch.ratio}`).toBeLessThan(0.28)
    expect(pngMatch.silhouette, `png color ${pngMatch.ratio}`).toBeLessThan(0.28)
    expect(arialLive.silhouette).toBeGreaterThan(liveMatch.silhouette + 0.06)
    expect(arialPng.silhouette).toBeGreaterThan(pngMatch.silhouette + 0.06)

    await page.reload()
    await waitForEditor(page)
    await expect(page.getByLabel('Font family')).toHaveValue(family)
    await expect(page.getByLabel('Text content')).toHaveValue('Good Vibes!\nMEOW!')
    await expectFontReady(page, family)
    const reopenedBytes = await downloadPng(page, 1024)
    const reopened = await inspectPngBytes(page, reopenedBytes)
    const reopenedGrid = await comparePreviewExportGrid(page, reopenedBytes)
    expect(reopened.width).toBe(first.width)
    expect(reopened.height).toBe(first.height)
    expect(Math.abs(reopened.opaqueCount - first.opaqueCount) / first.opaqueCount).toBeLessThan(0.05)
    expect(reopenedGrid.compared).toBeGreaterThan(40)
    const reopenedLive = await compareLiveTextToPaintedFamily(page, family)
    const reopenedPng = await comparePngTextToPaintedFamily(page, reopenedBytes, family, ['Good Vibes!', 'MEOW!'], 64, '#08152f')
    expect(reopenedLive.silhouette).toBeLessThan(0.28)
    expect(reopenedPng.silhouette).toBeLessThan(0.28)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${screenshots}/font-${family.replaceAll(' ', '-')}.png`, fullPage: true })
  })
}

test('a delayed font blocks download until the real glyphs are ready', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let requested = false
  await page.route('**/fonts/bangers.ttf', async (route) => { requested = true; await gate; await route.continue() })
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByLabel('Font family').selectOption('Bangers')
  await expect.poll(() => requested).toBe(true)
  await page.getByRole('button', { name: 'Export and share' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export sticker', exact: true })
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Exporting…')
  await expect(dialog.getByRole('button', { name: 'Download PNG', exact: true })).toBeDisabled()
  expect(downloads).toEqual([])
  const download = page.waitForEvent('download')
  release()
  expect((await download).suggestedFilename()).toMatch(/1024\.png$/)
  await expectFontReady(page, 'Bangers')
  await expect(dialog.getByRole('status')).toContainText('Download started')
})

test('font failures preserve text and produce an honest export error', async ({ page }) => {
  await page.route('**/fonts/fredoka.ttf', (route) => route.abort())
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByLabel('Text content').fill('Keep my words')
  await page.getByLabel('Font family').selectOption('Fredoka')
  await expect(page.getByRole('alert')).toContainText('Could not load Fredoka')
  await page.getByRole('button', { name: 'Export and share' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export sticker', exact: true })
  let downloads = 0
  page.on('download', () => { downloads++ })
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Could not load Fredoka')
  expect(downloads).toBe(0)
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Text content')).toHaveValue('Keep my words')
  await page.getByLabel('Font family').selectOption('Chewy')
  await expectFontReady(page, 'Chewy')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('canvas textarea uses a full line box for punctuation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByLabel('Font family').selectOption('Georgia')
  await page.getByLabel('Text content').fill('...')
  await waitForCanvasInk(page, 10)
  await page.getByRole('heading', { name: 'Text layer', exact: true }).click()
  await doubleClickArtwork(page)
  const editor = page.getByRole('textbox', { name: 'Edit canvas text', exact: true })
  await expect(editor).toBeVisible()
  const box = await editor.evaluate((element: HTMLTextAreaElement) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    value: element.value,
  }))
  expect(box.value).toBe('...')
  expect(box.clientHeight).toBeGreaterThanOrEqual(box.lineHeight)
  expect(box.clientHeight).toBeGreaterThanOrEqual(box.scrollHeight - 1)
})

for (const width of [1440, 1024, 390]) {
  test(`cute cutouts and editable text presets save and reopen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await openBlankEditor(page)
    await page.getByRole('button', { name: 'Stickers & decorations', exact: true }).click()
    await expect(page.locator('.asset-items .catalog-asset')).toHaveCount(39)
    if (width === 1440) {
      const images = page.locator('.asset-items .catalog-asset img')
      const broken = await images.evaluateAll(async (images) => Promise.all(images.map(async (element) => {
        const image = element as HTMLImageElement
        image.loading = 'eager'
        try { await image.decode(); return '' } catch { return image.src }
      })))
      expect(broken.filter(Boolean)).toEqual([])
    }
    await page.getByRole('button', { name: 'Add Meow cat', exact: true }).click()
    await waitForCanvasInk(page, 200)
    if (width < 1150) await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    const panel = inspector(page, width)
    await expect(panel.getByText('Meow cat', { exact: true })).toBeVisible()
    await panel.getByLabel('Toggle silhouette outline').check()
    await panel.getByRole('button', { name: 'Rotate 90°', exact: true }).click()
    if (width < 1150) await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Text styles', exact: true }).click()
    await page.getByRole('button', { name: 'Add Baloo 2 text', exact: true }).click()
    if (width < 1150) await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    const afterText = inspector(page, width)
    await expect(afterText.getByLabel('Text content')).toHaveValue('PAWSOME!')
    await expectFontReady(page, 'Baloo 2', afterText)
    if (width < 1150) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    if (width < 1150) await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    await inspector(page, width).getByRole('tab', { name: 'Layers' }).click()
    await expect(inspector(page, width).getByLabel('Layer name: PAWSOME!')).toHaveCount(0)
    if (width < 1150) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    if (width < 1150) await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    const afterRedo = inspector(page, width)
    await afterRedo.getByRole('tab', { name: 'Layers' }).click()
    await expect(afterRedo.getByLabel('Layer name: PAWSOME!')).toBeVisible()
    await afterRedo.getByRole('button', { name: 'Select PAWSOME!' }).click()
    await afterRedo.getByRole('tab', { name: 'Adjust' }).click()
    await expect(afterRedo.getByLabel('Text content')).toHaveValue('PAWSOME!')
    if (width < 1150) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved locally')
    await page.reload()
    await waitForEditor(page)
    if (width < 1150) await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    const reopened = inspector(page, width)
    await expect(reopened.getByLabel('Text content')).toHaveValue('PAWSOME!')
    await expect(reopened.getByLabel('Font family')).toHaveValue('Baloo 2')
    await reopened.getByRole('tab', { name: 'Layers' }).click()
    await expect(reopened.getByLabel('Layer name: Meow cat')).toBeVisible()
    await reopened.getByRole('button', { name: 'Select Meow cat' }).click()
    await reopened.getByRole('tab', { name: 'Adjust' }).click()
    await expect(reopened.getByLabel('Toggle silhouette outline')).toBeChecked()
    if (width < 1150) await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const png = await inspectPngBytes(page, await downloadPng(page, 1024))
    expect(Math.max(png.width, png.height)).toBe(1024)
    expect(png.colorType).toBe(6)
    expect(png.opaqueCount).toBeGreaterThan(1000)
    expect(png.transparentCount).toBeGreaterThan(100)
    await page.getByRole('tab', { name: 'Text styles', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${screenshots}/cutouts-and-fonts-${width}.png`, fullPage: true })
  })
}
