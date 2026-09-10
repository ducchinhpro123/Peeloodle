import { describe, expect, it } from 'vitest'
import { createImageElement, createPresentationDocument, createShapeElement, createTextElement, clonePresentationDocumentWithNewIds } from './factories'
import { parsePresentationDocument } from './parse'
import { PRESENTATION_LIMITS } from './limits'

describe('presentation factories', () => {
  it('creates a valid blank document with one slide', () => {
    const document = createPresentationDocument({ title: 'Bài trình bày', now: '2026-09-10T00:00:00.000Z' })
    expect(document.title).toBe('Bài trình bày')
    expect(document.slides).toHaveLength(1)
    expect(document.assets).toEqual([])
    expect(document.revision).toBe(0)
    expect(document.pageSize).toEqual({ width: 1280, height: 720 })
    expect(() => parsePresentationDocument(document)).not.toThrow()
  })

  it('creates elements that satisfy the document contract', () => {
    const document = createPresentationDocument()
    const text = createTextElement({ text: 'Xin chào', name: 'Greeting' })
    const shape = createShapeElement({ shape: 'rounded-rectangle', fill: '#ffd166' })
    const image = createImageElement({ assetId: 'asset-1', alt: 'A sample' })
    document.assets.push({ id: 'asset-1', blobKey: 'media/asset-1.png', mimeType: 'image/png', width: 10, height: 10, sha256: 'a'.repeat(64), provenance: { source: 'upload', label: 'test' } })
    document.slides[0]!.elements.push(text, shape, image)
    expect(() => parsePresentationDocument(document)).not.toThrow()
  })

  it('clones a document with new IDs and remapped asset references', () => {
    const source = createPresentationDocument({ title: 'Source' })
    source.assets.push({
      id: 'asset-1',
      blobKey: 'media/asset-1.png',
      mimeType: 'image/png',
      width: 10,
      height: 10,
      sha256: 'a'.repeat(64),
      provenance: { source: 'upload', label: 'test' },
    })
    const sourceImage = createImageElement({ assetId: 'asset-1' })
    source.slides[0]!.elements.push(sourceImage)

    const clone = clonePresentationDocumentWithNewIds(source, { title: 'Copy', now: '2026-09-10T10:00:00.000Z' })
    expect(clone.id).not.toBe(source.id)
    expect(clone.title).toBe('Copy')
    expect(clone.revision).toBe(0)
    expect(clone.slides[0]!.id).not.toBe(source.slides[0]!.id)
    const cloneImage = clone.slides[0]!.elements[0]!
    expect(cloneImage.id).not.toBe(sourceImage.id)
    expect(cloneImage.kind).toBe('image')
    if (cloneImage.kind !== 'image') throw new Error('expected image')
    expect(cloneImage.assetId).not.toBe('asset-1')
    expect(clone.assets[0]!.id).toBe(cloneImage.assetId)
    // The source is untouched and both documents remain valid.
    expect(source.assets[0]!.id).toBe('asset-1')
    expect(source.slides[0]!.elements[0]!.id).toBe(sourceImage.id)
    expect(() => parsePresentationDocument(clone)).not.toThrow()
    expect(() => parsePresentationDocument(source)).not.toThrow()
  })

  it('exposes centralized limits', () => {
    expect(PRESENTATION_LIMITS.maxSlides).toBeGreaterThanOrEqual(10)
    expect(PRESENTATION_LIMITS.historyEntries).toBe(50)
  })
})
