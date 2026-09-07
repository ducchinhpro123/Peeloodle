import { expect, test, type Page } from '@playwright/test'
import { crc32, deflateSync } from 'node:zlib'

function pngChunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodeRgbaPng(width: number, height: number, fill: [number, number, number, number]) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x += 1) {
      const i = y * (width * 4 + 1) + 1 + x * 4
      raw[i] = fill[0]
      raw[i + 1] = fill[1]
      raw[i + 2] = fill[2]
      raw[i + 3] = fill[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const redPng = encodeRgbaPng(256, 256, [220, 16, 16, 255])

type PixelReport = {
  width: number
  height: number
  corner: number[]
  center: number[]
  maxAlpha: number
  opaqueCount: number
  redCount: number
  darkCount: number
  redBounds: { minX: number; minY: number; maxX: number; maxY: number } | null
  darkBounds: { minX: number; minY: number; maxX: number; maxY: number } | null
}

async function inspectPng(page: Page, downloadPath: string, expectedSize: number): Promise<PixelReport> {
  const { readFileSync } = await import('node:fs')
  const bytes = readFileSync(downloadPath)
  expect(bytes[0]).toBe(0x89)
  expect(bytes[1]).toBe(0x50)
  expect(bytes.readUInt32BE(16)).toBe(expectedSize)
  expect(bytes.readUInt32BE(20)).toBe(expectedSize)
  expect(bytes[25]).toBe(6)

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
    const midIdx = (Math.floor(bitmap.height / 2) * bitmap.width + Math.floor(bitmap.width / 2)) * 4
    const center = [data[midIdx] ?? 0, data[midIdx + 1] ?? 0, data[midIdx + 2] ?? 0, data[midIdx + 3] ?? 0]
    let maxAlpha = 0
    let opaqueCount = 0
    let redCount = 0
    let darkCount = 0
    const redBounds = { minX: bitmap.width, minY: bitmap.height, maxX: 0, maxY: 0 }
    const darkBounds = { minX: bitmap.width, minY: bitmap.height, maxX: 0, maxY: 0 }
    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        const i = (y * bitmap.width + x) * 4
        const r = data[i] ?? 0
        const g = data[i + 1] ?? 0
        const b = data[i + 2] ?? 0
        const alpha = data[i + 3] ?? 0
        if (alpha > maxAlpha) maxAlpha = alpha
        if (alpha < 16) continue
        opaqueCount += 1
        const red = alpha > 200 && r > 150 && g < 80 && b < 80
        const dark = alpha > 160 && r < 50 && g < 50 && b < 70
        if (red) {
          redCount += 1
          if (x < redBounds.minX) redBounds.minX = x
          if (y < redBounds.minY) redBounds.minY = y
          if (x > redBounds.maxX) redBounds.maxX = x
          if (y > redBounds.maxY) redBounds.maxY = y
        }
        if (dark) {
          darkCount += 1
          if (x < darkBounds.minX) darkBounds.minX = x
          if (y < darkBounds.minY) darkBounds.minY = y
          if (x > darkBounds.maxX) darkBounds.maxX = x
          if (y > darkBounds.maxY) darkBounds.maxY = y
        }
      }
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      corner: [corner[0], corner[1], corner[2], corner[3]],
      center,
      maxAlpha,
      opaqueCount,
      redCount,
      darkCount,
      redBounds: redCount ? redBounds : null,
      darkBounds: darkCount ? darkBounds : null,
    }
  }, bytes.toString('base64'))
  expect(pixels.corner[3]).toBe(0)
  expect(pixels.maxAlpha).toBeGreaterThan(0)
  expect(pixels.opaqueCount).toBeGreaterThan(100)
  expect(pixels.opaqueCount).toBeLessThan(expectedSize * expectedSize)
  expect(pixels.redCount).toBeGreaterThan(100)
  expect(pixels.redBounds).not.toBeNull()
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
  const pixels = await inspectPng(page, downloadPath!, size)
  await expect(dialog.getByRole('status')).toContainText(/download started/i)
  return pixels
}

async function openEditorFromDashboard(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Create a Sticker' }).click()
  await page.waitForURL(/\/editor\/[0-9a-f-]+/i)
  await expect(page.getByRole('heading', { name: /untitled sticker/i })).toBeVisible()
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await expect(page.getByText('Opening sticker…')).toHaveCount(0)
  await expect(page.locator('[data-testid="editor-canvas"] canvas')).toBeVisible()
}

async function artboardToScreen(page: Page, docX: number, docY: number) {
  return page.locator('[data-testid="editor-canvas"]').evaluate((host, point) => {
    const rect = host.getBoundingClientRect()
    const fit = Math.min((rect.width - 36) / 1024, (rect.height - 36) / 1024)
    const viewScale = Math.max(fit, 0.05)
    const x = rect.width / 2 - (1024 * viewScale) / 2
    const y = rect.height / 2 - (1024 * viewScale) / 2
    return { x: rect.left + x + point[0] * viewScale, y: rect.top + y + point[1] * viewScale, viewScale }
  }, [docX, docY] as [number, number])
}

async function waitForImageLayer(page: Page) {
  const uploaded = page.getByAltText('Image').first()
  const uploadError = page.getByRole('alert')
  await expect(uploaded.or(uploadError)).toBeVisible()
  if (await uploadError.isVisible()) throw new Error(await uploadError.innerText())
  await expect(uploaded).toBeVisible()
}

test('dashboard create, canvas edit, multiline text, save, reload, and PNG composition', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openEditorFromDashboard(page)
  await page.getByTestId('photo-file-input').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: redPng })
  await waitForImageLayer(page)

  const start = await artboardToScreen(page, 512, 512)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 70, start.y + 40)
  await page.mouse.up()

  const handle = await artboardToScreen(page, 640, 384)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + 36, handle.y - 36)
  await page.mouse.up()

  const inspector = page.locator('.editor > .inspector')
  await inspector.getByRole('tab', { name: 'Position' }).click()
  await inspector.locator('.layer-list').getByRole('button', { name: 'Image' }).click()
  await inspector.getByRole('tab', { name: 'Adjust' }).click()
  await inspector.getByRole('button', { name: 'Rotate 90°' }).click()
  await page.getByRole('button', { name: 'Text' }).click()
  await page.getByLabel('Text content').fill('Hello\nSticker')
  await page.getByLabel('Sticker title').fill('E2E Sticker')
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await expect(page.getByRole('status')).toContainText(/saved locally/i)

  const dbNames = await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))
  expect(dbNames).toContain('stickerlab-local')

  const editorUrl = page.url()
  await page.reload()
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await expect(page.getByText('Opening sticker…')).toHaveCount(0)
  await expect(page.getByLabel('Sticker title')).toHaveValue('E2E Sticker')
  await expect(page.getByLabel('Text content')).toHaveValue('Hello\nSticker')

  await page.goto('/')
  await page.getByRole('link', { name: /e2e sticker/i }).click()
  await expect(page).toHaveURL(editorUrl)
  await expect(page.getByLabel('Text content')).toHaveValue('Hello\nSticker')

  await page.goto('/my-stickers')
  await page.getByRole('link', { name: /e2e sticker/i }).click()
  await expect(page.getByLabel('Text content')).toHaveValue('Hello\nSticker')

  await page.getByRole('button', { name: /export and share/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Export sticker' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => {
    const node = document.activeElement
    const dialogNode = document.querySelector('[data-slot="dialog-content"]')
    return !!node && !!dialogNode && dialogNode.contains(node)
  })).toBe(true)

  const first = await downloadExport(page, 512)
  expect(first.darkCount).toBeGreaterThan(20)
  expect(first.darkBounds).not.toBeNull()
  expect(first.redBounds!.maxX - first.redBounds!.minX).toBeGreaterThan(40)
  expect(first.redBounds!.maxY - first.redBounds!.minY).toBeGreaterThan(40)
  expect(first.darkBounds!.maxY - first.darkBounds!.minY).toBeGreaterThan(20)

  const large = await downloadExport(page, 1024)
  expect(large.darkCount).toBeGreaterThan(20)
  expect(Math.abs(large.redBounds!.minX / 2 - first.redBounds!.minX)).toBeLessThan(12)
  expect(Math.abs(large.darkBounds!.minY / 2 - first.darkBounds!.minY)).toBeLessThan(12)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('mobile editor save, reopen, and export stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditorFromDashboard(page)
  await expect(page.getByRole('button', { name: /save to my stickers/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /export and share/i })).toBeVisible()
  await page.getByTestId('photo-file-input').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: redPng })
  await waitForImageLayer(page)
  await page.getByRole('button', { name: 'Text' }).click()
  await page.getByRole('button', { name: 'Sticker properties' }).click()
  const properties = page.getByRole('dialog', { name: 'Sticker properties' })
  await expect(properties.getByLabel('Text content')).toBeVisible()
  await properties.getByLabel('Text content').fill('Mobile\nText')
  await page.keyboard.press('Escape')
  await page.getByLabel('Sticker title').fill('Mobile Sticker')
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await expect(page.getByRole('status')).toContainText(/saved locally/i)
  await page.goto('/my-stickers')
  await page.getByRole('link', { name: /mobile sticker/i }).click()
  await expect(page.getByLabel('Text content')).toHaveValue('Mobile\nText')
  await page.getByRole('button', { name: /export and share/i }).click()
  await downloadExport(page, 512)
})

test('editor layouts at 1024 and 1100 keep the canvas ready', async ({ page }) => {
  for (const width of [1024, 1100]) {
    await page.setViewportSize({ width, height: 768 })
    await openEditorFromDashboard(page)
    await expect(page.getByRole('button', { name: /save to my stickers/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /export and share/i })).toBeVisible()
  }
})

test('template cloning and layer manager workflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/templates')
  const card = page.getByRole('button', { name: 'Good Vibes Pack' }).first()
  await card.click()
  const dialog = page.getByRole('dialog', { name: 'Good Vibes Pack' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Use Template' }).click()
  await page.waitForURL(/\/editor\/[0-9a-f-]+/i)

  await expect(page.getByLabel('Sticker title')).toHaveValue('Good Vibes Pack Copy')
  const canvas = page.getByTestId('editor-canvas')
  await expect(canvas).toBeVisible()

  await page.getByRole('button', { name: 'Layers' }).click()
  const inspector = page.locator('.editor > .inspector')
  await expect(inspector.getByRole('tab', { name: 'Layers' })).toHaveAttribute('data-state', 'active')

  const bringForward = inspector.getByRole('button', { name: /Bring .* forward/ }).first()
  if (await bringForward.isEnabled()) {
    await bringForward.click()
  }

  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await expect(page.getByRole('status')).toContainText(/saved locally/i)

  await page.goto('/my-stickers')
  await page.getByRole('link', { name: /Good Vibes Pack Copy/i }).click()
  await expect(page.getByLabel('Sticker title')).toHaveValue('Good Vibes Pack Copy')
})

test('pack creation, adding sticker, and ZIP export', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openEditorFromDashboard(page)
  await page.getByRole('button', { name: 'Text' }).click()
  await page.getByLabel('Text content').fill('Sticker For Pack')
  await page.getByLabel('Sticker title').fill('Pack Sticker 1')
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await expect(page.getByRole('status')).toContainText(/saved locally/i)

  await page.goto('/my-stickers')
  await expect(page.getByRole('heading', { name: 'My Sticker Packs' })).toBeVisible()

  await page.getByRole('button', { name: 'New Pack' }).first().click()
  const createDialog = page.getByRole('dialog', { name: 'Create New Pack' })
  await expect(createDialog).toBeVisible()
  await createDialog.getByLabel('Pack Name').fill('E2E Pack')
  await createDialog.getByRole('button', { name: 'Create Pack' }).click()
  await expect(createDialog).toBeHidden()

  await expect(page.getByRole('heading', { name: 'E2E Pack' })).toBeVisible()

  await page.getByRole('button', { name: 'Add Stickers' }).click()
  const addDialog = page.getByRole('dialog', { name: /add stickers to e2e pack/i })
  await expect(addDialog).toBeVisible()
  await addDialog.getByRole('checkbox').click()
  await page.keyboard.press('Escape')

  await expect(page.locator('.pack-detail')).toContainText('1 stickers · Local')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ZIP' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('e2e_pack.zip')
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()

  const { readFileSync } = await import('node:fs')
  const zipBytes = readFileSync(downloadPath!)
  expect(zipBytes[0]).toBe(0x50)
  expect(zipBytes[1]).toBe(0x4b)
  expect(zipBytes[2]).toBe(0x03)
  expect(zipBytes[3]).toBe(0x04)
  expect(zipBytes.length).toBeGreaterThan(200)
})

test('manual erase and restore mask workflow with undo, export parity, and persistence', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openEditorFromDashboard(page)
  await page.getByTestId('photo-file-input').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: redPng })
  await waitForImageLayer(page)

  // 1. Activate Erase tool
  await page.getByRole('button', { name: 'Erase' }).first().click()

  // 2. Hover over canvas to verify cursor preview
  const canvas = page.getByTestId('editor-canvas')
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  const centerX = canvasBox!.x + canvasBox!.width / 2
  const centerY = canvasBox!.y + canvasBox!.height / 2

  await page.mouse.move(centerX, centerY)
  const cursor = page.getByTestId('brush-cursor')
  await expect(cursor).toBeVisible()

  // 3. Draw erase stroke through the center
  await page.mouse.down()
  await page.mouse.move(centerX + 30, centerY)
  await page.mouse.move(centerX + 60, centerY)
  await page.mouse.up()

  // 4. Verify Reset Mask button appears in Inspector
  const resetBtn = page.getByRole('button', { name: 'Reset Mask' })
  await expect(resetBtn).toBeVisible()

  // 5. Test Undo: resets mask, Reset Mask button disappears
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(resetBtn).toBeHidden()

  // 6. Test Redo: restores erased mask
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(resetBtn).toBeVisible()

  // 7. Save sticker with mask
  await page.getByLabel('Sticker title').fill('Masked Sticker')
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await expect(page.getByRole('status')).toContainText(/saved locally/i)

  // 8. Reload page: mask rehydrates from persistence
  await page.reload()
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await expect(page.getByLabel('Sticker title')).toHaveValue('Masked Sticker')
  await expect(resetBtn).toBeVisible()

  // 9. Export transparent PNG and verify exported pixels
  await page.getByRole('button', { name: /export and share/i }).click()
  const pixels = await downloadExport(page, 512)
  expect(pixels.corner[3]).toBe(0) // Transparent corner
  expect(pixels.maxAlpha).toBeGreaterThan(200) // Red pixels still present
  expect(pixels.redCount).toBeGreaterThan(100)
  // Erased stroke hit center area, center pixel is transparent
  expect(pixels.center[3]).toBe(0)
})
