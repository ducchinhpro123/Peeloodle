import type { PackRecord, ProjectDocument } from '../../types/domain'
import { IdbRepository, type AssetRecord, type MaskRecord, type StickerLabRepository } from './repository'
import type { CloudRemote } from './cloudRemote'
import { binaryHash } from './cloudRemote'
import type { RemoteResource, SyncEntry } from './syncTypes'

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

async function loadBinaries(source: StickerLabRepository, document: ProjectDocument) {
  const assets = await Promise.all(document.assetIds.map((id) => source.getAsset(id)))
  const keys = [...new Set(document.layers.flatMap((layer) => (layer.kind === 'image' && layer.maskKey ? [layer.maskKey] : [])))]
  const masks = await Promise.all(keys.map(async (key) => ({ key, blob: await source.getMask(key) })))
  return { assets, masks }
}

export type CloudStatus = { state: 'pending' | 'syncing' | 'synced' | 'error'; pending: number; error: string | null; notices: string[]; version: number; conflicts: Record<string, { id: string; revision: number }> }

export class CloudRepository extends IdbRepository {
  private active = true
  private listeners = new Set<() => void>()
  private status: CloudStatus = { state: 'pending', pending: 0, error: null, notices: [], version: 0, conflicts: {} }
  private work: Promise<void> | null = null
  private wakeRequested = false
  private importWork: Promise<void> | null = null
  private remoteProjects: RemoteResource[] = []
  private openProjectBases = new Map<string, number>()
  private packBases = new WeakMap<PackRecord, { revision: number }>()
  private pendingPackBases = new Map<string, Set<{ revision: number }>>()
  protected override writeBase = (kind: string, id: string) => kind === 'project' ? this.openProjectBases.get(id) : undefined

  constructor(dbName: string, private readonly remote: CloudRemote) { super(dbName, true) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getStatus = () => this.status
  dismissConflict(id: string) {
    const conflicts = { ...this.status.conflicts }
    delete conflicts[id]
    this.publish({ conflicts })
  }
  dispose() { this.active = false }
  private publish(patch: Partial<CloudStatus>) {
    if (!this.active) return
    this.status = { ...this.status, ...patch, version: this.status.version + 1 }
    for (const listener of this.listeners) listener()
  }
  private async updateStatus() {
    const entries = await this.listSyncEntries()
    const pending = entries.reduce((sum, entry) => sum + entry.pending.length, 0)
    this.publish({ pending, state: pending ? 'pending' : 'synced', error: null, notices: [...entries.flatMap((entry) => entry.notice ? [entry.notice] : []), ...(this.remote.warnings ?? [])] })
  }
  private changed() { this.wakeRequested = true; this.publish({ state: 'pending' }); void this.sync() }
  override async saveProjectWithAssets(document: ProjectDocument, assets: AssetRecord[], masks: MaskRecord[] = []) {
    await super.saveProjectWithAssets(document, assets, masks)
    this.changed()
  }
  override async listPacks() {
    const rows = await this.packsWithRevisions()
    for (const { pack, baseRevision, pendingIds } of rows) {
      const token = { revision: baseRevision }
      this.packBases.set(pack, token)
      for (const id of pendingIds) {
        const tokens = this.pendingPackBases.get(id) ?? new Set()
        tokens.add(token)
        this.pendingPackBases.set(id, tokens)
      }
    }
    return rows.map(({ pack }) => pack).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  override async getPack(id: string) {
    return (await this.listPacks()).find((pack) => pack.id === id) ?? super.getPack(id)
  }
  override async savePack(pack: PackRecord, previous?: PackRecord) {
    const next = { ...pack, visibility: 'private' as const }
    delete next.coverAssetId
    await this.savePackAtRevision(next, previous ? this.packBases.get(previous)?.revision : undefined)
    this.changed()
  }
  override async deleteProject(id: string) { await super.deleteProject(id); this.changed() }
  override async deletePack(id: string, previous?: PackRecord) { await this.deletePackAtRevision(id, previous ? this.packBases.get(previous)?.revision : undefined); this.changed() }
  override async listProjects() {
    const local = await super.listProjects()
    const known = new Set((await this.listSyncEntries()).map((entry) => entry.id))
    return [...local, ...this.remoteProjects.filter((row) => !row.deleted && !known.has(row.id)).map((row) => row.value as ProjectDocument)]
  }
  override async getProject(id: string) {
    try {
      const { document, baseRevision } = await this.projectWithRevision(id)
      this.openProjectBases.set(id, baseRevision)
      return document
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'not_found')) throw error
      const row = this.remoteProjects.find((project) => project.id === id && !project.deleted)
      if (!row || !this.active) throw new Error('This sticker is not cached. Connect and use Account → Refresh cloud, then retry.')
      const bundle = await this.remote.download(row)
      if (!this.active) throw new Error('Workspace changed')
      await this.cacheRemote(row, bundle.assets, bundle.masks)
      this.openProjectBases.set(id, row.revision)
      return super.getProject(id)
    }
  }

  /** One foreground drain, no polling or silent infinite retries. Online/account controls retry. */
  sync(): Promise<void> {
    if (this.work) return this.work
    if (!this.active) return Promise.resolve()
    this.work = this.drain().catch((error: unknown) => {
      const text = errorText(error)
      const expired = /jwt|unauthorized|invalid.?grant|session changed|not authenticated|401/i.test(text)
      this.publish({
        state: 'error',
        error: expired
          ? 'Session expired. Your local edits are kept. Sign in again to sync.'
          : `Saved locally. Cloud sync failed: ${text || 'Reconnect or sign in again, then retry.'}`,
      })
    }).finally(() => {
      this.work = null
      if (this.active && this.wakeRequested && this.status.state !== 'error') void this.sync()
    })
    return this.work
  }
  private async drain() {
    while (this.active) {
      this.wakeRequested = false
      const entries = (await this.listSyncEntries()).filter((entry) => entry.pending.length)
      // Project saves, then packs, then project deletes (membership must be cleared first).
      entries.sort((a, b) => {
        const rank = (entry: typeof a) => (entry.kind === 'project' && entry.pending[0]?.value === null ? 2 : entry.kind === 'pack' ? 1 : 0)
        return rank(a) - rank(b)
      })
      if (!entries.length) { await this.updateStatus(); return }
      this.publish({ state: 'syncing', pending: entries.reduce((sum, entry) => sum + entry.pending.length, 0), error: null })
      for (const entry of entries) {
        if (!this.active) return
        const operation = entry.pending[0]
        const { assets, masks } = await this.records(entry)
        let result = await this.remote.commit(entry, operation, assets, masks)
        if (!this.active) return // Lost acknowledgment is safe: replay uses the same operation identity.
        if (result.conflict) {
          // The winning original can use different assets. Download before replacing local JSON.
          const reportedOriginal = result.original ?? result.resource
          const latest = (await this.remote.list(entry.kind)).find((row) => row.id === reportedOriginal.id) ?? reportedOriginal
          const bundle = await this.remote.download(latest)
          result = result.original ? { ...result, original: latest } : { ...result, resource: latest }
          for (const asset of bundle.assets) await this.saveAsset(asset)
          for (const mask of bundle.masks) await this.saveMask(mask.key, mask.blob)
        }
        await this.acknowledge(entry.key, operation.operationId, result)
        for (const token of this.pendingPackBases.get(operation.operationId) ?? []) {
          if (!result.conflict) token.revision = result.resource.revision
        }
        this.pendingPackBases.delete(operation.operationId)
        if (entry.kind === 'project' && !result.conflict) this.openProjectBases.set(entry.id, result.resource.revision)
        if (entry.kind === 'project' && result.original) this.publish({ conflicts: { ...this.status.conflicts, [entry.id]: { id: result.resource.id, revision: (result.resource.value as ProjectDocument).revision } } })
      }
    }
  }
  private async records(entry: SyncEntry) {
    const document = entry.kind === 'project' ? entry.pending[0].value as ProjectDocument | null : null
    return document ? loadBinaries(this, document) : { assets: [], masks: [] }
  }

  async refresh(): Promise<void> {
    await this.sync()
    if (!this.active) return
    try {
      const [projects, packs] = await Promise.all([this.remote.list('project'), this.remote.list('pack')])
      if (!this.active) return
      this.remoteProjects = projects
      const errors: string[] = []
      for (const row of [...projects, ...packs]) {
        if (!this.active) return
        const local = (await this.listSyncEntries()).find((entry) => entry.kind === row.kind && entry.id === row.id)
        if (local?.pending.length || local?.baseRevision === row.revision) continue
        try {
          const bundle = await this.remote.download(row)
          if (!this.active) return
          await this.cacheRemote(row, bundle.assets, bundle.masks)
        } catch { errors.push(`“${row.value.title}” could not be downloaded. Reconnect and refresh to retry.`) }
      }
      if (errors.length) throw new Error(errors.join(' '))
      // A listing refresh must not erase a failed upload status.
      if (this.status.state !== 'error') await this.updateStatus()
      else this.publish({})
    } catch (error) {
      this.publish({ state: 'error', error: `Cloud refresh failed. Cached work is available. ${error instanceof Error ? error.message : ''}` })
    }
  }

  importGuest(guest: StickerLabRepository, ownerId: string, progress: (message: string) => void): Promise<void> {
    if (this.importWork) return this.importWork
    this.importWork = this.copyGuest(guest, ownerId, progress).finally(() => { this.importWork = null })
    return this.importWork
  }
  private async copyGuest(guest: StickerLabRepository, ownerId: string, progress: (message: string) => void) {
    const [projects, packs] = await Promise.all([guest.listProjects(), guest.listPacks()])
    const targetId = async (kind: string, id: string) => `import-${await binaryHash(new Blob([JSON.stringify([ownerId, kind, id])]))}`
    const mapping = new Map(await Promise.all(projects.map(async (project) => [project.id, await targetId('project', project.id)] as const)))
    let completed = 0
    for (const project of projects) {
      if (!this.active) throw new Error('Import paused because the workspace changed. Sign in to the same account to resume.')
      const id = mapping.get(project.id)!
      if (!(await this.listSyncEntries()).some((entry) => entry.key === `project:${id}`)) {
        const { assets, masks } = await loadBinaries(guest, project)
        if (!this.active) throw new Error('Import paused; guest originals were kept.')
        await this.saveProjectWithAssets({ ...project, id }, assets, masks)
      }
      progress(`Copied ${++completed} of ${projects.length} stickers locally. Guest originals are kept.`)
    }
    for (const pack of packs) {
      if (!this.active) throw new Error('Import paused; guest originals were kept.')
      const id = await targetId('pack', pack.id)
      if (!(await this.listSyncEntries()).some((entry) => entry.key === `pack:${id}`)) {
        if (pack.projectIds.some((projectId) => !mapping.has(projectId))) throw new Error(`Pack “${pack.title}” has missing stickers. Repair the guest pack and retry.`)
        await this.savePack({ ...pack, id, projectIds: pack.projectIds.map((projectId) => mapping.get(projectId)!) })
      }
    }
    await this.sync()
    if (!this.active || this.status.state === 'error' || (await this.listSyncEntries()).some((entry) => entry.pending.length)) throw new Error(this.status.error ?? 'Import was copied locally and remains pending. Retry cloud sync in the originating account.')
    progress('Import saved to cloud. Guest originals are still on this device.')
  }
}
