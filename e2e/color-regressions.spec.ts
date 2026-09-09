import { expect, test, type Page } from '@playwright/test'
import { downloadPng, encodeRgbaPng, inspectPngBytes, openBlankEditor, samplePreviewCenter, waitForEditor } from './liveEditor'

async function editorState(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/features/editor/store.ts')
    const state = useEditorStore.getState()
    return { gestureActive: state.gestureActive, past: state.past.length }
  })
}

test('color picker completes unchanged, cancelled, and keyboard gestures before autosave', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  const inspector = page.locator('.editor > .inspector')
  const swatch = inspector.getByRole('button', { name: 'Open color picker' })
  await swatch.click()
  const alpha = inspector.getByRole('slider', { name: 'Alpha' })
  const box = await alpha.boundingBox()
  if (!box) throw new Error('Alpha slider is missing')
  const midpoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await page.mouse.click(midpoint.x, midpoint.y)
  await expect.poll(async () => (await editorState(page)).gestureActive).toBe(false)
  const afterChangedClick = await editorState(page)
  await page.mouse.click(midpoint.x, midpoint.y)
  await swatch.click()
  expect(await editorState(page)).toEqual(afterChangedClick)

  await swatch.click()
  await alpha.dispatchEvent('pointerdown', { button: 0, bubbles: true })
  await alpha.dispatchEvent('pointercancel', { button: 0, bubbles: true })
  await expect.poll(async () => (await editorState(page)).gestureActive).toBe(false)

  const beforeKeyboard = await editorState(page)
  await alpha.focus()
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.up('ArrowLeft')
  await expect.poll(async () => (await editorState(page)).gestureActive).toBe(false)
  expect((await editorState(page)).past).toBe(beforeKeyboard.past + 1)
  await swatch.click()

  const content = inspector.getByLabel('Text content')
  await content.fill('Saved after color gesture')
  await content.blur()
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(content).toHaveValue('Text')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(content).toHaveValue('Saved after color gesture')
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await page.reload()
  await waitForEditor(page)
  await expect(page.locator('.editor > .inspector').getByLabel('Text content')).toHaveValue('Saved after color gesture')
})

test('shorthand text colors retain preview, persistence, and exported alpha', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  const inspector = page.locator('.editor > .inspector')
  const content = inspector.getByLabel('Text content')
  const color = inspector.getByLabel('Text color')
  await content.fill('█')
  await content.blur()

  await color.fill('#f00')
  await color.blur()
  const shortRed = await downloadPng(page)
  await color.fill('#ff0000')
  await color.blur()
  expect((await downloadPng(page)).equals(shortRed)).toBe(true)

  await color.fill('#0f08')
  await color.blur()
  const preview = await samplePreviewCenter(page)
  expect(preview[1]).toBeGreaterThan((preview[0] ?? 0) + 100)
  expect(preview[3]).toBeGreaterThanOrEqual(120)
  expect(preview[3]).toBeLessThan(255)
  await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await page.reload()
  await waitForEditor(page)
  const reopenedColor = page.locator('.editor > .inspector').getByLabel('Text color')
  await expect(reopenedColor).toHaveValue('#0f08')
  const shortAlpha = await downloadPng(page)
  const pixels = await inspectPngBytes(page, shortAlpha)
  expect(pixels.center[1]).toBeGreaterThan((pixels.center[0] ?? 0) + 100)
  expect(pixels.maxAlpha).toBeGreaterThanOrEqual(120)
  expect(pixels.maxAlpha).toBeLessThanOrEqual(145)
  await reopenedColor.fill('#00ff0088')
  await reopenedColor.blur()
  expect((await downloadPng(page)).equals(shortAlpha)).toBe(true)
})

test('shorthand outline alpha uses the same white-mixed export tint as eight digits', async ({ page }) => {
  const cutout = encodeRgbaPng(96, 96, (x, y) => x >= 20 && x < 76 && y >= 20 && y < 76
    ? [220, 40, 70, 255]
    : [0, 0, 0, 0])
  await page.setViewportSize({ width: 1440, height: 900 })
  await openBlankEditor(page)
  await page.getByTestId('photo-file-input').setInputFiles({ name: 'cutout.png', mimeType: 'image/png', buffer: cutout })
  const inspector = page.locator('.editor > .inspector')
  await inspector.getByLabel('Toggle silhouette outline').check()
  const color = inspector.getByLabel('Outline color')
  await color.fill('#f00')
  await color.blur()
  const shortRed = await downloadPng(page)
  await color.fill('#ff0000')
  await color.blur()
  expect((await downloadPng(page)).equals(shortRed)).toBe(true)

  await color.fill('#0f08')
  await color.blur()
  const short = await downloadPng(page)
  const pastelPixels = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! >= 90 && pixels[i]! <= 150 && pixels[i + 1]! >= 230 && pixels[i + 2]! >= 90 && pixels[i + 2]! <= 150 && pixels[i + 3]! > 200) count += 1
    }
    return count
  }, short.toString('base64'))
  expect(pastelPixels).toBeGreaterThan(20)
  await color.fill('#00ff0088')
  await color.blur()
  expect((await downloadPng(page)).equals(short)).toBe(true)
})
