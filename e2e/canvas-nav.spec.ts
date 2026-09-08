import { expect, test, type Page } from '@playwright/test'
import { downloadPng, waitForCanvasInk } from './liveEditor'

const storePath = '/src/features/editor/store.ts'
const utilsPath = '/src/features/editor/maskUtils.ts'

async function setup(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height })
  await page.goto('/create')
  await expect(page.locator('[data-testid="editor-canvas"] canvas')).toBeVisible()
  await page.evaluate(async () => {
    const { useEditorStore: store } = await import('/src/features/editor/store.ts')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#e02020'
    ctx.fillRect(0, 0, 256, 256)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)))
    const current = store.getState().document
    if (!current) throw new Error('editor document missing')
    store.getState().hydrate({ ...current, assetIds: ['a'], layers: [{ id: 'image', name: 'Image', kind: 'image', assetId: 'a', visible: true, locked: false, opacity: 1, transform: { x: 300, y: 300, scaleX: 1, scaleY: 1, rotation: 0 } }] }, [{ asset: { id: 'a', blobKey: 'a', mimeType: 'image/png', width: 256, height: 256, provenance: 'test' }, blob }])
  })
  await waitForCanvasInk(page)
}

async function storeSnapshot(page: Page) {
  return page.evaluate(async (path) => {
    const { useEditorStore } = await import(path)
    const state = useEditorStore.getState()
    const layer = state.document?.layers[0]
    return {
      viewport: state.viewport,
      tool: state.activeTool,
      selected: state.selectedLayerId,
      dirty: state.dirty,
      past: state.past.length,
      future: state.future.length,
      revision: state.document?.revision,
      updatedAt: state.document?.updatedAt,
      maskKey: layer?.kind === 'image' ? layer.maskKey : undefined,
      transform: layer?.transform,
    }
  }, storePath)
}

async function imagePoint(page: Page, u = 128, v = 128) {
  return page.evaluate(async ({ u, v, storePath, utilsPath }) => {
    const { useEditorStore } = await import(storePath)
    const { getStageMetrics, imageLocalToScreen } = await import(utilsPath)
    const state = useEditorStore.getState()
    const layer = state.document.layers[0]
    const host = document.querySelector('[data-testid="editor-canvas"]') as HTMLElement
    const box = host.getBoundingClientRect()
    const point = imageLocalToScreen({ u, v }, layer, layer.crop, getStageMetrics(host.clientWidth, host.clientHeight, state.viewport))
    return { x: box.left + point.x, y: box.top + point.y }
  }, { u, v, storePath, utilsPath })
}

async function documentUnderClient(page: Page, x: number, y: number) {
  return page.evaluate(async ({ x, y, storePath, utilsPath }) => {
    const { useEditorStore } = await import(storePath)
    const { getStageMetrics } = await import(utilsPath)
    const host = document.querySelector('[data-testid="editor-canvas"]') as HTMLElement
    const box = host.getBoundingClientRect()
    const metrics = getStageMetrics(host.clientWidth, host.clientHeight, useEditorStore.getState().viewport)
    return {
      x: (x - box.left - metrics.stageX) / metrics.viewScale,
      y: (y - box.top - metrics.stageY) / metrics.viewScale,
    }
  }, { x, y, storePath, utilsPath })
}

test('wheel zooms toward the pointer and ignores inspector/tray scrolling', async ({ page }) => {
  await setup(page)
  const before = await storeSnapshot(page)
  const host = page.getByTestId('editor-canvas')
  const box = (await host.boundingBox())!
  const pointer = { x: box.x + 24, y: box.y + box.height - 24 }
  const documentPoint = await documentUnderClient(page, pointer.x, pointer.y)
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.wheel(0, -160)
  await page.mouse.wheel(0, -160)
  const zoomed = await storeSnapshot(page)
  expect(zoomed.viewport.zoom).toBeGreaterThan(before.viewport.zoom)
  expect(zoomed.viewport.zoom).toBeLessThanOrEqual(4)
  expect(await page.locator('.canvas-controls b').textContent()).toBe(`${Math.round(zoomed.viewport.zoom * 100)}%`)
  const afterPoint = await documentUnderClient(page, pointer.x, pointer.y)
  expect(Math.abs(afterPoint.x - documentPoint.x)).toBeLessThan(2)
  expect(Math.abs(afterPoint.y - documentPoint.y)).toBeLessThan(2)
  expect(zoomed.revision).toBe(before.revision)
  expect(zoomed.dirty).toBe(before.dirty)
  expect(zoomed.past).toBe(before.past)
  expect(zoomed.transform).toEqual(before.transform)

  await host.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(new WheelEvent('wheel', {
      clientX: rect.left + 8,
      clientY: rect.top + 8,
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
  })
  const pinched = await storeSnapshot(page)
  expect(pinched.viewport.zoom).not.toBe(zoomed.viewport.zoom)

  const inspector = page.locator('.inspector')
  const tray = page.locator('.asset-tray')
  const zoomLabel = await page.locator('.canvas-controls b').textContent()
  for (const panel of [inspector, tray]) {
    const panelBox = (await panel.boundingBox())!
    await page.mouse.move(panelBox.x + 24, panelBox.y + 24)
    await page.mouse.wheel(0, 180)
    expect(await panel.evaluate((element) => {
      const event = new WheelEvent('wheel', { deltaY: 120, deltaMode: 0, bubbles: true, cancelable: true })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })).toBe(false)
  }
  expect(await page.locator('.canvas-controls b').textContent()).toBe(zoomLabel)
  await page.getByRole('button', { name: 'Reset view', exact: true }).click()
  expect((await storeSnapshot(page)).viewport).toEqual({ zoom: 1, panX: 0, panY: 0 })
})

test('space-drag pans over empty canvas and artwork without changing the tool or layer', async ({ page }) => {
  await setup(page)
  const host = page.getByTestId('editor-canvas')
  await page.evaluate(async (path) => { (await import(path)).useEditorStore.getState().selectLayer('image') }, storePath)
  const tools = ['select', 'text', 'erase', 'restore'] as const
  for (const tool of tools) {
    await page.evaluate(async ({ path, tool }) => { (await import(path)).useEditorStore.getState().setTool(tool) }, { path: storePath, tool })
    const before = await storeSnapshot(page)
    const overImage = await imagePoint(page)
    await page.keyboard.down(' ')
    await expect(host).toHaveAttribute('data-space-pan')
    await page.mouse.move(overImage.x, overImage.y)
    await page.mouse.down()
    await expect(host).toHaveAttribute('data-panning')
    await page.mouse.move(overImage.x + 36, overImage.y - 18, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up(' ')
    await expect(host).not.toHaveAttribute('data-space-pan')
    await expect(host).not.toHaveAttribute('data-panning')
    const afterImage = await storeSnapshot(page)
    expect(afterImage.tool).toBe(tool)
    expect(afterImage.selected).toBe('image')
    expect(afterImage.transform).toEqual(before.transform)
    expect(afterImage.maskKey).toBe(before.maskKey)
    expect(afterImage.viewport.panX).not.toBe(before.viewport.panX)
    expect(afterImage.viewport.panY).not.toBe(before.viewport.panY)
    expect(afterImage.revision).toBe(before.revision)
    expect(afterImage.past).toBe(before.past)
  }

  const beforeEmpty = await storeSnapshot(page)
  const empty = (await host.boundingBox())!
  await page.keyboard.down(' ')
  await page.mouse.move(empty.x + 10, empty.y + 10)
  await page.mouse.down()
  await page.mouse.move(empty.x + 50, empty.y + 40, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up(' ')
  const afterEmpty = await storeSnapshot(page)
  expect(afterEmpty.transform).toEqual(beforeEmpty.transform)
  expect(afterEmpty.viewport.panX).not.toBe(beforeEmpty.viewport.panX)

  await page.evaluate(async (path) => { (await import(path)).useEditorStore.getState().setTool('pan') }, storePath)
  const beforeTool = await storeSnapshot(page)
  const again = await imagePoint(page)
  await page.mouse.move(again.x, again.y)
  await page.mouse.down()
  await page.mouse.move(again.x - 24, again.y + 16, { steps: 4 })
  await page.mouse.up()
  const afterTool = await storeSnapshot(page)
  expect(afterTool.tool).toBe('pan')
  expect(afterTool.transform).toEqual(beforeTool.transform)
  expect(afterTool.viewport.panX).not.toBe(beforeTool.viewport.panX)
})

test('space typing, dialogs, blur, and release-outside do not stick pan', async ({ page }) => {
  await setup(page)
  const host = page.getByTestId('editor-canvas')
  const before = await storeSnapshot(page)
  await page.getByLabel('Sticker title').click()
  await page.keyboard.type(' Hello')
  await expect(page.getByLabel('Sticker title')).toHaveValue(/Hello/)
  expect((await storeSnapshot(page)).viewport).toEqual(before.viewport)
  await expect(host).not.toHaveAttribute('data-space-pan')

  await page.getByRole('button', { name: /export and share/i }).click()
  await expect(page.getByRole('dialog', { name: 'Export sticker' })).toBeVisible()
  await page.keyboard.down(' ')
  await expect(host).not.toHaveAttribute('data-space-pan')
  await page.keyboard.up(' ')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Export sticker' })).toHaveCount(0)

  await page.locator('body').click({ position: { x: 8, y: 8 } })
  await page.keyboard.down(' ')
  await expect(host).toHaveAttribute('data-space-pan')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(host).not.toHaveAttribute('data-space-pan')
  await page.keyboard.up(' ')

  await page.keyboard.down(' ')
  await expect(host).toHaveAttribute('data-space-pan')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })
  await expect(host).not.toHaveAttribute('data-space-pan')
  await page.keyboard.up(' ')

  await page.evaluate(async (path) => { (await import(path)).useEditorStore.getState().setTool('select') }, storePath)
  const edge = (await host.boundingBox())!
  await page.keyboard.down(' ')
  await page.mouse.move(edge.x + 16, edge.y + 16)
  await page.mouse.down()
  await expect(host).toHaveAttribute('data-panning')
  await page.mouse.move(2, 2)
  await page.mouse.up()
  await expect(host).not.toHaveAttribute('data-panning')
  await page.keyboard.up(' ')
  await expect(host).not.toHaveAttribute('data-space-pan')
  await page.getByRole('button', { name: 'Reset view', exact: true }).click()
  const afterOutside = await storeSnapshot(page)
  const start = await imagePoint(page)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 28, start.y + 10, { steps: 5 })
  await page.mouse.up()
  const dragged = await storeSnapshot(page)
  expect(dragged.viewport).toEqual(afterOutside.viewport)
  expect(dragged.transform).not.toEqual(afterOutside.transform)
  expect(dragged.tool).toBe('select')
})

test('viewport navigation does not corrupt in-progress erase or export pixels', async ({ page }) => {
  await setup(page)
  await page.evaluate(async (path) => {
    const store = (await import(path)).useEditorStore.getState()
    store.setTool('erase')
    store.setBrushSize(40)
    store.selectLayer('image')
  }, storePath)
  const start = await imagePoint(page, 80, 80)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 })
  const host = page.getByTestId('editor-canvas')
  const box = (await host.boundingBox())!
  await page.mouse.wheel(0, -120)
  await page.keyboard.down(' ')
  await page.mouse.move(box.x + 30, box.y + 30)
  await page.keyboard.up(' ')
  await page.mouse.up()
  await expect.poll(async () => {
    const snap = await storeSnapshot(page)
    return Boolean(snap.maskKey) && snap.tool === 'erase'
  }).toBe(true)
  const afterStroke = await storeSnapshot(page)
  const pngBefore = await downloadPng(page, 1024)
  const panStart = await imagePoint(page, 200, 200)
  await page.keyboard.down(' ')
  await page.mouse.move(panStart.x, panStart.y)
  await page.mouse.down()
  await page.mouse.move(panStart.x + 40, panStart.y + 20, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up(' ')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 200)
  const afterNav = await storeSnapshot(page)
  expect(afterNav.maskKey).toBe(afterStroke.maskKey)
  expect(afterNav.past).toBe(afterStroke.past)
  expect(afterNav.revision).toBe(afterStroke.revision)
  expect(afterNav.tool).toBe('erase')
  expect((await downloadPng(page, 1024)).equals(pngBefore)).toBe(true)
  await page.getByRole('button', { name: 'Reset view', exact: true }).click()
  expect((await downloadPng(page, 1024)).equals(pngBefore)).toBe(true)
})

test('tablet layout zooms and pans', async ({ page }) => {
  await setup(page, 1024, 768)
  const before = await storeSnapshot(page)
  const host = page.getByTestId('editor-canvas')
  const box = (await host.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -140)
  expect((await storeSnapshot(page)).viewport.zoom).toBeGreaterThan(before.viewport.zoom)
  const overImage = await imagePoint(page)
  await page.keyboard.down(' ')
  await page.mouse.move(overImage.x, overImage.y)
  await page.mouse.down()
  await page.mouse.move(overImage.x + 20, overImage.y + 12, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up(' ')
  const tablet = await storeSnapshot(page)
  expect(tablet.transform).toEqual(before.transform)
  expect(tablet.viewport.panX).not.toBe(before.viewport.panX)
})

test.describe('mobile brush after navigation', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })
  test('touch erase still paints at 390x844', async ({ page }) => {
    await setup(page, 390, 844)
    await page.evaluate(async (path) => {
      const store = (await import(path)).useEditorStore.getState()
      store.setTool('erase')
      store.setBrushSize(40)
    }, storePath)
    const tap = await imagePoint(page, 128, 128)
    await page.touchscreen.tap(tap.x, tap.y)
    await expect.poll(async () => (await storeSnapshot(page)).maskKey).toBeTruthy()
    await expect(page.getByRole('button', { name: /save to my stickers/i })).toBeInViewport()
  })
})
