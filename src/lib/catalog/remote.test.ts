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
				},
				upload: (path: string, body: unknown, options: unknown) => {
					calls.push(['upload', bucket, path, body, options]);
					return Promise.resolve(next());
				},
				download: (path: string) => {
					calls.push(['download', bucket, path]);
					return Promise.resolve(next());
				},
				remove: (paths: string[]) => {
					calls.push(['remove', bucket, paths]);
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

describe('supabase catalog adapter upload lifecycle', () => {
	const now = '2026-09-16T00:00:00.000Z';
	const batchId = 'b0000000-0000-4000-8000-000000000001';
	const jobRow = {
		id: 'j0000000-0000-4000-8000-000000000001',
		batch_id: batchId,
		asset_id: 'a0000000-0000-4000-8000-000000000001',
		source_path: `${batchId}/s0000000-0000-4000-8000-000000000001.png`,
		original_name: 'Chart 01.PNG',
		claimed_mime: 'image/png',
		claimed_bytes: 1024,
		position: 0,
		stage: 'queued',
		progress: 0,
		attempts: 0,
		lease_expires_at: null,
		error_code: null,
		error_message: null,
		created_at: now,
		updated_at: now
	};
	const statusRow = {
		batch: {
			id: batchId,
			state: 'open',
			created_at: now,
			counts: { total: 1, queued: 1, claimed: 0, ready: 0, failed: 0, cancelled: 0 }
		},
		jobs: [{ ...jobRow, stored: false, version_id: null }]
	};
	const report = {
		versionId: 'v0000000-0000-4000-8000-000000000009',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1024,
		sourceMime: 'image/png',
		derivativePath: 'assets/a/v/asset.png',
		derivativeSha256: 'b'.repeat(64),
		derivativeBytes: 2048,
		derivativeMime: 'image/png' as const,
		derivativeWidth: 64,
		derivativeHeight: 64,
		thumbnailPath: null,
		thumbnailSha256: null,
		thumbnailBytes: 0,
		renderer: 'sharp',
		validation: { source_format: 'png' }
	};

	it('creates a batch through the guarded RPC and parses the status payload', async () => {
		const { calls, client } = fakeClient([{ data: { ok: true, item: statusRow }, error: null }]);
		const catalog = catalogUsing(client);
		const result = await catalog.createUploadBatch({
			collectionId: null,
			files: [{ name: 'Chart 01.PNG', mime: 'image/png', bytes: 1024 }]
		});
		expect(result).toMatchObject({ ok: true, item: { batch: { id: batchId } } });
		expect(calls).toEqual([
			[
				'rpc',
				'catalog_admin_create_upload_batch',
				{
					p_collection_id: null,
					p_files: [{ name: 'Chart 01.PNG', mime: 'image/png', bytes: 1024 }]
				}
			]
		]);
	});

	it('reads the batch status, lists batches and refuses a malformed job row', async () => {
		const { calls, client } = fakeClient([
			{ data: { ok: true, item: statusRow }, error: null },
			{
				data: {
					ok: true,
					items: [statusRow.batch],
					next: { created_at: now, id: batchId }
				},
				error: null
			},
			{ data: { ok: true, item: { ...statusRow.jobs[0], position: 'first' } }, error: null }
		]);
		const catalog = catalogUsing(client);
		const status = await catalog.uploadStatus(batchId);
		expect(status.jobs[0]).toMatchObject({ originalName: 'Chart 01.PNG', stored: false });
		const batches = await catalog.listUploadBatches();
		expect(batches.items[0].counts.total).toBe(1);
		expect(batches.nextCursor).not.toBeNull();
		await expect(catalog.uploadStatus(batchId)).rejects.toMatchObject({ code: 'invalid_data' });
		expect(calls[0]).toEqual(['rpc', 'catalog_admin_upload_status', { p_batch_id: batchId }]);
		expect(calls[1]).toEqual([
			'rpc',
			'catalog_admin_list_upload_batches',
			{ p_limit: 10, p_before: null, p_before_id: null }
		]);
	});

	it('claims a job, keeping the lease out of the job object', async () => {
		const { calls, client } = fakeClient([
			{
				data: {
					ok: true,
					item: { ...jobRow, stage: 'claimed', attempts: 1, stored: true },
					lease: { token: 'l0000000-0000-4000-8000-000000000001', expires_at: now }
				},
				error: null
			},
			{ data: { ok: false, reason: 'none_pending' }, error: null }
		]);
		const catalog = catalogUsing(client);
		const claimed = await catalog.claimUploadJob(120);
		expect(claimed).toMatchObject({
			ok: true,
			item: { leaseToken: 'l0000000-0000-4000-8000-000000000001', job: { stage: 'claimed' } }
		});
		expect(JSON.stringify(claimed)).not.toContain('"lease_token"');
		expect(calls[0]).toEqual([
			'rpc',
			'catalog_admin_claim_upload_job',
			{ p_lease_seconds: 120, p_job_id: null }
		]);
		expect(await catalog.claimUploadJob()).toMatchObject({ reason: 'none_pending' });
	});

	it('sends a snake_case version report and parses the completion', async () => {
		const completedRow = {
			...jobRow,
			stage: 'ready',
			progress: 100,
			stored: true,
			version_id: report.versionId
		};
		const { calls, client } = fakeClient([
			{
				data: {
					ok: true,
					item: completedRow,
					version: { ...assetVersionRow, id: report.versionId }
				},
				error: null
			}
		]);
		const catalog = catalogUsing(client);
		const result = await catalog.completeUploadJob(jobRow.id, 'lease-token', report);
		expect(result).toMatchObject({
			ok: true,
			item: { job: { stage: 'ready' }, version: { id: report.versionId }, replayed: false }
		});
		expect(calls[0][0]).toBe('rpc');
		expect(calls[0][1]).toBe('catalog_admin_complete_upload_job');
		expect(calls[0][2]).toMatchObject({
			p_job_id: jobRow.id,
			p_lease_token: 'lease-token',
			p_report: {
				version_id: report.versionId,
				source_sha256: report.sourceSha256,
				derivative_path: report.derivativePath,
				derivative_mime: 'image/png',
				thumbnail_path: null,
				renderer: 'sharp'
			}
		});
	});

	it('uploads, downloads and removes objects in the fixed buckets only', async () => {
		const { calls, client } = fakeClient([
			{ data: { path: 'ok' }, error: null },
			{ data: { path: 'ok' }, error: null },
			{ data: new Blob([new Uint8Array([1, 2, 3])]), error: null },
			{ data: [], error: null }
		]);
		const catalog = catalogUsing(client);
		await catalog.uploadSource('b/j.png', new Blob([new Uint8Array(8)]), 'image/png');
		await catalog.uploadDerivative(
			'assets/a/v/asset.png',
			new Blob([new Uint8Array(4)]),
			'image/png'
		);
		const bytes = await catalog.downloadSource('b/j.png');
		expect([...bytes]).toEqual([1, 2, 3]);
		await catalog.removeObjects('catalog-sources', ['b/j.png']);
		expect(calls.map((call) => [call[0], call[1], call[2]])).toEqual([
			['upload', 'catalog-sources', 'b/j.png'],
			['upload', 'catalog-derivatives', 'assets/a/v/asset.png'],
			['download', 'catalog-sources', 'b/j.png'],
			['remove', 'catalog-sources', ['b/j.png']]
		]);
		const options = calls[0][4] as { contentType: string; upsert: boolean };
		expect(options).toEqual({ contentType: 'image/png', upsert: false });
	});

	it('reads the orphan listing and journals a cleanup', async () => {
		const { calls, client } = fakeClient([
			{
				data: {
					ok: true,
					item: {
						sources: [{ path: 'b/orphan.png', bytes: 12 }],
						derivatives: [],
						source_total: 1,
						derivative_total: 0,
						truncated: false
					}
				},
				error: null
			},
			{ data: { ok: true, item: { removed: 1 } }, error: null }
		]);
		const catalog = catalogUsing(client);
		const orphans = await catalog.listOrphanMedia(batchId);
		expect(orphans.sources).toEqual([{ path: 'b/orphan.png', bytes: 12 }]);
		expect(await catalog.recordUploadCleanup(batchId, ['b/orphan.png'])).toBe(1);
		expect(calls[0]).toEqual([
			'rpc',
			'catalog_admin_list_orphan_media',
			{ p_batch_id: batchId, p_limit: 200 }
		]);
		expect(calls[1]).toEqual([
			'rpc',
			'catalog_admin_record_upload_cleanup',
			{ p_batch_id: batchId, p_paths: ['b/orphan.png'] }
		]);
	});

	it('turns a permission failure on an upload RPC into a permission error', async () => {
		const { client } = fakeClient([
			{ data: null, error: { code: '42501', message: 'not an administrator' } }
		]);
		const catalog = catalogUsing(client);
		await expect(catalog.claimUploadJob()).rejects.toMatchObject({ code: 'permission' });
	});
});
