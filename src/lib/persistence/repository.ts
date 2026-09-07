import type { Asset, ProjectDocument } from '../../types/domain'
import { parseAsset, parseProjectDocument, PersistenceError, serializeProjectDocument } from './document'

export { createProjectDocument, isPersistenceError, parseAsset, parseProjectDocument, PersistenceError, serializeProjectDocument } from './document'
export type { PersistenceErrorCode } from './document'

const PROJECTS_STORE = 'projects'
const ASSETS_STORE = 'assets'
const DB_VERSION = 1
const DEFAULT_DB_NAME = 'stickerlab-local'

/** Metadata plus the immutable original blob. Never part of ProjectDocument. */
export type AssetRecord = {
  asset: Asset
  blob: Blob
}

/** Local-first project/asset store. Must not persist object URLs, DOM nodes, or Konva objects. */
export interface StickerLabRepository {
  getProject(id: string): Promise<ProjectDocument>
  listProjects(): Promise<ProjectDocument[]>
  saveProject(document: ProjectDocument): Promise<void>
  deleteProject(id: string): Promise<void>
  getAsset(id: string): Promise<AssetRecord>
  listAssets(): Promise<Asset[]>
  saveAsset(record: AssetRecord): Promise<void>
  deleteAsset(id: string): Promise<void>
  saveProjectWithAssets(document: ProjectDocument, assets: AssetRecord[]): Promise<void>
}

export class MemoryRepository implements StickerLabRepository {
  private projects = new Map<string, unknown>()
  private assets = new Map<string, AssetRecord>()
  private failNextWrite = false

  injectWriteFailure(): void {
    this.failNextWrite = true
  }

  /** Test seam: write an unvalidated value as if it came off disk. */
  seedRawProject(id: string, value: unknown): void {
    this.projects.set(id, value)
  }

  async getProject(id: string): Promise<ProjectDocument> {
    if (!this.projects.has(id)) throw new PersistenceError('not_found', `Project ${id} was not found`)
    return parseProjectDocument(this.projects.get(id))
  }

  async listProjects(): Promise<ProjectDocument[]> {
    const documents: ProjectDocument[] = []
    for (const value of this.projects.values()) {
      try {
        documents.push(parseProjectDocument(value))
      } catch {
        // Skip unreadable rows so one corrupt record cannot hide the rest.
      }
    }
    return sortProjects(documents)
  }

  async saveProject(document: ProjectDocument): Promise<void> {
    await this.saveProjectWithAssets(document, [])
  }

  async deleteProject(id: string): Promise<void> {
    this.guardWrite()
    this.projects.delete(id)
  }

  async getAsset(id: string): Promise<AssetRecord> {
    const record = this.assets.get(id)
    if (!record) throw new PersistenceError('not_found', `Asset ${id} was not found`)
    return { asset: parseAsset(record.asset), blob: record.blob }
  }

  async listAssets(): Promise<Asset[]> {
    return [...this.assets.values()].map((record) => parseAsset(record.asset))
  }

  async saveAsset(record: AssetRecord): Promise<void> {
    this.guardWrite()
    const next = new Map(this.assets)
    next.set(record.asset.id, cloneAssetRecord(record))
    this.assets = next
  }

  async deleteAsset(id: string): Promise<void> {
    this.guardWrite()
    this.assets.delete(id)
  }

  async saveProjectWithAssets(document: ProjectDocument, assets: AssetRecord[]): Promise<void> {
    this.guardWrite()
    const clean = serializeProjectDocument(document)
    const nextAssets = new Map(this.assets)
    for (const record of assets) nextAssets.set(record.asset.id, cloneAssetRecord(record))
    assertAssetsResolvable(clean, (id) => nextAssets.has(id))
    const nextProjects = new Map(this.projects)
    nextProjects.set(clean.id, clean)
    this.assets = nextAssets
    this.projects = nextProjects
  }

  private guardWrite(): void {
    if (!this.failNextWrite) return
    this.failNextWrite = false
    throw new PersistenceError('transaction_failed', 'Save failed')
  }
}

export class IdbRepository implements StickerLabRepository {
  private openPromise: Promise<IDBDatabase> | undefined

  constructor(private readonly dbName = DEFAULT_DB_NAME) {}

  async getProject(id: string): Promise<ProjectDocument> {
    const value = await this.transact([PROJECTS_STORE], 'readonly', (tx) => idbRequest<unknown>(tx.objectStore(PROJECTS_STORE).get(id)))
    if (value === undefined) throw new PersistenceError('not_found', `Project ${id} was not found`)
    return parseProjectDocument(value)
  }

  async listProjects(): Promise<ProjectDocument[]> {
    const rows = await this.transact([PROJECTS_STORE], 'readonly', (tx) => idbRequest<unknown[]>(tx.objectStore(PROJECTS_STORE).getAll()))
    const documents: ProjectDocument[] = []
    for (const row of rows ?? []) {
      try {
        documents.push(parseProjectDocument(row))
      } catch {
        // Same as memory: listing must not crash on one bad row.
      }
    }
    return sortProjects(documents)
  }

  async saveProject(document: ProjectDocument): Promise<void> {
    await this.saveProjectWithAssets(document, [])
  }

  async deleteProject(id: string): Promise<void> {
    await this.transact([PROJECTS_STORE], 'readwrite', (tx) => idbRequest(tx.objectStore(PROJECTS_STORE).delete(id)))
  }

  async getAsset(id: string): Promise<AssetRecord> {
    const row = await this.transact([ASSETS_STORE], 'readonly', (tx) => idbRequest<unknown>(tx.objectStore(ASSETS_STORE).get(id)))
    if (row === undefined) throw new PersistenceError('not_found', `Asset ${id} was not found`)
    return parseStoredAsset(row)
  }

  async listAssets(): Promise<Asset[]> {
    const rows = await this.transact([ASSETS_STORE], 'readonly', (tx) => idbRequest<unknown[]>(tx.objectStore(ASSETS_STORE).getAll()))
    const assets: Asset[] = []
    for (const row of rows ?? []) {
      try {
        assets.push(parseStoredAsset(row).asset)
      } catch {
        // Skip unreadable asset rows in catalog listings.
      }
    }
    return assets
  }

  async saveAsset(record: AssetRecord): Promise<void> {
    const stored = await toStoredAsset(record)
    await this.transact([ASSETS_STORE], 'readwrite', (tx) => idbRequest(tx.objectStore(ASSETS_STORE).put(stored)))
  }

  async deleteAsset(id: string): Promise<void> {
    await this.transact([ASSETS_STORE], 'readwrite', (tx) => idbRequest(tx.objectStore(ASSETS_STORE).delete(id)))
  }

  async saveProjectWithAssets(document: ProjectDocument, assets: AssetRecord[]): Promise<void> {
    const clean = serializeProjectDocument(document)
    const storedAssets = await Promise.all(assets.map(toStoredAsset))
    await this.transact([PROJECTS_STORE, ASSETS_STORE], 'readwrite', async (tx) => {
      const assetStore = tx.objectStore(ASSETS_STORE)
      for (const stored of storedAssets) await idbRequest(assetStore.put(stored))
      for (const assetId of clean.assetIds) {
        const row = await idbRequest<unknown>(assetStore.get(assetId))
        if (row === undefined) throw new PersistenceError('missing_asset', `Project ${clean.id} references missing asset ${assetId}`)
        parseStoredAsset(row)
      }
      await idbRequest(tx.objectStore(PROJECTS_STORE).put(clean))
    })
  }

  private async transact<T>(storeNames: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open()
    const tx = db.transaction(storeNames, mode)
    const done = transactionDone(tx)
    try {
      const result = await work(tx)
      await done
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // Already finished or aborted.
      }
      await done.catch(() => undefined)
      throw error instanceof PersistenceError
        ? error
        : new PersistenceError('transaction_failed', 'IndexedDB operation failed', error)
    }
  }

  private open(): Promise<IDBDatabase> {
    if (!this.openPromise) {
      this.openPromise = openDatabase(this.dbName).catch((error) => {
        this.openPromise = undefined
        throw error
      })
    }
    return this.openPromise
  }
}

export function createMemoryRepository(): MemoryRepository {
  return new MemoryRepository()
}

export function createIdbRepository(dbName = DEFAULT_DB_NAME): IdbRepository {
  return new IdbRepository(dbName)
}

let localRepository: StickerLabRepository | undefined

export function getLocalRepository(): StickerLabRepository {
  if (!localRepository) localRepository = createIdbRepository()
  return localRepository
}

function cloneAssetRecord(record: AssetRecord): AssetRecord {
  if (!(record.blob instanceof Blob) || record.blob.size <= 0) {
    throw new PersistenceError('invalid_asset', `Asset ${record.asset.id} is missing blob data`)
  }
  return { asset: parseAsset(record.asset), blob: record.blob }
}

async function toStoredAsset(record: AssetRecord): Promise<Asset & { blob: ArrayBuffer }> {
  const asset = cloneAssetRecord(record).asset
  return { ...asset, blob: await blobToArrayBuffer(record.blob) }
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new PersistenceError('invalid_asset', 'Could not read asset blob'))
    reader.readAsArrayBuffer(blob)
  })
}

function parseStoredAsset(value: unknown): AssetRecord {
  if (typeof value !== 'object' || value === null) throw new PersistenceError('invalid_asset', 'Stored asset must be an object')
  const { blob, ...rest } = value as { blob?: unknown }
  const asset = parseAsset(rest)
  return { asset, blob: restoreBlob(blob, asset.mimeType) }
}

function restoreBlob(value: unknown, mimeType: string): Blob {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    if (value.size <= 0) throw new PersistenceError('invalid_asset', 'Stored asset is missing blob data')
    return value
  }
  if (isArrayBuffer(value) && value.byteLength > 0) return new Blob([value], { type: mimeType })
  if (ArrayBuffer.isView(value) && value.byteLength > 0) {
    return new Blob([value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)], { type: mimeType })
  }
  throw new PersistenceError('invalid_asset', 'Stored asset is missing blob data')
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

function assertAssetsResolvable(document: ProjectDocument, hasAsset: (id: string) => boolean): void {
  for (const assetId of document.assetIds) {
    if (!hasAsset(assetId)) throw new PersistenceError('missing_asset', `Project ${document.id} references missing asset ${assetId}`)
  }
}

function sortProjects(documents: ProjectDocument[]): ProjectDocument[] {
  return documents.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)))
}

function openDatabase(name: string): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB
  if (!factory) throw new PersistenceError('transaction_failed', 'IndexedDB is not available')
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ASSETS_STORE)) db.createObjectStore(ASSETS_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(new PersistenceError('transaction_failed', 'Failed to open local database', request.error))
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new PersistenceError('transaction_failed', 'IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new PersistenceError('transaction_failed', 'IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new PersistenceError('transaction_failed', 'IndexedDB transaction aborted'))
  })
}
