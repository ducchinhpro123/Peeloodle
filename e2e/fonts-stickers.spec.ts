import { expect, test, type Page } from '@playwright/test'
import type Konva from 'konva'
import { readFile } from 'node:fs/promises'

const families = ['Fredoka', 'Baloo 2', 'Luckiest Guy', 'Chewy', 'Pacifico', 'Bangers']
const screenshots = '/tmp/stickerlab-editor-fonts'

async function expectTextNode(page: Page, family: string) {
  await expect.poll(() => page.evaluate((family) => {
    const konva = (window as unknown as { Konva: typeof Konva }).Konva
    const node = konva?.stages[0]?.findOne<Konva.Text>('Text')
    return node?.fontFamily() === family
  }, family)).toBe(true)
}

for (const family of families) {
  test(`${family} loads, survives reopening, and matches real exported text pixels`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/create')
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByLabel('Text content').fill('Good Vibes!\nMEOW!')
    await page.getByLabel('Font family').selectOption(family)
    await expectTextNode(page, family)
    await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved locally')
    await page.reload()
    await expect(page.getByLabel('Font family')).toHaveValue(family)
    await expect(page.getByLabel('Text content')).toHaveValue('Good Vibes!\nMEOW!')
    await expectTextNode(page, family)

    const result = await page.evaluate(async (family) => {
      const storePath = '/src/features/editor/store.ts'
      const renderPath = '/src/features/exports/renderDocument.ts'
      const { useEditorStore } = await import(storePath)
      const { renderDocument } = await import(renderPath)
      const state = useEditorStore.getState()
      const konva = (window as unknown as { Konva: typeof Konva }).Konva
      const stage = konva.stages[0]!
      stage.findOne<Konva.Transformer>('Transformer')!.nodes([])
      const node = stage.findOne<Konva.Text>('Text')!
      const blob = await renderDocument(state.document, state.assets, { size: 1024 })
      const bitmap = await createImageBitmap(blob)
      const exported = document.createElement('canvas')
      exported.width = exported.height = 1024
      const ctx = exported.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const preview = stage.toCanvas({ x: stage.x(), y: stage.y(), width: 1024 * stage.scaleX(), height: 1024 * stage.scaleY(), pixelRatio: 1 / stage.scaleX() })
      const actual = preview.getContext('2d')!.getImageData(0, 0, 1024, 1024).data
      const expected = ctx.getImageData(0, 0, 1024, 1024).data
      let ink = 0
      let differences = 0
      // Exclude the editor-only artboard border. The text lives well inside this region.
      for (let y = 100; y < 900; y++) for (let x = 100; x < 900; x++) {
        const offset = (y * 1024 + x) * 4
        if (expected[offset + 3]! > 127) ink++
        if (Math.abs(actual[offset + 3]! - expected[offset + 3]!) > 4) differences++
      }
      ctx.font = `64px ${JSON.stringify(family)}`
      const width = Math.max(...node.text().split('\n').map((line) => ctx.measureText(line).width))
      ctx.font = '64px Arial'
      const fallbackWidth = Math.max(...node.text().split('\n').map((line) => ctx.measureText(line).width))
      const faces = await document.fonts.load(`64px ${JSON.stringify(family)}`)
      return { ink, differences, nodeWidth: node.width(), width, fallbackWidth, loaded: faces.length > 0 && faces.every((face) => face.status === 'loaded'), transparentCorner: expected[3] }
    }, family)
    expect(result.loaded).toBe(true)
    expect(result.ink).toBeGreaterThan(1000)
    expect(result.differences / result.ink).toBeLessThan(0.02)
    expect(result.nodeWidth).toBeCloseTo(result.width, 1)
    expect(Math.abs(result.width - result.fallbackWidth)).toBeGreaterThan(1)
    expect(result.transparentCorner).toBe(0)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${screenshots}/font-${family.replaceAll(' ', '-')}.png`, fullPage: true })
  })
}

test('a delayed font blocks download until the real glyphs are ready', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let requested = false
  await page.route('**/fonts/bangers.ttf', async (route) => { requested = true; await gate; await route.continue() })
  await page.goto('/create')
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
  await expectTextNode(page, 'Bangers')
  await expect(dialog.getByRole('status')).toContainText('Download started')
})

test('font failures preserve text and produce an honest export error', async ({ page }) => {
  await page.route('**/fonts/fredoka.ttf', (route) => route.abort())
  await page.goto('/create')
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
  await expectTextNode(page, 'Chewy')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const width of [1440, 1024, 390]) {
  test(`cute cutouts and editable text presets save and reopen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await page.goto('/create')
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
    const storePath = '/src/features/editor/store.ts'
    await expect.poll(() => page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document.layers.length, storePath)).toBe(1)
    if (width < 1150) await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    const inspector = width < 1150 ? page.getByRole('dialog', { name: 'Sticker properties' }) : page.locator('.editor > .inspector')
    await inspector.getByLabel('Toggle silhouette outline').check()
    await inspector.getByRole('button', { name: 'Rotate 90°', exact: true }).click()
    if (width < 1150) await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Text styles', exact: true }).click()
    await page.getByRole('button', { name: 'Add Baloo 2 text', exact: true }).click()
    await expectTextNode(page, 'Baloo 2')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    expect(await page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document.layers.length, storePath)).toBe(1)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expectTextNode(page, 'Baloo 2')
    await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved locally')
    await page.reload()
    await expectTextNode(page, 'Baloo 2')
    const state = await page.evaluate(async (path) => {
      const { useEditorStore } = await import(path)
      const state = useEditorStore.getState()
      return { layers: state.document.layers, assets: Object.values(state.assets).map((record) => {
        const asset = record as { asset: { provenance: string }; blob: Blob }
        return { provenance: asset.asset.provenance, size: asset.blob.size }
      }) }
    }, storePath)
    expect(state.layers).toHaveLength(2)
    expect(state.layers[0]).toMatchObject({ name: 'Meow cat', kind: 'image', outline: { enabled: true }, transform: { rotation: 90 } })
    expect(state.layers[1]).toMatchObject({ kind: 'text', content: 'PAWSOME!', fontFamily: 'Baloo 2' })
    expect(state.assets[0]!.size).toBeGreaterThan(1000)
    expect(state.assets[0]!.provenance).toBe('bundled-asset:/art/stickers/01-orange-cat-meow.webp')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Export and share' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export sticker', exact: true })
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click()
    const bytes = await readFile((await (await download).path())!)
    const image = await page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      bitmap.close()
      let ink = 0
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) ink++
      return { width: canvas.width, height: canvas.height, ink, corner: pixels[3] }
    }, [...bytes])
    expect(image).toMatchObject({ width: 1024, height: 1024, corner: 0 })
    expect(image.ink).toBeGreaterThan(1000)
    expect(image.ink).toBeLessThan(1024 * 1024 / 2)
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Text styles', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${screenshots}/cutouts-and-fonts-${width}.png`, fullPage: true })
  })
}
