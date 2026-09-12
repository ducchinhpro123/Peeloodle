import { expect, test, type Page } from '@playwright/test'

/**
 * The app shell's own links stay mounted around the editor route, so they have to
 * consult the same leave guard as the editor's Back link. Without it, clicking a
 * shell link unmounts the editor, whose cleanup closes the document and drops the
 * on-screen edit with it. This test types into a text box and leaves through the
 * shell's Home link well inside the autosave debounce, so it fails if the shell
 * navigations are not guarded - the stored row is read back from IndexedDB.
 *
 * No screenshots: proofs/out belongs to other specs.
 */

async function settleDevServer(page: Page) {
  await page.waitForLoadState('load')
  await page.waitForTimeout(900)
}

async function readDocument(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/features/presentations/editor/store.ts')
    const state = store.usePresentationStore.getState()
    const documentModel = state.document
    if (!documentModel) return null
    const text = documentModel.slides
      .flatMap((slide) => slide.elements)
      .filter((element) => element.kind === 'text')
      .flatMap((element) => element.paragraphs)
      .flatMap((paragraph) => paragraph.runs)
      .map((run) => run.text)
      .join('')
    return { id: documentModel.id, revision: documentModel.revision, text, dirty: state.dirty }
  })
}

async function readStoredDocument(page: Page, id: string) {
  return page.evaluate(async (presentationId) => {
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const stored = await persistence.createIdbPresentationRepository().getPresentation(presentationId)
    const text = stored.slides
      .flatMap((slide) => slide.elements)
      .filter((element) => element.kind === 'text')
      .flatMap((element) => element.paragraphs)
      .flatMap((paragraph) => paragraph.runs)
      .map((run) => run.text)
      .join('')
    return { revision: stored.revision, text }
  }, id)
}

async function openBlankEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await settleDevServer(page)
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  return (await readDocument(page))!.id
}

test('a shell nav link writes the pending edit before it leaves the editor', async ({ page }) => {
  const presentationId = await openBlankEditor(page)

  // A text session is open and the autosave debounce is still counting down, so
  // nothing here has been persisted as a revision yet.
  await page.getByRole('button', { name: 'Add text' }).click()
  const field = page.getByRole('textbox', { name: 'Text content' })
  await expect(field).toBeFocused()
  await page.keyboard.type('Home must not lose this')

  await page.locator('.topnav').getByRole('link', { name: 'Home' }).click()

  // The guard clears the click only after the write, so the route change proves the
  // edit is already on disk; the row is then read back to prove it.
  await expect(page).toHaveURL('/')
  const stored = await readStoredDocument(page, presentationId)
  expect(stored.text).toContain('Home must not lose this')

  // Home is the dashboard, and the editor is really gone.
  await expect(page.getByRole('heading', { name: /Small stickers/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Untitled presentation' })).not.toBeVisible()
})

test('a clean editor follows a shell nav link immediately', async ({ page }) => {
  await openBlankEditor(page)

  // No edits at all: the guard must be invisible.
  await page.locator('.topnav').getByRole('link', { name: 'Home' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /Small stickers/ })).toBeVisible()
  await expect(page.getByText(/could not be saved/i)).not.toBeVisible()
})
