/**
 * Presentation repository contract (P12).
 *
 * Documents and their media are separate records; a save is atomic from the
 * caller's perspective. Implementations: `MemoryPresentationRepository`
 * (tests/UI prototypes) and the IndexedDB adapter (P13/P14). Error codes come
 * from the shared `PersistenceError` so UIs can distinguish missing media,
 * quota/transaction failures and revision conflicts.
 */

import { PersistenceError } from '../document'
import { assertPresentationMediaWritable } from './mediaPolicy'
import { byUpdatedAtDescending } from '../order'
import { assertRevisionWritable } from './revision'
import { clonePresentationDocumentWithNewIds } from '../../../features/presentations/model/factories'
import { serializePresentationDocument } from '../../../features/presentations/model/parse'
import type { PresentationAsset, PresentationDocument, PresentationSummary } from '../../../features/presentations/model/types'

export type PresentationMediaRecord = {
  assetId: string
  bytes: Uint8Array
  mimeType: PresentationAsset['mimeType']
}

export type SavePresentationOptions = {
  /** Revision the caller last read; a newer stored revision is a conflict. */
  baseRevision?: number
}

export interface PresentationRepository {
  listPresentations(): Promise<PresentationSummary[]>
  getPresentation(id: string): Promise<PresentationDocument>
  savePresentation(document: PresentationDocument, media?: PresentationMediaRecord[], options?: SavePresentationOptions): Promise<void>
  deletePresentation(id: string): Promise<void>
  /** Independent copy with new document/slide/element/asset IDs and copied media. */
  duplicatePresentation(id: string, options?: { title?: string }): Promise<PresentationDocument>
  getMedia(assetId: string): Promise<PresentationMediaRecord>
  hasMedia(assetId: string): Promise<boolean>
}

export function toPresentationSummary(document: PresentationDocument): PresentationSummary {
  return { id: document.id, title: document.title, slideCount: document.slides.length, updatedAt: document.updatedAt, revision: document.revision }
}

export class MemoryPresentationRepository implements PresentationRepository {
  protected documents = new Map<string, PresentationDocument>()
  protected media = new Map<string, PresentationMediaRecord>()
  private failNextWrite = false

  injectWriteFailure(): void {
    this.failNextWrite = true
  }

  /** Test seam: write an unvalidated value as if it came off disk. */
  seedRawDocument(id: string, value: unknown): void {
    this.documents.set(id, value as PresentationDocument)
  }

  seedMedia(record: PresentationMediaRecord): void {
    this.media.set(record.assetId, { ...record, bytes: record.bytes.slice() })
  }

  async listPresentations(): Promise<PresentationSummary[]> {
    const summaries: PresentationSummary[] = []
    for (const value of this.documents.values()) {
      try {
        summaries.push(toPresentationSummary(serializePresentationDocument(value)))
      } catch {
        // One unreadable row must not hide the rest of the library.
      }
    }
    return summaries.sort(byUpdatedAtDescending)
  }

  async getPresentation(id: string): Promise<PresentationDocument> {
    const value = this.documents.get(id)
    if (value === undefined) throw new PersistenceError('not_found', `Presentation ${id} was not found`)
    return serializePresentationDocument(value)
  }

  async savePresentation(document: PresentationDocument, media: PresentationMediaRecord[] = [], options: SavePresentationOptions = {}): Promise<void> {
    this.guardWrite()
    const clean = serializePresentationDocument(document)
    const existing = this.documents.get(clean.id)
    let storedRevision: number | undefined
    if (existing) {
      try {
        storedRevision = serializePresentationDocument(existing).revision
      } catch {
        storedRevision = Number.POSITIVE_INFINITY
      }
    }
    assertRevisionWritable({ id: clean.id, incomingRevision: clean.revision, storedRevision, baseRevision: options.baseRevision })
    assertPresentationMediaWritable({
      documentId: clean.id,
      assets: clean.assets,
      submitted: media,
      stored: [...this.media.values()],
    })
    const nextMedia = new Map(this.media)
    for (const record of media) nextMedia.set(record.assetId, { ...record, bytes: record.bytes.slice() })
    // Commit together so a failed save leaves the previous document intact.
    this.media = nextMedia
    this.documents.set(clean.id, clean)
  }

  async deletePresentation(id: string): Promise<void> {
    this.guardWrite()
    this.documents.delete(id)
  }

  async duplicatePresentation(id: string, options: { title?: string } = {}): Promise<PresentationDocument> {
    const source = await this.getPresentation(id)
    const copy = clonePresentationDocumentWithNewIds(source, { title: options.title ?? `${source.title} copy` })
    // `clonePresentationDocumentWithNewIds` maps assets by index, so media can be copied in order.
    const media: PresentationMediaRecord[] = source.assets.map((asset, index) => {
      const record = this.media.get(asset.id)
      if (!record) throw new PersistenceError('missing_asset', `Cannot duplicate ${id}: media for ${asset.id} is missing`)
      return { assetId: copy.assets[index]!.id, bytes: record.bytes, mimeType: record.mimeType }
    })
    await this.savePresentation(copy, media)
    return copy
  }

  async getMedia(assetId: string): Promise<PresentationMediaRecord> {
    const record = this.media.get(assetId)
    if (!record) throw new PersistenceError('not_found', `Media ${assetId} was not found`)
    return { ...record, bytes: record.bytes.slice() }
  }

  async hasMedia(assetId: string): Promise<boolean> {
    return this.media.has(assetId)
  }

  private guardWrite(): void {
    if (!this.failNextWrite) return
    this.failNextWrite = false
    throw new PersistenceError('transaction_failed', 'Save failed')
  }
}

export function createMemoryPresentationRepository(): MemoryPresentationRepository {
  return new MemoryPresentationRepository()
}
