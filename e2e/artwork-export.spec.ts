import { expect, test } from '@playwright/test'

for (const scenario of ['masked-outline', 'opaque-image', 'separated-layers', 'text', 'empty', 'erased'] as const) {
  test(`artwork export trims actual visible edges: ${scenario}`, async ({ page }) => {
    await page.goto('/create')
    await expect(page.getByTestId('editor-canvas')).toBeVisible()
    const result = await page.evaluate(async (scenario) => {
      const rendererPath = '/src/features/exports/renderDocument.ts'
      const repoPath = '/src/lib/persistence/repository.ts'
      const { renderDocument } = await import(rendererPath)
      const { createProjectDocument } = await import(repoPath)
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(80, 60, 200, 100)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)))
      ctx.clearRect(0, 0, 400, 300); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 400, 300); ctx.clearRect(145, 85, 50, 50)
      if (scenario === 'erased') ctx.clearRect(0, 0, 400, 300)
      const mask = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)))
      const base = { id: 'one', name: 'One', visible: true, locked: false, opacity: 1, transform: { x: -800, y: 1400, scaleX: -1, scaleY: 1, rotation: 90 } }
      const image = { ...base, kind: 'image', assetId: 'source', maskKey: 'mask', crop: { x: 40, y: 20, width: 300, height: 200 }, outline: { enabled: true, color: '#00ff00', width: 10 } }
      const shape = { ...base, kind: 'shape', shape: 'rectangle', fill: '#ff0000', transform: { ...base.transform, x: -400, y: 1500, scaleX: 1, rotation: 0 } }
      const layers = scenario === 'masked-outline' || scenario === 'erased' ? [image]
        : scenario === 'opaque-image' ? [{ ...image, maskKey: undefined, outline: undefined, crop: undefined, transform: { ...base.transform, scaleX: 1, rotation: 0 } }]
        : scenario === 'separated-layers' ? [shape, { ...shape, id: 'two', fill: '#0000ff', transform: { ...shape.transform, x: 2000 } }, { ...shape, id: 'hidden', visible: false, transform: { ...shape.transform, x: 100000 } }]
        : scenario === 'text' ? [{ ...base, kind: 'text', content: 'Hello!\nSticker', fontFamily: 'Pacifico', fontSize: 48, color: '#ff0000' }]
        : [{ ...image, opacity: 0 }]
      const doc = { ...createProjectDocument(), layers }
      const before = JSON.stringify(doc)
      try {
        const png = await renderDocument(doc, { source: { asset: { id: 'source', width: 400, height: 300, mimeType: 'image/png' }, blob } }, { size: 512, bounds: 'artwork', masks: { mask } })
        const bitmap = await createImageBitmap(png)
        canvas.width = bitmap.width; canvas.height = bitmap.height; ctx.drawImage(bitmap, 0, 0); bitmap.close()
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let red = 0, blue = 0, green = 0, transparent = 0
        for (let i = 0; i < pixels.length; i += 4) {
          if (!pixels[i + 3]) transparent++
          if (pixels[i + 3]! < 200) continue
          if (pixels[i]! > 200 && pixels[i + 1]! < 30 && pixels[i + 2]! < 30) red++
          if (pixels[i + 2]! > 200 && pixels[i]! < 30) blue++
          if (pixels[i + 1]! > 200 && pixels[i]! < 30) green++
        }
        const alpha = (x: number, y: number) => pixels[(y * canvas.width + x) * 4 + 3]!
        const touches = [Array.from({ length: canvas.width }, (_, x) => alpha(x, 0)).some(Boolean), Array.from({ length: canvas.width }, (_, x) => alpha(x, canvas.height - 1)).some(Boolean), Array.from({ length: canvas.height }, (_, y) => alpha(0, y)).some(Boolean), Array.from({ length: canvas.height }, (_, y) => alpha(canvas.width - 1, y)).some(Boolean)]
        return { width: canvas.width, height: canvas.height, red, blue, green, transparent, touches, unchanged: before === JSON.stringify(doc), error: null }
      } catch (error) {
        return { error: String(error), unchanged: before === JSON.stringify(doc) }
      }
    }, scenario)
    expect(result.unchanged).toBe(true)
    if (scenario === 'empty' || scenario === 'erased') {
      expect(result.error).toContain('Nothing visible to export')
      return
    }
    expect(result.error).toBeNull()
    expect(Math.max(result.width!, result.height!)).toBeLessThanOrEqual(512)
    expect(result.red).toBeGreaterThan(100)
    expect(result.touches).toEqual([true, true, true, true])
    if (scenario === 'opaque-image') expect(Math.abs(result.height! - result.width! / 2)).toBeLessThanOrEqual(1)
    if (scenario === 'masked-outline') {
      expect(result.width! / result.height!).toBeCloseTo(120 / 220, 1)
      expect(result.green).toBeGreaterThan(100)
      expect(result.transparent).toBeGreaterThan(100)
    }
    if (scenario === 'separated-layers') {
      expect(Math.abs(result.height! - result.width! * 120 / 2520)).toBeLessThanOrEqual(1)
      expect(result.blue).toBeGreaterThan(100)
    }
  })
}
