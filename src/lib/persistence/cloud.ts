/**
 * Cloud-capable sticker store: an IndexedDB repository plus a remote, with the
 * revision each writer last read tracked for conflict detection (ported from the
 * source `cloud.ts`).
 *
 * The adapter composes `IdbRepository` rather than extending it: local reads and
 * writes are delegated, and the sync bookkeeping (pending entries, base
 * revisions, status) lives here. Which base revision a write carries is injected
 * into the local adapter's change tracking at construction, so the local store
 * stays usable on its own and no callback reaches into protected internals.
 */

import type { PackRecord, ProjectDocument } from '#lib/domain/domain.js';
import {
	IdbRepository,
	loadProjectBundle,
	type AssetRecord,
	type MaskRecord,
	type RepositorySync,
	type StickerLabRepository
} from './repository';
import type { CloudRemote } from './cloudRemote';
import { binaryHash } from './cloudRemote';
import type { RemoteResource, SyncEntry } from './syncTypes';

function errorText(error: unknown) {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object' && 'message' in error)
		return String((error as { message: unknown }).message);
	return String(error);
}

/** The bundle in the array shape the remote client takes. */
function bundleArrays(bundle: Awaited<ReturnType<typeof loadProjectBundle>>): {
	assets: AssetRecord[];
	masks: MaskRecord[];
} {
	return {
		assets: [...bundle.assets.values()],
		masks: [...bundle.masks].map(([key, blob]) => ({ key, blob }))
	};
}

export type CloudStatus = {
	state: 'pending' | 'syncing' | 'synced' | 'error';
	pending: number;
	error: string | null;
	notices: string[];
	version: number;
	conflicts: Record<string, { id: string; revision: number }>;
};

export class CloudRepository implements StickerLabRepository {
	private readonly local: IdbRepository;
	private active = true;
	private listeners = new Set<() => void>();
	private status: CloudStatus = {
		state: 'pending',
		pending: 0,
		error: null,
		notices: [],
		version: 0,
		conflicts: {}
	};
	private work: Promise<void> | null = null;
	private wakeRequested = false;
	private importWork: Promise<void> | null = null;
	private remoteProjects: RemoteResource[] = [];
	private openProjectBases = new Map<string, number>();
	/** Base revision per record id, populated by the listing that handed the record out. */
	private projectBases = new Map<string, number>();
	private packBases = new Map<string, { revision: number }>();
	private pendingPackBases = new Map<string, Set<{ revision: number }>>();

	constructor(
		dbName: string,
		private readonly remote: CloudRemote
	) {
		// A project save usually follows an open (`openProjectBases`); a delete of a
		// listed but unopened project uses the base recorded by the listing.
		this.local = new IdbRepository(dbName, true, (kind, id) =>
			kind === 'project'
				? (this.openProjectBases.get(id) ?? this.projectBases.get(id))
				: this.packBases.get(id)?.revision
		);
	}
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	getStatus = () => this.status;
	/** The capability callers use after a mutation; local adapters have no `sync`. */
	readonly sync: RepositorySync = { settle: () => this.settle() };
	dismissConflict(id: string) {
		const conflicts = { ...this.status.conflicts };
		delete conflicts[id];
		this.publish({ conflicts });
	}
	dispose() {
		this.active = false;
	}
	private publish(patch: Partial<CloudStatus>) {
		if (!this.active) return;
		this.status = { ...this.status, ...patch, version: this.status.version + 1 };
		for (const listener of this.listeners) listener();
	}
	private async updateStatus() {
		const entries = await this.local.listSyncEntries();
		const pending = entries.reduce((sum, entry) => sum + entry.pending.length, 0);
		this.publish({
			pending,
			state: pending ? 'pending' : 'synced',
			error: null,
			notices: [
				...entries.flatMap((entry) => (entry.notice ? [entry.notice] : [])),
				...(this.remote.warnings ?? [])
			]
		});
	}
	private changed() {
		this.wakeRequested = true;
		this.publish({ state: 'pending' });
		void this.settle();
	}

	async saveProject(document: ProjectDocument): Promise<void> {
		await this.saveProjectWithAssets(document, []);
	}
	async saveProjectWithAssets(
		document: ProjectDocument,
		assets: AssetRecord[],
		masks: MaskRecord[] = []
	) {
		await this.local.saveProjectWithAssets(document, assets, masks);
		this.changed();
	}
	async deleteProject(id: string): Promise<void> {
		await this.local.deleteProject(id);
		this.changed();
	}
	async listPacks() {
		const rows = await this.local.packsWithRevisions();
		for (const { pack, baseRevision, pendingIds } of rows) {
			const token = { revision: baseRevision };
			this.packBases.set(pack.id, token);
			for (const id of pendingIds) {
				const tokens = this.pendingPackBases.get(id) ?? new Set();
				tokens.add(token);
				this.pendingPackBases.set(id, tokens);
			}
		}
		return rows.map(({ pack }) => pack).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
	async getPack(id: string) {
		return (await this.listPacks()).find((pack) => pack.id === id) ?? this.local.getPack(id);
	}
	async savePack(pack: PackRecord): Promise<void> {
		const next = { ...pack, visibility: 'private' as const };
		delete next.coverAssetId;
		await this.local.savePack(next);
		this.changed();
	}
	async deletePack(id: string): Promise<void> {
		await this.local.deletePack(id);
		this.changed();
	}
	async listProjects() {
		const local = await this.local.listProjects();
		const entries = await this.local.listSyncEntries();
		const localEntries = new Map(
			entries.filter((entry) => entry.kind === 'project').map((entry) => [entry.id, entry])
		);
		for (const project of local)
			this.projectBases.set(project.id, localEntries.get(project.id)?.baseRevision ?? 0);
		const remote = this.remoteProjects
			.filter((row) => !row.deleted && !localEntries.has(row.id))
			.map((row) => {
				const project = row.value as ProjectDocument;
				this.projectBases.set(project.id, row.revision);
				return project;
			});
		return [...local, ...remote];
	}
	async getProject(id: string) {
		try {
			const { document, baseRevision } = await this.local.projectWithRevision(id);
			this.openProjectBases.set(id, baseRevision);
			return document;
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'not_found')) throw error;
			const row = this.remoteProjects.find((project) => project.id === id && !project.deleted);
			if (!row || !this.active)
				throw new Error(
					'This sticker is not cached. Connect and use Account → Refresh cloud, then retry.',
					{ cause: error }
				);
			const bundle = await this.remote.download(row);
			if (!this.active) throw new Error('Workspace changed', { cause: error });
			await this.local.cacheRemote(row, bundle.assets, bundle.masks);
			this.openProjectBases.set(id, row.revision);
			return this.local.getProject(id);
		}
	}

	/** The local sync queue (diagnostics and tests); `getStatus()` summarizes it. */
	listSyncEntries(): Promise<SyncEntry[]> {
		return this.local.listSyncEntries();
	}

	async getAsset(id: string): Promise<AssetRecord> {
		return this.local.getAsset(id);
	}
	async listAssets() {
		return this.local.listAssets();
	}
	async saveAsset(record: AssetRecord): Promise<void> {
		await this.local.saveAsset(record);
	}
	async deleteAsset(id: string): Promise<void> {
		await this.local.deleteAsset(id);
	}
	async getMask(key: string): Promise<Blob> {
		return this.local.getMask(key);
	}
	async saveMask(key: string, blob: Blob): Promise<void> {
		await this.local.saveMask(key, blob);
	}
	async deleteMask(key: string): Promise<void> {
		await this.local.deleteMask(key);
	}

	/** One foreground drain, no polling or silent infinite retries. Online/account controls retry. */
	settle(): Promise<void> {
		if (this.work) return this.work;
		if (!this.active) return Promise.resolve();
		this.work = this.drain()
			.catch((error: unknown) => {
				const text = errorText(error);
				const expired =
					/jwt|unauthorized|invalid.?grant|session changed|not authenticated|401/i.test(text);
				this.publish({
					state: 'error',
					error: expired
						? 'Session expired. Your local edits are kept. Sign in again to sync.'
						: `Saved locally. Cloud sync failed: ${text || 'Reconnect or sign in again, then retry.'}`
				});
			})
			.finally(() => {
				this.work = null;
				if (this.active && this.wakeRequested && this.status.state !== 'error') void this.settle();
			});
		return this.work;
	}
	private async drain() {
		while (this.active) {
			this.wakeRequested = false;
			const entries = (await this.local.listSyncEntries()).filter((entry) => entry.pending.length);
			// Project saves, then packs, then project deletes (membership must be cleared first).
			entries.sort((a, b) => {
				const rank = (entry: typeof a) =>
					entry.kind === 'project' && entry.pending[0]?.value === null
						? 2
						: entry.kind === 'pack'
							? 1
							: 0;
				return rank(a) - rank(b);
			});
			if (!entries.length) {
				await this.updateStatus();
				return;
			}
			this.publish({
				state: 'syncing',
				pending: entries.reduce((sum, entry) => sum + entry.pending.length, 0),
				error: null
			});
			for (const entry of entries) {
				if (!this.active) return;
				const operation = entry.pending[0];
				const { assets, masks } = await this.records(entry);
				let result = await this.remote.commit(entry, operation, assets, masks);
				if (!this.active) return; // Lost acknowledgment is safe: replay uses the same operation identity.
				if (result.conflict) {
					// The winning original can use different assets. Download before replacing local JSON.
					const reportedOriginal = result.original ?? result.resource;
					const latest =
						(await this.remote.list(entry.kind)).find((row) => row.id === reportedOriginal.id) ??
						reportedOriginal;
					const bundle = await this.remote.download(latest);
					result = result.original
						? { ...result, original: latest }
						: { ...result, resource: latest };
					for (const asset of bundle.assets) await this.local.saveAsset(asset);
					for (const mask of bundle.masks) await this.local.saveMask(mask.key, mask.blob);
				}
				await this.local.acknowledge(entry.key, operation.operationId, result);
				for (const token of this.pendingPackBases.get(operation.operationId) ?? []) {
					if (!result.conflict) token.revision = result.resource.revision;
				}
				this.pendingPackBases.delete(operation.operationId);
				if (entry.kind === 'project' && !result.conflict)
					this.openProjectBases.set(entry.id, result.resource.revision);
				if (entry.kind === 'project' && result.original)
					this.publish({
						conflicts: {
							...this.status.conflicts,
							[entry.id]: {
								id: result.resource.id,
								revision: (result.resource.value as ProjectDocument).revision
							}
						}
					});
			}
		}
	}
	private async records(entry: SyncEntry) {
		const document =
			entry.kind === 'project' ? (entry.pending[0].value as ProjectDocument | null) : null;
		return document
			? bundleArrays(await loadProjectBundle(this.local, document))
			: { assets: [], masks: [] };
	}

	async refresh(): Promise<void> {
		await this.settle();
		if (!this.active) return;
		try {
			const [projects, packs] = await Promise.all([
				this.remote.list('project'),
				this.remote.list('pack')
			]);
			if (!this.active) return;
			this.remoteProjects = projects;
			const errors: string[] = [];
			for (const row of [...projects, ...packs]) {
				if (!this.active) return;
				const local = (await this.local.listSyncEntries()).find(
					(entry) => entry.kind === row.kind && entry.id === row.id
				);
				if (local?.pending.length || local?.baseRevision === row.revision) continue;
				try {
					const bundle = await this.remote.download(row);
					if (!this.active) return;
					await this.local.cacheRemote(row, bundle.assets, bundle.masks);
				} catch {
					errors.push(
						`“${row.value.title}” could not be downloaded. Reconnect and refresh to retry.`
					);
				}
			}
			if (errors.length) throw new Error(errors.join(' '));
			// A listing refresh must not erase a failed upload status.
			if (this.status.state !== 'error') await this.updateStatus();
			else this.publish({});
		} catch (error) {
			this.publish({
				state: 'error',
				error: `Cloud refresh failed. Cached work is available. ${
					error instanceof Error ? error.message : ''
				}`
			});
		}
	}

	importGuest(
		guest: StickerLabRepository,
		ownerId: string,
		progress: (message: string) => void
	): Promise<void> {
		if (this.importWork) return this.importWork;
		this.importWork = this.copyGuest(guest, ownerId, progress).finally(() => {
			this.importWork = null;
		});
		return this.importWork;
	}
	private async copyGuest(
		guest: StickerLabRepository,
		ownerId: string,
		progress: (message: string) => void
	) {
		const [projects, packs] = await Promise.all([guest.listProjects(), guest.listPacks()]);
		const targetId = async (kind: string, id: string) =>
			`import-${await binaryHash(new Blob([JSON.stringify([ownerId, kind, id])]))}`;
		const mapping = new Map(
			await Promise.all(
				projects.map(
					async (project) => [project.id, await targetId('project', project.id)] as const
				)
			)
		);
		let completed = 0;
		for (const project of projects) {
			if (!this.active)
				throw new Error(
					'Import paused because the workspace changed. Sign in to the same account to resume.'
				);
			const id = mapping.get(project.id)!;
			if (!(await this.local.listSyncEntries()).some((entry) => entry.key === `project:${id}`)) {
				const { assets, masks } = bundleArrays(await loadProjectBundle(guest, project));
				if (!this.active) throw new Error('Import paused; guest originals were kept.');
				await this.saveProjectWithAssets({ ...project, id }, assets, masks);
			}
			progress(
				`Copied ${++completed} of ${projects.length} stickers locally. Guest originals are kept.`
			);
		}
		for (const pack of packs) {
			if (!this.active) throw new Error('Import paused; guest originals were kept.');
			const id = await targetId('pack', pack.id);
			if (!(await this.local.listSyncEntries()).some((entry) => entry.key === `pack:${id}`)) {
				if (pack.projectIds.some((projectId) => !mapping.has(projectId)))
					throw new Error(
						`Pack “${pack.title}” has missing stickers. Repair the guest pack and retry.`
					);
				await this.savePack({
					...pack,
					id,
					projectIds: pack.projectIds.map((projectId) => mapping.get(projectId)!)
				});
			}
		}
		await this.settle();
		if (
			!this.active ||
			this.status.state === 'error' ||
			(await this.local.listSyncEntries()).some((entry) => entry.pending.length)
		)
			throw new Error(
				this.status.error ??
					'Import was copied locally and remains pending. Retry cloud sync in the originating account.'
			);
		progress('Import saved to cloud. Guest originals are still on this device.');
	}
}
