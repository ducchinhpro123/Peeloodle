import { expect, test, type Page } from '@playwright/test'

/**
 * The required journey for the leave guard: an edit made moments before leaving
 * must survive. Clicking Back well inside the 750 ms autosave debounce would lose
 * the edit if the exit link did not flush and await the write first, so this test
 * fails if the guard is removed - it does not depend on outwaiting the debounce.
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

test('leaving mid-edit persists the on-screen text before navigating', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await settleDevServer(page)
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  const presentationId = (await readDocument(page))!.id

  // Add a text box and type, leaving the session OPEN. The overlay commits each
  // keystroke into the document, but the open history group deliberately holds the
  // autosave back, so nothing here has been persisted as a revision yet.
  await page.getByRole('button', { name: 'Add text' }).click()
  const field = page.getByRole('textbox', { name: 'Text content' })
  await expect(field).toBeFocused()
  await page.keyboard.type('Leaving must not lose this')

  // Leave straight away, without closing the session or waiting for a debounce.
  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page).toHaveURL(/\/presentations$/)

  // Read the stored row: the edit reached disk, so the guard flushed and wrote it.
  // (That the write is awaited *before* navigating, rather than fired and forgotten,
  // is pinned by the jsdom guard tests, which keep the editor open when it fails.)
  const stored = await readStoredDocument(page, presentationId)
  expect(stored.text).toContain('Leaving must not lose this')

  // And it is still there when the presentation is reopened from the library.
  await page.getByRole('link', { name: 'Open Untitled presentation' }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  const reopened = await readDocument(page)
  expect(reopened).toMatchObject({ id: presentationId, dirty: false })
  expect(reopened?.text).toContain('Leaving must not lose this')
})

test('a clean exit navigates without being blocked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await settleDevServer(page)
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  // No edits at all: the guard must be transparent.
  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page).toHaveURL(/\/presentations$/)
  await expect(page.getByRole('link', { name: 'Open Untitled presentation' })).toBeVisible()
})
