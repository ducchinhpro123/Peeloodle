import { expect, type Page } from '@playwright/test'

/**
 * Shared helpers for the presentation browser specs.
 *
 * These were copy-pasted into three specs (the guard specs matched byte for byte),
 * so they live here now. Each helper runs its own code in the page: nothing is
 * captured from this module's scope.
 */

/** The Vite dev client performs one dep-optimizer reload shortly after first load. */
export async function settleDevServer(page: Page): Promise<void> {
  await page.waitForLoadState('load')
  await page.waitForTimeout(900)
}

/** The live editor state for the open document: what the user sees, not what is stored. */
export async function readDocument(page: Page) {
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

/** The persisted row, read straight from IndexedDB: the claim under test. */
export async function readStoredDocument(page: Page, id: string) {
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

/** Creates a blank presentation from the library and returns its id. */
export async function openBlankEditor(page: Page): Promise<string> {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await settleDevServer(page)
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  return (await readDocument(page))!.id
}
