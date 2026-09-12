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
    const image = documentModel.slides
      .flatMap((slide) => slide.elements)
      .find((element) => element.kind === 'image')
    return {
      id: documentModel.id,
      revision: documentModel.revision,
      text,
      dirty: state.dirty,
      image: image ? { x: image.x, y: image.y, width: image.width, height: image.height } : null,
    }
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
    return { title: stored.title, revision: stored.revision, text }
  }, id)
}

/**
 * Pixels that are really artwork inside a client-pixel region of the canvas
 * host: opaque pixels differing from that region's dominant colour. A blank
 * slide is one flat colour, so a blank region reads 0 and any real value means
 * something was painted there.
 */
export async function paintedPixelsInRect(page: Page, area: { x: number; y: number; width: number; height: number }): Promise<number> {
  return page.locator('canvas').first().evaluate((canvas, rect) => {
    const context = canvas.getContext('2d')
    if (!context) return -1
    const scaleX = canvas.width / canvas.clientWidth
    const scaleY = canvas.height / canvas.clientHeight
    const left = Math.max(0, Math.floor(rect.x * scaleX))
    const top = Math.max(0, Math.floor(rect.y * scaleY))
    const width = Math.max(1, Math.min(canvas.width - left, Math.floor(rect.width * scaleX)))
    const height = Math.max(1, Math.min(canvas.height - top, Math.floor(rect.height * scaleY)))
    const pixels = context.getImageData(left, top, width, height).data
    const counts = new Map<string, number>()
    let opaque = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! <= 150) continue
      opaque += 1
      const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let modal = 0
    for (const count of counts.values()) {
      if (count > modal) modal = count
    }
    return opaque - modal
  }, area)
}

/**
 * Client-pixel rect of one element, using the same fit/zoom/pan mapping the
 * canvas uses (document units stay independent of the viewport).
 */
export async function elementRectInCanvas(page: Page, element: { x: number; y: number; width: number; height: number }) {
  const host = page.getByTestId('presentation-canvas')
  const box = await host.boundingBox()
  if (!box) throw new Error('canvas host has no box')
  const zoom = Number(await host.getAttribute('data-view-zoom'))
  const panX = Number(await host.getAttribute('data-view-pan-x'))
  const panY = Number(await host.getAttribute('data-view-pan-y'))
  const pageWidth = Number(await host.getAttribute('data-document-width'))
  const pageHeight = Number(await host.getAttribute('data-document-height'))
  const scale = Math.min(box.width / pageWidth, box.height / pageHeight) * zoom
  const offsetX = (box.width - pageWidth * scale) / 2 + panX
  const offsetY = (box.height - pageHeight * scale) / 2 + panY
  return { x: offsetX + element.x * scale, y: offsetY + element.y * scale, width: element.width * scale, height: element.height * scale }
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
