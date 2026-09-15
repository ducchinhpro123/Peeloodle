/**
 * The account local-first repository contract (ported from the source
 * `cloud.test.ts`). The remote is an in-memory implementation of the same
 * `CloudRemote` interface the Supabase adapter implements, so these tests pin
 * the queue, retry, conflict-copy, guest-import and session-expiry behaviour
 * without a backend. The real HTTP wire contract is exercised by
 * `e2e/cloud.spec.ts` against a synthetic Supabase.
 */

import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CloudRepository } from './cloud';
import type { CloudRemote, RemoteBundle } from './cloudRemote';
import { createProjectDocument, IdbRepository } from './repository';
import { removeProject } from '$lib/editor/removeProject';
import type {
	CommitResult,
	PendingOperation,
	RemoteResource,
	ResourceKind,
	SyncEntry
} from './syncTypes';

beforeAll(() => {
	vi.stubGlobal('crypto', webcrypto);
});
afterAll(() => {
	vi.unstubAllGlobals();
});

class Remote implements CloudRemote {
	rows = new Map<string, RemoteResource>();
	receipts = new Map<string, CommitResult>();
	offline = false;
	loseResponse = false;
	beforeCommit: (() => Promise<void>) | null = null;
	async list(kind: ResourceKind) {
		return [...this.rows.values()].filter((row) => row.kind === kind);
	}
	async download(resource: RemoteResource): Promise<RemoteBundle> {
		return { resource, assets: [], masks: [] };
	}
	async commit(entry: SyncEntry, operation: PendingOperation): Promise<CommitResult> {
		if (this.beforeCommit) await this.beforeCommit();
		if (this.offline) throw new Error('Offline');
		const previous = this.receipts.get(operation.operationId);
		if (previous) return previous;
		const old = this.rows.get(entry.key);
		const conflict = (old?.revision ?? 0) !== entry.baseRevision || !!old?.deleted;
		if (conflict && operation.value === null) {
			if (!old) throw new Error('Cannot delete unknown resource');
			const result = { resource: old, conflict: true };
			this.receipts.set(operation.operationId, result);
			return result;
		}
		const id = conflict && operation.value ? operation.operationId : entry.id;
		const resource: RemoteResource = {
			kind: entry.kind,
			id,
			revision: id === entry.id ? (old?.revision ?? 0) + 1 : 1,
			deleted: operation.value === null,
			value: operation.value
				? {
						...operation.value,
						id,
						title: operation.value.title + (conflict ? ' (conflict copy)' : '')
					}
				: old!.value
		};
		const result = { resource, original: conflict ? old : undefined, conflict };
		this.rows.set(`${entry.kind}:${id}`, resource);
		this.receipts.set(operation.operationId, result);
		if (this.loseResponse) {
			this.loseResponse = false;
			throw new Error('Response lost');
		}
		return result;
	}
}

const packRecord = (overrides: Record<string, unknown> = {}) => ({
	id: 'pack',
	title: 'First',
	description: '',
	projectIds: [] as string[],
	visibility: 'private' as const,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides
});

describe('account local-first repository', () => {
	it('advances a pack editing baseline through its own pending saves, but not through another device refresh', async () => {
		const remote = new Remote();
		const repo = new CloudRepository(`packs-${crypto.randomUUID()}`, remote);
		const now = new Date().toISOString();
		const pack = packRecord({ createdAt: now, updatedAt: now });
		let release!: () => void;
		remote.beforeCommit = () =>
			new Promise<void>((resolve) => {
				release = resolve;
			});
		await repo.savePack(pack);
		while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
		const editing = await repo.getPack(pack.id);
		remote.beforeCommit = null;
		release();
		await repo.sync.settle();
		await repo.savePack({ ...editing, title: 'Own next edit' });
		await repo.sync.settle();
		expect(remote.rows.size).toBe(1);
		const stale = await repo.getPack(pack.id);
		const other = new CloudRepository(`packs-other-${crypto.randomUUID()}`, remote);
		await other.refresh();
		await other.savePack(packRecord({ title: 'Other device', createdAt: now, updatedAt: now }));
		await other.sync.settle();
		await repo.refresh();
		await repo.savePack({ ...stale, title: 'Open form edit' });
		await repo.sync.settle();
		expect([...remote.rows.values()].map((row) => row.value.title).sort()).toEqual([
			'Open form edit (conflict copy)',
			'Other device'
		]);
	});

	it('does not silently overwrite a remote edit when refresh occurs during local editing', async () => {
		const remote = new Remote();
		const repo = new CloudRepository(`refresh-${crypto.randomUUID()}`, remote);
		const doc = createProjectDocument({ title: 'Before editing' });
		await repo.saveProject(doc);
		await repo.sync.settle();
		const editing = await repo.getProject(doc.id);
		const other = new CloudRepository(`other-${crypto.randomUUID()}`, remote);
		await other.refresh();
		await other.saveProject({ ...doc, title: 'Other device' });
		await other.sync.settle();
		await repo.refresh();
		await repo.saveProject({ ...editing, title: 'Unsaved during refresh' });
		await repo.sync.settle();
		expect([...remote.rows.values()].map((row) => row.value.title).sort()).toEqual([
			'Other device',
			'Unsaved during refresh (conflict copy)'
		]);
	});

	it('rejects a stale project delete after refresh and keeps the newer cloud version', async () => {
		const remote = new Remote();
		const accountA = new CloudRepository(`delete-a-${crypto.randomUUID()}`, remote);
		const accountB = new CloudRepository(`delete-b-${crypto.randomUUID()}`, remote);
		const document = createProjectDocument({ title: 'Shared sticker' });

		await accountA.saveProject(document);
		await accountA.sync.settle();
		await accountA.getProject(document.id);
		await accountB.refresh();
		const [listed] = await accountB.listProjects();
		expect(listed?.title).toBe('Shared sticker');

		await accountA.saveProject({ ...document, title: 'Newer remote edit' });
		await accountA.sync.settle();
		await accountB.refresh();

		await accountB.deleteProject(listed!.id);
		await accountB.sync.settle();

		const current = remote.rows.get(`project:${document.id}`);
		expect(current).toMatchObject({
			deleted: false,
			revision: 2,
			value: { title: 'Newer remote edit' }
		});
		expect(accountB.getStatus().notices).toContain(
			'Deletion was not applied: the cloud version changed. Refresh and review it.'
		);
		expect((await accountB.listProjects()).map((project) => project.title)).toEqual([
			'Newer remote edit'
		]);
	});

	it('keeps pack membership when a stale project delete is rejected', async () => {
		const remote = new Remote();
		const accountA = new CloudRepository(`stale-pack-a-${crypto.randomUUID()}`, remote);
		const accountB = new CloudRepository(`stale-pack-b-${crypto.randomUUID()}`, remote);
		const document = createProjectDocument({ title: 'Packed sticker' });
		const retained = createProjectDocument({ title: 'Keep me' });
		await accountA.saveProject(document);
		await accountA.saveProject(retained);
		await accountA.sync.settle();
		await accountA.savePack(
			packRecord({
				title: 'Pack',
				projectIds: [document.id, retained.id],
				createdAt: document.createdAt,
				updatedAt: document.updatedAt
			})
		);
		await accountA.sync.settle();
		await accountB.refresh();
		const listed = (await accountB.listProjects()).find((project) => project.id === document.id);
		expect(listed?.title).toBe('Packed sticker');

		await accountA.saveProject({ ...document, title: 'Newer packed edit' });
		await accountA.sync.settle();
		await accountB.refresh();

		await removeProject(accountB, listed!);
		await accountB.sync.settle();

		const current = remote.rows.get(`project:${document.id}`);
		expect(current).toMatchObject({
			deleted: false,
			revision: 2,
			value: { title: 'Newer packed edit' }
		});
		expect(accountB.getStatus().notices).toContain(
			'Deletion was not applied: the cloud version changed. Refresh and review it.'
		);
		expect(remote.rows.get('pack:pack')?.value).toMatchObject({
			projectIds: [document.id, retained.id]
		});
		expect((await accountB.listPacks())[0]?.projectIds).toEqual([document.id, retained.id]);
		expect((await accountB.listProjects()).map((project) => project.title).sort()).toEqual([
			'Keep me',
			'Newer packed edit'
		]);
	});

	it('deletes the current listed project after clearing its pack membership', async () => {
		const remote = new Remote();
		const repo = new CloudRepository(`delete-current-${crypto.randomUUID()}`, remote);
		const document = createProjectDocument({ title: 'Delete me' });
		const retained = createProjectDocument({ title: 'Keep me' });
		await repo.saveProject(document);
		await repo.saveProject(retained);
		await repo.sync.settle();
		await repo.savePack(
			packRecord({
				title: 'Pack',
				projectIds: [document.id, retained.id],
				createdAt: document.createdAt,
				updatedAt: document.updatedAt
			})
		);
		await repo.sync.settle();

		const current = (await repo.listProjects()).find((project) => project.id === document.id)!;
		const pack = (await repo.listPacks())[0]!;
		await repo.savePack({
			...pack,
			projectIds: [retained.id],
			updatedAt: new Date().toISOString()
		});
		await repo.sync.settle();
		await repo.deleteProject(current.id);
		await repo.sync.settle();
		expect(remote.rows.get(`project:${document.id}`)?.deleted).toBe(true);
		expect(remote.rows.get('pack:pack')?.value).toMatchObject({ projectIds: [retained.id] });
		expect(remote.rows.get(`project:${retained.id}`)?.deleted).toBe(false);
	});

	it('resumes guest imports per account, preserving originals and ordered pack membership', async () => {
		const guest = new IdbRepository(`guest-import-${crypto.randomUUID()}`);
		const doc = createProjectDocument({ title: 'Guest photo' });
		await guest.saveProject(doc);
		await guest.savePack(
			packRecord({
				id: 'guest-pack',
				title: 'Guest pack',
				visibility: 'local',
				projectIds: [doc.id],
				createdAt: doc.createdAt,
				updatedAt: doc.updatedAt
			})
		);
		const remote = new Remote();
		remote.offline = true;
		const name = `import-${crypto.randomUUID()}`;
		const repo = new CloudRepository(name, remote);
		await expect(repo.importGuest(guest, 'account-a', () => undefined)).rejects.toThrow();
		expect((await guest.listProjects())[0]!.id).toBe(doc.id);
		repo.dispose();
		remote.offline = false;
		const reopened = new CloudRepository(name, remote);
		await reopened.importGuest(guest, 'account-a', () => undefined);
		await reopened.importGuest(guest, 'account-a', () => undefined);
		expect(remote.rows.size).toBe(2);
		const [project] = await reopened.listProjects();
		expect((await reopened.listPacks())[0]?.projectIds).toEqual([project!.id]);
		expect((await guest.listPacks())[0]?.projectIds).toEqual([doc.id]);
	});

	it('keeps an in-flight operation pending in its original workspace when disposed', async () => {
		const remote = new Remote();
		let release!: () => void;
		remote.beforeCommit = () =>
			new Promise<void>((resolve) => {
				release = resolve;
			});
		const name = `signout-${crypto.randomUUID()}`;
		const repo = new CloudRepository(name, remote);
		const doc = createProjectDocument({ title: 'Private A' });
		await repo.saveProject(doc);
		while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
		repo.dispose();
		release();
		await repo.sync.settle();
		const other = new CloudRepository(`private-b-${crypto.randomUUID()}`, new Remote());
		expect(await other.listProjects()).toEqual([]);
		expect((await new IdbRepository(name, true).listSyncEntries())[0]!.pending).toHaveLength(1);
	});

	it('retries a lost commit response after reload without duplicating a conflict copy', async () => {
		const remote = new Remote();
		const first = new CloudRepository(`a-${crypto.randomUUID()}`, remote);
		const secondName = `b-${crypto.randomUUID()}`;
		const second = new CloudRepository(secondName, remote);
		const doc = createProjectDocument({ title: 'Original' });
		await first.saveProject(doc);
		await first.sync.settle();
		await second.refresh();
		await first.saveProject({ ...doc, title: 'Device A' });
		await first.sync.settle();
		remote.loseResponse = true;
		await second.saveProject({ ...doc, title: 'Device B' });
		await second.sync.settle();
		expect(second.getStatus().state).toBe('error');
		expect((await second.getProject(doc.id)).title).toBe('Device B');
		second.dispose();
		const reopened = new CloudRepository(secondName, remote);
		await reopened.sync.settle();
		expect(remote.rows.size).toBe(2);
		expect((await reopened.listProjects()).map((project) => project.title).sort()).toEqual([
			'Device A',
			'Device B (conflict copy)'
		]);
		expect(reopened.getStatus().notices[0]).toContain('Conflict copy saved');
		expect((await reopened.listSyncEntries()).every((entry) => entry.pending.length === 0)).toBe(
			true
		);
	});

	it('does not acknowledge a newer local composition when an older upload completes', async () => {
		const remote = new Remote();
		let release!: () => void;
		remote.beforeCommit = () =>
			new Promise<void>((resolve) => {
				release = resolve;
			});
		const repo = new CloudRepository(`snapshot-${crypto.randomUUID()}`, remote);
		const doc = createProjectDocument({ title: 'First snapshot' });
		await repo.saveProject(doc);
		while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
		await repo.saveProject({ ...doc, title: 'Newer edit', revision: 1 });
		remote.offline = true;
		release();
		await repo.sync.settle();
		expect((await repo.getProject(doc.id)).title).toBe('Newer edit');
		expect((await repo.listSyncEntries())[0]!.pending).toHaveLength(2);
		expect(repo.getStatus().state).toBe('error');
		remote.beforeCommit = null;
		remote.offline = false;
		await repo.sync.settle();
		expect(remote.rows.get(`project:${doc.id}`)?.value.title).toBe('Newer edit');
		expect(repo.getStatus().state).toBe('synced');
	});

	it('retains an atomic project save and pending snapshot across reload without exposing it to guests', async () => {
		const name = `account-${crypto.randomUUID()}`;
		const repo = new IdbRepository(name, true);
		const doc = createProjectDocument({ title: 'Offline work' });
		await repo.saveProject(doc);
		const reopened = new IdbRepository(name, true);
		expect((await reopened.getProject(doc.id)).title).toBe('Offline work');
		const [entry] = await reopened.listSyncEntries();
		expect(entry!.pending[0]!.value).toEqual(doc);
		expect(entry!.baseRevision).toBe(0);
		expect(await new IdbRepository(`guest-${crypto.randomUUID()}`).listProjects()).toEqual([]);
		const invalid = { ...doc, title: 'Broken edit', assetIds: ['missing'] };
		await expect(reopened.saveProject(invalid)).rejects.toMatchObject({ code: 'missing_asset' });
		expect((await reopened.getProject(doc.id)).title).toBe('Offline work');
		expect((await reopened.listSyncEntries())[0]!.pending).toHaveLength(1);
	});

	it('keeps local work and asks to sign in again when the session expires during sync', async () => {
		const remote = new Remote();
		remote.beforeCommit = async () => {
			throw new Error('Invalid JWT');
		};
		const repo = new CloudRepository(`expiry-${crypto.randomUUID()}`, remote);
		const doc = createProjectDocument({ title: 'Kept locally' });
		await repo.saveProject(doc);
		await repo.sync.settle();
		expect((await repo.getProject(doc.id)).title).toBe('Kept locally');
		expect((await repo.listSyncEntries())[0]!.pending).toHaveLength(1);
		expect(repo.getStatus().error).toMatch(/sign in again/i);
	});
});
