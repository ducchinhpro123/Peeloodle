import { expect, test, type Page } from '@playwright/test'

const shots = '/tmp/grok-goal-6ad089e281f0/implementer/tool-entry'

async function waitForEditor(page: Page) {
  await expect(page.getByText('Opening sticker…')).toHaveCount(0)
  await expect(page.getByLabel('Sticker title')).toBeVisible()
}

test.describe('tool entry desktop', () => {
  test('sidebar and dashboard shortcuts activate the advertised tools', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.goto('/')
    await page.locator('.side-tools').getByRole('link', { name: 'Background Eraser' }).click()
    await waitForEditor(page)
    await expect(page.getByRole('button', { name: 'Background Eraser' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: /upload a photo to erase the background/i })).toBeVisible()
    expect(page.url()).toMatch(/tool=erase/)
    await page.screenshot({ path: `${shots}/e2e-erase-1440.png`, animations: 'disabled' })

    await page.goto('/')
    await page.locator('.feature-grid').getByRole('link', { name: /Text & Emoji/ }).click()
    await waitForEditor(page)
    await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('tab', { name: 'Stickers' }).first()).toHaveAttribute('aria-selected', 'true')
    expect(page.url()).toMatch(/tool=text/)
    await page.screenshot({ path: `${shots}/e2e-text-1440.png`, animations: 'disabled' })

    await page.goto('/')
    await page.locator('.feature-grid').getByRole('link', { name: /Filters & Effects/ }).click()
    await waitForEditor(page)
    await expect(page.getByRole('tab', { name: 'Effects' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(/no effect has been applied yet/i)).toBeVisible()
    expect(page.url()).toMatch(/tool=effects/)
    await page.screenshot({ path: `${shots}/e2e-effects-1440.png`, animations: 'disabled' })

    await page.goto('/')
    await page.locator('.side-tools').getByRole('link', { name: 'Export & Share' }).click()
    await waitForEditor(page)
    const dialog = page.getByRole('dialog', { name: 'Export sticker' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('not a WhatsApp or Telegram sticker pack')
    expect(page.url()).toMatch(/tool=export/)
    await page.screenshot({ path: `${shots}/e2e-export-1440.png`, animations: 'disabled' })

    expect(errors, errors.join('\n')).toEqual([])
  })

  test('an open sticker is not replaced by a blank document', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/create')
    await waitForEditor(page)
    await page.getByRole('button', { name: 'Text' }).click()
    await expect(page.getByLabel('Text content')).toBeVisible()
    const id = page.url().match(/\/editor\/([^/?]+)/)?.[1]
    expect(id).toBeTruthy()
    await page.getByRole('link', { name: 'Home', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Small stickers/ })).toBeVisible()
    await page.locator('.side-tools').getByRole('link', { name: 'Background Eraser' }).click()
    await waitForEditor(page)
    await expect(page).toHaveURL(new RegExp(`/editor/${id}.*tool=erase`))
    await expect(page.getByLabel('Text content')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Background Eraser' })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: `${shots}/e2e-keep-document-1440.png`, animations: 'disabled' })
    expect(errors, errors.join('\n')).toEqual([])
  })
})

test.describe('tool entry tablet', () => {
  test('effects stay reachable at 1024×768', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/create?tool=effects')
    await waitForEditor(page)
    await page.getByRole('button', { name: 'Sticker properties' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sticker properties' })
    await expect(dialog.getByRole('tab', { name: 'Effects' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByText(/no effect has been applied yet/i)).toBeVisible()
    await page.screenshot({ path: `${shots}/e2e-effects-1024.png`, animations: 'disabled' })
  })
})

test.describe('tool entry mobile', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test('repeating Export & Share reopens the dialog', async ({ page }) => {
    await page.goto('/create?tool=export')
    await waitForEditor(page)
    const dialog = page.getByRole('dialog', { name: 'Export sticker' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Export & Share', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden()
    await expect(page.getByRole('dialog', { name: 'Export sticker' })).toBeVisible()
  })

  test('Ctrl-clicking Text & Emoji leaves Eraser on the original editor', async ({ page, context }) => {
    await page.goto('/create?tool=text')
    await waitForEditor(page)
    await page.getByRole('button', { name: 'Background Eraser', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Background Eraser', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const shortcut = page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Text & Emoji', exact: true })
    const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
    await shortcut.click({ modifiers: ['ControlOrMeta'] })
    await expect(page.getByRole('button', { name: 'Background Eraser', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const popup = await popupPromise
    if (popup) {
      expect(popup.url()).toMatch(/tool=text/)
      await popup.close()
    }
  })

  test('repeating Text & Emoji reactivates text after erase', async ({ page }) => {
    await page.goto('/create?tool=text')
    await waitForEditor(page)
    await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Background Eraser', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Background Eraser', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Text & Emoji', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  test('mobile navigation activates Text & Emoji', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto('/')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const sheet = page.getByRole('dialog', { name: 'Navigation' })
    await sheet.getByRole('link', { name: 'Text & Emoji' }).click()
    await expect(sheet).toBeHidden()
    await waitForEditor(page)
    await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(page.url()).toMatch(/tool=text/)
    await page.screenshot({ path: `${shots}/e2e-text-390.png`, animations: 'disabled' })
    expect(errors, errors.join('\n')).toEqual([])
  })
})
