import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { createClient, type Session } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'

const url = process.env.SUPABASE_TEST_URL
const key = process.env.SUPABASE_TEST_KEY
const emailA = process.env.SUPABASE_TEST_EMAIL_A
const password = process.env.SUPABASE_TEST_PASSWORD
const enabled = !!(url && key && emailA && password)
// Synthetic session setup is deliberately narrower than real magic-link delivery verification.
async function login(email = emailA!): Promise<Session> {
  const auth = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await auth.auth.signInWithPassword({ email, password: password! })
  if (error || !data.session) throw new Error(error?.message ?? 'No test session')
  return data.session
}
async function seed(context: BrowserContext, session: Session) {
  const parsed = new URL(url!)
  const domain = parsed.hostname
  const storageKey = `sb-${domain.split('.')[0]}-auth-token`
  await context.addCookies([
    { name: storageKey, value: encodeURIComponent(JSON.stringify(session)), domain, path: '/' },
  ])
  await context.addInitScript(({ session, storageKey }) => {
    if (!localStorage.getItem('cloud-test-signed-out')) {
      localStorage.setItem(storageKey, JSON.stringify(session))
    }
  }, { session, storageKey })
}
async function exportPixels(page: Page) {
  await page.getByRole('button', { name: 'Export and share' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export sticker' })
  await dialog.getByLabel('512 × 512').check()
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click()
  const path = await (await pending).path()
  const bytes = await readFile(path!)
  const hash = await inspectPixels(page, bytes)
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  return hash
}
async function inspectPixels(page: Page, bytes: Buffer) {
  const pixels = await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return { width: canvas.width, height: canvas.height, corner: data[3], opaque: data.filter((value, index) => index % 4 === 3 && value > 0).length, hash }
  }, bytes.toString('base64'))
  expect(pixels).toMatchObject({ width: 512, height: 512, corner: 0 })
  expect(pixels.opaque).toBeGreaterThan(100)
  expect(pixels.opaque).toBeLessThan(512 * 512)
  return pixels.hash
}

test('private cloud: upload, transformed mask/font, second browser reopen/export, offline retry, sign-out isolation', async ({ browser }) => {
  test.skip(!enabled, 'Dedicated ordinary-user credentials required; no emails are sent by this test')
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await seed(first, await login()); await seed(second, await login())
  const page = await first.newPage()
  await page.goto('/')
  await page.getByRole('link', { name: 'Create a Sticker', exact: true }).click()
  await expect(page.getByTestId('photo-file-input')).toBeAttached()
  await page.getByTestId('photo-file-input').setInputFiles('public/art/stickers/04-winking-smiley.webp')
  await expect(page.getByAltText('Image').first()).toBeVisible()
  await page.evaluate(async () => {
    const modulePath = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(modulePath)
    const state = useEditorStore.getState()
    const layer = state.document.layers.find((item: { kind: string }) => item.kind === 'image')
    const asset = state.assets[layer.assetId].asset
    const canvas = document.createElement('canvas'); canvas.width = asset.width; canvas.height = asset.height
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.clearRect(canvas.width / 3, canvas.height / 3, canvas.width / 3, canvas.height / 3)
    const mask = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
    state.applyMask(layer.id, crypto.randomUUID(), mask)
    state.applyTransform(layer.id, { ...layer.transform, rotation: 30, scaleX: 1.3, scaleY: -1.1 })
    state.addTextLayer({ content: 'Cloud font', fontFamily: 'Chewy', fontSize: 64, color: '#12223b' })
  })
  const title = `Cloud journey ${Date.now()}`
  await page.getByLabel('Sticker title').fill(title)
  await page.getByRole('button', { name: 'Save to My Stickers' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved to cloud', { timeout: 60000 })
  const editorPath = new URL(page.url()).pathname
  const hash = await exportPixels(page)
  const other = await second.newPage()
  await other.goto('/my-stickers')
  await expect(other.getByRole('link', { name: new RegExp(title) })).toBeVisible({ timeout: 60000 })
  const otherEditor = await second.newPage()
  await otherEditor.goto(editorPath)
  await expect(otherEditor.getByLabel('Sticker title')).toHaveValue(title)
  await expect(otherEditor.getByLabel('Text content')).toHaveValue('Cloud font')
  expect(await exportPixels(otherEditor)).toBe(hash)
  await otherEditor.close()

  // Save and rename a two-sticker pack, then inspect actual ordered ZIP contents on device two.
  await page.goto('/create')
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  const secondTitle = `${title} caption`
  await page.getByLabel('Sticker title').fill(secondTitle)
  await page.getByRole('button', { name: 'Save to My Stickers' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved to cloud', { timeout: 60000 })
  await page.goto('/my-stickers')
  await page.getByRole('button', { name: 'New Pack', exact: true }).click()
  await page.getByLabel('Pack Name').fill(title)
  await page.getByRole('button', { name: 'Create Pack', exact: true }).click()
  await page.getByRole('button', { name: 'Add Stickers', exact: true }).click()
  const firstMember = page.getByRole('checkbox', { name: `Include ${title}`, exact: true })
  await firstMember.click()
  await expect(firstMember).toBeChecked()
  const secondMember = page.getByRole('checkbox', { name: `Include ${secondTitle}`, exact: true })
  await secondMember.click()
  await expect(secondMember).toBeChecked()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: `Move ${secondTitle} up`, exact: true }).click()
  await page.getByRole('button', { name: 'Edit pack', exact: true }).click()
  const packTitle = `${title} pack renamed`
  await page.getByLabel('Pack Name').fill(packTitle)
  await page.getByLabel('Description (optional)').fill('Private cloud ordered export')
  await page.getByRole('button', { name: 'Save Pack', exact: true }).click()
  await expect(page.locator('.cloud-banner')).toContainText('Saved work is backed up', { timeout: 60000 })
  await other.goto('/my-stickers')
  await other.getByRole('button', { name: new RegExp(packTitle) }).click()
  const zipPromise = other.waitForEvent('download')
  await other.getByRole('button', { name: 'Download ZIP', exact: true }).click()
  const zip = await readFile((await (await zipPromise).path())!)
  const entries = new Map<string, Buffer>()
  for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
    expect(zip.readUInt16LE(offset + 8)).toBe(0)
    const size = zip.readUInt32LE(offset + 18), nameSize = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28)
    const name = zip.subarray(offset + 30, offset + 30 + nameSize).toString()
    const start = offset + 30 + nameSize + extra
    entries.set(name, zip.subarray(start, start + size)); offset = start + size
  }
  const manifest = JSON.parse(entries.get('manifest.json')!.toString())
  expect(manifest.description).toBe('Private cloud ordered export')
  expect(manifest.stickers.map((sticker: { title: string }) => sticker.title)).toEqual([secondTitle, title])
  expect(await inspectPixels(other, entries.get(manifest.stickers[1].filename)!)).toBe(hash)
  await other.goto(editorPath)
  await expect(other.getByLabel('Sticker title')).toHaveValue(title)
  // Offline cloud: Supabase network requests fail, while the local app and IndexedDB continue editing.
  await other.route('**/rest/v1/**', (route) => route.abort())
  await other.route('**/storage/v1/**', (route) => route.abort())
  await other.getByLabel('Sticker title').fill(`${title} offline`)
  await other.getByRole('button', { name: 'Save to My Stickers' }).click()
  await expect(other.locator('.save-status')).toHaveText('Saved locally · cloud pending')
  await other.reload()
  await expect(other.getByLabel('Sticker title')).toHaveValue(`${title} offline`)
  expect(await exportPixels(other)).toBe(hash)
  await other.unroute('**/rest/v1/**'); await other.unroute('**/storage/v1/**')
  await other.getByRole('button', { name: 'Refresh / retry cloud' }).click()
  await expect(other.locator('.save-status')).toHaveText('Saved to cloud', { timeout: 60000 })
  await other.getByRole('button', { name: /^Account:/ }).click()
  const account = other.getByRole('dialog', { name: 'Your private workspace' })
  await other.evaluate(({ storageKey }) => {
    localStorage.setItem('cloud-test-signed-out', 'true')
    localStorage.removeItem(storageKey)
  }, { storageKey: `sb-${new URL(url!).hostname.split('.')[0]}-auth-token` })
  await account.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(other.getByRole('button', { name: 'Guest account' })).toBeVisible({ timeout: 15000 })
  await other.goto('/my-stickers')
  await expect(other.getByRole('heading', { name: 'All Local Stickers' })).toBeVisible()
  await expect(other.getByText(`${title} offline`, { exact: true })).toHaveCount(0)
  await other.goto(editorPath)
  await expect(other.getByRole('heading', { name: 'Sticker not found' })).toBeVisible()
  await first.close(); await second.close()
  await first.close(); await second.close()
})

test('explicit guest import survives an account switch during an upload and resumes without duplicates', async ({ browser }) => {
  test.skip(!enabled || !process.env.SUPABASE_TEST_EMAIL_B, 'Two dedicated ordinary accounts required')
  const sessionA = await login(), sessionB = await login(process.env.SUPABASE_TEST_EMAIL_B!)
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pageA = await contextA.newPage()
  await pageA.goto('/create')
  await pageA.getByTestId('photo-file-input').setInputFiles('public/art/stickers/04-winking-smiley.webp')
  await expect(pageA.getByAltText('Image').first()).toBeVisible()
  const title = `Guest consent ${Date.now()}`
  await pageA.getByLabel('Sticker title').fill(title)
  await pageA.getByRole('button', { name: 'Save to My Stickers' }).click()
  await expect(pageA.locator('.save-status')).toHaveText('Saved locally')
  const guestPath = new URL(pageA.url()).pathname

  // Import into Account A, verifying explicit user initiation and progress.
  await seed(contextA, sessionA)
  await pageA.goto('/my-stickers')
  const accountA = pageA.getByRole('dialog', { name: 'Your private workspace' })
  await expect(accountA.getByRole('button', { name: 'Import guest collection / retry' })).toBeVisible()
  await expect(pageA.locator('.project-card').filter({ hasText: title })).toHaveCount(0)
  await accountA.getByRole('button', { name: 'Import guest collection / retry' }).click()
  await expect(accountA.getByRole('status').filter({ hasText: 'Import saved to cloud' })).toBeVisible({ timeout: 60000 })
  // Duplicate import retry is a safe no-op.
  await accountA.getByRole('button', { name: 'Import guest collection / retry' }).click()
  await expect(accountA.getByRole('status').filter({ hasText: 'Import saved to cloud' })).toBeVisible({ timeout: 60000 })
  await accountA.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(pageA.locator('.project-card').filter({ hasText: title })).toHaveCount(1)

  // Account B context on the same guest device: guest work is not imported without separate consent.
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await seed(contextB, sessionB)
  const pageB = await contextB.newPage()
  await pageB.goto('/my-stickers')
  await expect(pageB.getByRole('button', { name: `Account: ${sessionB.user.email}` })).toBeAttached()
  const accountB = pageB.getByRole('dialog', { name: 'Your private workspace' })
  if (await accountB.isVisible()) await accountB.getByRole('button', { name: 'Not now', exact: true }).click()
  await expect(pageB.locator('.project-card').filter({ hasText: title })).toHaveCount(0)

  // Sign out Account A: guest originals survive intact on this device.
  await pageA.getByRole('button', { name: /^Account:/ }).click()
  await pageA.evaluate(({ storageKey }) => {
    localStorage.setItem('cloud-test-signed-out', 'true')
    localStorage.removeItem(storageKey)
  }, { storageKey: `sb-${new URL(url!).hostname.split('.')[0]}-auth-token` })
  await accountA.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(pageA.getByRole('button', { name: 'Guest account' })).toBeVisible()
  await pageA.goto(guestPath)
  await expect(pageA.getByLabel('Sticker title')).toHaveValue(title)
  await contextA.close(); await contextB.close()
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`account and invalid callback remain accessible at ${viewport.width}`, async ({ browser }) => {
    test.skip(!enabled, 'Cloud configuration required')
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.goto('/')
    await page.getByRole('button', { name: 'Guest account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sign in to StickerLab' })
    await expect(dialog.getByLabel('Email address')).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Request sign-in link' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/stickerlab-cloud-account-${viewport.width}.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Guest account' })).toBeFocused()
    await page.goto('/auth/callback?error=access_denied&next=https://example.invalid')
    await expect(page.getByRole('alert')).toContainText('Request a fresh link')
    await expect(page).toHaveURL(/\/auth\/callback$/)
    await context.close()
  })
}

