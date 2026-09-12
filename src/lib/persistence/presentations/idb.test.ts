import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { STICKERLAB_DB_VERSION, STORE_NAMES } from '../idb'
import { createIdbRepository, createProjectDocument } from '../repository'
import { createIdbPresentationRepository } from './idb'
import { createImageElement, createPresentationDocument } from '../../../features/presentations/model/factories'
import { fixtureImagePng } from '../../../features/presentations/model/fixtures/fixture'
import type { PresentationAsset, PresentationDocument } from '../../../features/presentations/model/types'
import type { ImageLayer } from '../../../types/domain'

function asset(id: string): PresentationAsset {
  return { id, blobKey: `media/${id}.png`, mimeType: 'image/png', width: 256, height: 256, sha256: 'a'.repeat(64), byteLength: fixtureImagePng().length, provenance: { source: 'upload', label: 'test fixture' } }
}

function deckWithImage(id: string, title: string, now: string, assetId = 'media-1'): PresentationDocument {
  const document = createPresentationDocument({ id, title, now })
  document.assets.push(asset(assetId))
  document.slides[0]!.elements.push(createImageElement({ id: `img-${assetId}`, assetId }))
  return document
}

function media(assetId = 'media-1') {
  return { assetId, bytes: fixtureImagePng(), mimeType: 'image/png' as const }
}

function stickerProject() {
  const document = createProjectDocument({ id: 'project-1', title: 'Sticker' })
  const layer: ImageLayer = {
    id: 'layer-1',
    name: 'Photo',
    kind: 'image',
    assetId: 'sticker-asset-1',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    opacity: 1,
    visible: true,
    locked: false,
  }
  document.layers.push(layer)
  document.assetIds.push('sticker-asset-1')
  return document
}

/** Creates a populated v4 database exactly as the sticker-only release did. */
function seedV4Database(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 4)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('projects', { keyPath: 'id' })
      db.createObjectStore('assets', { keyPath: 'id' })
      db.createObjectStore('packs', { keyPath: 'id' })
      db.createObjectStore('masks', { keyPath: 'key' })
      db.createObjectStore('sync', { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['projects', 'assets'], 'readwrite')
      tx.objectStore('projects').put(stickerProject())
      tx.objectStore('assets').put({ id: 'sticker-asset-1', mimeType: 'image/png', width: 256, height: 256, blobKey: 'sticker-asset-1', provenance: 'test', blob: fixtureImagePng().buffer.slice(0) })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

function databaseVersion(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => {
      const version = request.result.version
      request.result.close()
      resolve(version)
    }
    request.onerror = () => reject(request.error)
  })
}

describe('IdbPresentationRepository (P13/P14)', () => {
  it('upgrades a populated v4 database additively, keeping sticker data', async () => {
    const name = `stickerlab-upgrade-${crypto.randomUUID()}`
    await seedV4Database(name)

    const stickers = createIdbRepository(name)
    const presentations = createIdbPresentationRepository(name)
    const deck = deckWithImage('deck-1', 'Bài trình bày', '2026-09-10T00:00:00.000Z')

    // Old sticker data is still readable through the sticker repository.
    expect((await stickers.getProject('project-1')).title).toBe('Sticker')
    expect(await stickers.getAsset('sticker-asset-1')).toBeDefined()
    expect(await stickers.listProjects()).toHaveLength(1)

    // New stores work in the same database without disturbing the old rows.
    await presentations.savePresentation(deck, [media()])
    expect((await presentations.getPresentation('deck-1')).slides).toHaveLength(1)
    expect((await stickers.getProject('project-1')).title).toBe('Sticker')
    expect(await databaseVersion(name)).toBe(STICKERLAB_DB_VERSION)
  })

  it('round-trips documents and media and lists summaries newest first', async () => {
    const repo = createIdbPresentationRepository(`stickerlab-pres-${crypto.randomUUID()}`)
    await repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'), [media()])
    await repo.savePresentation(createPresentationDocument({ id: 'deck-2', title: 'Second', now: '2026-09-11T00:00:00.000Z' }))
    expect((await repo.listPresentations()).map((summary) => summary.id)).toEqual(['deck-2', 'deck-1'])
    const loaded = await repo.getPresentation('deck-1')
    expect(loaded.title).toBe('First')
    expect(Array.from((await repo.getMedia('media-1')).bytes)).toEqual(Array.from(fixtureImagePng()))
    expect(await repo.hasMedia('media-1')).toBe(true)
    expect(await repo.hasMedia('missing')).toBe(false)
  })

  it('rejects stale revisions, recreated deletions and conflicting base revisions', async () => {
    const repo = createIdbPresentationRepository(`stickerlab-conflict-${crypto.randomUUID()}`)
    const document = deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z')
    await repo.savePresentation(document, [media()])

    // A stale tab tries to save its older revision after another save won.
    await repo.savePresentation({ ...document, title: 'Second', revision: 1 }, [media()], { baseRevision: 0 })
    await expect(repo.savePresentation({ ...document, title: 'Stale', revision: 1 }, [media()], { baseRevision: 0 })).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(repo.savePresentation({ ...document, title: 'Older', revision: 0 }, [media()])).rejects.toMatchObject({ code: 'revision_conflict' })
    expect((await repo.getPresentation('deck-1')).title).toBe('Second')

    // A tab that loaded a row which was deleted elsewhere must not silently recreate it.
    await repo.deletePresentation('deck-1')
    await expect(repo.savePresentation({ ...document, revision: 2 }, [media()], { baseRevision: 1 })).rejects.toMatchObject({ code: 'revision_conflict' })
    // A brand-new document has no base revision and is allowed.
    await repo.savePresentation(deckWithImage('deck-9', 'New', '2026-09-12T00:00:00.000Z'), [media()])
  })

  it('rolls back media and document together when a write fails', async () => {
    const repo = createIdbPresentationRepository(`stickerlab-atomic-${crypto.randomUUID()}`)
    const first = deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z')
    await repo.savePresentation(first, [media()])

    const second = deckWithImage('deck-1', 'Second', '2026-09-11T00:00:00.000Z', 'media-2')
    second.revision = 1
    second.slides[0]!.elements.push(createImageElement({ id: 'img-second', assetId: 'media-2' }))

    const prototype = globalThis.IDBObjectStore.prototype
    const originalPut = prototype.put
    let failDocumentWrite = true
    prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      if (failDocumentWrite && this.name === STORE_NAMES.presentations) {
        failDocumentWrite = false
        throw new Error('simulated quota failure')
      }
      return originalPut.apply(this, args as never)
    } as typeof originalPut

    try {
      await expect(repo.savePresentation(second, [media('media-2')])).rejects.toMatchObject({ code: 'transaction_failed' })
    } finally {
      prototype.put = originalPut
    }

    // The new media never landed and the previous document is intact.
    expect(await repo.hasMedia('media-2')).toBe(false)
    expect((await repo.getPresentation('deck-1')).title).toBe('First')
    expect(Array.from((await repo.getMedia('media-1')).bytes)).toEqual(Array.from(fixtureImagePng()))
  })

  it('keeps stored media immutable across saves', async () => {
    const repo = createIdbPresentationRepository(`stickerlab-immutable-${crypto.randomUUID()}`)
    const document = deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z')
    await repo.savePresentation(document, [media()])

    await expect(repo.savePresentation(document, [{ assetId: 'media-1', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }])).rejects.toMatchObject({ code: 'invalid_asset' })
    await expect(repo.savePresentation(document, [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/webp' }])).rejects.toMatchObject({ code: 'invalid_asset' })
    await expect(repo.savePresentation(document, [media('unrelated-asset')])).rejects.toMatchObject({ code: 'invalid_asset' })
    const redeclared = deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z')
    redeclared.assets[0]!.mimeType = 'image/webp'
    await expect(repo.savePresentation(redeclared)).rejects.toMatchObject({ code: 'invalid_asset' })
    expect((await repo.getMedia('media-1')).mimeType).toBe('image/png')
  })

  it('duplicates independently with copied media', async () => {
    const repo = createIdbPresentationRepository(`stickerlab-dup-${crypto.randomUUID()}`)
    await repo.savePresentation(deckWithImage('deck-1', 'Original', '2026-09-10T00:00:00.000Z'), [media()])
    const copy = await repo.duplicatePresentation('deck-1', { title: 'Copy' })
    expect(copy.id).not.toBe('deck-1')
    expect(copy.assets[0]!.id).not.toBe('media-1')
    const copyImage = copy.slides[0]!.elements[0]!
    if (copyImage.kind !== 'image') throw new Error('expected image')
    expect(copyImage.assetId).toBe(copy.assets[0]!.id)
    expect(await repo.hasMedia(copy.assets[0]!.id)).toBe(true)
    expect((await repo.getMedia(copy.assets[0]!.id)).bytes.length).toBe(fixtureImagePng().length)
    expect((await repo.getPresentation('deck-1')).title).toBe('Original')
  })

  it('deletes documents without touching shared media', async () => {
    const repo = createIdbPresentationRepository(`stickerlab-delete-${crypto.randomUUID()}`)
    await repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'), [media()])
    await repo.deletePresentation('deck-1')
    await expect(repo.getPresentation('deck-1')).rejects.toMatchObject({ code: 'not_found' })
    expect(await repo.hasMedia('media-1')).toBe(true)
  })

  it('skips unreadable rows in listings but fails loudly on direct load', async () => {
    const name = `stickerlab-corrupt-${crypto.randomUUID()}`
    const repo = createIdbPresentationRepository(name)
    await repo.savePresentation(createPresentationDocument({ id: 'good', title: 'Good', now: '2026-09-10T00:00:00.000Z' }))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, STICKERLAB_DB_VERSION)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction([STORE_NAMES.presentations], 'readwrite')
        tx.objectStore(STORE_NAMES.presentations).put({ kind: 'presentation', schemaVersion: 99, id: 'bad' })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
    expect((await repo.listPresentations()).map((summary) => summary.id)).toEqual(['good'])
    await expect(repo.getPresentation('bad')).rejects.toMatchObject({ code: 'unsupported_schema' })
  })
})
