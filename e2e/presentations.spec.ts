import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const OUT = join(process.cwd(), 'proofs', 'out')

async function settleDevServer(page: Page) {
  // The Vite dev client performs one dep-optimizer reload shortly after first
  // load; wait it out so the evaluations below cannot be destroyed mid-run.
  await page.waitForLoadState('load')
  await page.waitForTimeout(900)
}

async function seedFixturePresentation(page: Page) {
  await page.goto('/')
  await settleDevServer(page)
  return page.evaluate(async () => {
    const fixture = await import('/src/features/presentations/model/fixtures/fixture.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const documentModel = fixture.createFixturePresentation()
    await persistence.createIdbPresentationRepository().savePresentation(documentModel, [{
      assetId: fixture.FIXTURE_IMAGE_ASSET_ID,
      bytes: fixture.fixtureImagePng(),
      mimeType: 'image/png',
    }])
    return documentModel.id
  })
}

async function readPresentationJson(page: Page, id: string) {
  return page.evaluate(async (presentationId) => {
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    return JSON.stringify(await persistence.createIdbPresentationRepository().getPresentation(presentationId))
  }, id)
}

/** Samples the live Konva canvas so missing shapes/text cannot pass unnoticed. */async function sampleCanvas(page: Page) {
  return page.locator('canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d')
    if (!context) return { dark: 0, mint: 0, white: 0, yellow: 0 }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let dark = 0
    let mint = 0
    let white = 0
    let yellow = 0
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index]!
      const green = pixels[index + 1]!
      const blue = pixels[index + 2]!
      const alpha = pixels[index + 3]!
      if (alpha <= 150) continue
      if (red < 60 && green < 90 && blue < 130) dark += 1
      if (red < 50 && green > 130 && blue < 150) mint += 1
      if (red > 200 && green > 200 && blue > 200) white += 1
      if (red > 200 && green > 170 && green < 230 && blue < 140) yellow += 1
    }
    return { dark, mint, white, yellow }
  })
}

test('creates, lists, and reopens a local 16:9 presentation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/presentations')

  await expect(page.getByRole('heading', { name: 'No presentations yet' })).toBeVisible()
  await page.screenshot({ path: `${OUT}/p15-library-empty-1440x900.png`, fullPage: false })
  await page.getByRole('button', { name: 'Create your first presentation' }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Untitled presentation' })).toBeVisible()

  const canvas = page.getByTestId('presentation-canvas')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-document-width', '1280')
  await expect(canvas).toHaveAttribute('data-document-height', '720')
  await expect(page.locator('canvas')).toBeVisible()
  await page.screenshot({ path: `${OUT}/p15-editor-blank-1440x900.png`, fullPage: false })

  const editorUrl = page.url()
  await page.getByRole('link', { name: 'Back to presentations' }).click()
  const card = page.getByRole('link', { name: 'Open Untitled presentation' })
  await expect(card).toContainText('1 slide')
  await page.screenshot({ path: `${OUT}/p15-library-1440x900.png`, fullPage: false })
  await card.click()
  await expect(page).toHaveURL(editorUrl)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByLabel('Canvas zoom')).toHaveText('125%')
  await page.getByRole('button', { name: 'Fit slide to window' }).click()
  await expect(page.getByLabel('Canvas zoom')).toHaveText('100%')

  await page.screenshot({ path: `${OUT}/p15-editor-1440x900.png`, fullPage: false })
})

test('presentation library and preview remain contained on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/presentations')
  await page.screenshot({ path: `${OUT}/p15-library-390x844.png`, fullPage: false })
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page.getByText(/Presentation authoring is designed for a laptop/)).toBeVisible()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  // Authoring controls stay reachable at phone width even though the copy points at desktop.
  await expect(page.getByRole('button', { name: 'Add text' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${OUT}/p15-editor-390x844.png`, fullPage: false })

  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page.getByRole('link', { name: 'Open Untitled presentation' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('renders the active fixture slide and keeps zoom, pan, and slide changes view-only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  const presentationId = await seedFixturePresentation(page)

  await page.goto(`/presentations/${presentationId}`)
  await expect(page.getByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })).toBeVisible()
  const canvasHost = page.getByTestId('presentation-canvas')
  await expect(canvasHost).toBeVisible()

  // Background, panel shape, white title text, the yellow accent circle, and the
  // stored mint PNG must all have been painted; dropping any of them fails here.
  await expect.poll(async () => {
    const sample = await sampleCanvas(page)
    return { dark: sample.dark > 1_000, mint: sample.mint > 500, white: sample.white > 100, yellow: sample.yellow > 500 }
  }).toEqual({ dark: true, mint: true, white: true, yellow: true })
  await page.screenshot({ path: `${OUT}/p16-fixture-slide1-1280x768.png`, fullPage: false })

  const before = await readPresentationJson(page, presentationId)

  await page.getByRole('button', { name: 'Zoom in' }).click()
  const box = await canvasHost.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 35, box!.y + box!.height / 2 + 20)
  await expect(canvasHost).toHaveClass(/is-panning/)
  await page.mouse.up()
  await expect(canvasHost).not.toHaveClass(/is-panning/)
  await expect(canvasHost).toHaveAttribute('data-view-zoom', '1.25')
  await expect(canvasHost).not.toHaveAttribute('data-view-pan-x', '0')

  // Slide navigation is view state: the rendered page changes, the document does not.
  await page.getByRole('button', { name: 'Show slide 2: Bullets slide' }).click()
  await expect(page.getByRole('button', { name: 'Show slide 2: Bullets slide' })).toHaveAttribute('aria-current', 'true')
  await expect.poll(async () => (await sampleCanvas(page)).white).toBeGreaterThan(50_000)
  await page.screenshot({ path: `${OUT}/p16-fixture-slide2-1280x768.png`, fullPage: false })

  const after = await readPresentationJson(page, presentationId)
  expect(after).toBe(before)
})

test('keeps a long saved title usable at the tablet editor width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  const title = 'Khảo sát trải nghiệm học tập — a deliberately long presentation title that must remain identifiable'
  const presentationId = await page.evaluate(async (savedTitle) => {
    const factories = await import('/src/features/presentations/model/factories.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const documentModel = factories.createPresentationDocument({ title: savedTitle })
    await persistence.createIdbPresentationRepository().savePresentation(documentModel)
    return documentModel.id
  }, title)

  await page.goto('/presentations')
  const card = page.getByRole('link', { name: `Open ${title}` })
  await expect(card).toBeVisible()
  await expect(card).toContainText(title)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${OUT}/p15-library-1024x768.png`, fullPage: false })

  await card.click()
  const heading = page.getByRole('heading', { name: title })
  await expect(heading).toBeVisible()
  await expect(heading).toHaveAttribute('title', title)
  await expect(page).toHaveURL(`/presentations/${presentationId}`)
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${OUT}/p15-editor-1024x768.png`, fullPage: false })
})

/** Client-pixel rect of one element using the same fit/zoom/pan mapping the canvas uses. */
async function elementRectInCanvas(page: Page, element: { x: number; y: number; width: number; height: number }) {
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

async function countDarkPixels(page: Page, region: { x: number; y: number; width: number; height: number }) {
  return page.locator('canvas').evaluate((canvas, area) => {
    const context = canvas.getContext('2d')
    if (!context) return -1
    const scaleX = canvas.width / canvas.clientWidth
    const scaleY = canvas.height / canvas.clientHeight
    const left = Math.max(0, Math.floor(area.x * scaleX))
    const top = Math.max(0, Math.floor(area.y * scaleY))
    const width = Math.max(1, Math.floor(area.width * scaleX))
    const height = Math.max(1, Math.floor(area.height * scaleY))
    const data = context.getImageData(left, top, width, height).data
    let dark = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3]! > 150 && data[index]! < 90 && data[index + 1]! < 90 && data[index + 2]! < 120) dark += 1
    }
    return dark
  }, region)
}

async function readFirstElement(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/features/presentations/editor/store.ts')
    const state = store.usePresentationStore.getState()
    const element = state.document!.slides[0]!.elements[0]!
    return {
      id: element.id,
      kind: element.kind,
      text: element.kind === 'text' ? element.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('') : '',
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      history: state.past.length,
      dirty: state.dirty,
      editing: state.view.editingElementId,
      zoom: state.view.zoom,
      pan: state.view.pan,
      padding: element.kind === 'text' ? element.padding : 0,
      lineHeight: element.kind === 'text' ? element.lineHeight : 1,
      fontSize: element.kind === 'text' ? (element.paragraphs[0]?.runs[0]?.size ?? 28) : 28,
    }
  })
}

test('inserts, edits, saves, and reopens a text box without moving it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.goto('/presentations')
  await page.getByRole('button', { name: /Create (your first|a blank) presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Untitled presentation' })).toBeVisible()

  // Insert through the store command, then type Vietnamese and English into the DOM overlay.
  await page.getByRole('button', { name: 'Add text' }).click()
  const field = page.getByRole('textbox', { name: 'Text content' })
  await expect(field).toBeFocused()
  await page.keyboard.type('Xin chào Việt Nam — hello')
  await page.screenshot({ path: `${OUT}/p17-editor-editing-1280x768.png`, fullPage: false })

  const canvasHost = page.getByTestId('presentation-canvas')
  await expect(canvasHost).toHaveAttribute('data-editing-element', /.+/)
  await canvasHost.click({ position: { x: 6, y: 6 } })
  await expect(field).toHaveCount(0)

  const afterTyping = await readFirstElement(page)
  expect(afterTyping.text).toBe('Xin chào Việt Nam — hello')
  expect(afterTyping.kind).toBe('text')
  expect(afterTyping.history).toBe(2) // addElement plus one grouped text session
  expect(afterTyping.dirty).toBe(true)
  expect(afterTyping.editing).toBeNull()
  // Typing never touches canvas view state.
  expect({ zoom: afterTyping.zoom, pan: afterTyping.pan }).toEqual({ zoom: 1, pan: { x: 0, y: 0 } })
  await expect(page.getByText('Unsaved changes')).toBeVisible()

  // Canvas hit testing: click selects, double click opens the DOM editor again.
  // Point at the first text line, which is what the canvas actually paints.
  const placement = { x: afterTyping.x, y: afterTyping.y, width: afterTyping.width, height: afterTyping.height }
  const linePoint = await elementRectInCanvas(page, {
    x: afterTyping.x + afterTyping.padding + 8,
    y: afterTyping.y + afterTyping.padding + (afterTyping.fontSize * afterTyping.lineHeight) / 2,
    width: 0,
    height: 0,
  })
  const centre = { x: linePoint.x, y: linePoint.y }
  await canvasHost.click({ position: centre })
  await expect(canvasHost).toHaveAttribute('data-selected-element', afterTyping.id)
  await canvasHost.dblclick({ position: centre })
  const reopenedField = page.getByRole('textbox', { name: 'Text content' })
  await expect(reopenedField).toBeVisible()
  await expect(reopenedField).toContainText('Xin chào Việt Nam')
  await expect(page.getByRole('button', { name: 'Edit text' })).toBeVisible()

  // Wheel zoom over the canvas keeps the session open (it does not blur the field);
  // the dashed field must track the element box and the caret must keep its place.
  const canvasBox = await canvasHost.boundingBox()
  expect(canvasBox).not.toBeNull()
  await page.mouse.move(canvasBox!.x + 30, canvasBox!.y + 30)
  await page.mouse.wheel(0, -120)
  await expect(canvasHost).not.toHaveAttribute('data-view-zoom', '1')
  const movedField = page.getByRole('textbox', { name: 'Text content' })
  await expect(movedField).toBeVisible()
  const movedRect = await elementRectInCanvas(page, placement)
  const fieldBox = await movedField.boundingBox()
  expect(fieldBox).not.toBeNull()
  expect(Math.abs(fieldBox!.x - (canvasBox!.x + movedRect.x))).toBeLessThanOrEqual(2)
  expect(Math.abs(fieldBox!.y - (canvasBox!.y + movedRect.y))).toBeLessThanOrEqual(2)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('~')
  expect((await readFirstElement(page)).text).toBe('Xin chào Việt Nam — hel~lo')
  await page.keyboard.press('Escape')
  await expect(movedField).toHaveCount(0)
  await page.getByRole('button', { name: 'Fit slide to window' }).click()
  expect((await readFirstElement(page)).pan).toEqual({ x: 0, y: 0 })

  const afterSecondSession = await readFirstElement(page)
  expect(afterSecondSession.text).toBe('Xin chào Việt Nam — hel~lo')
  expect(afterSecondSession.history).toBe(3)
  expect({ x: afterSecondSession.x, y: afterSecondSession.y, width: afterSecondSession.width, height: afterSecondSession.height }).toEqual(placement)

  // An empty box must stay reachable: blur without typing, then select it again.
  await page.getByRole('button', { name: 'Add text' }).click()
  const emptyField = page.getByRole('textbox', { name: 'Text content' })
  await expect(emptyField).toBeVisible()
  await expect(emptyField).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(emptyField).toHaveCount(0)
  const emptyBox = await page.evaluate(async () => {
    const store = await import('/src/features/presentations/editor/store.ts')
    const state = store.usePresentationStore.getState()
    const element = state.document!.slides[0]!.elements[1]!
    return { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height }
  })
  const emptyRect = await elementRectInCanvas(page, emptyBox)
  await canvasHost.click({ position: { x: emptyRect.x + emptyRect.width / 2, y: emptyRect.y + emptyRect.height / 2 } })
  await expect(canvasHost).toHaveAttribute('data-selected-element', emptyBox.id)

  // Save the edited document through the repository contract, then reopen it.
  const saved = await page.evaluate(async () => {
    const store = await import('/src/features/presentations/editor/store.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const state = store.usePresentationStore.getState()
    await persistence.createIdbPresentationRepository().savePresentation(state.document!, [], { baseRevision: state.savedRevision })
    return state.document!.id
  })
  await page.reload()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await page.goto('/presentations')
  await page.getByRole('link', { name: 'Open Untitled presentation' }).click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()

  const reopened = await readFirstElement(page)
  expect(reopened).toMatchObject({ ...placement, text: 'Xin chào Việt Nam — hel~lo', dirty: false, history: 0 })
  expect(await page.evaluate(async (id) => {
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    return (await persistence.createIdbPresentationRepository().getPresentation(id)).slides[0]!.elements[0]!.x
  }, saved)).toBe(placement.x)

  // The reopened slide really paints the text inside the saved box, and nowhere else.
  const textSample = async () => countDarkPixels(page, await elementRectInCanvas(page, placement))
  await expect.poll(textSample).toBeGreaterThan(120)
  const offBox = await elementRectInCanvas(page, { x: placement.x, y: placement.y + placement.height + 40, width: placement.width, height: 80 })
  expect(await countDarkPixels(page, offBox)).toBe(0)
  await page.screenshot({ path: `${OUT}/p17-editor-reopened-1280x768.png`, fullPage: false })
})
