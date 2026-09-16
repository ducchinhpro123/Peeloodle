/**
 * Catalog contract tests. The Supabase adapter shares these semantics with
 * `MemoryCatalog`: published-only reads, keyset paging, compare-and-set
 * revisions and the guarded refusals. Row parsing is pinned separately because
 * a malformed server row must never produce a half-populated object.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CatalogError,
	catalogPageSize,
	decodeCatalogCursor,
	encodeCatalogCursor,
	isCatalogError
} from './repository';
import { parseActionResult, parseCollection, takePage } from './parse';
import { MemoryCatalog } from './memory';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogTemplate
} from './types';

const now = '2026-09-16T00:00:00.000Z';

function collection(overrides: Partial<CatalogCollection> = {}): CatalogCollection {
	return {
		id: 'c0000000-0000-4000-8000-000000000001',
		name: 'Animals',
		description: 'Everyday animals',
		tags: ['animals'],
		sortOrder: 1,
		state: 'published',
		revision: 1,
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function asset(overrides: Partial<CatalogAsset> = {}): CatalogAsset {
	return {
		id: 'a0000000-0000-4000-8000-000000000001',
		collectionId: 'c0000000-0000-4000-8000-000000000001',
		name: 'Cat',
		description: '',
		tags: [],
		kind: 'raster',
		provenance: { source: 'fixture' },
		sortOrder: 1,
		state: 'published',
		revision: 2,
		publishedVersionId: 'v0000000-0000-4000-8000-000000000001',
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function version(overrides: Partial<CatalogAssetVersion> = {}): CatalogAssetVersion {
	return {
		id: 'v0000000-0000-4000-8000-000000000001',
		assetId: 'a0000000-0000-4000-8000-000000000001',
		versionNumber: 1,
		sourcePath: 'batches/b/j/image.png',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1000,
		sourceMime: 'image/png',
		derivativePath: 'assets/a/v/image.png',
		derivativeSha256: 'b'.repeat(64),
		derivativeBytes: 800,
		derivativeMime: 'image/png',
		derivativeWidth: 64,
		derivativeHeight: 64,
		thumbnailPath: null,
		validationState: 'validated',
		createdAt: now,
		...overrides
	};
}

function template(overrides: Partial<CatalogTemplate> = {}): CatalogTemplate {
	return {
		id: 't0000000-0000-4000-8000-000000000001',
		title: 'Class deck',
		useCase: 'class',
		description: '',
		tags: [],
		sortOrder: 1,
		state: 'published',
		revision: 2,
		publishedVersionId: 'w0000000-0000-4000-8000-000000000001',
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

describe('catalog row parsing', () => {
	it('maps a valid snake_case row and rejects malformed ones as invalid_data', () => {
		const parsed = parseCollection({
			...collection(),
			sort_order: 1,
			published_at: now,
			archived_at: null,
			created_at: now,
			updated_at: now,
			state: 'published'
		});
		expect(parsed.sortOrder).toBe(1);
		expect(parsed.publishedAt).toBe(now);
		for (const bad of [
			null,
			{},
			{ ...collection(), sort_order: 1.5, state: 'published' },
			{ ...collection(), sort_order: 1, state: 'nonsense' },
			{ ...collection(), sort_order: 1, state: 'published', revision: 0 },
			{ ...collection(), sort_order: 1, state: 'published', tags: ['ok', 2] },
			{ ...collection(), sort_order: 1, state: 'published', created_at: 'not-a-date' }
		]) {
			expect(() => parseCollection(bad)).toThrow(CatalogError);
			try {
				parseCollection(bad);
			} catch (error) {
				expect(isCatalogError(error) && error.code).toBe('invalid_data');
			}
		}
	});

	it('parses guarded RPC envelopes and preserves refusal detail', () => {
		const ok = parseActionResult(
			{
				ok: true,
				item: {
					...collection(),
					sort_order: 1,
					published_at: null,
					archived_at: null,
					created_at: now,
					updated_at: now
				}
			},
			parseCollection
		);
		expect(ok.ok).toBe(true);
		const refused = parseActionResult(
			{
				ok: false,
				reason: 'revision_conflict',
				detail: {
					item: {
						...collection(),
						sort_order: 1,
						published_at: null,
						archived_at: null,
						created_at: now,
						updated_at: now,
						revision: 4
					}
				}
			},
			parseCollection
		);
		expect(refused.ok).toBe(false);
		if (refused.ok) throw new Error('expected a refusal');
		expect(refused.reason).toBe('revision_conflict');
		expect(refused.detail.item?.revision).toBe(4);
		expect(() => parseActionResult({ ok: false, reason: 'nonsense' }, parseCollection)).toThrow(
			CatalogError
		);
	});
});

describe('catalog cursors and paging', () => {
	it('round-trips a keyset position and refuses anything else', () => {
		const cursor = { sortOrder: -3, id: 'a0000000-0000-4000-8000-000000000001' };
		expect(decodeCatalogCursor(encodeCatalogCursor(cursor))).toEqual(cursor);
		for (const bad of ['', 'nonsense', btoa('{"a":1}'), btoa('[1,"ok"]'), btoa('[1,"bad id!"]')]) {
			expect(() => decodeCatalogCursor(bad)).toThrow(CatalogError);
		}
	});

	it('reports a next cursor only when a full page has a follower', () => {
		const rows = [
			{ sortOrder: 1, id: 'a' },
			{ sortOrder: 2, id: 'b' },
			{ sortOrder: 3, id: 'c' }
		];
		expect(takePage(rows, 2)).toEqual({
			items: rows.slice(0, 2),
			nextCursor: encodeCatalogCursor({ sortOrder: 2, id: 'b' })
		});
		expect(takePage(rows.slice(0, 2), 2)).toEqual({ items: rows.slice(0, 2), nextCursor: null });
	});

	it('caps the page size and rejects nonsense limits', () => {
		expect(catalogPageSize(undefined)).toBe(24);
		expect(catalogPageSize(1000)).toBe(100);
		expect(() => catalogPageSize(0)).toThrow(CatalogError);
		expect(() => catalogPageSize(2.5)).toThrow(CatalogError);
	});
});

describe('catalog public reads', () => {
	const seed = () => ({
		collections: [
			collection(),
			collection({ id: 'c0000000-0000-4000-8000-000000000002', name: 'Drafts', state: 'draft' })
		],
		assets: [
			asset(),
			asset({ id: 'a0000000-0000-4000-8000-000000000002', name: 'Hidden', state: 'draft' }),
			asset({
				id: 'a0000000-0000-4000-8000-000000000003',
				name: 'Badger',
				collectionId: 'c0000000-0000-4000-8000-000000000001',
				sortOrder: 2
			})
		],
		versions: [
			version(),
			version({
				id: 'v0000000-0000-4000-8000-000000000002',
				assetId: 'a0000000-0000-4000-8000-000000000002'
			})
		]
	});

	it('never exposes drafts and pages with a stable cursor', async () => {
		const catalog = new MemoryCatalog(seed());
		const first = await catalog.listCollections();
		expect(first.items.map((row) => row.name)).toEqual(['Animals']);
		const assets = await catalog.listAssets({ limit: 1 });
		expect(assets.items.map((row) => row.name)).toEqual(['Cat']);
		expect(assets.nextCursor).not.toBeNull();
		const second = await catalog.listAssets({ limit: 1, cursor: assets.nextCursor });
		expect(second.items.map((row) => row.name)).toEqual(['Badger']);
		expect(second.nextCursor).toBeNull();
		await expect(
			catalog.getCollection('c0000000-0000-4000-8000-000000000002')
		).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(
			catalog.getPublishedVersion('a0000000-0000-4000-8000-000000000002')
		).rejects.toMatchObject({ code: 'not_found' });
	});

	it('filters by collection, kind, use case and free text', async () => {
		const catalog = new MemoryCatalog(seed());
		expect(
			(await catalog.listAssets({ collectionId: 'c0000000-0000-4000-8000-000000000001' })).items
		).toHaveLength(2);
		expect((await catalog.listAssets({ kind: 'svg' })).items).toHaveLength(0);
		expect((await catalog.listAssets({ query: 'badg' })).items.map((row) => row.name)).toEqual([
			'Badger'
		]);
		expect((await catalog.listAssets({ query: 'cat' })).items.map((row) => row.name)).toEqual([
			'Cat'
		]);
	});

	it('keeps the next page stable when an item is inserted before the cursor', async () => {
		const catalog = new MemoryCatalog(seed());
		const first = await catalog.listAssets({ limit: 1 });
		catalog.assets.push(
			asset({ id: 'a0000000-0000-4000-8000-000000000004', name: 'Aardvark', sortOrder: 0 })
		);
		const second = await catalog.listAssets({ limit: 1, cursor: first.nextCursor });
		expect(second.items.map((row) => row.name)).toEqual(['Badger']);
	});

	it('returns a signed URL only for a stored derivative', async () => {
		const catalog = new MemoryCatalog({
			...seed(),
			derivativeUrls: new Map([['assets/a/v/image.png', 'https://example.test/signed']])
		});
		expect(await catalog.signedDerivativeUrl('assets/a/v/image.png')).toBe(
			'https://example.test/signed'
		);
		await expect(catalog.signedDerivativeUrl('assets/missing')).rejects.toMatchObject({
			code: 'missing_media'
		});
	});
});

describe('catalog admin operations', () => {
	const adminId = '11111111-1111-4111-8111-111111111111';
	const seed = () => ({ admins: [adminId] });

	it('refuses anonymous and non-admin actors', async () => {
		const anonymous = new MemoryCatalog(seed(), null);
		await expect(anonymous.isAdmin()).resolves.toBe(false);
		await expect(
			anonymous.createCollection({ name: 'x', description: '', tags: [], sortOrder: 0 })
		).rejects.toMatchObject({ code: 'permission' });
		const guest = new MemoryCatalog(seed(), 'other');
		await expect(guest.listCollectionsForAdmin()).rejects.toMatchObject({ code: 'permission' });
		await expect(new MemoryCatalog(seed(), adminId).isAdmin()).resolves.toBe(true);
	});

	it('drives a draft through revision-checked edits, publication and archive', async () => {
		const catalog = new MemoryCatalog(seed(), adminId);
		const created = await catalog.createCollection({
			name: 'Animals',
			description: '',
			tags: ['animals'],
			sortOrder: 1
		});
		if (!created.ok) throw new Error('create refused');
		expect(
			(
				await catalog.updateCollection(created.item.id, 99, {
					name: 'x',
					description: '',
					tags: [],
					sortOrder: 1
				})
			).ok
		).toBe(false);
		expect(
			await catalog.updateCollection(created.item.id, 99, {
				name: 'x',
				description: '',
				tags: [],
				sortOrder: 1
			})
		).toMatchObject({ reason: 'revision_conflict' });
		const updated = await catalog.updateCollection(created.item.id, 1, {
			name: 'Animals',
			description: 'Everyday animals',
			tags: ['animals'],
			sortOrder: 1
		});
		expect(updated).toMatchObject({ ok: true, item: { revision: 2 } });
		const assetResult = await catalog.createAsset({
			collectionId: created.item.id,
			name: 'Cat',
			description: '',
			tags: [],
			kind: 'raster',
			provenance: {},
			sortOrder: 1
		});
		if (!assetResult.ok) throw new Error('asset refused');
		catalog.versions.push(version({ assetId: assetResult.item.id }));
		const pendingVersion = version({
			id: 'v0000000-0000-4000-8000-000000000009',
			assetId: assetResult.item.id,
			validationState: 'pending'
		});
		catalog.versions.push(pendingVersion);
		expect(await catalog.publishAsset(assetResult.item.id, pendingVersion.id, 1)).toMatchObject({
			reason: 'version_not_validated'
		});
		expect(await catalog.publishAsset(assetResult.item.id, version().id, 1)).toMatchObject({
			reason: 'collection_not_published'
		});
		expect(await catalog.publishCollection(created.item.id, 2)).toMatchObject({ ok: true });
		expect(await catalog.publishAsset(assetResult.item.id, version().id, 1)).toMatchObject({
			ok: true,
			item: { state: 'published', publishedVersionId: version().id }
		});
		expect(await catalog.archiveAsset(assetResult.item.id, 2)).toMatchObject({
			ok: true,
			item: { state: 'archived' }
		});
		expect((await catalog.listAssets()).items).toHaveLength(0);
	});

	it('refuses to archive a pinned asset or a collection containing items without consent', async () => {
		const assetId = asset().id;
		const catalog = new MemoryCatalog(
			{
				admins: [adminId],
				collections: [collection()],
				assets: [asset()],
				versions: [version()],
				templates: [template()],
				templateVersions: [
					{
						id: 'w0000000-0000-4000-8000-000000000001',
						templateId: template().id,
						versionNumber: 1,
						document: { schemaVersion: 1 },
						documentSha256: 'c'.repeat(64),
						documentBytes: 100,
						coverPath: 'templates/t/w/cover.png',
						coverSha256: 'd'.repeat(64),
						slidePreviews: [],
						fontRequirements: [],
						validationState: 'validated',
						validation: {},
						createdAt: now
					}
				],
				dependencies: [
					{
						templateVersionId: 'w0000000-0000-4000-8000-000000000001',
						assetId,
						assetVersionId: version().id
					}
				]
			},
			adminId
		);
		expect(await catalog.archiveAsset(assetId, 2)).toMatchObject({ reason: 'pinned_by_template' });
		expect(await catalog.archiveCollection(collection().id, 1, false)).toMatchObject({
			reason: 'contains_items',
			detail: { count: 1 }
		});
		expect(await catalog.archiveCollection(collection().id, 1, true)).toMatchObject({
			reason: 'pinned_by_template'
		});
	});

	it('refuses template publication while a pinned asset is not the published one', async () => {
		const catalog = new MemoryCatalog(
			{
				admins: [adminId],
				collections: [collection()],
				assets: [asset({ state: 'draft', publishedVersionId: null, revision: 1 })],
				versions: [version()],
				templates: [template({ revision: 1, state: 'draft', publishedVersionId: null })],
				templateVersions: [
					{
						id: 'w0000000-0000-4000-8000-000000000001',
						templateId: template().id,
						versionNumber: 1,
						document: { schemaVersion: 1 },
						documentSha256: 'c'.repeat(64),
						documentBytes: 100,
						coverPath: 'templates/t/w/cover.png',
						coverSha256: 'd'.repeat(64),
						slidePreviews: [],
						fontRequirements: [],
						validationState: 'validated',
						validation: {},
						createdAt: now
					}
				],
				dependencies: [
					{
						templateVersionId: 'w0000000-0000-4000-8000-000000000001',
						assetId: asset().id,
						assetVersionId: version().id
					}
				]
			},
			adminId
		);
		expect(
			await catalog.publishTemplate(template().id, 'w0000000-0000-4000-8000-000000000001', 1)
		).toMatchObject({ reason: 'dependency_unavailable', detail: { assetIds: [asset().id] } });
	});
});

describe('catalog upload lifecycle', () => {
	const adminId = '11111111-1111-4111-8111-111111111111';
	const files = [
		{ name: 'Chart 01.PNG', mime: 'image/png', bytes: 1024 },
		{ name: 'logo.svg', mime: 'image/svg+xml', bytes: 2048 }
	];
	const report = (assetId: string, versionId: string, overrides: Record<string, unknown> = {}) => ({
		versionId,
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1024,
		sourceMime: 'image/png',
		derivativePath: `assets/${assetId}/${versionId}/asset.png`,
		derivativeSha256: 'b'.repeat(64),
		derivativeBytes: 2048,
		derivativeMime: 'image/png' as const,
		derivativeWidth: 64,
		derivativeHeight: 64,
		thumbnailPath: null,
		thumbnailSha256: null,
		thumbnailBytes: 0,
		renderer: 'test',
		validation: {},
		...overrides
	});

	afterEach(() => vi.useRealTimers());

	async function batch() {
		const catalog = new MemoryCatalog({ admins: [adminId] }, adminId);
		const created = await catalog.createUploadBatch({ collectionId: null, files });
		if (!created.ok) throw new Error(JSON.stringify(created));
		return { catalog, status: created.item };
	}

	it('reserves one path per file and only claims a job once its source is stored', async () => {
		const { catalog, status } = await batch();
		expect(status.jobs.map((job) => job.originalName)).toEqual(['Chart 01.PNG', 'logo.svg']);
		expect(status.jobs.map((job) => job.position)).toEqual([0, 1]);
		expect(status.batch.counts).toMatchObject({ total: 2, queued: 2, ready: 0 });
		expect(status.jobs.every((job) => job.stored === false)).toBe(true);
		expect(status.jobs[0].sourcePath.startsWith(`${status.batch.id}/`)).toBe(true);
		expect(await catalog.claimUploadJob()).toMatchObject({ reason: 'none_pending' });

		await catalog.uploadSource(
			status.jobs[0].sourcePath,
			new Blob([new Uint8Array(1024)]),
			'image/png'
		);
		const refreshed = await catalog.uploadStatus(status.batch.id);
		expect(refreshed.jobs[0].stored).toBe(true);
		expect(refreshed.jobs[1].stored).toBe(false);

		const claimResult = await catalog.claimUploadJob();
		if (!claimResult.ok) throw new Error(JSON.stringify(claimResult));
		expect(claimResult.item.job.stage).toBe('claimed');
		expect(claimResult.item.job.attempts).toBe(1);
		expect(claimResult.item.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
		expect(JSON.stringify(await catalog.uploadStatus(status.batch.id))).not.toContain(
			claimResult.item.leaseToken
		);
	});

	it('refuses an unsupported type before writing anything', async () => {
		const catalog = new MemoryCatalog({ admins: [adminId] }, adminId);
		const refused = await catalog.createUploadBatch({
			collectionId: null,
			files: [{ name: 'bad.gif', mime: 'image/gif', bytes: 10 }]
		});
		expect(refused).toMatchObject({ reason: 'invalid_file' });
		expect(await catalog.listUploadBatches()).toMatchObject({ items: [] });
	});

	it('reclaims an expired lease and refuses the stale token afterwards', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
		const { catalog, status } = await batch();
		const job = status.jobs[0];
		await catalog.uploadSource(job.sourcePath, new Blob([new Uint8Array(1024)]), 'image/png');

		const first = await catalog.claimUploadJob(60);
		if (!first.ok) throw new Error(JSON.stringify(first));
		vi.setSystemTime(new Date('2026-09-16T00:02:00.000Z'));
		const second = await catalog.claimUploadJob(60);
		if (!second.ok) throw new Error(JSON.stringify(second));
		expect(second.item.job.id).toBe(job.id);
		expect(second.item.job.attempts).toBe(2);
		expect(second.item.leaseToken).not.toBe(first.item.leaseToken);

		const stale = await catalog.completeUploadJob(
			job.id,
			first.item.leaseToken,
			report(job.assetId as string, crypto.randomUUID())
		);
		expect(stale).toMatchObject({ reason: 'lease_lost' });
	});

	it('stores an immutable validated version and replays the same report idempotently', async () => {
		const { catalog, status } = await batch();
		const job = status.jobs[0];
		const assetId = job.assetId as string;
		await catalog.uploadSource(job.sourcePath, new Blob([new Uint8Array(1024)]), 'image/png');
		const claim = await catalog.claimUploadJob();
		if (!claim.ok) throw new Error(JSON.stringify(claim));
		const versionId = crypto.randomUUID();
		const payload = report(assetId, versionId);

		expect(await catalog.completeUploadJob(job.id, claim.item.leaseToken, payload)).toMatchObject({
			reason: 'media_missing'
		});
		await catalog.uploadDerivative(
			payload.derivativePath,
			new Blob([new Uint8Array(2048)]),
			'image/png'
		);
		const completed = await catalog.completeUploadJob(job.id, claim.item.leaseToken, payload);
		if (!completed.ok) throw new Error(JSON.stringify(completed));
		expect(completed.item.version).toMatchObject({
			validationState: 'validated',
			versionNumber: 1,
			sourcePath: job.sourcePath
		});
		expect(completed.item.job.stage).toBe('ready');

		const replay = await catalog.completeUploadJob(job.id, claim.item.leaseToken, payload);
		expect(replay).toMatchObject({ ok: true, item: { replayed: true } });
		expect(catalog.versions).toHaveLength(1);

		// A report that points at another asset's media is refused outright.
		const forged = await catalog.completeUploadJob(job.id, claim.item.leaseToken, {
			...payload,
			versionId: crypto.randomUUID()
		});
		expect(forged).toMatchObject({ reason: 'already_complete' });
	});

	it('fails, retries and refuses a job at the attempt limit', async () => {
		const { catalog, status } = await batch();
		const job = status.jobs[1];
		await catalog.uploadSource(job.sourcePath, new Blob([new Uint8Array(2048)]), 'image/svg+xml');
		const claim = await catalog.claimUploadJob();
		if (!claim.ok) throw new Error(JSON.stringify(claim));
		expect(
			await catalog.failUploadJob(job.id, 'not-the-token', { code: 'x', message: 'y' })
		).toMatchObject({ reason: 'lease_lost' });

		const failed = await catalog.failUploadJob(job.id, claim.item.leaseToken, {
			code: 'decode_failed',
			message: 'The image could not be decoded'
		});
		if (!failed.ok) throw new Error(JSON.stringify(failed));
		expect(failed.item).toMatchObject({
			stage: 'failed',
			errorCode: 'decode_failed',
			errorMessage: 'The image could not be decoded'
		});
		expect(await catalog.retryUploadJob(job.id)).toMatchObject({
			ok: true,
			item: { stage: 'queued' }
		});
		const stored = catalog.uploadJobs.find((row) => row.id === job.id);
		if (stored) stored.attempts = 10;
		expect(await catalog.retryUploadJob(job.id)).toMatchObject({ reason: 'attempts_exhausted' });
	});

	it('cancels unfinished jobs, invalidates their leases and blocks new claims', async () => {
		const { catalog, status } = await batch();
		const job = status.jobs[0];
		await catalog.uploadSource(job.sourcePath, new Blob([new Uint8Array(1024)]), 'image/png');
		const claim = await catalog.claimUploadJob();
		if (!claim.ok) throw new Error(JSON.stringify(claim));

		const cancelled = await catalog.cancelUploadBatch(status.batch.id);
		if (!cancelled.ok) throw new Error(JSON.stringify(cancelled));
		expect(cancelled.item.batch.state).toBe('cancelled');
		expect(cancelled.item.jobs[0].stage).toBe('cancelled');
		expect(await catalog.claimUploadJob()).toMatchObject({ reason: 'none_pending' });
		expect(
			await catalog.completeUploadJob(
				job.id,
				claim.item.leaseToken,
				report(job.assetId as string, crypto.randomUUID())
			)
		).toMatchObject({ reason: 'lease_lost' });
	});

	it('lists only unreferenced media as orphans and protects pinned paths', async () => {
		const { catalog, status } = await batch();
		const [ready, other] = status.jobs;
		const assetId = ready.assetId as string;
		await catalog.uploadSource(ready.sourcePath, new Blob([new Uint8Array(1024)]), 'image/png');
		const claim = await catalog.claimUploadJob();
		if (!claim.ok) throw new Error(JSON.stringify(claim));
		const versionId = crypto.randomUUID();
		const payload = report(assetId, versionId);
		await catalog.uploadDerivative(
			payload.derivativePath,
			new Blob([new Uint8Array(2048)]),
			'image/png'
		);
		await catalog.completeUploadJob(ready.id, claim.item.leaseToken, payload);
		await catalog.uploadSource(other.sourcePath, new Blob([new Uint8Array(2048)]), 'image/svg+xml');
		await catalog.cancelUploadBatch(status.batch.id);

		const orphans = await catalog.listOrphanMedia(status.batch.id);
		expect(orphans.sources.map((object) => object.path)).toEqual([other.sourcePath]);
		expect(orphans.derivatives).toEqual([]);
		expect(orphans.sourceTotal).toBe(1);

		await expect(
			catalog.recordUploadCleanup(status.batch.id, [payload.derivativePath])
		).rejects.toMatchObject({ code: 'missing_media' });
		expect(await catalog.recordUploadCleanup(status.batch.id, [other.sourcePath])).toBe(1);

		// The completed job's source is referenced by its version, so removal keeps
		// it even though it was named explicitly; only the orphan disappears.
		await catalog.removeObjects('catalog-sources', [other.sourcePath, ready.sourcePath]);
		expect(catalog.objects.map((object) => object.path).sort()).toEqual(
			[ready.sourcePath, payload.derivativePath].sort()
		);
	});

	it('refuses upload operations without administrator membership', async () => {
		const catalog = new MemoryCatalog({}, null);
		await expect(catalog.createUploadBatch({ collectionId: null, files })).rejects.toBeInstanceOf(
			CatalogError
		);
		const admin = new MemoryCatalog({ admins: [adminId] }, adminId);
		const created = await admin.createUploadBatch({ collectionId: null, files });
		if (!created.ok) throw new Error(JSON.stringify(created));
		await expect(catalog.claimUploadJob()).rejects.toBeInstanceOf(CatalogError);
	});
});

describe('catalog template drafts in memory', () => {
	const adminId = '11111111-1111-4111-8111-111111111111';
	const sourceAssetId = asset().id;
	const sourceVersionId = version().id;

	/** One cloned presentation asset that already exists as a validated version. */
	const draftDocument = () => ({
		schemaVersion: 1,
		id: '10000000-0000-4000-8000-000000000001',
		title: 'Template copy',
		assets: [
			{
				id: '20000000-0000-4000-8000-000000000001',
				blobKey: `catalog/${'b'.repeat(64)}`,
				mimeType: 'image/png',
				width: 64,
				height: 64,
				sha256: 'b'.repeat(64),
				byteLength: 800,
				provenance: {
					source: 'catalog',
					label: 'Template art',
					catalogItemId: sourceAssetId,
					catalogVersionId: sourceVersionId
				}
			}
		],
		slides: []
	});

	const draftInput = (document: unknown) => ({
		metadata: {
			title: 'Template copy',
			useCase: 'class',
			description: '',
			tags: ['class'],
			sortOrder: 1
		},
		document,
		documentSha256: 'e'.repeat(64),
		documentBytes: 128,
		fontRequirements: [{ fontId: 'be-vietnam-pro' }]
	});

	const seeded = () =>
		new MemoryCatalog(
			{ admins: [adminId], collections: [collection()], assets: [asset()], versions: [version()] },
			adminId
		);

	it('creates a draft template, pending version and de-duplicated pins atomically', async () => {
		const catalog = seeded();
		const document = draftDocument();
		// A second asset pinning the same catalog version must not add a second row.
		document.assets.push({
			...structuredClone(document.assets[0]),
			id: '20000000-0000-4000-8000-000000000002'
		});
		const result = await catalog.createTemplateDraft(draftInput(document));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(JSON.stringify(result));
		expect(catalog.templates).toHaveLength(1);
		expect(catalog.templateVersions).toHaveLength(1);
		expect(catalog.dependencies).toEqual([
			{
				templateVersionId: catalog.templateVersions[0]!.id,
				assetId: sourceAssetId,
				assetVersionId: sourceVersionId
			}
		]);
		expect(catalog.templateVersions[0]).toMatchObject({
			coverPath: null,
			coverSha256: null,
			slidePreviews: [],
			validationState: 'pending',
			documentSha256: 'e'.repeat(64),
			documentBytes: 128,
			fontRequirements: [{ fontId: 'be-vietnam-pro' }]
		});
		expect(catalog.templates[0]).toMatchObject({
			title: 'Template copy',
			state: 'draft',
			revision: 1,
			publishedVersionId: null
		});
		expect(result.item).toEqual({
			template: catalog.templates[0],
			version: catalog.templateVersions[0]
		});
		// The version owns a clone, never the caller's live document.
		expect(catalog.templateVersions[0]!.document).not.toBe(document);
		expect(catalog.templateVersions[0]!.document).toEqual(document);
		document.title = 'edited after the draft was created';
		expect((catalog.templateVersions[0]!.document as { title: string }).title).toBe(
			'Template copy'
		);
	});

	it('refuses a mismatched dependency without mutating any array', async () => {
		const catalog = seeded();
		const document = draftDocument();
		document.assets[0].sha256 = 'f'.repeat(64);
		const result = await catalog.createTemplateDraft(draftInput(document));
		expect(result).toMatchObject({
			ok: false,
			reason: 'dependency_unavailable',
			detail: { assetIds: [sourceAssetId] }
		});
		expect(catalog.templates).toHaveLength(0);
		expect(catalog.templateVersions).toHaveLength(0);
		expect(catalog.dependencies).toHaveLength(0);
	});

	it('refuses an unknown or non-validated dependency without writing anything', async () => {
		const cases: CatalogAssetVersion[][] = [[version({ validationState: 'pending' })], []];
		for (const versions of cases) {
			const catalog = new MemoryCatalog(
				{ admins: [adminId], assets: [asset()], versions },
				adminId
			);
			const result = await catalog.createTemplateDraft(draftInput(draftDocument()));
			expect(result).toMatchObject({
				ok: false,
				reason: 'dependency_unavailable',
				detail: { assetIds: [sourceAssetId] }
			});
			expect(catalog.templates).toHaveLength(0);
			expect(catalog.templateVersions).toHaveLength(0);
			expect(catalog.dependencies).toHaveLength(0);
		}
	});

	it('refuses a document without an assets array as invalid_document', async () => {
		const catalog = seeded();
		const result = await catalog.createTemplateDraft(draftInput({ schemaVersion: 1, slides: [] }));
		expect(result).toMatchObject({ ok: false, reason: 'invalid_document' });
		expect(catalog.templates).toHaveLength(0);
		expect(catalog.templateVersions).toHaveLength(0);
		expect(catalog.dependencies).toHaveLength(0);
	});

	it('reads one exact asset version and refuses a mismatched pair or a non-admin', async () => {
		const catalog = seeded();
		expect(await catalog.getAssetVersion(sourceAssetId, sourceVersionId)).toMatchObject({
			id: sourceVersionId,
			assetId: sourceAssetId
		});
		await expect(
			catalog.getAssetVersion('a0000000-0000-4000-8000-000000000009', sourceVersionId)
		).rejects.toMatchObject({ code: 'not_found' });
		await expect(
			catalog.getAssetVersion(sourceAssetId, 'v0000000-0000-4000-8000-000000000009')
		).rejects.toMatchObject({ code: 'not_found' });
		const anonymous = new MemoryCatalog({ assets: [asset()], versions: [version()] });
		await expect(anonymous.getAssetVersion(sourceAssetId, sourceVersionId)).rejects.toMatchObject({
			code: 'permission'
		});
	});
});
