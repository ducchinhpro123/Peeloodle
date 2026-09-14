/**
 * P45 follow-up — production-build offline journey.
 *
 * The network-disabled run in `proofs/p44-p45-readers-and-limits.md` used the Vite
 * dev server, which pre-bundles dependencies and reloads when it re-optimizes them;
 * it cannot speak for what a static host serves. This spec runs against the
 * production build (`npm run build` + `vite preview`, see
 * `playwright.preview.config.ts`) and drives the real UI only: no `/src/...` module
 * imports, no debug globals, no console pre-warming.
 *
 * Claims under test:
 * - Before it says "Ready for offline use.", readiness has fetched what the local flow
 *   needs: the library, editor and canvas modules, the snapshot/PDF/PPTX builders, and
 *   all eight local presentation font faces. (The backup builder arrives with the
 *   library route, which statically imports it for restore.)
 * - Once ready, a disconnect does not break local edit/save/reopen or a *first-use*
 *   PDF, PPTX and backup export, and no export ran while the connection was up.
 * - A disconnect that lands before readiness is a limited, honestly reported state:
 *   local editing and saving keep working, an export says how to recover without
 *   telling the student to reload over unwritten work, and the recovery is a reload
 *   while online (a failed module import stays failed for the life of the page).
 *
 * Limitations recorded rather than hidden: a page that has never opened the
 * presentation flow, and reloading the app while offline, stay unsupported — there
 * is no service worker or app-shell cache. Reports are written after the assertions
 * so a failing run leaves no report behind.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'
import { elementRectInCanvas, paintedPixelsInRect } from './presentations'

const OUT = join(process.cwd(), 'proofs', 'out')
const ASSETS = join(process.cwd(), 'dist', 'assets')
const SAMPLE_IMAGE = join(process.cwd(), 'public', 'samples', 'cat-in-console.png')

const READY_LABEL = 'Ready for offline use.'
const FAILED_LABEL =
  'Offline use could not be prepared in this page. Reconnect and reload the page. Your saved work is not affected.'
const OFFLINE_LABEL =
  'Offline use needs one online load. Reconnect and reload the page. Your saved work is not affected.'

const OFFLINE_TEXT = 'Ngoại tuyến giữ nguyên bố cục'
const OFFLINE_EDIT = 'sửa khi mất mạng'
const OFFLINE_TEXT_EDITED = `${OFFLINE_TEXT} và ${OFFLINE_EDIT}`

/** The first text box of a blank deck: `addTextBox` puts it here. */
const TEXT_BOX = { x: 140, y: 240, width: 1000, height: 160 }

const EXPORT_BUTTON = { PDF: 'Export PDF', PPTX: 'Export PPTX', backup: 'Download backup (.zip)' } as const
/** Every chunk the presentation flow needs to survive a disconnect. */
const PRESENTATION_CHUNK = /\/(PresentationsPage|PresentationEditorPage|PresentationCanvas|snapshot|pdf|pptx|backup)-[^/]*\.js$/
const BUILDER_CHUNK = /\/(snapshot|pdf|pptx|backup)-[^/]*\.js$/
/** The builders readiness itself loads on demand, through `exports/loaders.ts`. */
const READINESS_BUILDER_CHUNK = /\/(snapshot|pdf|pptx)-[^/]*\.js$/
/** The chunks the rendered presentations routes fetch, backup included: the library
    statically imports `restoreBackup` → `exports/backup`. */
const ROUTE_LOADED_CHUNK = /\/(PresentationsPage|PresentationEditorPage|PresentationCanvas|backup)-[^/]*\.js$/
const PRESENTATION_FONT_URL = /\/fonts\/presentations\/([^/]+\.ttf)$/

/**
 * The eight faces `presentation-fonts.css` declares, which is also what
 * `PRESENTATION_FONT_FACES` in `rendering/fonts.ts` requests. Each file name is served
 * from `public/fonts/presentations/`.
 */
const PRESENTATION_FACES = [
  { family: 'Be Vietnam Pro', style: 'normal', weight: '400', file: 'BeVietnamPro-Regular.ttf' },
  { family: 'Be Vietnam Pro', style: 'normal', weight: '700', file: 'BeVietnamPro-Bold.ttf' },
  { family: 'Be Vietnam Pro', style: 'italic', weight: '400', file: 'BeVietnamPro-Italic.ttf' },
  { family: 'Be Vietnam Pro', style: 'italic', weight: '700', file: 'BeVietnamPro-BoldItalic.ttf' },
  { family: 'Spectral', style: 'normal', weight: '400', file: 'Spectral-Regular.ttf' },
  { family: 'Spectral', style: 'normal', weight: '700', file: 'Spectral-Bold.ttf' },
  { family: 'Spectral', style: 'italic', weight: '400', file: 'Spectral-Italic.ttf' },
  { family: 'Spectral', style: 'italic', weight: '700', file: 'Spectral-BoldItalic.ttf' },
] as const

const PRESENTATION_FONT_FILES = PRESENTATION_FACES.map((face) => face.file).sort()
const byDescriptor = (left: { family: string; style: string; weight: string }, right: { family: string; style: string; weight: string }) =>
  `${left.family} ${left.style} ${left.weight}`.localeCompare(`${right.family} ${right.style} ${right.weight}`)
/** `document.fonts` order is stylesheet order; the expectation is sorted the same way. */
const EXPECTED_FACES = PRESENTATION_FACES
  .map(({ family, style, weight }) => ({ family, style, weight, status: 'loaded' }))
  .sort(byDescriptor)

type Report = Record<string, unknown>

type ObservedFontFace = { family: string; style: string; weight: string; status: string }

/**
 * What the browser really holds for the presentation families: one CSS-connected face
 * per declared descriptor, with the status the face itself reports. `FontFaceSet.check`
 * is deliberately not used — it answers `true` from the fallback when no matching face
 * has been registered or fetched, which is the false positive this verifies against.
 */
async function presentationFontFaces(page: Page): Promise<ObservedFontFace[]> {
  return page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.family === 'Be Vietnam Pro' || face.family === 'Spectral')
      .map((face) => ({ family: face.family, style: face.style, weight: face.weight, status: face.status })),
  ).then((faces) => faces.sort(byDescriptor))
}

/**
 * Names the build under test: the revision and working-tree state of the repository,
 * and the content-hashed asset names Vite wrote into `dist/assets` (the Playwright
 * webServer rebuilt `dist` before this spec ran). Without this, a report cannot be tied
 * to the code that produced it.
 */
async function buildFingerprint(): Promise<{ gitRevision: string | null; workingTreeDirty: boolean; assets: Array<{ name: string; bytes: number }> }> {
  const git = (args: string[]): string | null => {
    try {
      return execFileSync('git', args, { encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  }
  const names = (await readdir(ASSETS)).sort()
  return {
    gitRevision: git(['rev-parse', 'HEAD']),
    workingTreeDirty: (git(['status', '--porcelain']) ?? '').length > 0,
    assets: await Promise.all(names.map(async (name) => ({ name, bytes: (await stat(join(ASSETS, name))).size }))),
  }
}

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path()
  if (!path) throw new Error('the download produced no file')
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}

/**
 * Exports one format through the production Export dialog and returns the downloaded
 * bytes. Any failure the dialog reports is a test failure: these exports have to
 * produce a file, not a message.
 */
async function exportViaDialog(page: Page, format: keyof typeof EXPORT_BUTTON, waitMs = 90_000): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export presentation' })
  await expect(dialog).toBeVisible()
  const pending = page.waitForEvent('download', { timeout: waitMs })
  pending.catch(() => null)
  await dialog.getByRole('button', { name: EXPORT_BUTTON[format] }).click()
  const outcome = await Promise.race([
    pending.then((download) => ({ failed: false as const, download })),
    dialog
      .getByRole('alert')
      .waitFor({ timeout: waitMs })
      .then(async () => ({ failed: true as const, message: (await dialog.getByRole('alert').allInnerTexts()).join(' ').trim() })),
  ])
  if (outcome.failed) throw new Error(`the ${format} export reported a failure instead of a download: ${outcome.message}`)
  const bytes = await readDownload(outcome.download)
  await expect(dialog.getByText('Export ready')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  return bytes
}

/** The open export dialog, with its readiness line asserted by the caller. */
async function openExportDialog(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export presentation' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function readPdfFacts(bytes: Buffer): Promise<{ pages: number; pageSizePt: { width: number; height: number } }> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.load(new Uint8Array(bytes))
  const { width, height } = pdf.getPage(0).getSize()
  return { pages: pdf.getPageCount(), pageSizePt: { width, height } }
}

/**
 * Opens the first text box through the real canvas gesture. `elementRectInCanvas`
 * reports host-relative pixels (the shared raster helper measures inside the canvas),
 * so the host's own origin is added before clicking: the mouse works in viewport
 * coordinates. The point stays left of the inserted artwork, which sits on top of the
 * box's middle.
 */
async function openTextEditor(page: Page): Promise<void> {
  const host = await page.getByTestId('presentation-canvas').boundingBox()
  if (!host) throw new Error('the slide canvas has no box')
  const rect = await elementRectInCanvas(page, TEXT_BOX)
  await page.mouse.dblclick(host.x + rect.x + rect.width * 0.05, host.y + rect.y + rect.height * 0.4)
  await expect(page.getByTestId('text-edit-field')).toBeVisible()
}

async function paintedArtwork(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<number> {
  const rect = await elementRectInCanvas(page, box)
  let painted = 0
  await expect
    .poll(async () => {
      painted = await paintedPixelsInRect(page, rect)
      return painted
    }, { timeout: 20_000, message: 'the reopened editor should repaint the saved artwork from IndexedDB' })
    .toBeGreaterThan(1_000)
  return painted
}

/** Measured on-disk sizes of the production chunks, for the raw/encoded split below. */
async function chunkFileSizes(): Promise<Record<string, number>> {
  const names = await readdir(ASSETS)
  const sizes: Record<string, number> = {}
  for (const name of names) {
    if (!PRESENTATION_CHUNK.test(`/${name}`)) continue
    sizes[name] = (await stat(join(ASSETS, name))).size
  }
  return sizes
}

test('P45 production: first-use PDF, PPTX and backup exports work once the presentation flow is ready and the network drops', async ({ page, context }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const downloadNames: string[] = []
  const externalRequests: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const scriptRequests: string[] = []
  const fontFiles: string[] = []
  page.on('download', (download) => downloadNames.push(download.suggestedFilename()))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') externalRequests.push(request.url())
  })
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 240)))
  page.on('requestfinished', (request) => {
    const path = new URL(request.url()).pathname
    if (request.resourceType() === 'script') scriptRequests.push(path)
    const file = PRESENTATION_FONT_URL.exec(path)?.[1]
    if (file) fontFiles.push(file)
  })

  // 1 — a real document, built through the UI while the connection is up.
  await page.goto('/presentations')
  await page.getByRole('button', { name: /Create your first presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.getByTestId('text-edit-field').fill(OFFLINE_TEXT)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  await page.getByTestId('presentation-image-input').setInputFiles(SAMPLE_IMAGE)
  // The insert is persist-first: the picture only becomes the selected element after
  // its bytes are stored. Its 1:1 insert gives the geometry fields the artwork's own
  // pixel size, which is also how the test knows these fields describe the picture.
  await expect(page.getByLabel('Width')).toHaveValue('344')
  await expect(page.getByLabel('Height')).toHaveValue('344')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  const imageBox = {
    x: Number(await page.getByLabel('X position').inputValue()),
    y: Number(await page.getByLabel('Y position').inputValue()),
    width: Number(await page.getByLabel('Width').inputValue()),
    height: Number(await page.getByLabel('Height').inputValue()),
  }
  expect(imageBox.width).toBeGreaterThan(100)

  // 2 — readiness is observable in the UI and reports only what actually finished.
  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page).toHaveURL(/\/presentations$/)
  await expect(page.getByText(READY_LABEL)).toBeVisible({ timeout: 30_000 })
  // Readiness is only allowed to say "ready" once every face's file has been fetched;
  // the request log is what proves the fonts came from the local build, not the system.
  const fontFilesFetchedByReadiness = [...new Set(fontFiles)].sort()
  expect(fontFilesFetchedByReadiness).toEqual(PRESENTATION_FONT_FILES)
  await page.getByRole('link', { name: /^Open / }).first().click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  const readyDialog = await openExportDialog(page)
  await expect(readyDialog.getByText(READY_LABEL)).toBeVisible()
  await page.screenshot({ path: join(OUT, 'p45-production-offline-ready.png') })
  await page.keyboard.press('Escape')
  await expect(readyDialog).toHaveCount(0)

  // No export ran while the connection was up. Readiness fetched the three builders it
  // loads on demand itself; the backup builder is NOT one of them: the library route
  // statically imports `restoreBackup`, which statically imports `exports/backup`, so
  // backup arrives with the library chunk the route render fetched.
  const fetchedBeforeAnyExport = downloadNames.length === 0
  expect(downloadNames).toEqual([])
  const readinessBuilderChunks = scriptRequests.filter((path) => READINESS_BUILDER_CHUNK.test(path))
  expect(new Set(readinessBuilderChunks).size).toBe(3)
  const routeLoadedChunks = scriptRequests.filter((path) => ROUTE_LOADED_CHUNK.test(path))
  expect(new Set(routeLoadedChunks).size).toBe(4)
  // What the browser actually fetched for those modules: raw JS (decodedBodySize) vs
  // bytes over the wire (encodedBodySize, and transferSize including headers).
  const measuredModules = await page.evaluate((pattern) => {
    const matcher = new RegExp(pattern)
    return performance
      .getEntriesByType('resource')
      .filter((entry) => matcher.test(new URL(entry.name).pathname))
      .map((entry) => {
        const timing = entry as PerformanceResourceTiming
        return {
          path: new URL(timing.name).pathname,
          decodedBodySize: timing.decodedBodySize,
          encodedBodySize: timing.encodedBodySize,
          transferSize: timing.transferSize,
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path))
  }, '/(PresentationsPage|PresentationEditorPage|PresentationCanvas|snapshot|pdf|pptx|backup)-[^/]*\\.js$')

  // 3 — the network goes away. Everything below runs offline.
  await context.setOffline(true)
  page.on('requestfailed', (request) => failedRequests.push(new URL(request.url()).pathname))

  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page).toHaveURL(/\/presentations$/)
  await expect(page.getByRole('link', { name: /^Open / }).first()).toBeVisible()
  await page.getByRole('link', { name: /^Open / }).first().click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  // Fonts: all eight declared faces are real, loaded faces with no network at all.
  // `document.fonts.check` would answer true from a fallback face, so the faces
  // themselves are read instead.
  const fontFaces = await presentationFontFaces(page)
  expect(fontFaces).toEqual(EXPECTED_FACES)
  // Media: the artwork is painted again in the reopened editor, so those pixels can
  // only come from artwork rehydrated out of IndexedDB.
  const paintedAfterReopen = await paintedArtwork(page, imageBox)

  // 4 — edit and autosave with no connection.
  await openTextEditor(page)
  await expect(page.getByTestId('text-edit-field')).toContainText(OFFLINE_TEXT)
  await page.getByTestId('text-edit-field').fill(OFFLINE_TEXT_EDITED)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 15_000 })

  // 5 — first use of each export format, all with no connection.
  const pdfStarted = Date.now()
  const pdfBytes = await exportViaDialog(page, 'PDF')
  const pdfMs = Date.now() - pdfStarted
  const pptxStarted = Date.now()
  const pptxBytes = await exportViaDialog(page, 'PPTX')
  const pptxMs = Date.now() - pptxStarted
  const backupStarted = Date.now()
  const backupBytes = await exportViaDialog(page, 'backup')
  const backupMs = Date.now() - backupStarted

  const pdfFacts = await readPdfFacts(pdfBytes)
  expect(pdfFacts.pages).toBe(1)
  expect(pdfFacts.pageSizePt).toEqual({ width: 960, height: 540 })

  const { strFromU8, unzipSync } = await import('fflate')
  const pptxFiles = unzipSync(new Uint8Array(pptxBytes))
  const slideXml = strFromU8(pptxFiles['ppt/slides/slide1.xml']!)
  expect(slideXml).toContain(OFFLINE_EDIT)
  const pptxMedia = Object.keys(pptxFiles).filter((name) => /^ppt\/media\/[^/]+$/.test(name))
  expect(pptxMedia).toHaveLength(1)

  const backupFiles = unzipSync(new Uint8Array(backupBytes))
  const backupEntries = Object.keys(backupFiles)
  const backupDocument = JSON.parse(strFromU8(backupFiles['document.json']!)) as { title: string }
  expect(strFromU8(backupFiles['document.json']!)).toContain(OFFLINE_TEXT_EDITED)
  const backupMedia = backupEntries.filter((name) => name.startsWith('media/'))
  expect(backupMedia).toHaveLength(1)
  // The backup carries the uploaded bytes unchanged; the artwork survived the round trip.
  const { readFile } = await import('node:fs/promises')
  const sourceImage = await readFile(SAMPLE_IMAGE)
  expect(Buffer.compare(Buffer.from(backupFiles[backupMedia[0]!]!), sourceImage)).toBe(0)
  expect(Buffer.compare(Buffer.from(pptxFiles[pptxMedia[0]!]!), sourceImage)).toBe(0)

  // 6 — reopen once more, still offline: the saved edit and the artwork come back.
  await page.getByRole('link', { name: 'Back to presentations' }).click()
  await expect(page).toHaveURL(/\/presentations$/)
  await page.getByRole('link', { name: /^Open / }).first().click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await openTextEditor(page)
  await expect(page.getByTestId('text-edit-field')).toContainText(OFFLINE_EDIT)
  await page.keyboard.press('Escape')
  const paintedAfterSecondReopen = await paintedArtwork(page, imageBox)
  await page.screenshot({ path: join(OUT, 'p45-production-offline-reopened.png') })

  const pageErrorsBeforeColdRoute = pageErrors.length
  // Everything the reopened library and editor needed was already in memory: no
  // request failed during library → editor → library → reopen → edit → export.
  const failedOfflineBeforeColdRoute = [...new Set(failedRequests)]

  // 7 — the contrast: a route readiness never fetched is still unavailable offline.
  // The sticker editor is deliberately out of scope for this warm-up. (The editor
  // shell shows only the header navigation, so this is the "Create" link.)
  await page.getByRole('link', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Unexpected Application Error!')).toBeVisible()
  const coldRouteBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)
  const coldRouteFailures = [...new Set(failedRequests)].filter((path) => !failedOfflineBeforeColdRoute.includes(path))

  const chunkSizes = await chunkFileSizes()
  const builderEncodedBytes = measuredModules
    .filter((entry) => BUILDER_CHUNK.test(entry.path))
    .reduce((total, entry) => total + entry.encodedBodySize, 0)
  const fingerprint = await buildFingerprint()
  const report: Report = {
    generatedAt: new Date().toISOString(),
    fingerprint,
    environment: {
      build: 'production (`npm run build` + `vite preview`)',
      viewport: '1440×900',
      browser: 'chromium (Playwright launchOptions.executablePath=/usr/bin/chromium)',
      note: 'vite preview gzips responses. `decodedBodySize` is the raw module the browser evaluated, `encodedBodySize`/`transferSize` are what it sent over the wire, and `rawFileBytes` is the same file in dist/assets. The report is written after the test\u2019s assertions.',
    },
    readiness: {
      label: READY_LABEL,
      readinessBuilderChunks,
      routeLoadedChunks,
      builderEncodedBytes,
      builderRawFileBytes: Object.entries(chunkSizes)
        .filter(([name]) => BUILDER_CHUNK.test(`/${name}`))
        .reduce((total, [, bytes]) => total + bytes, 0),
      measuredModules: measuredModules.map((entry) => ({ ...entry, rawFileBytes: Object.entries(chunkSizes).find(([name]) => entry.path.endsWith(name))?.[1] ?? null })),
      fontFilesFetched: fontFilesFetchedByReadiness,
      fetchedBeforeAnyExport,
      note: 'The library, editor and canvas modules are fetched by rendering those routes, which the readiness check waits for. Readiness itself fetches exactly the three builders `usePresentationExport` loads on demand (snapshot, pdf, pptx) plus the eight font files. `backup` is route-loaded, not readiness-loaded: PresentationsPage statically imports `restoreBackup` → `exports/backup`, so it was fetched with the library chunk.',
    },
    offline: {
      fontFaces,
      paintedPixelsAfterReopen: paintedAfterReopen,
      paintedPixelsAfterSecondReopen: paintedAfterSecondReopen,
      savedEditPersists: OFFLINE_TEXT_EDITED,
      failedRequestsBeforeColdRoute: failedOfflineBeforeColdRoute,
      failedRequests: coldRouteFailures,
      externalRequests,
      downloads: downloadNames,
    },
    exports: {
      pdf: { bytes: pdfBytes.length, pages: pdfFacts.pages, pageSizePt: pdfFacts.pageSizePt, ms: pdfMs },
      pptx: { bytes: pptxBytes.length, slides: 1, mediaEntries: pptxMedia.length, containsEdit: true, ms: pptxMs },
      backup: { bytes: backupBytes.length, entries: backupEntries.length, mediaEntries: backupMedia.length, documentTitle: backupDocument.title, ms: backupMs },
    },
    coldRoute: { url: page.url(), message: coldRouteBody },
    pageErrorsBeforeColdRoute,
    pageErrors,
    pageErrorsNote: 'Both page errors come from step 7, the deliberately cold sticker-editor route; the library and editor phases produced none.',
    limitations: [
      'A page that never opened the presentation area is not warmed at all, and a cold page load while offline is unsupported: there is no service worker or app-shell cache.',
      'Within a warmed page, readiness fetched the library, editor and canvas modules, the snapshot/PDF/PPTX builders and the eight font files; the backup builder arrives earlier, with the library route that imports it for restore.',
      'A module import that failed stays failed for the life of the page, so recovery is a reload while online — and that reload is only offered once the editor is holding no unwritten work.',
    ],
  }
  await mkdir(OUT, { recursive: true })

  expect(externalRequests).toEqual([])
  expect(downloadNames).toHaveLength(3)
  expect(pageErrorsBeforeColdRoute).toBe(0)
  // The reopened library and editor needed nothing from the network; only the final
  // deliberately-cold route did (its own chunk and the sticker-only dependencies the
  // browser tried after that route failed).
  expect(failedOfflineBeforeColdRoute.filter((path) => path !== '/favicon.png')).toEqual([])
  expect(coldRouteFailures.length).toBeGreaterThan(0)

  await writeFile(join(OUT, 'p45-production-offline-report.json'), `${JSON.stringify(report, null, 2)}\n`)
})

test('P45 production: a disconnect before the warm-up finishes is reported honestly and poisons nothing', async ({ page, context }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const downloadNames: string[] = []
  const pageErrors: string[] = []
  const fontFiles: string[] = []
  let offlineWindow = false
  const scriptsStartedWhileOffline: string[] = []
  page.on('download', (download) => downloadNames.push(download.suggestedFilename()))
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 240)))
  page.on('request', (request) => {
    if (offlineWindow && request.resourceType() === 'script') scriptsStartedWhileOffline.push(new URL(request.url()).pathname)
  })
  page.on('requestfinished', (request) => {
    const file = PRESENTATION_FONT_URL.exec(new URL(request.url()).pathname)?.[1]
    if (file) fontFiles.push(file)
  })

  // The app schedules the warm-up for an idle moment. Holding that moment is how this
  // test makes the disconnect land first, without touching production code and without
  // adding any application global: only a test-side browser API stub.
  await page.addInitScript(() => {
    window.requestIdleCallback = (callback: IdleRequestCallback) =>
      window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 8_000)
    window.cancelIdleCallback = (handle: number) => window.clearTimeout(handle)
  })

  await page.goto('/presentations')
  await expect(page.getByRole('button', { name: /Create your first presentation/ })).toBeVisible()
  await expect(page.getByText('Preparing offline use…')).toBeVisible()

  // 1 — the disconnect lands before the warm-up runs.
  await context.setOffline(true)
  offlineWindow = true
  await expect(page.getByText(OFFLINE_LABEL)).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: join(OUT, 'p45-production-offline-pre-readiness.png') })
  const buildersStartedWhileOffline = scriptsStartedWhileOffline.filter((path) => BUILDER_CHUNK.test(path))
  expect(buildersStartedWhileOffline).toEqual([])

  // 2 — reconnecting in the same page restores local work and a first export: the
  // skipped fetch left no failed module behind to poison them.
  offlineWindow = false
  await context.setOffline(false)
  await page.getByRole('button', { name: /Create your first presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.getByTestId('text-edit-field').fill(OFFLINE_TEXT)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('presentation-image-input').setInputFiles(SAMPLE_IMAGE)
  await expect(page.getByLabel('Width')).toHaveValue('344')
  const imageBox = {
    x: Number(await page.getByLabel('X position').inputValue()),
    y: Number(await page.getByLabel('Y position').inputValue()),
    width: Number(await page.getByLabel('Width').inputValue()),
    height: Number(await page.getByLabel('Height').inputValue()),
  }
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  const pdfBytes = await exportViaDialog(page, 'PDF')
  const pdfFacts = await readPdfFacts(pdfBytes)

  // 3 — a reloaded session warms properly, and *that* is what makes an offline reopen
  // work from a cold page: the editor route, its lazy canvas and all eight font faces
  // are in memory before the connection goes away. The font log is cleared first so
  // the assertion below speaks for this page load, not for the editing session before it.
  fontFiles.length = 0
  await page.goto('/presentations')
  await expect(page.getByText(READY_LABEL)).toBeVisible({ timeout: 30_000 })
  const fontFilesFetchedByReadiness = [...new Set(fontFiles)].sort()
  expect(fontFilesFetchedByReadiness).toEqual(PRESENTATION_FONT_FILES)
  await context.setOffline(true)
  await page.getByRole('link', { name: /^Open / }).first().click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  const fontFaces = await presentationFontFaces(page)
  expect(fontFaces).toEqual(EXPECTED_FACES)
  const painted = await paintedArtwork(page, imageBox)

  const report: Report = {
    generatedAt: new Date().toISOString(),
    fingerprint: await buildFingerprint(),
    environment: {
      build: 'production (`npm run build` + `vite preview`)',
      viewport: '1440×900',
      note: 'The idle callback the warm-up runs on was stubbed by the test to fire 8 s after mount, so the disconnect provably happened before readiness started. The test added this stub to the page; the app shipped no test hook. The report is written after the test\u2019s assertions.',
    },
    preReadinessDisconnect: {
      label: OFFLINE_LABEL,
      builderChunksAttempted: buildersStartedWhileOffline.length,
      scriptsStartedWhileOffline,
      note: 'No fetch was attempted, which is why a later reconnect can still load those chunks in this page.',
    },
    afterReconnectSamePage: {
      localEditingAndSaving: true,
      firstExportProducedBytes: pdfBytes.length,
      pdfPages: pdfFacts.pages,
      note: 'The readiness record stays failed for the session; the export itself went online.',
    },
    reloadedSessionOfflineReopen: {
      fontFilesFetched: fontFilesFetchedByReadiness,
      fontFaces,
      paintedPixels: painted,
      note: 'The reloaded page warmed while online — all eight font files were fetched before the disconnect — then the network was disabled and the library reopened the document from IndexedDB.',
    },
    downloads: downloadNames,
    pageErrors,
  }
  await mkdir(OUT, { recursive: true })

  expect(pageErrors).toEqual([])
  expect(downloadNames).toHaveLength(1)

  await writeFile(join(OUT, 'p45-production-offline-pre-readiness-report.json'), `${JSON.stringify(report, null, 2)}\n`)
})


test('P45 production: a builder that cannot be fetched says how to recover and needs a reload', async ({ page, context }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const downloadNames: string[] = []
  const pageErrors: string[] = []
  page.on('download', (download) => downloadNames.push(download.suggestedFilename()))
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 240)))

  // Hold the three builders the library does not itself need. The rest of the warm-up
  // (library, editor and canvas modules) is waited for and stays in memory, so the
  // failure under test is exactly "the connection dropped before the builders arrived".
  // (`backup` is not held: the library imports it for restore, so holding it would
  // break the page load itself.)
  let releaseBuilders = () => {}
  const held = new Promise<void>((resolve) => {
    releaseBuilders = resolve
  })
  const heldPaths: string[] = []
  await page.route('**/assets/*.js', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!/\/(snapshot|pdf|pptx)-[^/]*\.js$/.test(path)) return route.continue()
    heldPaths.push(path)
    if (heldPaths.length === 3) releaseBuilders()
    await held
    return route.abort('internetdisconnected')
  })
  const routeChunks = new Set<string>()
  let routesInMemory: () => void = () => {}
  const routesLoaded = new Promise<void>((resolve) => {
    routesInMemory = resolve
  })
  page.on('requestfinished', (request) => {
    const path = new URL(request.url()).pathname
    if (!/\/(PresentationsPage|PresentationEditorPage|PresentationCanvas)-[^/]*\.js$/.test(path)) return
    routeChunks.add(path)
    if (routeChunks.size === 3) routesInMemory()
  })

  await page.goto('/presentations')
  await expect(page.getByRole('button', { name: /Create your first presentation/ })).toBeVisible()
  await held
  await routesLoaded
  await context.setOffline(true)
  releaseBuilders()
  await expect(page.getByText(FAILED_LABEL)).toBeVisible({ timeout: 30_000 })

  // A failed warm-up must not touch local work that its modules can still serve.
  await page.getByRole('button', { name: /Create your first presentation/ }).click()
  await expect(page).toHaveURL(/\/presentations\/[^/]+$/)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.getByTestId('text-edit-field').fill(OFFLINE_TEXT)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 15_000 })

  // The export explains how to recover instead of repeating the browser's module error.
  const dialog = await openExportDialog(page)
  await expect(dialog.getByText(FAILED_LABEL)).toBeVisible()
  await dialog.getByRole('button', { name: EXPORT_BUTTON.PDF }).click()
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30_000 })
  const failureMessage = (await dialog.getByRole('alert').innerText()).trim()
  expect(failureMessage).toContain('Reconnect and reload the page')
  expect(failureMessage).not.toContain('dynamically imported module')
  expect(downloadNames).toEqual([])
  await page.screenshot({ path: join(OUT, 'p45-production-offline-failed-fetch.png') })

  // Retrying in the same page cannot work: the failed import is cached for the page.
  await dialog.getByRole('button', { name: EXPORT_BUTTON.PDF }).click()
  await expect(dialog.getByRole('alert')).toContainText('Reconnect and reload the page', { timeout: 30_000 })
  await page.keyboard.press('Escape')

  // Recovery is a reload while online: the next page session warms and exports again.
  await context.setOffline(false)
  await page.unroute('**/assets/*.js')
  await page.goto('/presentations')
  await expect(page.getByText(READY_LABEL)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('link', { name: /^Open / }).first().click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  const pdfBytes = await exportViaDialog(page, 'PDF')
  const pdfFacts = await readPdfFacts(pdfBytes)

  const report: Report = {
    generatedAt: new Date().toISOString(),
    fingerprint: await buildFingerprint(),
    environment: {
      build: 'production (`npm run build` + `vite preview`)',
      viewport: '1440×900',
      note: 'A Playwright route held the three builder fetches and aborted them as the browser went offline, so the failure is a real failed module fetch rather than a replayed message. The report is written after the test\u2019s assertions.',
    },
    failedRequests: heldPaths,
    routeChunksInMemory: [...routeChunks].sort(),
    failedState: {
      label: FAILED_LABEL,
      exportFailureMessage: failureMessage,
      exportsProducedWhileFailed: downloadNames.length - 1,
      localEditSavedWhileOffline: true,
      note: 'The three builder fetches were held and then aborted as the browser went offline, so this is a real failed module fetch. The library, editor and canvas chunks had finished, which is why local work kept working. The saved edit is why the copy gives the plain reload instruction: an editor holding unwritten work gets the save-first wording instead (`usePresentationExport.test.tsx`).',
    },
    recovery: {
      reloadWhileOnlineLabel: READY_LABEL,
      pdfBytes: pdfBytes.length,
      pdfPages: pdfFacts.pages,
    },
    downloads: downloadNames,
    pageErrors,
  }
  await mkdir(OUT, { recursive: true })

  expect(pageErrors).toEqual([])
  expect(downloadNames).toHaveLength(1)

  await writeFile(join(OUT, 'p45-production-offline-failed-fetch-report.json'), `${JSON.stringify(report, null, 2)}\n`)
})
