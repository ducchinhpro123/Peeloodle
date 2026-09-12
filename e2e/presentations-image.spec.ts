import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * P18/P19 browser evidence: a real personal image is uploaded, actually painted by
 * Konva, persisted to IndexedDB with its bytes, and still paints after reload.
 *
 * Deliberately takes no screenshots: this spec is pixel evidence, and the committed
 * p15/p17 captures belong to other specs.
 */

async function settleDevServer(page: Page) {
  // The Vite dev client performs one dep-optimizer reload shortly after first load.
  await page.waitForLoadState('load')
  await page.waitForTimeout(900)
}

/**
 * Counts opaque pixels that differ from the canvas's dominant colour, i.e. the
 * pixels that are actually artwork. A blank slide is one flat colour, so this
 * number rises only if something was really painted.
 */
async function artworkPixels(page: Page) {
  return page.locator('canvas').first().evaluate((canvas) => {
    const context = canvas.getContext('2d')
    if (!context) return -1
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const counts = new Map<string, number>()
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3]! <= 150) continue
      const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let modal = 0
    let total = 0
    for (const count of counts.values()) {
      total += count
      if (count > modal) modal = count
    }
    return total - modal
  })
}

async function readEditorState(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/features/presentations/editor/store.ts')
    const state = store.usePresentationStore.getState()
    const documentModel = state.document
    if (!documentModel) return null
    const image = documentModel.slides.flatMap((slide) => slide.elements).find((element) => element.kind === 'image')
    return {
      assets: documentModel.assets.map((asset) => ({
        id: asset.id,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        shaLength: asset.sha256.length,
      })),
      image: image ? { x: image.x, y: image.y, width: image.width, height: image.height } : null,
      dirty: state.dirty,
    }
  })
}

test('uploads a personal image, paints it, stores its bytes, and reopens it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await settleDevServer(page)
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  const blankArtwork = await artworkPixels(page)

  // A real PNG from the repo, through the real file input: validateUpload sniffing,
  // decode, hashing and the insert command all run for real here.
  await page.getByTestId('presentation-image-input').setInputFiles(join(process.cwd(), 'public', 'apple-touch-icon.png'))

  await expect.poll(async () => (await readEditorState(page))?.image ?? null).not.toBeNull()
  const inserted = await readEditorState(page)
  expect(inserted?.assets).toHaveLength(1)
  expect(inserted?.assets[0]).toMatchObject({ width: 173, height: 180, mimeType: 'image/png', shaLength: 64 })
  if (!inserted?.image) throw new Error('no image element was inserted')

  // Positioned inside the 1280x720 page, at natural size (the policy never upscales).
  expect(inserted.image.x).toBeGreaterThanOrEqual(0)
  expect(inserted.image.y).toBeGreaterThanOrEqual(0)
  expect(inserted.image.x + inserted.image.width).toBeLessThanOrEqual(1280)
  expect(inserted.image.y + inserted.image.height).toBeLessThanOrEqual(720)
  expect(inserted.dirty).toBe(true)

  // It is actually drawn, and nothing failed to draw.
  await expect(page.locator('.presentation-canvas-error')).toHaveCount(0)
  await expect.poll(async () => (await artworkPixels(page)) - blankArtwork).toBeGreaterThan(500)

  // The completed insert is autosaved, and the status only says so once it is true.
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 10_000 })

  const assetId = inserted.assets[0]!.id
  const stored = await page.evaluate(async (id) => {
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const repository = persistence.createIdbPresentationRepository()
    const record = await repository.getMedia(id)
    // Hash the stored bytes so this asserts identity with the uploaded file rather
    // than merely that some bytes of the right type were written.
    const digest = await crypto.subtle.digest('SHA-256', record.bytes)
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return { hasMedia: await repository.hasMedia(id), bytes: record.bytes.length, mimeType: record.mimeType, sha256 }
  }, assetId)
  expect(stored).toMatchObject({ hasMedia: true, mimeType: 'image/png' })
  expect(stored.bytes).toBeGreaterThan(1000)
  expect(stored.sha256).toBe(inserted.assets[0]!.sha256)

  // Reload and reopen: the document and its bytes come back off disk, and the
  // stored media is decoded back onto the canvas rather than remembered in memory.
  await page.reload()
  await page.goto('/presentations')
  await page.getByRole('link', { name: 'Open Untitled presentation' }).click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.locator('.presentation-canvas-error')).toHaveCount(0)
  await expect.poll(async () => artworkPixels(page)).toBeGreaterThan(500)

  const reopened = await readEditorState(page)
  expect(reopened).toMatchObject({ dirty: false })
  expect(reopened?.assets).toHaveLength(1)
  expect(reopened?.assets[0]).toMatchObject({ id: assetId, width: 173, height: 180 })
  expect(reopened?.image).toMatchObject({ width: inserted.image.width, height: inserted.image.height })
})

test('refuses an unsupported file and leaves no element behind', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await settleDevServer(page)
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)

  // An SVG is on the reject list; it must not become an asset or an element.
  await page.getByTestId('presentation-image-input').setInputFiles({
    name: 'shape.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'),
  })

  await expect(page.getByRole('alert')).toBeVisible()
  const state = await readEditorState(page)
  expect(state?.assets).toHaveLength(0)
  expect(state?.image).toBeNull()
  expect(state?.dirty).toBe(false)
})
