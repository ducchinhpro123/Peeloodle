import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const storePath = '/src/features/editor/store.ts'

test('all twelve layered templates match their actual rendered previews', async ({ page }) => {
  await page.goto('/templates')
  await expect(page.getByRole('button', { name: 'Preview Happy Astronaut', exact: true })).toHaveCount(0)
  const results = await page.evaluate(async () => {
    const templatesPath = '/src/features/templates/templates.ts'
    const renderPath = '/src/features/exports/renderDocument.ts'
    const { templateData, instantiateTemplate } = await import(templatesPath)
    const { renderDocument } = await import(renderPath)
    const results = []
    for (const template of templateData) {
      const { document: doc, assets } = await instantiateTemplate(template)
      const blob = await renderDocument(doc, Object.fromEntries(assets.map((record: { asset: { id: string } }) => [record.asset.id, record])), { size: 512 })
      const output = await createImageBitmap(blob)
      const preview = await createImageBitmap(await (await fetch(template.previewImage)).blob())
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 512
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(output, 0, 0)
      const actual = ctx.getImageData(0, 0, 512, 512).data
      ctx.clearRect(0, 0, 512, 512)
      ctx.drawImage(preview, 0, 0)
      const expected = ctx.getImageData(0, 0, 512, 512).data
      let ink = 0, differences = 0
      for (let i = 0; i < actual.length; i++) {
        if (i % 4 === 3 && actual[i]! > 127) ink++
        if (Math.abs(actual[i]! - expected[i]!) > 4) differences++
      }
      results.push({ title: template.title, layers: doc.layers.length, caption: doc.layers.at(-1).kind, corner: actual[3], ink, differences })
      output.close(); preview.close()
    }
    return results
  })
  expect(results).toHaveLength(12)
  for (const result of results) {
    expect(result, result.title).toMatchObject({ caption: 'text', corner: 0 })
    expect(result.layers).toBeGreaterThanOrEqual(5)
    expect(result.ink).toBeGreaterThan(30000)
    expect(result.differences / result.ink).toBeLessThan(0.01)
  }
})

for (const width of [1440, 1024, 390]) {
  test(`template → replace photo and caption → undo/redo → reopen → PNG at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 1024 ? 768 : 844 })
    await page.goto('/templates')
    await page.getByLabel('Search sample templates').fill('Good Vibes')
    await page.getByRole('button', { name: 'Preview Good Vibes', exact: true }).first().click()
    await page.getByRole('button', { name: 'Use Template', exact: true }).click()
    await expect(page.getByLabel('Sticker title')).toHaveValue('Good Vibes Copy')
    const url = page.url()
    if (width < 1150) await page.getByRole('button', { name: 'Sticker properties', exact: true }).click()
    const inspector = width < 1150 ? page.getByRole('dialog', { name: 'Sticker properties' }) : page.locator('.editor > .inspector')
    await inspector.getByLabel('Text content').fill('My good vibes')
    await inspector.getByLabel('Font family').selectOption('Fredoka')
    await inspector.getByRole('tab', { name: 'Layers', exact: true }).click()
    await inspector.getByRole('button', { name: 'Select Your photo', exact: true }).click()
    await inspector.getByRole('tab', { name: 'Adjust', exact: true }).click()
    await expect(inspector.getByRole('button', { name: 'Replace photo', exact: true })).toBeEnabled()
    const originalId = await page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document.layers[0].assetId, storePath)
    if (width === 1440) {
      await inspector.getByLabel('Replacement photo').setInputFiles({ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })
      await expect(page.getByRole('alert')).toContainText('SVG uploads are not supported')
      expect(await page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document.layers[0].assetId, storePath)).toBe(originalId)
    }
    const chooser = page.waitForEvent('filechooser')
    await inspector.getByRole('button', { name: 'Replace photo', exact: true }).click()
    await (await chooser).setFiles('public/samples/solenodon.png')
    await expect.poll(() => page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document.layers[0].assetId, storePath)).not.toBe(originalId)
    if (width < 1150) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    expect(await page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document.layers[0].assetId, storePath)).toBe(originalId)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await page.getByRole('button', { name: 'Save to My Stickers', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved locally')
    // Gallery thumbnails may still load; rehydration must not fetch original source blobs.
    await page.route('**/samples/*.png', (route) => route.request().resourceType() === 'fetch' ? route.abort() : route.continue())
    await page.reload()
    await expect(page.getByTestId('editor-canvas')).toBeVisible()
    await expect.poll(() => page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document?.layers.length, storePath)).toBe(5)
    const saved = await page.evaluate(async (path) => {
      const state = (await import(path)).useEditorStore.getState()
      return { layers: state.document.layers, assetCount: Object.keys(state.assets).length, photo: state.assets[state.document.layers[0].assetId].asset }
    }, storePath)
    expect(saved.assetCount).toBe(4)
    expect(saved.photo.provenance).toBe('user-upload:solenodon.png')
    expect(saved.layers[0]).toMatchObject({ kind: 'image', name: 'Your photo', outline: { enabled: true }, transform: { rotation: -7 } })
    expect(saved.layers[0].crop).toBeUndefined()
    expect(saved.layers[4]).toMatchObject({ kind: 'text', content: 'My good vibes', fontFamily: 'Fredoka' })
    await page.getByRole('button', { name: 'Export and share' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click()
    const bytes = await readFile((await (await download).path())!)
    const pixels = await page.evaluate(async (bytes) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 512
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, 512, 512).data
      const result = { width: image.width, height: image.height, corner: data[3], ink: data.filter((value, i) => i % 4 === 3 && value > 127).length }
      image.close()
      return result
    }, [...bytes])
    expect(pixels).toMatchObject({ width: 512, height: 512, corner: 0 })
    expect(pixels.ink).toBeGreaterThan(20000)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/stickerlab-ui-audit/composition-editor-${width}.png`, fullPage: true })
    await page.unroute('**/samples/*.png')
    await page.goto('/templates')
    await page.getByRole('button', { name: 'Preview Good Vibes', exact: true }).first().click()
    await page.getByRole('button', { name: 'Use Template', exact: true }).click()
    await expect(page.getByLabel('Sticker title')).toHaveValue('Good Vibes Copy')
    expect(page.url()).not.toBe(url)
    const fresh = await page.evaluate(async (path) => (await import(path)).useEditorStore.getState().document, storePath)
    expect(fresh.layers[0].assetId).not.toBe(saved.layers[0].assetId)
    expect(fresh.layers[0].crop).toBeDefined()
    expect(fresh.layers[4].content).toBe('Good Vibes!')
  })
}

test('missing template artwork reports failure without creating a broken project; retry works', async ({ page }) => {
  await page.route('**/samples/cat-in-console.png', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Preview Good Vibes', exact: true }).first().click()
  await page.getByRole('button', { name: 'Use Template', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save the template')
  expect(await page.evaluate(async () => {
    const path = '/src/lib/persistence/repository.ts'
    return (await (await import(path)).getLocalRepository().listProjects()).length
  })).toBe(0)
  await page.unroute('**/samples/cat-in-console.png')
  await page.getByRole('button', { name: 'Use Template', exact: true }).click()
  await expect(page.getByLabel('Sticker title')).toHaveValue('Good Vibes Copy')
})
