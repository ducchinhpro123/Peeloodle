import { expect, test, type Page } from '@playwright/test'
import { readDocument, settleDevServer } from './presentations'

/**
 * P20 in a real browser: rename, duplicate and delete write real IndexedDB rows,
 * and deleting a copy leaves the original alone. Every claim is read back from the
 * IndexedDB repository, not from the screen.
 *
 * No screenshots: `proofs/out` belongs to the other specs.
 */

async function openLibrary(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await settleDevServer(page)
}

/** Creates a blank presentation from the library and returns to the library. */
async function createPresentation(page: Page): Promise<string> {
  // The hero button is the one that always exists, empty library or not.
  await page.getByRole('button', { name: 'Start a blank presentation' }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  const id = (await readDocument(page))!.id
  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page).toHaveURL(/\/presentations$/)
  return id
}

/** The persisted row, read straight from IndexedDB: the claim under test. */
async function readStored(page: Page, id: string) {
  return page.evaluate(async (presentationId) => {
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const document = await persistence.createIdbPresentationRepository().getPresentation(presentationId)
    return {
      id: document.id,
      title: document.title,
      revision: document.revision,
      slideId: document.slides[0]!.id,
      assets: document.assets.map((asset) => ({ id: asset.id, byteLength: asset.byteLength })),
    }
  }, id)
}

/** Every stored presentation id, read straight from IndexedDB. */
async function storedIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const rows = await persistence.createIdbPresentationRepository().listPresentations()
    return rows.map((row) => row.id)
  })
}

test('renaming stores the new title at the next revision without touching the slides', async ({ page }) => {
  await openLibrary(page)
  const id = await createPresentation(page)
  const before = await readStored(page, id)

  await page.getByRole('button', { name: `Rename ${before.title}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Rename this presentation' })
  const field = dialog.getByRole('textbox', { name: 'Presentation name' })
  await expect(field).toHaveValue(before.title)
  await field.fill('Bài học về Hà Nội và các bạn')
  // Enter submits the rename form; Escape is covered by the cancel path below.
  await page.keyboard.press('Enter')

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('link', { name: 'Open Bài học về Hà Nội và các bạn' })).toBeVisible()

  const after = await readStored(page, id)
  expect(after.title).toBe('Bài học về Hà Nội và các bạn')
  expect(after.revision).toBe(before.revision + 1)
  expect(after.slideId).toBe(before.slideId)
})

test('duplicating writes an independent stored row and leaves the source alone', async ({ page }) => {
  await openLibrary(page)
  const id = await createPresentation(page)
  const source = await readStored(page, id)

  await page.getByRole('button', { name: `Duplicate ${source.title}` }).click()
  await expect(page.getByRole('link', { name: `Open ${source.title} copy` })).toBeVisible()

  const ids = await storedIds(page)
  expect(ids).toHaveLength(2)
  const copyId = ids.find((row) => row !== id)!
  const copy = await readStored(page, copyId)
  expect(copy.title).toBe(`${source.title} copy`)
  expect(copy.id).not.toBe(id)
  // Independent document contents, not a shared row.
  expect(copy.slideId).not.toBe(source.slideId)

  expect(await readStored(page, id)).toMatchObject({ title: source.title, revision: source.revision, slideId: source.slideId })
})

test('deleting a duplicate cancels safely, removes only that row, and returns focus', async ({ page }) => {
  await openLibrary(page)
  const firstId = await createPresentation(page)
  const secondId = await createPresentation(page)
  await page.getByRole('button', { name: 'Duplicate Untitled presentation' }).first().click()
  await expect(page.getByRole('link', { name: 'Open Untitled presentation copy' })).toBeVisible()

  const withCopy = await storedIds(page)
  expect(withCopy).toHaveLength(3)
  const copyId = withCopy.find((row) => row !== firstId && row !== secondId)!

  // Cancel first: the confirmation opens on the safe action, and closing it puts
  // focus back on the button that opened it without removing anything.
  const deleteCopy = page.getByRole('button', { name: 'Delete Untitled presentation copy' })
  await deleteCopy.click()
  const confirm = page.getByRole('dialog', { name: 'Delete this presentation?' })
  await expect(confirm.getByRole('button', { name: 'Keep presentation' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expect(deleteCopy).toBeFocused()
  expect(await storedIds(page)).toHaveLength(3)

  // Confirming removes the copy and nothing else.
  await deleteCopy.click()
  await confirm.getByRole('button', { name: 'Delete presentation' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('link', { name: 'Open Untitled presentation copy' })).toBeHidden()

  const left = await storedIds(page)
  expect(left).not.toContain(copyId)
  expect([...left].sort()).toEqual([firstId, secondId].sort())
  expect(await readStored(page, firstId)).toMatchObject({ title: 'Untitled presentation' })

  // Focus lands on a surviving control rather than the document body.
  await expect(page.getByRole('button', { name: 'Rename Untitled presentation' }).first()).toBeFocused()
})
