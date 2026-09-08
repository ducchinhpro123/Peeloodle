import { afterEach, expect, it, vi } from 'vitest'
import { cloneTemplateDocument, instantiateTemplate, templateData } from './templates'
import * as assetLoader from '../assets/assetLoader'
import { createMemoryRepository } from '../../lib/persistence/repository'

afterEach(() => vi.restoreAllMocks())

it('isolates nested layer settings when cloning a template', () => {
  const template = structuredClone(templateData[0]!)
  template.document.layers.push({ id: 'image', kind: 'image', name: 'Image', assetId: 'asset', opacity: 1, visible: true, locked: false, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, filters: { brightness: 0, contrast: 0, saturation: 0, grayscale: 0 }, outline: { enabled: true, color: '#ffffff', width: 12 } })
  template.document.assetIds = ['asset']
  const cloned = cloneTemplateDocument(template)
  const image = cloned.layers.at(-1)!
  if (image.kind !== 'image') throw new Error('Missing cloned image')
  image.filters!.brightness = 50
  image.outline!.width = 20
  cloned.artboard.width = 512
  expect(template.document.artboard.width).toBe(1024)
  expect(template.document.layers.at(-1)).toMatchObject({ filters: { brightness: 0 }, outline: { width: 12 } })
})


it('builds twelve distinct layouts with independent photo, caption, and decoration layers', () => {
  expect(templateData).toHaveLength(12)
  expect(templateData.slice(0, 4).map((item) => item.category)).toEqual(['Trending', 'Trending', 'Trending', 'Trending'])
  expect(new Set(templateData.map((item) => item.tags.at(-1))).size).toBe(12)
  expect(new Set(templateData.map((item) => item.title)).size).toBe(12)
  const polaroid = templateData.find((item) => item.title === 'Pet Bestie')!
  expect(polaroid.document.layers[0]).toMatchObject({ kind: 'shape', name: 'Photo frame', shape: 'rectangle' })
  expect(polaroid.document.layers.some((layer) => layer.kind === 'image' && layer.name === 'Your photo' && !layer.outline)).toBe(true)
  const rocket = templateData.find((item) => item.title === 'Tiny Win')!
  expect(Object.values(rocket.assetSources ?? {})).toContain('/art/illustrations/little-rocket.webp')
  expect(rocket.assetSources?.photo).toBe('/art/template-photos/boba-tea.webp')
  expect(new Set(templateData.slice(0, 4).map((item) => item.assetSources?.photo)).size).toBe(4)
  for (const template of templateData) {
    const photo = template.document.layers.find((layer) => layer.name === 'Your photo')
    const caption = template.document.layers.at(-1)
    expect(photo).toMatchObject({ kind: 'image' })
    expect(photo && 'crop' in photo ? photo.crop : undefined).toBeUndefined()
    expect(template.assetSources?.photo).toMatch(/^\/art\/template-photos\/.+\.webp$/)
    expect(caption).toMatchObject({ kind: 'text', name: 'Your caption' })
    expect(template.document.layers.length).toBeGreaterThanOrEqual(4)
  }
})

it('hydrates layered photo templates with independent assets and saves them atomically', async () => {
  vi.spyOn(assetLoader, 'ingestBundledImage').mockImplementation(async (src) => {
    const id = crypto.randomUUID()
    return { asset: { id, blobKey: id, mimeType: 'image/webp', width: 1024, height: 1024, provenance: `bundled-asset:${src}` }, blob: new Blob(['artwork'], { type: 'image/webp' }) }
  })
  const originals = structuredClone(templateData)
  const repo = createMemoryRepository()
  for (const template of templateData.filter((item) => item.previewImage)) {
    const first = await instantiateTemplate(template)
    const second = await instantiateTemplate(template)
    expect(first.document.id).not.toBe(second.document.id)
    expect(first.document.assetIds[0]).not.toBe(second.document.assetIds[0])
    const firstPhoto = first.document.layers.find((layer) => layer.name === 'Your photo')
    const secondPhoto = second.document.layers.find((layer) => layer.name === 'Your photo')
    expect(firstPhoto?.id).not.toBe(secondPhoto?.id)
    expect(firstPhoto).toMatchObject({ assetId: first.assets[0]!.asset.id })
    repo.injectWriteFailure()
    await expect(repo.saveProjectWithAssets(first.document, first.assets)).rejects.toThrow()
    await expect(repo.getAsset(first.assets[0]!.asset.id)).rejects.toThrow()
    await repo.saveProjectWithAssets(first.document, first.assets)
    expect(await repo.getProject(first.document.id)).toEqual(first.document)
    expect((await repo.getAsset(first.document.assetIds[0]!)).asset.provenance).toBe(`bundled-asset:${template.assetSources!.photo}`)
  }
  expect(await repo.listProjects()).toHaveLength(12)
  expect(templateData).toEqual(originals)
})
