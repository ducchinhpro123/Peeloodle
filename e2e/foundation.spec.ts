import { expect, test } from '@playwright/test'

const screenshots = '/tmp/stickerlab-browser-verification'

async function expectContained(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

function expectHorizontallyWithin(inner: { x: number; width: number }, outer: { x: number; width: number }, label: string) {
  expect(inner.x, `${label} left`).toBeGreaterThanOrEqual(outer.x - 1)
  expect(inner.x + inner.width, `${label} right`).toBeLessThanOrEqual(outer.x + outer.width + 1)
}

test('Dashboard remains contained at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await expectContained(page)
  await expect(page.locator('.hero-art')).toBeVisible()
  await page.screenshot({ path: `${screenshots}/dashboard-1024x768-current.png`, fullPage: true })
})

test('Dashboard composition at 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await expectContained(page)
  const heading = page.getByRole('heading', { level: 1, name: /Small stickers/ })
  await expect(heading.locator('em')).toHaveText('Big personality.')
  const styles = await heading.evaluate((el) => {
    const computed = getComputedStyle(el)
    return { weight: computed.fontWeight, family: computed.fontFamily, size: computed.fontSize }
  })
  expect(Number(styles.weight)).toBeLessThan(700)
  expect(styles.family).toMatch(/Chewy/i)
  await expect(page.locator('.hero-art')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search templates and packs' })).toBeVisible()
  await page.screenshot({ path: `${screenshots}/dashboard-1440x900-current.png`, fullPage: false })
})

test('tablet headers stay within their fixed height at 1024px and 1100px', async ({ page }) => {
  for (const width of [1024, 1100]) {
    await page.setViewportSize({ width, height: 768 })
    await page.goto('/templates')
    const header = page.locator('.header')
    await expect(header).toHaveCSS('height', '64px')
    const headerBox = await header.boundingBox()
    const childBoxes = await header.locator(':scope > *').evaluateAll((children) => children.map((child) => {
      const box = child.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    }))
    expect(headerBox).not.toBeNull()
    expect(childBoxes.filter(({ top, bottom }) => top < headerBox!.top || bottom > headerBox!.bottom)).toEqual([])
    await expect(page.getByRole('button', { name: 'Search templates and packs' })).toBeVisible()
    await page.screenshot({ path: `${screenshots}/header-${width}x768-current.png`, fullPage: true })
  }
})

test('editor tablet layout and export modal render without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 768 })
  await page.goto('/create')
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await expect(page.getByText('Opening sticker…')).toHaveCount(0)
  await expectContained(page)
  await page.screenshot({ path: `${screenshots}/editor-1100x768-current.png`, fullPage: true })
  await page.getByRole('button', { name: /export and share/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Export sticker' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Download PNG' })).toBeVisible()
  await page.screenshot({ path: `${screenshots}/editor-save-modal-1100x768-current.png`, fullPage: true })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test.describe('mobile touch Dashboard', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })

  test('contains Dashboard at 390px with touch emulation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    // Document scrollWidth alone misses clipping because main uses overflow: hidden.
    await expectContained(page)
    const viewport = page.viewportSize()!
    const mainBox = await page.locator('main').boundingBox()
    const splitBox = await page.locator('.split').boundingBox()
    const recentBox = await page.getByRole('heading', { name: /Recent Projects/ }).evaluate((heading) => {
      const section = heading.closest('section')
      if (!section) return null
      const box = section.getBoundingClientRect()
      return { x: box.left, width: box.width }
    })
    const rail = page.locator('.split .rail')
    const railBox = await rail.boundingBox()
    expect(mainBox).not.toBeNull()
    expect(splitBox).not.toBeNull()
    expect(recentBox).not.toBeNull()
    expect(railBox).not.toBeNull()
    const viewportBox = { x: 0, width: viewport.width }
    expectHorizontallyWithin(recentBox!, mainBox!, 'Recent Projects vs main')
    expectHorizontallyWithin(recentBox!, viewportBox, 'Recent Projects vs viewport')
    expectHorizontallyWithin(splitBox!, mainBox!, 'split vs main')
    expectHorizontallyWithin(splitBox!, viewportBox, 'split vs viewport')
    expectHorizontallyWithin(railBox!, mainBox!, 'rail vs main')
    await expect.poll(() => rail.evaluate((el) => getComputedStyle(el).overflowX)).toMatch(/^(auto|scroll|overlay)$/)
    await expect.poll(() => rail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await rail.evaluate((el) => { el.scrollLeft = el.scrollWidth })
    await expect.poll(() => rail.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    expectHorizontallyWithin((await rail.boundingBox())!, mainBox!, 'rail vs main after scroll')
    await expectContained(page)
    await page.screenshot({ path: `${screenshots}/dashboard-390x844-current.png`, fullPage: true })
  })

  test('closes navigation after choosing the current-route tool link', async ({ page }) => {
    await page.goto('/create')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const sheet = page.getByRole('dialog', { name: 'Navigation' })
    await sheet.getByRole('link', { name: 'Background Eraser' }).click()
    await expect(sheet).toBeHidden()
  })

  test('navigation and dialog close controls have 44px hit areas', async ({ page }) => {
    await page.goto('/')
    const opener = page.getByRole('button', { name: 'Open navigation' })
    const openerBox = await opener.boundingBox()
    expect(openerBox).not.toBeNull()
    expect(openerBox!.width).toBeGreaterThanOrEqual(44)
    expect(openerBox!.height).toBeGreaterThanOrEqual(44)
    await opener.click()
    const close = page.getByRole('button', { name: 'Close navigation' })
    const closeBox = await close.boundingBox()
    expect(closeBox).not.toBeNull()
    expect(closeBox!.width).toBeGreaterThanOrEqual(44)
    expect(closeBox!.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden()
  })
})
