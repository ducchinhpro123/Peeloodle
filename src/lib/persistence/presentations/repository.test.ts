import { describe, expect, it } from 'vitest'
import { createMemoryPresentationRepository } from './repository'
import { createImageElement, createPresentationDocument } from '../../../features/presentations/model/factories'
import { fixtureImagePng } from '../../../features/presentations/model/fixtures/fixture'
import type { PresentationAsset } from '../../../features/presentations/model/types'

function asset(id: string): PresentationAsset {
  return { id, blobKey: `media/${id}.png`, mimeType: 'image/png', width: 256, height: 256, sha256: 'a'.repeat(64), provenance: { source: 'upload', label: 'test fixture' } }
}

function deckWithImage(id: string, title: string, now: string) {
  const document = createPresentationDocument({ id, title, now })
  document.assets.push(asset('media-1'))
  document.slides[0]!.elements.push(createImageElement({ id: 'img-1', assetId: 'media-1' }))
  return document
}

describe('presentation repository contract (memory)', () => {
  it('saves, loads and lists documents', async () => {
    const repo = createMemoryPresentationRepository()
    await repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'), [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/png' }])
    await repo.savePresentation(createPresentationDocument({ id: 'deck-2', title: 'Second', now: '2026-09-11T00:00:00.000Z' }))
    const list = await repo.listPresentations()
    expect(list.map((summary) => summary.id)).toEqual(['deck-2', 'deck-1'])
    expect(list[1]).toMatchObject({ title: 'First', slideCount: 1 })
    const loaded = await repo.getPresentation('deck-1')
    expect(loaded.assets).toHaveLength(1)
    expect(loaded.slides[0]!.elements[0]!.kind).toBe('image')
  })

  it('requires media for every referenced asset', async () => {
    const repo = createMemoryPresentationRepository()
    await expect(repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'))).rejects.toMatchObject({ code: 'missing_asset' })
  })

  it('refuses media that is not referenced by the incoming document', async () => {
    const repo = createMemoryPresentationRepository()
    await repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'), [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/png' }])
    const other = createPresentationDocument({ id: 'deck-2', title: 'Second', now: '2026-09-11T00:00:00.000Z' })
    await expect(repo.savePresentation(other, [{ assetId: 'media-1', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }])).rejects.toMatchObject({
      code: 'invalid_asset',
    })
    // The original bytes are intact.
    expect(Array.from((await repo.getMedia('media-1')).bytes)).toEqual(Array.from(fixtureImagePng()))
  })

  it('refuses to replace existing media with different bytes', async () => {
    const repo = createMemoryPresentationRepository()
    await repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'), [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/png' }])
    await expect(
      repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'), [{ assetId: 'media-1', bytes: new Uint8Array([9, 9, 9]), mimeType: 'image/png' }]),
    ).rejects.toMatchObject({ code: 'invalid_asset' })
    expect(Array.from((await repo.getMedia('media-1')).bytes)).toEqual(Array.from(fixtureImagePng()))
  })

  it('accepts an idempotent media re-save and rejects a MIME mismatch', async () => {
    const repo = createMemoryPresentationRepository()
    const document = deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z')
    await repo.savePresentation(document, [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/png' }])
    await expect(repo.savePresentation(document, [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/png' }])).resolves.toBeUndefined()
    await expect(repo.savePresentation(document, [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/webp' }])).rejects.toMatchObject({ code: 'invalid_asset' })
  })

  it('rejects documents that fail validation', async () => {
    const repo = createMemoryPresentationRepository()
    const invalid = deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z')
    invalid.slides = []
    await expect(repo.savePresentation(invalid)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('detects stale revisions without overwriting newer work', async () => {
    const repo = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'deck-1', title: 'First', now: '2026-09-10T00:00:00.000Z' })
    await repo.savePresentation(document)
    // A save based on the revision the caller read is accepted.
    const fresh = { ...document, title: 'Fresh', revision: 1 }
    await repo.savePresentation(fresh, [], { baseRevision: 0 })
    expect((await repo.getPresentation('deck-1')).title).toBe('Fresh')
    // A second save still based on revision 0 is stale and must not win.
    const stale = { ...document, title: 'Stale', revision: 2 }
    await expect(repo.savePresentation(stale, [], { baseRevision: 0 })).rejects.toMatchObject({ code: 'revision_conflict' })
    expect((await repo.getPresentation('deck-1')).title).toBe('Fresh')
  })

  it('duplicates independently, copying media and remapping references', async () => {
    const repo = createMemoryPresentationRepository()
    await repo.savePresentation(deckWithImage('deck-1', 'Original', '2026-09-10T00:00:00.000Z'), [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/png' }])
    const copy = await repo.duplicatePresentation('deck-1', { title: 'Copy' })
    expect(copy.title).toBe('Copy')
    expect(copy.id).not.toBe('deck-1')
    expect(copy.assets[0]!.id).not.toBe('media-1')
    const copyImage = copy.slides[0]!.elements[0]!
    if (copyImage.kind !== 'image') throw new Error('expected image')
    expect(copyImage.assetId).toBe(copy.assets[0]!.id)
    expect(await repo.hasMedia(copy.assets[0]!.id)).toBe(true)
    const copiedMedia = await repo.getMedia(copy.assets[0]!.id)
    expect(copiedMedia.bytes.length).toBe(fixtureImagePng().length)
    // The original is untouched.
    expect((await repo.getPresentation('deck-1')).title).toBe('Original')
    expect(await repo.hasMedia('media-1')).toBe(true)
  })

  it('deletes documents without touching media used by others', async () => {
    const repo = createMemoryPresentationRepository()
    await repo.savePresentation(deckWithImage('deck-1', 'First', '2026-09-10T00:00:00.000Z'), [{ assetId: 'media-1', bytes: fixtureImagePng(), mimeType: 'image/png' }])
    await repo.deletePresentation('deck-1')
    await expect(repo.getPresentation('deck-1')).rejects.toMatchObject({ code: 'not_found' })
    expect(await repo.hasMedia('media-1')).toBe(true)
  })

  it('preserves the previous save when a write fails', async () => {
    const repo = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'deck-1', title: 'First', now: '2026-09-10T00:00:00.000Z' })
    await repo.savePresentation(document)
    repo.injectWriteFailure()
    await expect(repo.savePresentation({ ...document, title: 'Second' })).rejects.toMatchObject({ code: 'transaction_failed' })
    expect((await repo.getPresentation('deck-1')).title).toBe('First')
  })

  it('skips unreadable rows in the list but fails loudly on direct load', async () => {
    const repo = createMemoryPresentationRepository()
    await repo.savePresentation(createPresentationDocument({ id: 'good', title: 'Good', now: '2026-09-10T00:00:00.000Z' }))
    repo.seedRawDocument('bad', { kind: 'presentation', schemaVersion: 99 })
    const list = await repo.listPresentations()
    expect(list.map((summary) => summary.id)).toEqual(['good'])
    await expect(repo.getPresentation('bad')).rejects.toMatchObject({ code: 'unsupported_schema' })
  })

  it('returns copies, not internal state', async () => {
    const repo = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'deck-1', title: 'First', now: '2026-09-10T00:00:00.000Z' })
    await repo.savePresentation(document)
    const loaded = await repo.getPresentation('deck-1')
    loaded.title = 'Mutated outside'
    expect((await repo.getPresentation('deck-1')).title).toBe('First')
  })
})
