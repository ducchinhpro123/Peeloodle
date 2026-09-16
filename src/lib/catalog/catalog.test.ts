/**
 * Catalog contract tests. The Supabase adapter shares these semantics with
 * `MemoryCatalog`: published-only reads, keyset paging, compare-and-set
 * revisions and the guarded refusals. Row parsing is pinned separately because
 * a malformed server row must never produce a half-populated object.
 */
import { describe, expect, it } from 'vitest';
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
			{ ok: false, reason: 'revision_conflict', detail: { item: { revision: 4 } } },
			parseCollection
		);
		expect(refused).toEqual({
			ok: false,
			reason: 'revision_conflict',
			detail: { item: { revision: 4 } }
		});
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
						coverPath: 'templates/t/w/cover.png',
						slidePreviews: [],
						validationState: 'validated',
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
						coverPath: 'templates/t/w/cover.png',
						slidePreviews: [],
						validationState: 'validated',
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
