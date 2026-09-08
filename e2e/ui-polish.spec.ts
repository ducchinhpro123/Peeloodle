import { expect, test, type Locator, type Page } from '@playwright/test'

const screenshots = '/tmp/stickerlab-ui-audit'

for (const width of [3200, 1920, 1440, 1024, 390]) {
  test(`page banners fill the available content width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/templates', '/templates?view=explore', '/my-stickers']) {
      await page.goto(route)
      const hero = page.locator('.hero').first()
      await expect(hero).toBeVisible()
      const gap = await hero.evaluate((element) => {
        const parent = element.parentElement!
        const style = getComputedStyle(parent)
        const bounds = element.getBoundingClientRect()
        const outer = parent.getBoundingClientRect()
        return {
          left: bounds.left - outer.left - parseFloat(style.paddingLeft) - parseFloat(style.borderLeftWidth),
          right: outer.right - bounds.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      expect(Math.abs(gap.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(gap.right)).toBeLessThanOrEqual(1)
      expect(gap.overflow).toBe(false)
      await hero.screenshot({ path: `${screenshots}/full-width-${route === '/' ? 'home' : route.includes('explore') ? 'explore' : route.slice(1)}-${width}.png` })
    }
  })
}

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

for (const width of [1672, 1440, 1024, 860, 390, 320]) {
  test(`scrapbook header fits and keeps navigation accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    const header = page.getByRole('banner')
    const headerBox = (await header.boundingBox())!
    expect(headerBox.height).toBe(width <= 720 ? 112 : width <= 1150 ? 72 : 80)
    const controls = header.locator('a:visible, button:visible')
    const boxes = await controls.evaluateAll((elements) => elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }))
    for (const [index, box] of boxes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.y).toBeGreaterThanOrEqual(headerBox.y)
      expect(box.y + box.height).toBeLessThanOrEqual(headerBox.y + headerBox.height)
      for (const other of boxes.slice(index + 1)) {
        expect(box.x >= other.x + other.width || other.x >= box.x + box.width || box.y >= other.y + other.height || other.y >= box.y + box.height).toBe(true)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await header.screenshot({ path: `/tmp/stickerlab-header-comparison/header-${width}.png` })
    for (const [name, title] of [
      ['Search templates and packs', 'Search is not implemented'],
      ['Notifications', 'Notifications are unavailable'],
      ['Guest account', 'Sign in to StickerLab'],
    ]) {
      const opener = header.getByRole('button', { name, exact: true })
      await expect(opener).toBeInViewport()
      const box = (await opener.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      await opener.focus()
      await page.keyboard.press('Enter')
      await expectDialogFits(page, page.getByRole('dialog', { name: title, exact: true }))
      await page.keyboard.press('Escape')
      await expect(opener).toBeFocused()
    }
    if (width <= 900) {
      const menu = header.getByRole('button', { name: 'Open navigation' })
      await menu.click()
      const navigation = page.getByRole('dialog', { name: 'Navigation', exact: true })
      await navigation.getByRole('link', { name: 'Templates', exact: true }).click()
      await expect(navigation).toBeHidden()
    } else {
      await header.getByRole('link', { name: 'Templates', exact: true }).focus()
      await page.keyboard.press('Enter')
    }
    await expect(page).toHaveURL(/\/templates$/)
    await expect(header.getByRole('navigation', { includeHidden: true }).getByRole('link', { name: 'Templates', includeHidden: true })).toHaveAttribute('aria-current', 'page')
  })
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`packs scrapbook matches the composition and keeps actions usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/my-stickers?view=export-history')
    await page.evaluate(() => document.fonts.ready)
    const hero = page.locator('.hero')
    await hero.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
    await expect(hero.locator('.collage-polaroid')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const copy = (await hero.locator('.hero-copy').boundingBox())!
    const art = (await hero.locator('.collage').boundingBox())!
    if (viewport.width === 390) expect(art.y).toBeGreaterThan(copy.y + copy.height)
    else expect(art.x).toBeGreaterThan(copy.x + copy.width)
    await hero.screenshot({ path: `${screenshots}/packs-scrapbook-${viewport.width}.png` })
    await page.getByRole('button', { name: 'All Packs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No local packs yet' })).toBeVisible()
    await hero.getByRole('button', { name: 'New Pack', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create New Pack' })
    await expectDialogFits(page, dialog)
    await page.keyboard.press('Escape')
    await expect(hero.getByRole('button', { name: 'New Pack', exact: true })).toBeFocused()
    await hero.getByRole('link', { name: 'Import Photos', exact: true }).click()
    await expect(page.getByTestId('editor-canvas')).toBeVisible()
  })

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
        await expect(page.locator('.collage-studio .collage-cat, .collage-studio .collage-buddy')).toHaveCount(2)
        await expect(page.locator('.collage-studio .collage-polaroid')).toHaveCount(2)
        await expect(page.locator('.feature-scrap')).toHaveText('Make it yours!')
        await expect(page.locator('.feature-doodle')).toHaveCount(4)
        const guest = page.getByRole('button', { name: 'Guest account' })
        await guest.click()
        const account = page.getByRole('dialog', { name: 'Sign in to StickerLab' })
        await expectDialogFits(page, account)
        await expect(account.getByText(/Cloud saving is not configured|Email address/)).toBeVisible()
        await page.screenshot({ path: `${screenshots}/account-dialog-${viewport.width}.png`, animations: 'disabled' })
        await page.keyboard.press('Escape')
        await expect(guest).toBeFocused()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const headerHeight = (await page.getByRole('banner').boundingBox())!.height
      expect((await page.locator('.layout').boundingBox())!.y).toBeGreaterThanOrEqual(headerHeight)
      if (viewport.width > 720) {
        const layout = page.locator(name === 'editor' ? '.editor-layout' : '.layout > .sidebar')
        expect((await layout.boundingBox())!.height).toBeCloseTo(viewport.height - headerHeight, 0)
      }
      const brokenImages = await page.locator('img').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => { image.loading = 'eager'; return image.decode().catch(() => undefined) }))
        return images.filter((image) => image.naturalWidth === 0).map((image) => image.src)
      })
      expect(brokenImages).toEqual([])
      await page.screenshot({ path: `${screenshots}/${name}-${viewport.width}.png`, fullPage: true, animations: 'disabled' })
    }

    await expect(page.getByText('Exports fit the visible artwork.', { exact: true })).toBeVisible()
    expect(await page.locator('.canvas-workspace').evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('conic-gradient')
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(page.locator('.canvas-controls')).toContainText('110%')
    await page.getByRole('button', { name: 'Reset view', exact: true }).click()
    await expect(page.locator('.canvas-controls')).toContainText('100%')

    const exportOpener = page.getByRole('button', { name: 'Export and share' })
    await exportOpener.click()
    const exportDialog = page.getByRole('dialog', { name: 'Export sticker', exact: true })
    await expectDialogFits(page, exportDialog)
    await exportDialog.getByText('Up to 1024 px longest edge', { exact: true }).click()
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
    const previewOpener = page.getByRole('button', { name: 'Orbit Pop', exact: true }).first()
    await previewOpener.click()
    const preview = page.getByRole('dialog', { name: 'Orbit Pop', exact: true })
    await expectDialogFits(page, preview)
    await preview.getByRole('img', { name: 'Orbit Pop', exact: true }).evaluate((image: HTMLImageElement) => image.decode())
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
