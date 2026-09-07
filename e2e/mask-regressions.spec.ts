import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

let pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
})
test.afterEach(() => { expect(pageErrors).toEqual([]) })

async function setup(page: Page, scaleX = 1, scaleY = 1, imageSize = 256, extraLayers = 0) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/create')
  await expect(page.locator('[data-testid="editor-canvas"] canvas')).toBeVisible()
  await page.evaluate(async ({ scaleX, scaleY, imageSize, extraLayers }) => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore: store } = await import(path)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = imageSize
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#e02020'
    ctx.fillRect(0, 0, imageSize, imageSize)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)))
    const current = store.getState().document
    store.getState().hydrate({ ...current, assetIds: ['a'], layers: [{ id: 'image', name: 'Image', kind: 'image', assetId: 'a', visible: true, locked: false, opacity: 1, transform: { x: 300, y: 300, scaleX, scaleY, rotation: 0 } }, ...Array.from({ length: extraLayers }, (_, i) => ({ id: `shape-${i}`, name: `Shape ${i}`, kind: 'shape', shape: 'rectangle', fill: '#00aa88', visible: true, locked: false, opacity: 1, transform: { x: i * 20, y: 850, rotation: 0, scaleX: 0.1, scaleY: 0.1 } }))] }, [{ asset: { id: 'a', blobKey: 'a', mimeType: 'image/png', width: imageSize, height: imageSize, provenance: 'test' }, blob }])
    store.getState().setBrushSize(40)
    store.getState().setTool('erase')
  }, { scaleX, scaleY, imageSize, extraLayers })
}

async function point(page: Page, u: number, v: number) {
  return page.evaluate(async ({ u, v }) => {
    const path = '/src/features/editor/store.ts'
    const utilsPath = '/src/features/editor/maskUtils.ts'
    const { useEditorStore } = await import(path)
    const { getStageMetrics, imageLocalToScreen } = await import(utilsPath)
    const state = useEditorStore.getState()
    const layer = state.document.layers[0]
    const host = document.querySelector('[data-testid="editor-canvas"]') as HTMLElement
    const box = host.getBoundingClientRect()
    const p = imageLocalToScreen({ u, v }, layer, layer.crop, getStageMetrics(host.clientWidth, host.clientHeight, state.viewport))
    return { x: box.left + p.x, y: box.top + p.y }
  }, { u, v })
}

async function stroke(page: Page, u: number, v: number) {
  const p = await point(page, u, v)
  await page.mouse.click(p.x, p.y)
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    const state = useEditorStore.getState()
    return !state.gestureActive && !state.finishMaskStroke
  })).toBe(true)
}

async function maskAlpha(page: Page, points: number[][]) {
  return page.evaluate(async (points) => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    const state = useEditorStore.getState()
    const key = state.document.layers[0].maskKey
    if (!key) return points.map(() => 255)
    const bitmap = await createImageBitmap(state.masks[key])
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return points.map(([u, v]) => ctx.getImageData(u!, v!, 1, 1).data[3])
  }, points)
}

test('successive strokes preserve prior holes and restore on a clean mask is a no-op', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    useEditorStore.getState().setTool('restore')
  })
  await stroke(page, 60, 60)
  const before = await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    return { dirty: useEditorStore.getState().dirty, past: useEditorStore.getState().past.length }
  })
  expect(before).toEqual({ dirty: false, past: 0 })
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    useEditorStore.getState().setTool('erase')
  })
  await stroke(page, 60, 60)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    useEditorStore.getState().setTool('restore')
  })
  await stroke(page, 60, 60)
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    useEditorStore.getState().setTool('erase')
  })
  await stroke(page, 190, 190)
  expect(await maskAlpha(page, [[60, 60], [190, 190], [125, 125]])).toEqual([0, 0, 255])
})

test('nonuniform scale keeps painted diameter consistent with document brush size', async ({ page }) => {
  await setup(page, 2, 0.5)
  await stroke(page, 128, 128)
  // A 40 document-pixel brush has local radii 10 and 40, not an averaged radius.
  expect(await maskAlpha(page, [[128, 128], [143, 128], [128, 158], [128, 178]])).toEqual([0, 255, 0, 255])
})

test('painting a cropped image does not alter hidden source pixels', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    const s = useEditorStore.getState()
    useEditorStore.setState({ document: { ...s.document, layers: [{ ...s.document.layers[0], crop: { x: 64, y: 64, width: 128, height: 128 } }] } })
  })
  await stroke(page, 66, 100)
  expect(await maskAlpha(page, [[60, 100], [66, 100]])).toEqual([255, 0])
})

async function holdEncoding(page: Page) {
  await page.evaluate(() => {
    const native = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = native
      native.call(this, (blob) => {
        ;(window as unknown as { releaseMask: (fail?: boolean) => void }).releaseMask = (fail) => callback(fail ? null : blob)
      }, ...args)
    }
  })
  const p = await point(page, 60, 60)
  await page.mouse.click(p.x, p.y)
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseMask?: () => void }).releaseMask)).toBe('function')
}

async function releaseEncoding(page: Page, fail = false) {
  await page.evaluate((fail) => (window as unknown as { releaseMask: (fail: boolean) => void }).releaseMask(fail), fail)
}

test('save and PNG export wait for the in-flight stroke rather than capturing an unmasked document', async ({ page }) => {
  await setup(page)
  await holdEncoding(page)
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented
  })).toBe(true)
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await page.getByRole('button', { name: /export and share/i }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /download png/i }).click()
  await releaseEncoding(page)
  const bytes = await readFile((await (await download).path())!)
  const alpha = await page.evaluate(async (encoded) => {
    const blob = await (await fetch(`data:image/png;base64,${encoded}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return [ctx.getImageData(180, 180, 1, 1).data[3], ctx.getImageData(230, 230, 1, 1).data[3]]
  }, bytes.toString('base64'))
  expect(alpha).toEqual([0, 255])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status')).toContainText(/saved locally/i)
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented
  })).toBe(false)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Reset Mask' })).toBeVisible()
  expect(await maskAlpha(page, [[60, 60]])).toEqual([0])
})

for (const destination of ['/editor/other-mask-project', '/create']) test(`navigation to ${destination} waits for encoding and cannot apply a stale mask`, async ({ page }) => {
  await setup(page)
  const id = await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const repoPath = '/src/lib/persistence/repository.ts'
    const { useEditorStore } = await import(path)
    const { createIdbRepository, createProjectDocument } = await import(repoPath)
    await createIdbRepository().saveProject(createProjectDocument({ id: 'other-mask-project' }))
    return useEditorStore.getState().document.id as string
  })
  await holdEncoding(page)
  await page.evaluate((destination) => {
    history.pushState(null, '', destination)
    dispatchEvent(new PopStateEvent('popstate'))
  }, destination)
  await expect(page.getByText('Opening sticker…')).toBeVisible()
  await releaseEncoding(page)
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  const next = await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    const s = useEditorStore.getState()
    return { id: s.document.id, layers: s.document.layers.length, pending: !!s.finishMaskStroke }
  })
  expect(next.layers).toBe(0)
  expect(next.pending).toBe(false)
  expect(next.id).not.toBe(id)
  if (destination !== '/create') expect(next.id).toBe('other-mask-project')
  await page.goto(`/editor/${id}`)
  await expect(page.getByRole('button', { name: 'Reset Mask' })).toBeVisible()
  expect(await maskAlpha(page, [[60, 60]])).toEqual([0])
})

test('a failed mask encode retains the stroke and Save retries it exactly once', async ({ page }) => {
  await setup(page)
  await holdEncoding(page)
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await releaseEncoding(page, true)
  await expect(page.getByText(/Save to retry; the stroke is retained/)).toBeVisible()
  await page.getByRole('button', { name: /save to my stickers/i }).click()
  await expect(page.getByRole('status')).toContainText(/saved locally/i)
  await expect(page.getByText(/Save to retry; the stroke is retained/)).toBeHidden()
  expect(await maskAlpha(page, [[60, 60]])).toEqual([0])
  expect(await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    return useEditorStore.getState().past.length
  })).toBe(1)
})

test('pointer cancellation commits accepted movement without gaps and ignores another pointer', async ({ page }) => {
  await setup(page)
  const start = await point(page, 50, 120)
  const end = await point(page, 200, 120)
  const host = page.getByTestId('editor-canvas')
  const pointer = { pointerId: 41, pointerType: 'pen', button: 0, bubbles: true }
  await host.dispatchEvent('pointerdown', { ...pointer, clientX: start.x, clientY: start.y })
  await host.dispatchEvent('pointermove', { ...pointer, clientX: end.x, clientY: end.y })
  await host.dispatchEvent('pointerup', { ...pointer, pointerId: 42, clientX: end.x, clientY: end.y })
  expect(await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    return !!useEditorStore.getState().finishMaskStroke
  })).toBe(true)
  await host.dispatchEvent('pointercancel', { ...pointer, clientX: end.x, clientY: end.y })
  await expect(page.getByRole('button', { name: 'Reset Mask' })).toBeVisible()
  expect(await maskAlpha(page, [[50, 120], [100, 120], [150, 120], [200, 120], [125, 160]])).toEqual([0, 0, 0, 0, 255])
})

test('corrupt masks fail closed in the preview and export instead of displaying the original', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    useEditorStore.getState().applyMask('image', 'bad-mask', new Blob(['corrupt'], { type: 'image/png' }))
  })
  await expect(page.getByText('Could not decode image mask', { exact: true })).toBeVisible()
  const p = await point(page, 128, 128)
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('[data-testid="editor-canvas"] canvas') as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    return canvas.getContext('2d')!.getImageData(x - rect.left, y - rect.top, 1, 1).data[3]
  }, p)).toBe(0)
  await page.getByRole('button', { name: /export and share/i }).click()
  await page.getByRole('button', { name: /download png/i }).click()
  await expect(page.getByText(/Could not decode mask bad-mask/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Reset Mask' }).click()
  await expect(page.getByText('Could not decode image mask', { exact: true })).toBeHidden()
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('[data-testid="editor-canvas"] canvas') as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    return canvas.getContext('2d')!.getImageData(x - rect.left, y - rect.top, 1, 1).data[3]
  }, p)).toBe(255)
})

test('restoring preserves original transparency; cropped masks, filters and outlines agree across preview, PNG and ZIP', async ({ page }) => {
  await setup(page, 0.3, 0.2, 2048)
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    const s = useEditorStore.getState()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(200,40,80,0.5)'; ctx.fillRect(0, 0, 2048, 2048)
    ctx.clearRect(1200, 400, 300, 300)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)))
    s.hydrate({ ...s.document, layers: [{ ...s.document.layers[0], crop: { x: 256, y: 256, width: 1536, height: 1536 } }] }, [{ ...s.assets.a, blob }])
    s.setTool('erase'); s.setBrushSize(40)
  })
  await stroke(page, 1024, 1024)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await stroke(page, 1024, 1024)
  await stroke(page, 1300, 500)
  const restored = await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const renderPath = '/src/features/exports/renderDocument.ts'
    const { useEditorStore } = await import(path)
    const { renderDocument } = await import(renderPath)
    const s = useEditorStore.getState()
    const bitmap = await createImageBitmap(await renderDocument(s.document, s.assets, { size: 1024, masks: s.masks }))
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return [ctx.getImageData(530, 454, 1, 1).data[3], ctx.getImageData(613, 349, 1, 1).data[3]]
  })
  expect(restored).toEqual([128, 0])
  await page.getByRole('button', { name: 'Erase', exact: true }).first().click()
  await stroke(page, 1024, 1024)
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    const s = useEditorStore.getState()
    s.updateOutline('image', { enabled: true, width: 40, color: '#00ff00' })
    s.updateFilters('image', { brightness: -20, grayscale: 75 })
  })
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const renderPath = '/src/features/exports/renderDocument.ts'
    const repoPath = '/src/lib/persistence/repository.ts'
    const zipPath = '/src/features/exports/zipExport.ts'
    const { useEditorStore } = await import(path)
    const { renderDocument } = await import(renderPath)
    const { createMemoryRepository } = await import(repoPath)
    const { exportPackZip } = await import(zipPath)
    const s = useEditorStore.getState()
    const png = await renderDocument(s.document, s.assets, { size: 512, masks: s.masks })
    const repo = createMemoryRepository()
    await repo.saveProjectWithAssets(s.document, Object.values(s.assets), Object.entries(s.masks).map(([key, blob]) => ({ key, blob })))
    const archive = new Uint8Array(await (await exportPackZip({ id: 'pack', title: 'Mask pack', description: '', visibility: 'local', createdAt: s.document.createdAt, updatedAt: s.document.updatedAt, projectIds: [s.document.id] }, repo)).arrayBuffer())
    const view = new DataView(archive.buffer)
    let zipPng: Blob | undefined
    for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
      const length = view.getUint32(offset + 18, true)
      const nameLength = view.getUint16(offset + 26, true)
      const start = offset + 30 + nameLength + view.getUint16(offset + 28, true)
      if (new TextDecoder().decode(archive.slice(offset + 30, offset + 30 + nameLength)).endsWith('.png')) zipPng = new Blob([archive.slice(start, start + length)], { type: 'image/png' })
      offset = start + length
    }
    if (!zipPng) throw new Error('ZIP lacks sticker PNG')
    const decode = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
      return ctx
    }
    const pngCtx = await decode(png)
    const zipCtx = await decode(zipPng)
    const pngPixels = pngCtx.getImageData(0, 0, 512, 512).data
    if (!zipCtx.getImageData(0, 0, 512, 512).data.every((value, i) => value === pngPixels[i])) return 255
    const host = document.querySelector('[data-testid="editor-canvas"]') as HTMLElement
    const preview = host.querySelector('canvas')!
    const fit = Math.min((host.clientWidth - 36) / 1024, (host.clientHeight - 36) / 1024)
    let error = 0
    for (const [x, y] of [[530, 454], [660, 550], [294, 450]]) {
      const target = pngCtx.getImageData(x! / 2, y! / 2, 1, 1).data
      const shown = preview.getContext('2d')!.getImageData(Math.round(host.clientWidth / 2 + (x! - 512) * fit), Math.round(host.clientHeight / 2 + (y! - 512) * fit), 1, 1).data
      for (let i = 0; i < 4; i++) error = Math.max(error, Math.abs(shown[i]! - target[i]!))
    }
    return error
  })).toBeLessThan(4)
})

test('rotated and flipped cropped strokes align with the cursor under zoom and pan', async ({ page }) => {
  await setup(page, -1.1, 0.7)
  await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const { useEditorStore } = await import(path)
    const s = useEditorStore.getState()
    useEditorStore.setState({ document: { ...s.document, layers: [{ ...s.document.layers[0], crop: { x: 48, y: 48, width: 160, height: 160 }, transform: { x: 600, y: 300, scaleX: -1.1, scaleY: 0.7, rotation: 37 } }] } })
    s.setViewport({ zoom: 1.4, panX: 20, panY: -15 })
  })
  const center = await point(page, 100, 100)
  const neighbor = await point(page, 145, 145)
  const previewAlpha = (p: { x: number; y: number }) => page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('[data-testid="editor-canvas"] canvas') as HTMLCanvasElement
    const box = canvas.getBoundingClientRect()
    return canvas.getContext('2d')!.getImageData(x - box.left, y - box.top, 1, 1).data[3]
  }, p)
  await expect.poll(() => previewAlpha(center)).toBe(255)
  await stroke(page, 100, 100)
  await expect.poll(() => previewAlpha(center)).toBe(0)
  await expect.poll(() => previewAlpha(neighbor)).toBe(255)
  const expectedSize = await page.evaluate(async () => {
    const path = '/src/features/editor/store.ts'
    const utilPath = '/src/features/editor/maskUtils.ts'
    const { useEditorStore } = await import(path)
    const { getStageMetrics } = await import(utilPath)
    const host = document.querySelector('[data-testid="editor-canvas"]') as HTMLElement
    return 40 * getStageMetrics(host.clientWidth, host.clientHeight, useEditorStore.getState().viewport).viewScale
  })
  const cursor = (await page.getByTestId('brush-cursor').boundingBox())!
  expect(cursor.width).toBeCloseTo(expectedSize, 1)
  await page.screenshot({ path: '/tmp/stickerlab-browser-verification/mask-editor-1440x900-current.png' })
})

test.describe('mobile mask editing', () => {
  test.use({ isMobile: true, hasTouch: true })
  test('touch erase and restore remain reachable at 390x844', async ({ page }) => {
    await setup(page)
    await page.setViewportSize({ width: 390, height: 844 })
    const p = await point(page, 128, 128)
    await page.touchscreen.tap(p.x, p.y)
    await expect.poll(() => maskAlpha(page, [[128, 128]])).toEqual([0])
    await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.touchscreen.tap(p.x, p.y)
    await expect.poll(() => maskAlpha(page, [[128, 128]])).toEqual([255])
    await expect(page.getByRole('button', { name: /save to my stickers/i })).toBeInViewport()
    await expect(page.getByRole('button', { name: /export and share/i })).toBeInViewport()
    await page.screenshot({ path: '/tmp/stickerlab-browser-verification/mask-editor-390x844-current.png', fullPage: true })
  })
})

for (const imageSize of [1024, 2048]) {
  test(`brush movement with ${imageSize}px photo and 30 layers avoids React commits and per-frame encoding`, async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const probe = window as unknown as { maskProbe: { commits: number }; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }
      probe.maskProbe = { commits: 0 }
      let rendererId = 0
      probe.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: new Map(),
        supportsFiber: true,
        inject: () => rendererId++,
        onCommitFiberRoot: () => { probe.maskProbe.commits++ },
        onCommitFiberUnmount: () => {},
      }
    })
    await setup(page, 300 / imageSize, 300 / imageSize, imageSize, 29)
    const start = await point(page, imageSize * 0.2, imageSize * 0.5)
    const end = await point(page, imageSize * 0.8, imageSize * 0.5)
    const measurement = await page.evaluate(async ({ start, end }) => {
      const path = '/src/features/editor/store.ts'
      const { useEditorStore } = await import(path)
      const host = document.querySelector('[data-testid="editor-canvas"]')!
      const probe = (window as unknown as { maskProbe: { commits: number } }).maskProbe
      let encodes = 0
      const native = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (...args) { encodes++; native.apply(this, args) }
      const event = (name: string, x: number, y: number) => host.dispatchEvent(new PointerEvent(name, { pointerId: 51, pointerType: 'pen', button: 0, bubbles: true, clientX: x, clientY: y }))
      event('pointerdown', start.x, start.y)
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
      const commits = probe.commits
      const revision = useEditorStore.getState().document.revision
      const handler: number[] = []
      const intervals: number[] = []
      let previous = performance.now()
      for (let i = 1; i <= 30; i++) {
        await new Promise(requestAnimationFrame)
        const now = performance.now()
        intervals.push(now - previous); previous = now
        event('pointermove', start.x + (end.x - start.x) * i / 30, start.y)
        handler.push(performance.now() - now)
      }
      const movementCommits = probe.commits - commits
      const duringStrokeEncodes = encodes
      const revisionChanges = useEditorStore.getState().document.revision - revision
      event('pointerup', end.x, end.y)
      const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]!
      return { movementCommits, duringStrokeEncodes, revisionChanges, handlerP95Ms: percentile(handler, 0.95), frameMedianMs: percentile(intervals, 0.5), frameP95Ms: percentile(intervals, 0.95) }
    }, { start, end })
    await testInfo.attach('brush-measurement', { body: JSON.stringify({ viewport: '1440x900', imageSize, layers: 30, ...measurement }), contentType: 'application/json' })
    console.log('Brush measurement', imageSize, measurement)
    expect(measurement.movementCommits).toBe(0)
    expect(measurement.duringStrokeEncodes).toBe(0)
    expect(measurement.revisionChanges).toBe(0)
    await expect(page.getByRole('button', { name: 'Reset Mask' })).toBeVisible()
    expect(await maskAlpha(page, [[imageSize * 0.5, imageSize * 0.5]])).toEqual([0])
  })
}
