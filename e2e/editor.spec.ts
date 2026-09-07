import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const redPng = path.resolve('e2e/fixtures/red.png')

async function inspectPng(page: Page, downloadPath: string, expectedSize: number) {
  const bytes = readFileSync(downloadPath)
  expect(bytes[0]).toBe(0x89)
  expect(bytes[1]).toBe(0x50)
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  expect(width).toBe(expectedSize)
  expect(height).toBe(expectedSize)
  const colorType = bytes[25]
  expect(colorType).toBe(6)

  const payload = bytes.toString('base64')
  const pixels = await page.evaluate(async (base64) => {
    const binary = atob(base64)
    const array = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i)
    const blob = new Blob([array], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no ctx')
    ctx.drawImage(bitmap, 0, 0)
    const corner = ctx.getImageData(0, 0, 1, 1).data
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    let maxAlpha = 0
    let redFound = false
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0
      if (alpha > maxAlpha) maxAlpha = alpha
      if (alpha > 200 && (data[i] ?? 0) > 150 && (data[i + 1] ?? 0) < 80) redFound = true
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      corner: [corner[0], corner[1], corner[2], corner[3]],
      maxAlpha,
      redFound,
    }
  }, payload)
  expect(pixels.corner[3]).toBe(0)
  expect(pixels.maxAlpha).toBeGreaterThan(0)
  expect(pixels.redFound).toBe(true)
  return pixels
}

async function downloadExport(page: Page, size: 512 | 1024) {
  const dialog = page.getByRole('dialog', { name: 'Export sticker' })
  await dialog.getByLabel(`${size} × ${size}`).check()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PNG' }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  await inspectPng(page, downloadPath!, size)
  await expect(dialog.getByRole('status')).toContainText(/download started/i)
}

test('upload, edit, save, reload, reopen, and inspect transparent PNG export', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/create')
  await page.waitForURL(/\/editor\/[0-9a-f-]+/i)
  await expect(page.getByRole('heading', { name: /untitled sticker/i })).toBeVisible()
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await page.getByTestId('photo-file-input').setInputFiles(redPng)
  const uploaded = page.getByRole('heading', { name: 'Image layer' })
  const uploadError = page.getByRole('alert')
  await expect(uploaded.or(uploadError)).toBeVisible()
  if (await uploadError.isVisible()) throw new Error(await uploadError.innerText())
  await expect(uploaded).toBeVisible()
  await page.getByRole('button', { name: 'Text' }).click()
  const content = page.getByLabel('Text content')
  await content.fill('Hello sticker')
  await page.getByLabel('Sticker title').fill('E2E Sticker')
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await expect(page.getByRole('status')).toContainText(/saved locally/i)

  const dbNames = await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))
  expect(dbNames).toContain('stickerlab-local')

  const editorUrl = page.url()
  await page.reload()
  await expect(page.getByLabel('Sticker title')).toHaveValue('E2E Sticker')
  await expect(page.getByLabel('Text content')).toHaveValue('Hello sticker')

  await page.goto('/')
  await page.getByRole('link', { name: /e2e sticker/i }).click()
  await expect(page).toHaveURL(editorUrl)
  await expect(page.getByLabel('Text content')).toHaveValue('Hello sticker')

  await page.goto('/my-stickers')
  await page.getByRole('link', { name: /e2e sticker/i }).click()
  await expect(page.getByLabel('Text content')).toHaveValue('Hello sticker')

  await page.getByRole('button', { name: /export and share/i }).click()
  await downloadExport(page, 512)
  await downloadExport(page, 1024)
})

test('mobile editor keeps save and export reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/create')
  await expect(page.getByRole('button', { name: /save to my stickers/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /export and share/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sticker properties' })).toBeVisible()
  await page.getByRole('button', { name: 'Text' }).click()
  await page.getByRole('button', { name: 'Sticker properties' }).click()
  await expect(page.getByRole('dialog').getByLabel('Text content')).toBeVisible()
})
