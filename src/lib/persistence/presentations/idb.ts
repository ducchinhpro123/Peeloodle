/**
 * IndexedDB presentation repository (P13/P14).
 *
 * Documents live in the `presentations` store and media in
 * `presentationMedia`, both added by the additive v5 upgrade of the existing
 * `stickerlab-local` database (sticker stores are never rewritten).
 *
 * A save validates the document, checks revisions against the stored row and
 * writes media plus document inside a single transaction: a failure aborts the
 * whole transaction, so the previous save and its media remain intact. Stored
 * media is immutable — later saves may not replace its bytes or metadata.
 */

import { PersistenceError } from '../document'
import { arrayBufferToBytes, bytesEqual, idbRequest, openStickerLabDatabase, runTransaction, STICKERLAB_DB_NAME, STORE_NAMES } from '../idb'
import { clonePresentationDocumentWithNewIds } from '../../../features/presentations/model/factories'
import { serializePresentationDocument } from '../../../features/presentations/model/parse'
import type { PresentationAsset, PresentationDocument, PresentationSummary } from '../../../features/presentations/model/types'
import { toPresentationSummary, type PresentationMediaRecord, type PresentationRepository, type SavePresentationOptions } from './repository'

type StoredPresentationMedia = { assetId: string; mimeType: PresentationAsset['mimeType']; bytes: ArrayBuffer }

const MIME_TYPES: PresentationAsset['mimeType'][] = ['image/png', 'image/jpeg', 'image/webp']

function storedMediaToRecord(assetId: string, row: StoredPresentationMedia): PresentationMediaRecord {
  const bytes = arrayBufferToBytes(row.bytes)
  if (!bytes) throw new PersistenceError('invalid_asset', `Stored media ${assetId} is missing bytes`)
  if (!MIME_TYPES.includes(row.mimeType)) throw new PersistenceError('invalid_asset', `Stored media ${assetId} has an unsupported type`)
  return { assetId, mimeType: row.mimeType, bytes }
}

function toStoredMedia(record: PresentationMediaRecord): StoredPresentationMedia {
  const buffer = record.bytes.buffer.slice(record.bytes.byteOffset, record.bytes.byteOffset + record.bytes.byteLength)
  return { assetId: record.assetId, mimeType: record.mimeType, bytes: buffer }
}

export class IdbPresentationRepository implements PresentationRepository {
  private openPromise: Promise<IDBDatabase> | undefined

  constructor(private readonly dbName = STICKERLAB_DB_NAME) {}

  async listPresentations(): Promise<PresentationSummary[]> {
    const rows = await this.transact([STORE_NAMES.presentations], 'readonly', (tx) => idbRequest<unknown[]>(tx.objectStore(STORE_NAMES.presentations).getAll()))
    const summaries: PresentationSummary[] = []
    for (const row of rows ?? []) {
      try {
        summaries.push(toPresentationSummary(serializePresentationDocument(row)))
      } catch {
        // One unreadable row must not hide the rest of the library.
      }
    }
    return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)))
  }

  async getPresentation(id: string): Promise<PresentationDocument> {
    const row = await this.transact([STORE_NAMES.presentations], 'readonly', (tx) => idbRequest<unknown>(tx.objectStore(STORE_NAMES.presentations).get(id)))
    if (row === undefined) throw new PersistenceError('not_found', `Presentation ${id} was not found`)
    return serializePresentationDocument(row)
  }

  async savePresentation(document: PresentationDocument, media: PresentationMediaRecord[] = [], options: SavePresentationOptions = {}): Promise<void> {
    const clean = serializePresentationDocument(document)
    const db = await this.open()
    await runTransaction(db, [STORE_NAMES.presentations, STORE_NAMES.presentationMedia], 'readwrite', async (tx) => {
      const documents = tx.objectStore(STORE_NAMES.presentations)
      const mediaStore = tx.objectStore(STORE_NAMES.presentationMedia)

      const existingRaw = await idbRequest<unknown>(documents.get(clean.id))
      if (existingRaw !== undefined) {
        let stored: PresentationDocument
        try {
          stored = serializePresentationDocument(existingRaw)
        } catch {
          throw new PersistenceError('invalid_document', `Stored presentation ${clean.id} is unreadable`)
        }
        if (stored.revision > clean.revision) {
          throw new PersistenceError('revision_conflict', `Presentation ${clean.id} is newer than this save`)
        }
        if (options.baseRevision !== undefined && stored.revision > options.baseRevision) {
          throw new PersistenceError('revision_conflict', `Presentation ${clean.id} changed after revision ${options.baseRevision}`)
        }
      } else if (options.baseRevision !== undefined && options.baseRevision >= 0) {
        // The row the caller loaded was deleted elsewhere; recreating it silently would hide that.
        throw new PersistenceError('revision_conflict', `Presentation ${clean.id} no longer exists`)
      }

      const storedMedia = new Map<string, StoredPresentationMedia>()
      for (const asset of clean.assets) {
        const row = await idbRequest<StoredPresentationMedia | undefined>(mediaStore.get(asset.id))
        if (row) storedMedia.set(asset.id, row)
      }

      for (const record of media) {
        const asset = clean.assets.find((candidate) => candidate.id === record.assetId)
        if (!asset) throw new PersistenceError('invalid_asset', `Media ${record.assetId} is not referenced by presentation ${clean.id}`)
        if (asset.mimeType !== record.mimeType) throw new PersistenceError('invalid_asset', `Media ${record.assetId} type does not match the document asset`)
        if (!record.bytes || record.bytes.length === 0) throw new PersistenceError('invalid_asset', `Media for ${record.assetId} is empty`)
        const existing = storedMedia.get(record.assetId)
        if (existing) {
          if (existing.mimeType !== record.mimeType) {
            throw new PersistenceError('invalid_asset', `Media ${record.assetId} is already stored as ${existing.mimeType}`)
          }
          const existingBytes = arrayBufferToBytes(existing.bytes)
          if (!existingBytes || !bytesEqual(existingBytes, record.bytes)) {
            throw new PersistenceError('invalid_asset', `Refusing to replace media ${record.assetId} with different bytes`)
          }
        }
      }

      const submitted = new Map(media.map((record) => [record.assetId, record]))
      for (const asset of clean.assets) {
        const record = submitted.get(asset.id)
        const stored = storedMedia.get(asset.id)
        const mimeType = record?.mimeType ?? stored?.mimeType
        if (!mimeType) throw new PersistenceError('missing_asset', `Presentation ${clean.id} references missing media ${asset.id}`)
        if (mimeType !== asset.mimeType) {
          throw new PersistenceError('invalid_asset', `Stored media ${asset.id} is ${mimeType}, but the document declares ${asset.mimeType}`)
        }
      }

      for (const record of media) {
        await idbRequest(mediaStore.put(toStoredMedia(record)))
      }
      await idbRequest(documents.put(clean))
    })
  }

  async deletePresentation(id: string): Promise<void> {
    await this.transact([STORE_NAMES.presentations], 'readwrite', (tx) => idbRequest(tx.objectStore(STORE_NAMES.presentations).delete(id)))
  }

  async duplicatePresentation(id: string, options: { title?: string } = {}): Promise<PresentationDocument> {
    const source = await this.getPresentation(id)
    const rows = await this.transact([STORE_NAMES.presentationMedia], 'readonly', async (tx) => {
      const store = tx.objectStore(STORE_NAMES.presentationMedia)
      const result: PresentationMediaRecord[] = []
      for (const asset of source.assets) {
        const row = await idbRequest<StoredPresentationMedia | undefined>(store.get(asset.id))
        if (!row) throw new PersistenceError('missing_asset', `Cannot duplicate ${id}: media for ${asset.id} is missing`)
        result.push(storedMediaToRecord(asset.id, row))
      }
      return result
    })
    const copy = clonePresentationDocumentWithNewIds(source, { title: options.title ?? `${source.title} copy` })
    // Assets are cloned in source order, so the media records map by index.
    const media = rows.map((record, index) => ({ ...record, assetId: copy.assets[index]!.id }))
    await this.savePresentation(copy, media)
    return copy
  }

  async getMedia(assetId: string): Promise<PresentationMediaRecord> {
    const row = await this.transact([STORE_NAMES.presentationMedia], 'readonly', (tx) => idbRequest<StoredPresentationMedia | undefined>(tx.objectStore(STORE_NAMES.presentationMedia).get(assetId)))
    if (!row) throw new PersistenceError('not_found', `Media ${assetId} was not found`)
    return storedMediaToRecord(assetId, row)
  }

  async hasMedia(assetId: string): Promise<boolean> {
    const key = await this.transact([STORE_NAMES.presentationMedia], 'readonly', (tx) => idbRequest<IDBValidKey | undefined>(tx.objectStore(STORE_NAMES.presentationMedia).getKey(assetId)))
    return key !== undefined
  }

  private async transact<T>(storeNames: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open()
    return runTransaction(db, storeNames, mode, work)
  }

  private open(): Promise<IDBDatabase> {
    if (!this.openPromise) {
      this.openPromise = openStickerLabDatabase(this.dbName).catch((error) => {
        this.openPromise = undefined
        throw error
      })
    }
    return this.openPromise
  }
}

export function createIdbPresentationRepository(dbName = STICKERLAB_DB_NAME): IdbPresentationRepository {
  return new IdbPresentationRepository(dbName)
}
