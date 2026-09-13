import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRepository } from '@/lib/persistence/repository'
import { createProjectDocument } from '@/lib/persistence/document'
import { prepareStickerSnapshot } from './insertStickerSnapshot'
import { fixtureImagePng } from '../model/fixtures/fixture'
import type { ImageLayer } from '@/types/domain'

beforeEach(() => {
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} }) as ImageBitmap
})

function imageLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    kind: 'image',
    name: 'Photo',
    assetId: 'asset-1',
    maskKey: 'mask-1',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    opacity: 1,
    visible: true,
    locked: false,
    ...overrides,
  }
}

describe('sticker snapshots', () => {
  it('composes the saved sticker through the renderer and prepares its own bytes', async () => {
    const repository = createMemoryRepository()
    const project = createProjectDocument({ id: 'sticker-1', title: 'Cat sticker' })
    project.layers = [imageLayer()]
    project.assetIds = ['asset-1']
    await repository.saveProjectWithAssets(project, [{
      asset: { id: 'asset-1', mimeType: 'image/png', width: 256, height: 256, blobKey: 'assets/asset-1', provenance: 'user' },
      blob: new Blob([fixtureImagePng()], { type: 'image/png' }),
    }], [{ key: 'mask-1', blob: new Blob([new Uint8Array([1, 2, 3])]) }])

    const render = vi.fn(async (document, assets, masks) => {
      expect(document.id).toBe('sticker-1')
      expect([...assets.keys()]).toEqual(['asset-1'])
      expect([...masks.keys()]).toEqual(['mask-1'])
      return new Blob([fixtureImagePng()], { type: 'image/png' })
    })

    const prepared = await prepareStickerSnapshot(repository, 'sticker-1', render)

    expect(render).toHaveBeenCalledTimes(1)
    expect(prepared.asset.provenance).toMatchObject({ source: 'upload', label: 'Cat sticker.png' })
    expect(prepared.asset.id).toBe(`asset-${prepared.asset.sha256}`)
    expect(Array.from(prepared.media.bytes)).toEqual(Array.from(fixtureImagePng()))
  })

  it('rejects when the sticker cannot be read', async () => {
    const repository = createMemoryRepository()
    await expect(prepareStickerSnapshot(repository, 'missing', vi.fn())).rejects.toThrow()
  })

  it('loads each asset and mask once even when layers share them', async () => {
    const repository = createMemoryRepository()
    const project = createProjectDocument({ id: 'sticker-2', title: 'Shared' })
    project.layers = [imageLayer(), imageLayer({ id: 'layer-2', name: 'Second' })]
    project.assetIds = ['asset-1']
    await repository.saveProjectWithAssets(project, [{
      asset: { id: 'asset-1', mimeType: 'image/png', width: 256, height: 256, blobKey: 'assets/asset-1', provenance: 'user' },
      blob: new Blob([fixtureImagePng()], { type: 'image/png' }),
    }], [{ key: 'mask-1', blob: new Blob([new Uint8Array([1, 2, 3])]) }])

    const getAsset = vi.spyOn(repository, 'getAsset')
    const getMask = vi.spyOn(repository, 'getMask')
    const render = vi.fn(async () => new Blob([fixtureImagePng()], { type: 'image/png' }))

    await prepareStickerSnapshot(repository, 'sticker-2', render)

    expect(getAsset).toHaveBeenCalledTimes(1)
    expect(getMask).toHaveBeenCalledTimes(1)
  })
})
