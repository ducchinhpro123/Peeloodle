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

/** Samples the live Konva canvas so missing shapes/text cannot pass unnoticed. */
async function sampleCanvas(page: Page) {
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
