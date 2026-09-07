import { expect, test, type Locator, type Page } from '@playwright/test'

const screenshots = '/tmp/stickerlab-ui-audit'

async function expectDialogFits(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible()
  const box = (await dialog.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(15)
  expect(box.y).toBeGreaterThanOrEqual(15)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 15)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 15)
  expect(await dialog.locator('.dialog-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true })
  const closeBox = (await close.boundingBox())!
  expect(closeBox.width).toBeGreaterThanOrEqual(44)
  expect(closeBox.height).toBeGreaterThanOrEqual(44)
  // Keyboard focus must not escape into the page behind the modal.
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`scrapbook hero stays readable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/templates')
    await page.evaluate(() => document.fonts.ready)
    const hero = page.locator('.hero')
    await expect(hero.getByRole('heading', { name: 'Find your vibe. Make it yours.' })).toBeVisible()
    await hero.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const copy = (await hero.locator('.hero-copy').boundingBox())!
    const art = (await hero.locator('.collage').boundingBox())!
    if (viewport.width === 390) expect(art.y).toBeGreaterThan(copy.y + copy.height)
    else expect(art.x).toBeGreaterThan(copy.x + copy.width - 12)
    await hero.screenshot({ path: `${screenshots}/scrapbook-${viewport.width}.png` })
    await page.getByRole('textbox', { name: 'Search sample templates' }).fill('no-such-template')
    await expect(page.getByRole('heading', { name: 'No sample templates found' })).toBeVisible()
    await page.getByRole('button', { name: 'Reset filters' }).click()
    await expect(page.locator('.template-card').first()).toBeVisible()
  })

  test(`pages and shared dialogs stay usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const [name, route] of [['dashboard', '/'], ['templates', '/templates'], ['packs', '/my-stickers'], ['editor', '/create']]) {
      await page.goto(route!)
      await page.evaluate(() => document.fonts.ready)
      if (name === 'editor') await expect(page.getByTestId('editor-canvas')).toBeVisible()
      else await expect(page.locator('.hero-art')).toBeVisible()
      if (name === 'dashboard') {
        await expect(page.locator('.collage-studio img')).toHaveCount(8)
        await expect(page.locator('.feature-doodle')).toHaveCount(4)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const brokenImages = await page.locator('img').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => { image.loading = 'eager'; return image.decode().catch(() => undefined) }))
        return images.filter((image) => image.naturalWidth === 0).map((image) => image.src)
      })
      expect(brokenImages).toEqual([])
      await page.screenshot({ path: `${screenshots}/${name}-${viewport.width}.png`, fullPage: true, animations: 'disabled' })
    }

    const exportOpener = page.getByRole('button', { name: 'Export and share' })
    await exportOpener.click()
    const exportDialog = page.getByRole('dialog', { name: 'Export sticker', exact: true })
    await expectDialogFits(page, exportDialog)
    await exportDialog.getByText('1024 × 1024', { exact: true }).click()
    await expect(exportDialog.getByRole('radio').last()).toBeChecked()
    await page.screenshot({ path: `${screenshots}/export-dialog-${viewport.width}.png`, animations: 'disabled' })
    await exportDialog.getByRole('button', { name: 'WhatsApp / Telegram' }).click()
    const notice = page.getByRole('dialog', { name: 'Messenger packs are not available', exact: true })
    await expectDialogFits(page, notice)
    await notice.getByRole('button', { name: 'Got it' }).click()
    await expect(notice).toBeHidden()
    await expect(exportDialog.getByRole('button', { name: 'WhatsApp / Telegram' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(exportOpener).toBeFocused()

    await page.goto('/templates')
    const previewOpener = page.getByRole('button', { name: 'Good Vibes', exact: true }).first()
    await previewOpener.click()
    const preview = page.getByRole('dialog', { name: 'Good Vibes', exact: true })
    await expectDialogFits(page, preview)
    await preview.getByRole('img', { name: 'Good Vibes', exact: true }).evaluate((image: HTMLImageElement) => image.decode())
    await expect(preview).toContainText('move each decoration independently')
    await page.screenshot({ path: `${screenshots}/template-dialog-${viewport.width}.png`, animations: 'disabled' })
    await preview.getByRole('button', { name: 'Keep browsing' }).click()
    await expect(previewOpener).toBeFocused()

    await page.goto('/my-stickers')
    const newPack = page.getByRole('button', { name: 'New Pack', exact: true })
    await newPack.click()
    const create = page.getByRole('dialog', { name: 'Create New Pack' })
    await expectDialogFits(page, create)
    await create.getByLabel('Pack Name').fill('Little joys')
    await page.screenshot({ path: `${screenshots}/create-dialog-${viewport.width}.png`, animations: 'disabled' })
    await create.getByRole('button', { name: 'Create Pack', exact: true }).click()
    await expect(create).toBeHidden()
    await expect(page.locator('.pack-detail')).toBeVisible()
    await page.getByRole('button', { name: 'Add Stickers', exact: true }).click()
    const add = page.getByRole('dialog', { name: 'Add stickers to Little joys' })
    await expectDialogFits(page, add)
    await add.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const remove = page.getByRole('dialog', { name: 'Delete this pack?' })
    await expect(remove.getByRole('button', { name: 'Keep Pack', exact: true })).toBeFocused()
    await expectDialogFits(page, remove)
    await remove.getByRole('button', { name: 'Keep Pack', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeFocused()
    await expect(page.locator('.pack-detail')).toContainText('Little joys')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await remove.getByRole('button', { name: 'Delete Pack', exact: true }).click()
    await expect(remove).toBeHidden()
    await expect(page.getByRole('heading', { name: 'No local packs yet' })).toBeVisible()
    await expect(newPack).toBeFocused()
  })
}

test('short viewports scroll long dialogs without hiding their close control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 })
  await page.goto('/my-stickers')
  await page.getByRole('button', { name: 'New Pack', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create New Pack' })
  await expectDialogFits(page, dialog)
  await dialog.getByLabel('Pack Name').fill('a'.repeat(160))
  await dialog.getByRole('button', { name: 'Create Pack', exact: true }).click()
  await page.getByRole('button', { name: 'Add Stickers', exact: true }).click()
  const longDialog = page.getByRole('dialog')
  await expectDialogFits(page, longDialog)
  await longDialog.getByRole('button', { name: 'Done', exact: true }).scrollIntoViewIfNeeded()
  await expect(longDialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeInViewport()
  await longDialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(longDialog).toBeHidden()
})

test('dialog keyboard input never deletes the selected canvas layer', async ({ page }) => {
  await page.goto('/create')
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByRole('button', { name: 'Export and share' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export sticker', exact: true })
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).focus()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  await expect(page.locator('.editor > .inspector').getByLabel('Text content')).toBeVisible()
})
