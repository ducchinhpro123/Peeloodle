import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryPresentationRepository } from '@/lib/persistence/presentations/repository'
import { createExportSnapshot, collectExportWarnings, referencedAssets } from './snapshot'
import { createImageElement, createPresentationDocument, createTextElement } from '../model/factories'
import { usePresentationStore } from '../editor/store'
import { fixtureImagePng } from '../model/fixtures/fixture'
import type { PresentationAsset, PresentationDocument } from '../model/types'

function bitmap(closed: number[] = []): ImageBitmap {
  return { width: 64, height: 64, close: () => { closed.push(1) } } as unknown as ImageBitmap
}

function asset(id: string, label: string): PresentationAsset {
  return {
    id,
    blobKey: `uploads/${id}`,
    mimeType: 'image/png',
    width: 64,
    height: 64,
    // Only hex characters are valid in the document's content hash.
    sha256: id.replace(/[^0-9a-f]/g, '').padEnd(64, '0').slice(0, 64),
    byteLength: fixtureImagePng().length,
    provenance: { source: 'upload', label },
  }
}

async function documentWithImage(id = 'asset-1'): Promise<{ repository: ReturnType<typeof createMemoryPresentationRepository>; document: PresentationDocument }> {
  const repository = createMemoryPresentationRepository()
  const document = createPresentationDocument({ id: 'deck', title: 'Deck' })
  const image = asset(id, 'photo.png')
  document.assets = [image]
  document.slides[0]!.elements.push(createImageElement({ assetId: image.id }))
  await repository.savePresentation(document, [{ assetId: image.id, bytes: fixtureImagePng(), mimeType: 'image/png' }])
  return { repository, document }
}

beforeEach(() => {
  usePresentationStore.getState().closeDocument()
})

afterEach(() => {
  usePresentationStore.getState().closeDocument()
})

describe('export snapshot preflight', () => {
  it('awaits fonts, decodes referenced artwork and disposes it once', async () => {
    const { repository, document } = await documentWithImage()
    const fonts = vi.fn(async () => {})
    const closed: number[] = []
    const snapshot = await createExportSnapshot(document, { repository, ensureFonts: fonts, decode: async () => bitmap(closed) })

    expect(fonts).toHaveBeenCalledTimes(1)
    expect(snapshot.revision).toBe(document.revision)
    expect(snapshot.document).toBe(document)
    expect([...snapshot.images.keys()]).toEqual(['asset-1'])
    expect(snapshot.media.get('asset-1')?.mimeType).toBe('image/png')
    expect(snapshot.warnings).toEqual([])

    snapshot.dispose()
    snapshot.dispose()
    expect(closed).toHaveLength(1)
  })

  it('loads only the artwork the document references', async () => {
    const { repository, document } = await documentWithImage('asset-referenced')
    repository.seedMedia({ assetId: 'asset-unreferenced', bytes: fixtureImagePng(), mimeType: 'image/png' })
    const getMedia = vi.spyOn(repository, 'getMedia')

    const snapshot = await createExportSnapshot(document, {
      repository,
      ensureFonts: async () => {},
      decode: async () => bitmap(),
    })

    expect(getMedia).toHaveBeenCalledTimes(1)
    expect(getMedia).toHaveBeenCalledWith('asset-referenced')
    expect([...snapshot.images.keys()]).toEqual(['asset-referenced'])
    snapshot.dispose()
  })

  it('reports a missing image with its name instead of exporting a broken page', async () => {
    const repository = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'deck' })
    const image = asset('asset-missing', 'holiday-photo.png')
    document.assets = [image]
    document.slides[0]!.elements.push(createImageElement({ assetId: image.id }))

    await expect(createExportSnapshot(document, { repository, ensureFonts: async () => {} })).rejects.toMatchObject({
      code: 'missing-media',
      message: expect.stringContaining('holiday-photo.png'),
    })
  })

  it('does not mix a later edit into a captured document', async () => {
    const repository = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'deck', title: 'Deck' })
    usePresentationStore.getState().loadDocument(document, { saved: true })

    // The caller captures the live document; the snapshot module never reads the store.
    const captured = usePresentationStore.getState().document!
    usePresentationStore.getState().addSlide()

    const snapshot = await createExportSnapshot(captured, {
      repository,
      ensureFonts: async () => {},
    })

    expect(snapshot.document.slides).toHaveLength(1)
    expect(snapshot.revision).toBe(document.revision)
    expect(usePresentationStore.getState().document!.slides).toHaveLength(2)
    snapshot.dispose()
  })

  it('closes decoded artwork when one image fails to decode', async () => {
    const { repository } = await documentWithImage('asset-ok')
    const document = await repository.getPresentation('deck')
    const broken = asset('asset-broken', 'broken.png')
    document.assets.push(broken)
    document.slides[0]!.elements.push(createImageElement({ assetId: broken.id }))
    await repository.savePresentation(document, [{ assetId: broken.id, bytes: fixtureImagePng(), mimeType: 'image/png' }])

    const closed: number[] = []
    await expect(createExportSnapshot(document, {
      repository,
      ensureFonts: async () => {},
      decode: async (record) => {
        if (record.assetId === broken.id) throw new Error('corrupt')
        return bitmap(closed)
      },
    })).rejects.toMatchObject({ code: 'decode-failed' })

    expect(closed).toHaveLength(1)
  })

  it('reports overflow and unknown fonts as actionable warnings', () => {
    const document = createPresentationDocument({ id: 'deck' })
    document.slides[0]!.elements.push(createTextElement({
      id: 'long-text',
      name: 'Long text',
      width: 400,
      height: 40,
      paragraphs: [{ runs: [{ text: 'a'.repeat(600), fontId: 'comic-sans-9000', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'none', bulletLevel: 0 }],
    }))

    const warnings = collectExportWarnings(document)
    const overflow = warnings.find((warning) => warning.code === 'text-overflow')
    const missing = warnings.find((warning) => warning.code === 'missing-font')

    expect(overflow?.message).toContain('Slide 1')
    expect(overflow?.message).toContain('Long text')
    expect(missing?.message).toContain('comic-sans-9000')
  })

  it('lists only the assets the slides draw', () => {
    const document = createPresentationDocument({ id: 'deck' })
    document.assets = [asset('used', 'used.png'), asset('unused', 'unused.png')]
    document.slides[0]!.elements.push(createImageElement({ assetId: 'used' }))

    expect(referencedAssets(document).map((entry) => entry.id)).toEqual(['used'])
  })
})
