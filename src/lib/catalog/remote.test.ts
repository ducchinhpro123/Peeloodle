/**
 * Wire-contract tests for the Supabase catalog adapter, using a recording fake
 * client. The SQL harness proves the server side and `MemoryCatalog` proves the
 * semantics; these tests pin what the adapter actually sends — column lists,
 * published-only filters, the keyset `or` expression, `limit + 1`, RPC names and
 * argument names — and how it turns PostgREST failures into `CatalogError`s.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/cloud/database';
import { CatalogError } from './repository';
import { SupabaseCatalog } from './remote';

/**
 * The adapter only uses the builder shape the fake above implements, so the
 * library's full client type is irrelevant to these tests; this is the single
 * cast that says so.
 */
function catalogUsing(client: unknown) {
	return new SupabaseCatalog(client as unknown as SupabaseClient<Database>);
}
const now = '2026-09-16T00:00:00.000Z';

const collectionRow = {
	id: 'c0000000-0000-4000-8000-000000000001',
	name: 'Animals',
	description: '',
	tags: [],
	sort_order: 1,
	state: 'published',
	revision: 1,
	published_at: now,
	archived_at: null,
	created_at: now,
	updated_at: now
};

const assetVersionRow = {
	id: 'v0000000-0000-4000-8000-000000000001',
	asset_id: 'a0000000-0000-4000-8000-000000000001',
	version_number: 1,
	source_path: 'batches/b/j/image.png',
	source_sha256: 'a'.repeat(64),
	source_bytes: 1000,
	source_mime: 'image/png',
	derivative_path: 'assets/a/v/image.png',
	derivative_sha256: 'b'.repeat(64),
	derivative_bytes: 800,
	derivative_mime: 'image/png',
	derivative_width: 64,
	derivative_height: 64,
	thumbnail_path: null,
	validation_state: 'validated',
	created_at: now
};

/**
 * A chainable PostgREST stand-in: every builder method records its call and the
 * chain resolves to the next queued `{ data, error }`.
 */
function fakeClient(
	responses: { data: unknown; error: { code?: string; message: string } | null }[]
) {
	const calls: unknown[][] = [];
	const next = () => responses.shift() ?? { data: null, error: null };
	const chain = () => {
		/** @type {any} */
		const builder = {
			select: (columns: string) => (calls.push(['select', columns]), builder),
			eq: (column: string, value: unknown) => (calls.push(['eq', column, value]), builder),
			or: (filter: string) => (calls.push(['or', filter]), builder),
			order: (column: string) => (calls.push(['order', column]), builder),
			limit: (count: number) => (calls.push(['limit', count]), builder),
			single: () => (calls.push(['single']), Promise.resolve(next())),
			then: (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve)
		};
		return builder;
	};
	const client = {
		from: (table: string) => (calls.push(['from', table]), chain()),
		rpc: (name: string, args?: unknown) => (
			calls.push(['rpc', name, args]),
			Promise.resolve(next())
		),
		storage: {
			from: (bucket: string) => ({
				createSignedUrl: (path: string, expires: number) => {
					calls.push(['signedUrl', bucket, path, expires]);
					return Promise.resolve(next());
				}
			})
		}
	};
	return { calls, client };
}

describe('supabase catalog adapter', () => {
	it('lists published collections with filters, keyset cursor and limit + 1', async () => {
		const { calls, client } = fakeClient([
			{
				data: [collectionRow, { ...collectionRow, id: 'c0000000-0000-4000-8000-000000000002' }],
				error: null
			}
		]);
		const catalog = catalogUsing(client);
		const cursor = btoa(JSON.stringify([3, 'c0000000-0000-4000-8000-000000000009']));
		const page = await catalog.listCollections({ query: 'ani%_,mals', limit: 1, cursor });
		expect(page.items).toHaveLength(1);
		expect(page.nextCursor).not.toBeNull();
		expect(calls).toEqual([
			['from', 'catalog_collections'],
			['select', expect.stringContaining('id,name,description,tags,sort_order,state,revision')],
			['eq', 'state', 'published'],
			['or', 'name.ilike.%ani mals%,description.ilike.%ani mals%'],
			['or', 'sort_order.gt.3,and(sort_order.eq.3,id.gt.c0000000-0000-4000-8000-000000000009)'],
			['order', 'sort_order'],
			['order', 'id'],
			['limit', 2]
		]);
	});

	it('never lists template documents or validation payloads', async () => {
		const { calls, client } = fakeClient([{ data: [], error: null }]);
		await catalogUsing(client).listTemplates();
		const select = calls.find((call) => call[0] === 'select')?.[1];
		expect(select).not.toContain('document');
		expect(select).not.toContain('validation');
	});

	it('fetches the published version only through the asset pointer', async () => {
		const assetRow = {
			id: assetVersionRow.asset_id,
			collection_id: null,
			name: 'Cat',
			description: '',
			tags: [],
			kind: 'raster',
			provenance: {},
			sort_order: 1,
			state: 'published',
			revision: 2,
			published_version_id: assetVersionRow.id,
			published_at: now,
			archived_at: null,
			created_at: now,
			updated_at: now
		};
		const { calls, client } = fakeClient([
			{ data: assetRow, error: null },
			{ data: assetVersionRow, error: null }
		]);
		const version = await catalogUsing(client).getPublishedVersion(assetRow.id);
		expect(version.id).toBe(assetVersionRow.id);
		expect(calls).toEqual([
			['from', 'catalog_assets'],
			['select', expect.stringContaining('published_version_id')],
			['eq', 'id', assetRow.id],
			['eq', 'state', 'published'],
			['single'],
			['from', 'catalog_asset_versions'],
			['select', expect.stringContaining('validation_state')],
			['eq', 'id', assetVersionRow.id],
			['eq', 'asset_id', assetRow.id],
			['single']
		]);
	});

	it('turns a permission failure into CatalogError(permission) and a missing row into not_found', async () => {
		const denied = fakeClient([{ data: null, error: { code: '42501', message: 'denied' } }]);
		await expect(catalogUsing(denied.client).listCollections()).rejects.toMatchObject({
			code: 'permission'
		});
		const missing = fakeClient([{ data: null, error: { code: 'PGRST116', message: 'no rows' } }]);
		await expect(catalogUsing(missing.client).getCollection('x')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('maps the guarded RPC names, argument names and typed refusals', async () => {
		const conflictRow = { ...collectionRow, revision: 5 };
		const { calls, client } = fakeClient([
			{
				data: { ok: false, reason: 'revision_conflict', detail: { item: conflictRow } },
				error: null
			}
		]);
		const catalog = catalogUsing(client);
		const result = await catalog.updateCollection('c0000000-0000-4000-8000-000000000001', 2, {
			name: 'Animals',
			description: '',
			tags: [],
			sortOrder: 1
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected a refusal');
		expect(result.reason).toBe('revision_conflict');
		expect(result.detail.item?.revision).toBe(5);
		expect(typeof result.detail.item?.name).toBe('string');
		expect(calls).toEqual([
			[
				'rpc',
				'catalog_admin_update_collection',
				expect.objectContaining({ expected_revision: 2, sort_order: 1 })
			]
		]);
	});

	it('publishes with the version and expected revision, and signs derivative URLs', async () => {
		const assetRow = {
			id: 'a0000000-0000-4000-8000-000000000001',
			collection_id: null,
			name: 'Cat',
			description: '',
			tags: [],
			kind: 'raster',
			provenance: {},
			sort_order: 1,
			state: 'published',
			revision: 3,
			published_version_id: assetVersionRow.id,
			published_at: now,
			archived_at: null,
			created_at: now,
			updated_at: now
		};
		const { calls, client } = fakeClient([
			{ data: { ok: true, item: assetRow }, error: null },
			{ data: { signedUrl: 'https://example.test/signed' }, error: null }
		]);
		const catalog = catalogUsing(client);
		const result = await catalog.publishAsset(assetRow.id, assetVersionRow.id, 2);
		expect(result.ok).toBe(true);
		expect(calls[0]).toEqual([
			'rpc',
			'catalog_admin_publish_asset',
			{ id: assetRow.id, version_id: assetVersionRow.id, expected_revision: 2 }
		]);
		expect(await catalog.signedDerivativeUrl(assetVersionRow.derivative_path, 120)).toBe(
			'https://example.test/signed'
		);
		expect(calls[1]).toEqual([
			'signedUrl',
			'catalog-derivatives',
			assetVersionRow.derivative_path,
			120
		]);
		await expect(catalog.signedDerivativeUrl('assets/missing')).rejects.toBeInstanceOf(
			CatalogError
		);
	});

	it('reads the admin predicate as a boolean', async () => {
		const { calls, client } = fakeClient([{ data: false, error: null }]);
		const catalog = catalogUsing(client);
		expect(await catalog.isAdmin()).toBe(false);
		expect(calls).toEqual([['rpc', 'catalog_is_admin', undefined]]);
	});

	it('rejects a forged or malformed cursor before it reaches PostgREST', async () => {
		const { client } = fakeClient([{ data: [], error: null }]);
		const catalog = catalogUsing(client);
		await expect(
			catalog.listCollections({ cursor: btoa('[1,"not a uuid!"]') })
		).rejects.toMatchObject({
			code: 'invalid_data'
		});
	});
});
