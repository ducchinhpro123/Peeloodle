import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { elementRectInCanvas, paintedPixelsInRect, readDocument, readStoredDocument, settleDevServer } from './presentations'

/**
 * P21: the browser journey that closes Milestone 1.
 *
 * Library → create → type text → insert a real image → autosave → rename from the
 * library → reload the whole page → reopen from the library, at desktop and tablet
 * widths. What survived is read back from IndexedDB (title, revision, slide count,
 * text runs, asset sha256/byteLength) and from the pixels Konva actually painted,
 * so a DOM-only claim cannot pass. The stored media is re-hashed and compared with
 * the uploaded file's SHA-256: identity, not just size or type.
 *
 * No screenshots: `proofs/out` belongs to the other presentation specs.
 */

const JOURNEY_IMAGE = join(process.cwd(), 'public', 'apple-touch-icon.png')
const TYPED_TEXT = 'Milestone one survives'
const RENAMED_TITLE = 'Milestone reload proof'

const VIEWPORTS = [
  { label: 'desktop 1440x900', width: 1440, height: 900 },
  { label: 'tablet 1024x768', width: 1024, height: 768 },
]

test.describe('milestone journey', () => {
  for (const viewport of VIEWPORTS) {
    test(`create, edit, save, reload and reopen — ${viewport.label}`, async ({ page }) => {
      const uploadedBytes = statSync(JOURNEY_IMAGE).size
      const uploadedSha256 = createHash('sha256').update(readFileSync(JOURNEY_IMAGE)).digest('hex')

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/presentations')
      await settleDevServer(page)

      // 1. Create a presentation from the library (the hero button exists empty or not).
      await page.getByRole('button', { name: 'Start a blank presentation' }).click()
      await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
      await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
      const created = await readDocument(page)
      expect(created).not.toBeNull()
      const presentationId = created!.id

      // 2. Add a text box and type into the DOM overlay; closing it commits the run.
      await page.getByRole('button', { name: 'Add text' }).click()
      const field = page.getByRole('textbox', { name: 'Text content' })
      await expect(field).toBeFocused()
      await page.keyboard.type(TYPED_TEXT)
      await page.keyboard.press('Escape')
      await expect(field).toHaveCount(0)

      // 3. Insert a real repo PNG through the real file input: sniffing, decode,
      // hashing, the atomic document + bytes write and the canvas draw all run.
      await page.getByTestId('presentation-image-input').setInputFiles(JOURNEY_IMAGE)
      await expect.poll(async () => (await readDocument(page))?.image ?? null).not.toBeNull()
      const edited = await readDocument(page)
      if (!edited?.image) throw new Error('no image element was inserted')
      expect(edited.text).toContain(TYPED_TEXT)

      // 4. Let autosave write it: no Save click anywhere in this journey.
      await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 10_000 })
      const imagePlacement = edited.image

      // Document-space regions for the pixel claims: the inserted image, the first
      // text line (ink left of the image), and a part of the slide no element
      // covers. The empty one is the control: it must read 0, so "the image paints"
      // cannot be satisfied by a measure that just counts everything.
      const imageRect = await elementRectInCanvas(page, imagePlacement)
      const textLineRect = await elementRectInCanvas(page, { x: 160, y: 250, width: 200, height: 40 })
      const emptyRect = await elementRectInCanvas(page, { x: 900, y: 520, width: 200, height: 120 })
      const expectCompositionPainted = async () => {
        await expect(page.locator('.presentation-canvas-error')).toHaveCount(0)
        await expect.poll(() => paintedPixelsInRect(page, imageRect)).toBeGreaterThan(1_000)
        await expect.poll(() => paintedPixelsInRect(page, textLineRect)).toBeGreaterThan(100)
        expect(await paintedPixelsInRect(page, emptyRect)).toBe(0)
      }
      await expectCompositionPainted()

      // 5. Rename from the library: a library operation inside the same journey, on
      // the same stored row the editor has been writing.
      await page.getByRole('link', { name: 'Back to presentations' }).click()
      await expect(page).toHaveURL(/\/presentations$/)
      const beforeRename = await readStoredDocument(page, presentationId)
      expect(beforeRename.text).toContain(TYPED_TEXT)
      await page.getByRole('button', { name: `Rename ${beforeRename.title}` }).click()
      const dialog = page.getByRole('dialog', { name: 'Rename this presentation' })
      const titleField = dialog.getByRole('textbox', { name: 'Presentation name' })
      await expect(titleField).toHaveValue(beforeRename.title)
      await titleField.fill(RENAMED_TITLE)
      await page.keyboard.press('Enter')
      await expect(dialog).toBeHidden()
      const renamed = await readStoredDocument(page, presentationId)
      expect(renamed.title).toBe(RENAMED_TITLE)
      expect(renamed.revision).toBe(beforeRename.revision + 1)

      // 6. Reload the whole page, then reopen the deck from the library.
      await page.reload()
      await settleDevServer(page)
      await page.getByRole('link', { name: `Open ${RENAMED_TITLE}` }).click()
      await expect(page).toHaveURL(`/presentations/${presentationId}`)
      await expect(page.getByTestId('presentation-canvas')).toBeVisible()
      await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
      await expect(page.locator('.presentation-canvas-error')).toHaveCount(0)

      // 7. The composition came back: same text, same image geometry, same painted
      // pixels - and the media had to come off disk to draw them.
      const reopened = await readDocument(page)
      if (!reopened?.image) throw new Error('the reopened document has no image element')
      expect(reopened).toMatchObject({ id: presentationId, revision: renamed.revision, dirty: false })
      expect(reopened.text).toContain(TYPED_TEXT)
      expect(reopened.image).toEqual(imagePlacement)
      expect(await elementRectInCanvas(page, reopened.image)).toEqual(imageRect)
      await expectCompositionPainted()

      // 8. Inspect the persisted output: the stored row and the stored bytes.
      const persisted = await page.evaluate(async (id) => {
        const persistence = await import('/src/lib/persistence/presentations/idb.ts')
        const repository = persistence.createIdbPresentationRepository()
        const documentModel = await repository.getPresentation(id)
        const elements = documentModel.slides.flatMap((slide) => slide.elements)
        const asset = documentModel.assets[0]
        const media = asset ? await repository.getMedia(asset.id) : null
        const digest = media ? await crypto.subtle.digest('SHA-256', media.bytes) : null
        return {
          title: documentModel.title,
          revision: documentModel.revision,
          slideCount: documentModel.slides.length,
          textRuns: elements.flatMap((element) => element.kind === 'text' ? element.paragraphs : []).flatMap((paragraph) => paragraph.runs.map((run) => run.text)),
          images: elements.flatMap((element) => element.kind === 'image' ? [{ assetId: element.assetId, x: element.x, y: element.y, width: element.width, height: element.height }] : []),
          assets: documentModel.assets.map((entry) => ({ id: entry.id, sha256: entry.sha256, byteLength: entry.byteLength, mimeType: entry.mimeType })),
          mediaByteLength: media?.bytes.length ?? 0,
          // Hash the bytes read back out of IndexedDB, so this is media identity
          // against the uploaded file rather than its declared type or length.
          mediaSha256: digest ? [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') : '',
        }
      }, presentationId)

      expect(persisted.title).toBe(RENAMED_TITLE)
      expect(persisted.revision).toBe(renamed.revision)
      expect(persisted.slideCount).toBe(1)
      expect(persisted.textRuns.join('')).toBe(TYPED_TEXT)
      expect(persisted.images).toEqual([{ assetId: `asset-${uploadedSha256}`, ...imagePlacement }])
      expect(persisted.assets).toEqual([{ id: `asset-${uploadedSha256}`, sha256: uploadedSha256, byteLength: uploadedBytes, mimeType: 'image/png' }])
      expect(persisted.mediaByteLength).toBe(uploadedBytes)
      expect(persisted.mediaSha256).toBe(uploadedSha256)
    })
  }
})
