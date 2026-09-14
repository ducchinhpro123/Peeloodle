import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { blobBytes } from '../blob'
import { ARTBOARD_SIZE, type ImageLayer, type ProjectDocument, type TextLayer } from '../../types/domain'
import {
  createIdbRepository,
  createMemoryRepository,
  createProjectDocument,
  loadProjectBundle,
  parseProjectDocument,
  PersistenceError,
  type AssetRecord,
} from './repository'

const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }

function textLayer(id = 'text-1'): TextLayer {
  return {
    id,
    name: 'Text',
    kind: 'text',
    content: 'Hello',
    fontFamily: 'Inter',
    fontSize: 32,
    color: '#08152f',
    transform: identity,
    opacity: 1,
    visible: true,
    locked: false,
  }
}

function imageLayer(assetId: string, id = 'image-1'): ImageLayer {
  return {
    id,
    name: 'Photo',
    kind: 'image',
    assetId,
    transform: identity,
    opacity: 1,
    visible: true,
    locked: false,
  }
}

function pngRecord(id: string, bytes: number[] = [1, 2, 3, 4]): AssetRecord {
  return {
    asset: { id, mimeType: 'image/png', width: 8, height: 8, blobKey: id, provenance: 'test' },
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
  }
}

function projectWith(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    ...createProjectDocument({ id: 'project-1', title: 'Sticker' }),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(PersistenceError)
  await promise.catch((error: PersistenceError) => expect(error.code).toBe(code))
}

describe('parseProjectDocument', () => {
  it('bounds persisted filter and outline work before rendering', () => {
    const layer = imageLayer('asset')
    layer.filters = { brightness: 0, contrast: 0, saturation: 0, grayscale: 101 }
    const doc = projectWith({ layers: [layer], assetIds: ['asset'] })
    expect(() => parseProjectDocument(doc)).toThrow(/grayscale/)
    layer.filters.grayscale = 25
    layer.outline = { enabled: true, color: '#ffffff', width: 1e9 }
    expect(() => parseProjectDocument(doc)).toThrow(/outline.width/)
    layer.outline.width = 0
    expect(parseProjectDocument(doc).layers[0]).toMatchObject({ outline: { width: 0 } })
  })

  it('accepts current template-shaped documents', () => {
    const document = parseProjectDocument({
      schemaVersion: 1,
      id: 'seed-0',
      title: 'Good Vibes Pack',
      artboard: { width: ARTBOARD_SIZE, height: ARTBOARD_SIZE, background: 'transparent' },
      layers: [],
      assetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 0,
    })
    expect(document.schemaVersion).toBe(1)
    expect(document.artboard).toEqual({ width: 1024, height: 1024, background: 'transparent' })
  })

  it('rejects malformed JSON, wrong schema, non-1024 artboard, duplicate layers, and missing asset refs', () => {
    expect(() => parseProjectDocument('{not-json')).toThrowError(PersistenceError)
    try {
      parseProjectDocument('{not-json')
    } catch (error) {
      expect((error as PersistenceError).code).toBe('malformed_data')
    }

    expect(() => parseProjectDocument({ ...projectWith(), schemaVersion: 2 })).toThrowError(/schemaVersion/)
    try {
      parseProjectDocument({ ...projectWith(), schemaVersion: 2 })
    } catch (error) {
      expect((error as PersistenceError).code).toBe('unsupported_schema')
    }

    expect(() => parseProjectDocument(projectWith({ artboard: { width: 512, height: 512, background: 'transparent' } }))).toThrowError(
      /1024/,
    )
    expect(() => parseProjectDocument(projectWith({ layers: [textLayer('dup'), textLayer('dup')] }))).toThrowError(/Duplicate layer/)
    expect(() => parseProjectDocument(projectWith({ layers: [imageLayer('missing-asset')], assetIds: [] }))).toThrowError(
      /not in assetIds/,
    )
  })
})

describe('loadProjectBundle', () => {
  it('fetches each referenced asset and mask once, keyed for rendering', async () => {
    const repository = createMemoryRepository()
    const asset = pngRecord('asset-a')
    const mask = new Blob(['mask'], { type: 'image/png' })
    const document = projectWith({
      layers: [imageLayer('asset-a', 'one'), { ...imageLayer('asset-a', 'two'), maskKey: 'mask-a' }],
      assetIds: ['asset-a'],
    })
    await repository.saveProjectWithAssets(document, [asset], [{ key: 'mask-a', blob: mask }])

    const getAsset = vi.spyOn(repository, 'getAsset')
    const getMask = vi.spyOn(repository, 'getMask')
    const bundle = await loadProjectBundle(repository, document)

    expect([...bundle.assets.keys()]).toEqual(['asset-a'])
    expect([...bundle.masks.keys()]).toEqual(['mask-a'])
    expect(getAsset).toHaveBeenCalledTimes(1)
    expect(getMask).toHaveBeenCalledTimes(1)
  })

  it('fails with the adapter not_found code when referenced artwork is missing', async () => {
    const repository = createMemoryRepository()
    const document = projectWith({ layers: [imageLayer('asset-gone')], assetIds: ['asset-gone'] })

    await expect(loadProjectBundle(repository, document)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('MemoryRepository', () => {
  it('roundtrips a project and immutable asset blob', async () => {
    const repo = createMemoryRepository()
    const asset = pngRecord('asset-1', [9, 8, 7, 6])
    const document = projectWith({
      layers: [imageLayer('asset-1'), textLayer()],
      assetIds: ['asset-1'],
      revision: 1,
    })

    await repo.saveProjectWithAssets(document, [asset])
    const loaded = await repo.getProject('project-1')
    const loadedAsset = await repo.getAsset('asset-1')

    expect(loaded.layers).toHaveLength(2)
    expect(loaded.assetIds).toEqual(['asset-1'])
    expect(loadedAsset.asset).toEqual(asset.asset)
    expect(await blobBytes(loadedAsset.blob)).toEqual(new Uint8Array([9, 8, 7, 6]))
    expect(await repo.listProjects()).toEqual([loaded])
  })

  it('rejects a save that references a missing asset and stores nothing', async () => {
    const repo = createMemoryRepository()
    const document = projectWith({ layers: [imageLayer('ghost')], assetIds: ['ghost'] })
    await expectCode(repo.saveProjectWithAssets(document, [pngRecord('other')]), 'missing_asset')
    await expectCode(repo.getProject('project-1'), 'not_found')
    expect(await repo.listProjects()).toEqual([])
    expect(await repo.listAssets()).toEqual([])
  })

  it('keeps the prior project when a write is injected to fail', async () => {
    const repo = createMemoryRepository()
    const original = projectWith({ title: 'Saved', revision: 1 })
    await repo.saveProject(original)

    repo.injectWriteFailure()
    await expectCode(repo.saveProject(projectWith({ title: 'Lost', revision: 2 })), 'transaction_failed')

    const loaded = await repo.getProject('project-1')
    expect(loaded.title).toBe('Saved')
    expect(loaded.revision).toBe(1)
  })

  it('getProject rejects corrupt stored rows', async () => {
    const repo = createMemoryRepository()
    repo.seedRawProject('bad-json', '{not-json')
    repo.seedRawProject('bad-schema', { ...projectWith({ id: 'bad-schema' }), schemaVersion: 99 })
    repo.seedRawProject('ok', projectWith({ id: 'ok', title: 'Keep', updatedAt: '2026-02-01T00:00:00.000Z' }))

    await expectCode(repo.getProject('bad-json'), 'malformed_data')
    await expectCode(repo.getProject('bad-schema'), 'unsupported_schema')
    expect(await repo.listProjects()).toEqual([expect.objectContaining({ id: 'ok', title: 'Keep' })])
  })

  it('can use an already-persisted asset on a later project save', async () => {
    const repo = createMemoryRepository()
    const asset = pngRecord('asset-1')
    await repo.saveAsset(asset)
    await repo.saveProject(projectWith({ layers: [imageLayer('asset-1')], assetIds: ['asset-1'] }))
    expect((await repo.getProject('project-1')).assetIds).toEqual(['asset-1'])
  })

  it('deletes projects without deleting assets', async () => {
    const repo = createMemoryRepository()
    const asset = pngRecord('asset-1')
    await repo.saveProjectWithAssets(projectWith({ layers: [imageLayer('asset-1')], assetIds: ['asset-1'] }), [asset])
    await repo.deleteProject('project-1')
    await expectCode(repo.getProject('project-1'), 'not_found')
    expect((await repo.getAsset('asset-1')).asset.id).toBe('asset-1')
  })
})

describe('IdbRepository', () => {
  it('fails with a recoverable error when IndexedDB is missing', async () => {
    const original = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
    try {
      await expectCode(createIdbRepository('stickerlab-test').listProjects(), 'transaction_failed')
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: original })
    }
  })

  it('roundtrips a project and blob through IndexedDB', async () => {
    const repo = createIdbRepository(`stickerlab-idb-${crypto.randomUUID()}`)
    const asset = pngRecord('asset-1', [4, 5, 6, 7])
    const document = projectWith({
      layers: [imageLayer('asset-1'), textLayer()],
      assetIds: ['asset-1'],
      revision: 1,
    })
    await repo.saveProjectWithAssets(document, [asset])
    const loaded = await repo.getProject('project-1')
    const loadedAsset = await repo.getAsset('asset-1')
    expect(loaded.title).toBe('Sticker')
    expect(loaded.layers).toHaveLength(2)
    expect(await blobBytes(loadedAsset.blob)).toEqual(new Uint8Array([4, 5, 6, 7]))
    expect((await repo.listProjects())[0]?.id).toBe('project-1')
  })

  it('aborts a missing-asset write so neither project nor new blobs remain', async () => {
    const repo = createIdbRepository(`stickerlab-idb-${crypto.randomUUID()}`)
    await expectCode(
      repo.saveProjectWithAssets(projectWith({ layers: [imageLayer('ghost')], assetIds: ['ghost'] }), [pngRecord('other')]),
      'missing_asset',
    )
    await expectCode(repo.getProject('project-1'), 'not_found')
    expect(await repo.listProjects()).toEqual([])
    expect(await repo.listAssets()).toEqual([])
  })

  it('deletes a project without deleting its assets', async () => {
    const repo = createIdbRepository(`stickerlab-idb-${crypto.randomUUID()}`)
    await repo.saveProjectWithAssets(projectWith({ layers: [imageLayer('asset-1')], assetIds: ['asset-1'] }), [pngRecord('asset-1')])
    await repo.deleteProject('project-1')
    await expectCode(repo.getProject('project-1'), 'not_found')
    expect((await repo.getAsset('asset-1')).asset.id).toBe('asset-1')
  })

  it('saves, lists, and deletes packs without affecting underlying projects in Memory and IndexedDB', async () => {
    for (const repo of [createMemoryRepository(), createIdbRepository(`stickerlab-packs-${crypto.randomUUID()}`)]) {
      const pack = {
        id: 'pack-1',
        title: 'Cool Stickers',
        description: 'A test pack',
        visibility: 'local' as const,
        projectIds: ['project-1', 'project-2'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await repo.savePack(pack)
      const loaded = await repo.getPack('pack-1')
      expect(loaded.title).toBe('Cool Stickers')
      expect(loaded.projectIds).toEqual(['project-1', 'project-2'])
      expect(await repo.listPacks()).toHaveLength(1)

      // Deleting pack does not throw and removes pack
      await repo.deletePack('pack-1')
      expect(await repo.listPacks()).toHaveLength(0)
      await expectCode(repo.getPack('pack-1'), 'not_found')
    }
  })

  it('saves, retrieves, and rejects missing masks in Memory and IndexedDB', async () => {
    for (const repo of [createMemoryRepository(), createIdbRepository(`stickerlab-masks-${crypto.randomUUID()}`)]) {
      const maskBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' })
      await repo.saveMask('mask-1', maskBlob)
      const loaded = await repo.getMask('mask-1')
      expect(loaded.size).toBe(maskBlob.size)

      const img = imageLayer('asset-1')
      img.maskKey = 'mask-1'
      const doc = projectWith({ layers: [img], assetIds: ['asset-1'] })
      await repo.saveProjectWithAssets(doc, [pngRecord('asset-1')])
      expect((await repo.getProject('project-1')).layers[0]?.kind === 'image').toBe(true)

      // Missing mask rejection
      const ghostImg = imageLayer('asset-1')
      ghostImg.maskKey = 'ghost-mask'
      const ghostDoc = projectWith({ id: 'ghost-proj', layers: [ghostImg], assetIds: ['asset-1'] })
      await expectCode(
        repo.saveProjectWithAssets(ghostDoc, [pngRecord('asset-1')]),
        'missing_mask',
      )

      await repo.deleteMask('mask-1')
      await expectCode(repo.getMask('mask-1'), 'not_found')
    }
  })

  it('keeps guest v4 saves atomic and does not enqueue cloud operations', async () => {
    const repo = createIdbRepository(`guest-v4-${crypto.randomUUID()}`)
    await repo.saveProject(projectWith())
    expect(await repo.listSyncEntries()).toEqual([])
    await expectCode(
      repo.saveProjectWithAssets(projectWith({ id: 'broken', layers: [imageLayer('ghost')], assetIds: ['ghost'] }), []),
      'missing_asset',
    )
    expect((await repo.getProject('project-1')).title).toBe('Sticker')
    expect(await repo.listSyncEntries()).toEqual([])
  })
})
