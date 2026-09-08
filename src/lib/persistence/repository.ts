import type { Asset, PackRecord, ProjectDocument } from '../../types/domain'
import type { CommitResult, RemoteResource, ResourceKind, SyncEntry, SyncValue } from './syncTypes'
import { parseAsset, parseProjectDocument, PersistenceError, serializeProjectDocument } from './document'

export { createProjectDocument, isPersistenceError, parseAsset, parseProjectDocument, PersistenceError, serializeProjectDocument } from './document'
export type { PersistenceErrorCode } from './document'

const PROJECTS_STORE = 'projects'
const ASSETS_STORE = 'assets'
const PACKS_STORE = 'packs'
const MASKS_STORE = 'masks'
const SYNC_STORE = 'sync'
const DB_VERSION = 4
const DEFAULT_DB_NAME = 'stickerlab-local'

/** Metadata plus the immutable original blob. Never part of ProjectDocument. */
export type AssetRecord = {
  asset: Asset
  blob: Blob
}

export type MaskRecord = {
  key: string
  blob: Blob
}

/** Local-first project/asset store. Must not persist object URLs, DOM nodes, or Konva objects. */
export interface StickerLabRepository {
  getProject(id: string): Promise<ProjectDocument>
  listProjects(): Promise<ProjectDocument[]>
  saveProject(document: ProjectDocument): Promise<void>
  deleteProject(id: string, previous?: ProjectDocument): Promise<void>
  getAsset(id: string): Promise<AssetRecord>
  listAssets(): Promise<Asset[]>
  saveAsset(record: AssetRecord): Promise<void>
  deleteAsset(id: string): Promise<void>
  saveProjectWithAssets(document: ProjectDocument, assets: AssetRecord[], masks?: MaskRecord[]): Promise<void>
  getPack(id: string): Promise<PackRecord>
  listPacks(): Promise<PackRecord[]>
  savePack(record: PackRecord, previous?: PackRecord): Promise<void>
  deletePack(id: string, previous?: PackRecord): Promise<void>
  getMask(key: string): Promise<Blob>
  saveMask(key: string, blob: Blob): Promise<void>
  deleteMask(key: string): Promise<void>
}

export class MemoryRepository implements StickerLabRepository {
  private projects = new Map<string, unknown>()
  private assets = new Map<string, AssetRecord>()
  private packs = new Map<string, PackRecord>()
  private masks = new Map<string, Blob>()
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

  async saveProjectWithAssets(document: ProjectDocument, assets: AssetRecord[], masks: MaskRecord[] = []): Promise<void> {
    this.guardWrite()
    const clean = serializeProjectDocument(document)
    const nextAssets = new Map(this.assets)
    for (const record of assets) nextAssets.set(record.asset.id, cloneAssetRecord(record))
    assertAssetsResolvable(clean, (id) => nextAssets.has(id))
    const nextMasks = new Map(this.masks)
    for (const record of masks) nextMasks.set(record.key, record.blob)
    for (const layer of clean.layers) {
      if (layer.kind === 'image' && layer.maskKey) {
        if (!nextMasks.has(layer.maskKey)) {
          throw new PersistenceError('missing_mask', `Project ${clean.id} references missing mask ${layer.maskKey}`)
        }
      }
    }
    const nextProjects = new Map(this.projects)
    nextProjects.set(clean.id, clean)
    this.assets = nextAssets
    this.masks = nextMasks
    this.projects = nextProjects
  }

  async getMask(key: string): Promise<Blob> {
    const blob = this.masks.get(key)
    if (!blob) throw new PersistenceError('not_found', `Mask ${key} was not found`)
    return blob
  }

  async saveMask(key: string, blob: Blob): Promise<void> {
    this.guardWrite()
    this.masks.set(key, blob)
  }

  async deleteMask(key: string): Promise<void> {
    this.guardWrite()
    this.masks.delete(key)
  }

  async getPack(id: string): Promise<PackRecord> {
    const pack = this.packs.get(id)
    if (!pack) throw new PersistenceError('not_found', `Pack ${id} was not found`)
    return clonePackRecord(pack)
  }

  async listPacks(): Promise<PackRecord[]> {
    return [...this.packs.values()].map(clonePackRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async savePack(record: PackRecord): Promise<void> {
    this.guardWrite()
    this.packs.set(record.id, clonePackRecord(record))
  }

  async deletePack(id: string): Promise<void> {
    this.guardWrite()
    this.packs.delete(id)
  }

  private guardWrite(): void {
    if (!this.failNextWrite) return
    this.failNextWrite = false
    throw new PersistenceError('transaction_failed', 'Save failed')
  }
}

export class IdbRepository implements StickerLabRepository {
  private openPromise: Promise<IDBDatabase> | undefined

  constructor(private readonly dbName = DEFAULT_DB_NAME, private readonly trackChanges = false) {}

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
    await this.deleteProjectAtRevision(id)
  }

  protected async deleteProjectAtRevision(id: string, baseRevision?: number): Promise<void> {
    await this.transact([PROJECTS_STORE, SYNC_STORE], 'readwrite', async (tx) => {
      await idbRequest(tx.objectStore(PROJECTS_STORE).delete(id))
      await this.enqueue(tx, 'project', id, null, baseRevision)
    })
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

  async getPack(id: string): Promise<PackRecord> {
    const row = await this.transact([PACKS_STORE], 'readonly', (tx) => idbRequest<unknown>(tx.objectStore(PACKS_STORE).get(id)))
    if (row === undefined) throw new PersistenceError('not_found', `Pack ${id} was not found`)
    return parsePackRecord(row)
  }

  async listPacks(): Promise<PackRecord[]> {
    const rows = await this.transact([PACKS_STORE], 'readonly', (tx) => idbRequest<unknown[]>(tx.objectStore(PACKS_STORE).getAll()))
    const packs: PackRecord[] = []
    for (const row of rows ?? []) {
      try {
        packs.push(parsePackRecord(row))
      } catch {
        // Skip unreadable rows
      }
    }
    return packs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async savePack(record: PackRecord): Promise<void> {
    await this.savePackAtRevision(record)
  }

  protected async savePackAtRevision(record: PackRecord, baseRevision?: number): Promise<void> {
    const clean = parsePackRecord(record)
    await this.transact([PACKS_STORE, SYNC_STORE], 'readwrite', async (tx) => {
      await idbRequest(tx.objectStore(PACKS_STORE).put(clean))
      await this.enqueue(tx, 'pack', clean.id, clean, baseRevision)
    })
  }

  async deletePack(id: string): Promise<void> {
    await this.deletePackAtRevision(id)
  }

  protected async deletePackAtRevision(id: string, baseRevision?: number): Promise<void> {
    await this.transact([PACKS_STORE, SYNC_STORE], 'readwrite', async (tx) => {
      await idbRequest(tx.objectStore(PACKS_STORE).delete(id))
      await this.enqueue(tx, 'pack', id, null, baseRevision)
    })
  }

  async getMask(key: string): Promise<Blob> {
    const row = await this.transact([MASKS_STORE], 'readonly', (tx) =>
      idbRequest<{ key: string; blob: ArrayBuffer } | undefined>(tx.objectStore(MASKS_STORE).get(key)),
    )
    if (row === undefined) throw new PersistenceError('not_found', `Mask ${key} was not found`)
    return parseStoredMask(row)
  }

  async saveMask(key: string, blob: Blob): Promise<void> {
    const stored = { key, blob: await blobToArrayBuffer(blob) }
    await this.transact([MASKS_STORE], 'readwrite', (tx) => idbRequest(tx.objectStore(MASKS_STORE).put(stored)))
  }

  async deleteMask(key: string): Promise<void> {
    await this.transact([MASKS_STORE], 'readwrite', (tx) => idbRequest(tx.objectStore(MASKS_STORE).delete(key)))
  }

  async saveProjectWithAssets(document: ProjectDocument, assets: AssetRecord[], masks: MaskRecord[] = []): Promise<void> {
    const clean = serializeProjectDocument(document)
    const storedAssets = await Promise.all(assets.map(toStoredAsset))
    const storedMasks = await Promise.all(
      masks.map(async (m) => ({ key: m.key, blob: await blobToArrayBuffer(m.blob) })),
    )
    await this.transact([PROJECTS_STORE, ASSETS_STORE, MASKS_STORE, SYNC_STORE], 'readwrite', async (tx) => {
      const assetStore = tx.objectStore(ASSETS_STORE)
      const maskStore = tx.objectStore(MASKS_STORE)
      for (const stored of storedAssets) await idbRequest(assetStore.put(stored))
      for (const stored of storedMasks) await idbRequest(maskStore.put(stored))
      for (const assetId of clean.assetIds) {
        const row = await idbRequest<unknown>(assetStore.get(assetId))
        if (row === undefined) throw new PersistenceError('missing_asset', `Project ${clean.id} references missing asset ${assetId}`)
        parseStoredAsset(row)
      }
      for (const layer of clean.layers) {
        if (layer.kind === 'image' && layer.maskKey) {
          const row = await idbRequest<unknown>(maskStore.get(layer.maskKey))
          if (row === undefined) throw new PersistenceError('missing_mask', `Project ${clean.id} references missing mask ${layer.maskKey}`)
        }
      }
      await idbRequest(tx.objectStore(PROJECTS_STORE).put(clean))
      await this.enqueue(tx, 'project', clean.id, clean)
    })
  }

  async listSyncEntries(): Promise<SyncEntry[]> {
    return this.transact([SYNC_STORE], 'readonly', (tx) => idbRequest(tx.objectStore(SYNC_STORE).getAll()))
  }

  protected async projectWithRevision(id: string): Promise<{ document: ProjectDocument; baseRevision: number }> {
    return this.transact([PROJECTS_STORE, SYNC_STORE], 'readonly', async (tx) => {
      const value: unknown = await idbRequest(tx.objectStore(PROJECTS_STORE).get(id))
      if (value === undefined) throw new PersistenceError('not_found', `Project ${id} was not found`)
      const entry: SyncEntry | undefined = await idbRequest(tx.objectStore(SYNC_STORE).get(`project:${id}`))
      return { document: parseProjectDocument(value), baseRevision: entry?.baseRevision ?? 0 }
    })
  }

  protected async packsWithRevisions(): Promise<Array<{ pack: PackRecord; baseRevision: number; pendingIds: string[] }>> {
    return this.transact([PACKS_STORE, SYNC_STORE], 'readonly', async (tx) => {
      const rows: unknown[] = await idbRequest(tx.objectStore(PACKS_STORE).getAll())
      const result: Array<{ pack: PackRecord; baseRevision: number; pendingIds: string[] }> = []
      for (const row of rows) {
        try {
          const pack = parsePackRecord(row)
          const entry: SyncEntry | undefined = await idbRequest(tx.objectStore(SYNC_STORE).get(`pack:${pack.id}`))
          result.push({ pack, baseRevision: entry?.baseRevision ?? 0, pendingIds: entry?.pending.map((operation) => operation.operationId) ?? [] })
        } catch { /* An unreadable pack must not hide other packs. */ }
      }
      return result
    })
  }

  protected writeBase?: (kind: ResourceKind, id: string) => number | undefined

  private async enqueue(tx: IDBTransaction, kind: ResourceKind, id: string, value: SyncValue | null, baseRevision?: number) {
    if (!this.trackChanges) return
    const store = tx.objectStore(SYNC_STORE)
    const key = `${kind}:${id}`
    const entry: SyncEntry = await idbRequest(store.get(key)) ?? { key, kind, id, baseRevision: 0, pending: [] }
    if (!entry.pending.length) entry.baseRevision = baseRevision ?? this.writeBase?.(kind, id) ?? entry.baseRevision
    // The head may have reached the server. Never change its identity or snapshot.
    // Only the not-yet-sent tail is coalesced, bounding the queue to two snapshots.
    if (JSON.stringify(entry.pending.at(-1)?.value) === JSON.stringify(value)) return
    entry.pending = [...entry.pending.slice(0, 1), { operationId: crypto.randomUUID(), value }]
    await idbRequest(store.put(entry))
  }

  /** Cache only fully downloaded resources; never overwrite pending local work. */
  async cacheRemote(resource: RemoteResource, assets: AssetRecord[] = [], masks: MaskRecord[] = []): Promise<void> {
    const value = resource.kind === 'project' ? serializeProjectDocument(resource.value as ProjectDocument) : parsePackRecord(resource.value)
    const storedAssets = await Promise.all(assets.map(toStoredAsset))
    const storedMasks = await Promise.all(masks.map(async (mask) => ({ key: mask.key, blob: await blobToArrayBuffer(mask.blob) })))
    await this.transact([PROJECTS_STORE, PACKS_STORE, ASSETS_STORE, MASKS_STORE, SYNC_STORE], 'readwrite', async (tx) => {
      const key = `${resource.kind}:${resource.id}`
      const entry: SyncEntry | undefined = await idbRequest(tx.objectStore(SYNC_STORE).get(key))
      if (entry?.pending.length || (entry && entry.baseRevision > resource.revision)) return
      for (const asset of storedAssets) await idbRequest(tx.objectStore(ASSETS_STORE).put(asset))
      for (const mask of storedMasks) await idbRequest(tx.objectStore(MASKS_STORE).put(mask))
      const store = tx.objectStore(resource.kind === 'project' ? PROJECTS_STORE : PACKS_STORE)
      if (resource.deleted) await idbRequest(store.delete(resource.id))
      else await idbRequest(store.put(value))
      await idbRequest(tx.objectStore(SYNC_STORE).put({ key, kind: resource.kind, id: resource.id, baseRevision: resource.revision, pending: [], notice: entry?.notice } satisfies SyncEntry))
    })
  }

  /** Acknowledge exactly the sent snapshot, leaving any later edit pending. */
  async acknowledge(key: string, operationId: string, result: CommitResult): Promise<void> {
    await this.transact([PROJECTS_STORE, PACKS_STORE, SYNC_STORE], 'readwrite', async (tx) => {
      const sync = tx.objectStore(SYNC_STORE)
      const entry: SyncEntry | undefined = await idbRequest(sync.get(key))
      if (!entry || entry.pending[0]?.operationId !== operationId) return
      entry.pending.shift()
      const original = result.original ?? result.resource
      if (!result.conflict) entry.baseRevision = original.revision
      if (result.conflict) entry.notice = result.original ? `Conflict copy saved: ${result.resource.value.title}` : 'Deletion was not applied: the cloud version changed. Refresh and review it.'
      const store = tx.objectStore(entry.kind === 'project' ? PROJECTS_STORE : PACKS_STORE)
      if (result.original) {
        const copyKey = `${entry.kind}:${result.resource.id}`
        const copy: SyncEntry | undefined = await idbRequest(sync.get(copyKey))
        if (!copy?.pending.length && (!copy || copy.baseRevision <= result.resource.revision)) {
          await idbRequest(store.put(result.resource.value))
          await idbRequest(sync.put({ key: copyKey, kind: entry.kind, id: result.resource.id, baseRevision: result.resource.revision, pending: [] } satisfies SyncEntry))
        }
      }
      if (!entry.pending.length) {
        if (original.deleted) await idbRequest(store.delete(original.id))
        else await idbRequest(store.put(original.value))
        entry.baseRevision = original.revision
      }
      await idbRequest(sync.put(entry))
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

export function parsePackRecord(value: unknown): PackRecord {
  if (typeof value !== 'object' || value === null) throw new PersistenceError('malformed_data', 'Pack must be an object')
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
  if (!id || !title) throw new PersistenceError('malformed_data', 'Pack must have id and title')
  const description = typeof raw.description === 'string' ? raw.description : ''
  const visibility = raw.visibility === 'private' ? 'private' : 'local'
  const projectIds = Array.isArray(raw.projectIds) ? raw.projectIds.filter((p): p is string => typeof p === 'string') : []
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  const record: PackRecord = { id, title, description, visibility, projectIds, createdAt, updatedAt }
  if (typeof raw.coverAssetId === 'string') record.coverAssetId = raw.coverAssetId
  return record
}

function clonePackRecord(record: PackRecord): PackRecord {
  return { ...record, projectIds: [...record.projectIds] }
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

function parseStoredMask(value: unknown): Blob {
  if (typeof value !== 'object' || value === null) throw new PersistenceError('invalid_asset', 'Stored mask must be an object')
  const { blob } = value as { blob?: unknown }
  return restoreBlob(blob, 'image/png')
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
      if (!db.objectStoreNames.contains(PACKS_STORE)) db.createObjectStore(PACKS_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(MASKS_STORE)) db.createObjectStore(MASKS_STORE, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(SYNC_STORE)) db.createObjectStore(SYNC_STORE, { keyPath: 'key' })
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
