import { expect, test } from '@playwright/test'

for (const effect of ['grayscale', 'brightness', 'contrast', 'saturation', 'outline', 'filtered-outline', 'translucent-outline', 'cropped-outline', 'circle'] as const) {
  test(`preview matches exported ${effect} pixels`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/create')
    await expect(page.locator('[data-testid="editor-canvas"] canvas')).toBeVisible()
    await page.evaluate(async (effect) => {
      const storePath = '/src/features/editor/store.ts'
      const { useEditorStore } = await import(storePath)
      const state = useEditorStore.getState()
      const image = document.createElement('canvas')
      image.width = image.height = 120
      const ctx = image.getContext('2d')!
      ctx.fillStyle = '#c82850'
      ctx.fillRect(0, 0, 120, 120)
      const blob = await new Promise<Blob>((resolve) => image.toBlob((blob) => resolve(blob!)))
      const base = { id: 'probe', name: 'Probe', visible: true, locked: false, opacity: effect === 'translucent-outline' ? 0.4 : 1, transform: { x: 400, y: 400, rotation: 0, scaleX: 1, scaleY: 1 } }
      const layer = effect === 'circle'
        ? { ...base, kind: 'shape', shape: 'circle', fill: '#c82850' }
        : { ...base, kind: 'image', assetId: 'probe', ...(['grayscale', 'brightness', 'contrast', 'saturation'].includes(effect) ? { filters: { brightness: 0, contrast: 0, saturation: 0, grayscale: 0, [effect]: 25 } } : { outline: { enabled: true, color: '#00ff00', width: 20 }, ...(effect === 'filtered-outline' ? { filters: { brightness: -100, contrast: 0, saturation: 0, grayscale: 0 } } : {}), ...(effect === 'cropped-outline' ? { crop: { x: 20, y: 20, width: 80, height: 80 } } : {}) }) }
      state.hydrate({ ...state.document, layers: [layer], assetIds: effect === 'circle' ? [] : ['probe'] }, effect === 'circle' ? [] : [{ asset: { id: 'probe', blobKey: 'probe', mimeType: 'image/png', width: 120, height: 120, provenance: 'test' }, blob }])
      useEditorStore.getState().selectLayer(null)
    }, effect)
    // Poll the real canvas to allow image decoding and React rendering to settle.
    await expect.poll(async () => page.evaluate(async (effect) => {
      const storePath = '/src/features/editor/store.ts'
      const renderPath = '/src/features/exports/renderDocument.ts'
      const { useEditorStore } = await import(storePath)
      const { renderDocument } = await import(renderPath)
      const state = useEditorStore.getState()
      const bitmap = await createImageBitmap(await renderDocument(state.document, state.assets, { size: 1024 }))
      const exported = document.createElement('canvas')
      exported.width = exported.height = 1024
      const e = exported.getContext('2d')!
      e.drawImage(bitmap, 0, 0)
      bitmap.close()
      const host = document.querySelector('[data-testid="editor-canvas"]') as HTMLElement
      const preview = host.querySelector('canvas')!
      const fit = Math.min((host.clientWidth - 36) / 1024, (host.clientHeight - 36) / 1024)
      const point = effect.includes('outline') ? [390, 460] : effect === 'circle' ? [405, 405] : [460, 460]
      const x = host.clientWidth / 2 + (point[0]! - 512) * fit
      const y = host.clientHeight / 2 + (point[1]! - 512) * fit
      const pixel = Array.from(preview.getContext('2d')!.getImageData(Math.round(x * preview.width / host.clientWidth), Math.round(y * preview.height / host.clientHeight), 1, 1).data)
      const target = Array.from(e.getImageData(point[0]!, point[1]!, 1, 1).data)
      const outlineError = effect.includes('outline') ? Math.abs(target[1]! - 255) : 0
      return Math.max(outlineError, ...pixel.map((value, index) => Math.abs(value - target[index]!)))
    }, effect)).toBeLessThan(4)
  })
}
