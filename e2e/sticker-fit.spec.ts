import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type Konva from 'konva'

const viewports = [{ width: 1440, height: 900 }, { width: 1440, height: 600 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]

for (const viewport of viewports) {
test(`artwork stays visible across the former artboard boundary at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport)
  await page.goto('/create')
  await page.getByRole('button', { name: 'Stickers & decorations', exact: true }).click()
  await page.getByRole('button', { name: 'Add Cool Corgi', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { Konva: typeof Konva }).Konva?.stages[0]?.find('Image').length)).toBe(1)
  const drag = await page.evaluate(() => {
    const stage = (window as unknown as { Konva: typeof Konva }).Konva.stages[0]!
    const host = stage.container().getBoundingClientRect()
    return { x: host.x + stage.x() + 512 * stage.scaleX(), y: host.y + stage.y() + 512 * stage.scaleY(), dx: 384 * stage.scaleX() }
  })
  await page.mouse.move(drag.x, drag.y)
  await page.mouse.down()
  await page.mouse.move(drag.x - drag.dx, drag.y, { steps: 12 })
  await page.mouse.up()
  const alphaOutside = () => page.evaluate(() => {
    const stage = (window as unknown as { Konva: typeof Konva }).Konva.stages[0]!
    const node = stage.findOne<Konva.Image>('Image')!
    const source = document.createElement('canvas'); source.width = source.height = 1024
    const ctx = source.getContext('2d')!; ctx.drawImage(node.image()!, 0, 0)
    const preview = stage.container().querySelector('canvas')!
    // Probe an opaque interior source pixel that now lies left of the export square.
    for (let y = 256; y < 768; y += 16) {
      if (ctx.getImageData(320, y, 1, 1).data[3]! < 240) continue
      const p = node.getAbsoluteTransform().point({ x: 320, y })
      return preview.getContext('2d')!.getImageData(Math.round(p.x * preview.width / stage.width()), Math.round(p.y * preview.height / stage.height()), 1, 1).data[3]
    }
    throw new Error('Fixture lacks an opaque pixel outside the export area')
  })
  await page.getByTestId('editor-canvas').screenshot({ path: `/tmp/stickerlab-sticker-fit/corgi-boundary-${viewport.width}x${viewport.height}.png` })
  await expect.poll(alphaOutside).toBeGreaterThan(200)
  await expect(page.getByText('Exports fit the visible artwork.', { exact: true })).toBeVisible()
  expect(await page.locator('.canvas-workspace').evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('conic-gradient')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { Konva: typeof Konva }).Konva.stages[0]!.findOne<Konva.Image>('Image')!.x())).toBe(0)
  if (viewport.width === 1440 && viewport.height === 900) {
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
    const download = async (name: string) => {
      await page.getByRole('button', { name: 'Export and share' }).click()
      const pending = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download PNG', exact: true }).click()
      const file = `/tmp/stickerlab-sticker-fit/${name}.png`
      await (await pending).saveAs(file)
      await page.keyboard.press('Escape')
      return readFile(file)
    }
    const before = await download('exported-corgi')
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    expect((await download('exported-corgi-zoomed')).equals(before)).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(page.getByTestId('editor-canvas')).toBeVisible()
    expect((await download('exported-corgi-reopened')).equals(before)).toBe(true)
  }
})


  test(`tray stickers fit without changing their document at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/create')
    await page.getByRole('button', { name: 'Stickers & decorations', exact: true }).click()
    await page.getByRole('button', { name: 'Add Happy Kitten', exact: true }).click()
    const geometry = () => page.evaluate(() => {
      const stage = (window as unknown as { Konva: typeof Konva }).Konva?.stages[0]
      const image = stage?.findOne<Konva.Image>('Image')
      if (!stage || !image) return null
      const bounds = image.getClientRect()
      const handles = stage.findOne<Konva.Transformer>('Transformer')?.getClientRect()
      return { bounds, handles, width: stage.width(), height: stage.height() }
    })
    await expect.poll(geometry).not.toBeNull()
    const expectFits = async () => {
      const result = (await geometry())!
      expect(result.bounds.x).toBeGreaterThanOrEqual(16)
      expect(result.bounds.y).toBeGreaterThanOrEqual(16)
      expect(result.bounds.x + result.bounds.width).toBeLessThanOrEqual(result.width - 16)
      expect(result.bounds.y + result.bounds.height).toBeLessThanOrEqual(result.height - 16)
      expect(result.bounds.width).toBeCloseTo(result.bounds.height, 1)
      if (result.handles && result.handles.width > 0) {
        expect(result.handles.x).toBeGreaterThanOrEqual(0)
        expect(result.handles.y).toBeGreaterThanOrEqual(0)
        expect(result.handles.x + result.handles.width).toBeLessThanOrEqual(result.width)
        expect(result.handles.y + result.handles.height).toBeLessThanOrEqual(result.height)
      }
    }
    await page.getByTestId('editor-canvas').screenshot({ path: `/tmp/stickerlab-sticker-fit/${viewport.width}x${viewport.height}.png` })
    await expectFits()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(geometry).toBeNull()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect.poll(geometry).not.toBeNull()
    await expectFits()
    await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
    const snapshot = () => page.evaluate(async () => {
      const path = '/src/features/editor/store.ts'
      return (await import(path)).useEditorStore.getState().document
    })
    const saved = await snapshot()
    expect(saved).toMatchObject({ schemaVersion: 1, layers: [{ kind: 'image', name: 'Happy Kitten' }] })
    await page.reload()
    await expect.poll(geometry).not.toBeNull()
    await expectFits()
    expect(await snapshot()).toEqual(saved)
    // Resizing the viewport must only change the view, not the saved composition.
    await page.setViewportSize({ width: 1024, height: 768 })
    const resized = await page.getByTestId('editor-canvas').evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }))
    await expect.poll(geometry).toMatchObject(resized)
    await expectFits()
    expect(await snapshot()).toEqual(saved)
  })
}
