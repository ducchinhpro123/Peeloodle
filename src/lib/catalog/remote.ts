/**
 * Supabase adapter for the catalog contracts.
 *
 * Reads use PostgREST with explicit column lists (never `select *`, so a list
 * query cannot drag full template documents or validation payloads along) and
 * keyset pagination on `(sort_order, id)`. Writes call the guarded RPCs from
 * `supabase/migrations/20260916120200_catalog_admin_rpcs.sql`; a business
 * refusal comes back as a result object, while SQLSTATE 42501 becomes a
 * `CatalogError('permission')`.
 *
 * RLS is the real boundary: the `state = 'published'` filters here also keep a
 * misconfigured policy from leaking drafts, and the admin methods assume the UI
 * guard already ran (the server re-checks membership regardless).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/cloud/database';
import {
	CatalogError,
	CATALOG_MAX_PAGE_SIZE,
	catalogPageSize,
	decodeCatalogCursor,
	type CatalogActionResult,
	type CatalogAdminRepository,
	type CatalogAssetInput,
	type CatalogCollectionInput,
	type CatalogAssetVersionReport,
	type CatalogListFilters,
	type CatalogRepository,
	type CatalogTemplateDraftInput,
	type CatalogTemplateInput,
	type CatalogTemplateVersionInput,
	type CatalogUploadClaimResult,
	type CatalogUploadCompletionResult,
	type CatalogUploadRequest,
	decodeUploadCursor
} from './repository';
import type { ProcessingOutcome } from './processing/runJob';
import {
	parseActionResult,
	parseAsset,
	parseAssetVersion,
	parseCollection,
	parseDependency,
	parseOrphanMedia,
	parseTemplate,
	parseTemplateDraft,
	parseTemplateVersion,
	parseTemplateVersionSummary,
	parseUploadBatchSummary,
	readUploadBatchPage,
	parseUploadClaimResult,
	parseUploadCompletionResult,
	parseUploadJob,
	parseUploadStatus,
	takePage,
	unwrapRead
} from './parse';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogOrphanMedia,
	CatalogPage,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateVersion,
	CatalogTemplateVersionSummary,
	CatalogUploadBatchPage,
	CatalogUploadBatchSummary,
	CatalogUploadJob,
	CatalogUploadStatus
} from './types';

const BUCKET = 'catalog-derivatives';
const SOURCE_BUCKET = 'catalog-sources';
const UPLOAD_BATCH_PAGE = 10;

const COLLECTION_COLUMNS =
	'id,name,description,tags,sort_order,state,revision,published_at,archived_at,created_at,updated_at';
const ASSET_COLUMNS =
	'id,collection_id,name,description,tags,kind,provenance,sort_order,state,revision,published_version_id,published_at,archived_at,created_at,updated_at';
const ASSET_VERSION_COLUMNS =
	'id,asset_id,version_number,source_path,source_sha256,source_bytes,source_mime,derivative_path,derivative_sha256,derivative_bytes,derivative_mime,derivative_width,derivative_height,thumbnail_path,validation_state,created_at';
const TEMPLATE_COLUMNS =
	'id,title,use_case,description,tags,sort_order,state,revision,published_version_id,published_at,archived_at,created_at,updated_at';
const TEMPLATE_VERSION_COLUMNS =
	'id,template_id,version_number,document,document_sha256,document_bytes,cover_path,cover_sha256,slide_previews,font_requirements,validation_state,validation,created_at';
const TEMPLATE_VERSION_SUMMARY_COLUMNS =
	'id,template_id,version_number,document_sha256,document_bytes,cover_path,cover_sha256,slide_previews,font_requirements,validation_state,validation,created_at';

/** PostgREST's `or` grammar treats these as syntax; free text never needs them. */
function searchTerm(query: string): string {
	return query
		.trim()
		.slice(0, 100)
		.replace(/[%_,()]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Keyset position for the current ordering, as a PostgREST `or` expression. */
function cursorFilter(filters: CatalogListFilters): string | null {
	if (!filters.cursor) return null;
	const cursor = decodeCatalogCursor(filters.cursor);
	return `sort_order.gt.${cursor.sortOrder},and(sort_order.eq.${cursor.sortOrder},id.gt.${cursor.id})`;
}

export class SupabaseCatalog implements CatalogRepository, CatalogAdminRepository {
	#client: SupabaseClient<Database>;

	constructor(client: SupabaseClient<Database>) {
		this.#client = client;
	}

	#fail(error: { code?: string; message: string } | null, what: string): never {
		if (error?.code === '42501') throw new CatalogError('permission', `${what}: ${error.message}`);
		if (error?.code === 'PGRST116') throw new CatalogError('not_found', what);
		throw new CatalogError('unavailable', `${what}: ${error?.message ?? 'unknown error'}`, error);
	}

	#action<T>(
		rpc: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
		what: string,
		parseItem: (item: unknown) => T
	): Promise<CatalogActionResult<T>> {
		return Promise.resolve(rpc).then(({ data, error }) => {
			if (error) this.#fail(error, what);
			return parseActionResult(data, parseItem);
		});
	}

	async listCollections(filters: CatalogListFilters = {}): Promise<CatalogPage<CatalogCollection>> {
		const limit = catalogPageSize(filters.limit);
		const term = filters.query ? searchTerm(filters.query) : '';
		let query = this.#client
			.from('catalog_collections')
			.select(COLLECTION_COLUMNS)
			.eq('state', 'published');
		if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
		const cursor = cursorFilter(filters);
		if (cursor) query = query.or(cursor);
		const { data, error } = await query
			.order('sort_order')
			.order('id')
			.limit(limit + 1);
		if (error) this.#fail(error, 'Could not list collections');
		return takePage((data ?? []).map(parseCollection), limit);
	}

	async getCollection(id: string): Promise<CatalogCollection> {
		const { data, error } = await this.#client
			.from('catalog_collections')
			.select(COLLECTION_COLUMNS)
			.eq('id', id)
			.eq('state', 'published')
			.single();
		if (error) this.#fail(error, 'Collection not found');
		return parseCollection(data);
	}

	async listAssets(filters: CatalogListFilters = {}): Promise<CatalogPage<CatalogAsset>> {
		const limit = catalogPageSize(filters.limit);
		const term = filters.query ? searchTerm(filters.query) : '';
		let query = this.#client.from('catalog_assets').select(ASSET_COLUMNS).eq('state', 'published');
		if (filters.collectionId) query = query.eq('collection_id', filters.collectionId);
		if (filters.kind) query = query.eq('kind', filters.kind);
		if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
		const cursor = cursorFilter(filters);
		if (cursor) query = query.or(cursor);
		const { data, error } = await query
			.order('sort_order')
			.order('id')
			.limit(limit + 1);
		if (error) this.#fail(error, 'Could not list assets');
		return takePage((data ?? []).map(parseAsset), limit);
	}

	async getAsset(id: string): Promise<CatalogAsset> {
		const { data, error } = await this.#client
			.from('catalog_assets')
			.select(ASSET_COLUMNS)
			.eq('id', id)
			.eq('state', 'published')
			.single();
		if (error) this.#fail(error, 'Asset not found');
		return parseAsset(data);
	}

	async getPublishedVersion(assetId: string): Promise<CatalogAssetVersion> {
		const asset = await this.getAsset(assetId);
		if (!asset.publishedVersionId)
			throw new CatalogError('missing_media', 'Asset has no published artwork');
		const { data, error } = await this.#client
			.from('catalog_asset_versions')
			.select(ASSET_VERSION_COLUMNS)
			.eq('id', asset.publishedVersionId)
			.eq('asset_id', asset.id)
			.single();
		if (error) this.#fail(error, 'Published artwork is missing');
		return parseAssetVersion(data);
	}

	async listTemplates(filters: CatalogListFilters = {}): Promise<CatalogPage<CatalogTemplate>> {
		const limit = catalogPageSize(filters.limit);
		const term = filters.query ? searchTerm(filters.query) : '';
		let query = this.#client
			.from('catalog_templates')
			.select(TEMPLATE_COLUMNS)
			.eq('state', 'published');
		if (filters.useCase) query = query.eq('use_case', filters.useCase);
		if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
		const cursor = cursorFilter(filters);
		if (cursor) query = query.or(cursor);
		const { data, error } = await query
			.order('sort_order')
			.order('id')
			.limit(limit + 1);
		if (error) this.#fail(error, 'Could not list templates');
		return takePage((data ?? []).map(parseTemplate), limit);
	}

	async getTemplate(id: string): Promise<CatalogTemplate> {
		const { data, error } = await this.#client
			.from('catalog_templates')
			.select(TEMPLATE_COLUMNS)
			.eq('id', id)
			.eq('state', 'published')
			.single();
		if (error) this.#fail(error, 'Template not found');
		return parseTemplate(data);
	}

	async getTemplateVersion(templateId: string): Promise<CatalogTemplateVersion> {
		const template = await this.getTemplate(templateId);
		const { data, error } = await this.#client
			.from('catalog_template_versions')
			.select(TEMPLATE_VERSION_COLUMNS)
			.eq('id', template.publishedVersionId ?? '')
			.eq('template_id', template.id)
			.single();
		if (error) this.#fail(error, 'Template preview is missing');
		return parseTemplateVersion(data);
	}

	async getDependencies(versionId: string): Promise<CatalogTemplateDependency[]> {
		const { data, error } = await this.#client
			.from('catalog_template_dependencies')
			.select('template_version_id,asset_id,asset_version_id')
			.eq('template_version_id', versionId);
		if (error) this.#fail(error, 'Could not list template dependencies');
		return (data ?? []).map(parseDependency);
	}

	async signedDerivativeUrl(path: string, expiresInSeconds = 60): Promise<string> {
		const { data, error } = await this.#client.storage
			.from(BUCKET)
			.createSignedUrl(path, expiresInSeconds);
		if (error || !data?.signedUrl)
			throw new CatalogError('missing_media', `No readable derivative for ${path}`, error);
		return data.signedUrl;
	}

	async isAdmin(): Promise<boolean> {
		const { data, error } = await this.#client.rpc('catalog_is_admin');
		if (error) this.#fail(error, 'Could not check catalog membership');
		return data === true;
	}

	async listCollectionsForAdmin(
		filters: CatalogListFilters = {}
	): Promise<CatalogPage<CatalogCollection>> {
		const limit = catalogPageSize(filters.limit);
		const term = filters.query ? searchTerm(filters.query) : '';
		let query = this.#client.from('catalog_collections').select(COLLECTION_COLUMNS);
		if (filters.state) query = query.eq('state', filters.state);
		if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
		const cursor = cursorFilter(filters);
		if (cursor) query = query.or(cursor);
		const { data, error } = await query
			.order('sort_order')
			.order('id')
			.limit(limit + 1);
		if (error) this.#fail(error, 'Could not list catalog collections');
		return takePage((data ?? []).map(parseCollection), limit);
	}

	async getLatestVersion(assetId: string): Promise<CatalogAssetVersion | null> {
		const { data, error } = await this.#client
			.from('catalog_asset_versions')
			.select(ASSET_VERSION_COLUMNS)
			.eq('asset_id', assetId)
			.order('version_number', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) this.#fail(error, 'Could not read the asset version');
		return data === null || data === undefined ? null : parseAssetVersion(data);
	}

	async getAssetVersion(assetId: string, versionId: string): Promise<CatalogAssetVersion> {
		const { data, error } = await this.#client
			.from('catalog_asset_versions')
			.select(ASSET_VERSION_COLUMNS)
			.eq('id', versionId)
			.eq('asset_id', assetId)
			.single();
		if (error) this.#fail(error, 'Asset version not found');
		return parseAssetVersion(data);
	}

	async listAssetsForAdmin(filters: CatalogListFilters = {}): Promise<CatalogPage<CatalogAsset>> {
		const limit = catalogPageSize(filters.limit);
		const term = filters.query ? searchTerm(filters.query) : '';
		let query = this.#client.from('catalog_assets').select(ASSET_COLUMNS);
		if (filters.state) query = query.eq('state', filters.state);
		if (filters.collectionId) query = query.eq('collection_id', filters.collectionId);
		if (filters.kind) query = query.eq('kind', filters.kind);
		if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
		const cursor = cursorFilter(filters);
		if (cursor) query = query.or(cursor);
		const { data, error } = await query
			.order('sort_order')
			.order('id')
			.limit(limit + 1);
		if (error) this.#fail(error, 'Could not list catalog assets');
		return takePage((data ?? []).map(parseAsset), limit);
	}

	async listTemplatesForAdmin(
		filters: CatalogListFilters = {}
	): Promise<CatalogPage<CatalogTemplate>> {
		const limit = catalogPageSize(filters.limit);
		const term = filters.query ? searchTerm(filters.query) : '';
		let query = this.#client.from('catalog_templates').select(TEMPLATE_COLUMNS);
		if (filters.state) query = query.eq('state', filters.state);
		if (filters.useCase) query = query.eq('use_case', filters.useCase);
		if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
		const cursor = cursorFilter(filters);
		if (cursor) query = query.or(cursor);
		const { data, error } = await query
			.order('sort_order')
			.order('id')
			.limit(limit + 1);
		if (error) this.#fail(error, 'Could not list catalog templates');
		return takePage((data ?? []).map(parseTemplate), limit);
	}

	async getTemplateForAdmin(id: string): Promise<CatalogTemplate> {
		const { data, error } = await this.#client
			.from('catalog_templates')
			.select(TEMPLATE_COLUMNS)
			.eq('id', id)
			.single();
		if (error) this.#fail(error, 'Template not found');
		return parseTemplate(data);
	}

	async listTemplateVersionsForAdmin(
		templateId: string,
		options: { limit?: number } = {}
	): Promise<CatalogTemplateVersionSummary[]> {
		const limit = Math.min(options.limit ?? 50, CATALOG_MAX_PAGE_SIZE);
		const { data, error } = await this.#client
			.from('catalog_template_versions')
			.select(TEMPLATE_VERSION_SUMMARY_COLUMNS)
			.eq('template_id', templateId)
			.order('version_number', { ascending: false })
			.limit(limit);
		if (error) this.#fail(error, 'Could not list template versions');
		return (data ?? []).map(parseTemplateVersionSummary);
	}

	async getLatestTemplateVersionForAdmin(
		templateId: string
	): Promise<CatalogTemplateVersion | null> {
		const { data, error } = await this.#client
			.from('catalog_template_versions')
			.select(TEMPLATE_VERSION_COLUMNS)
			.eq('template_id', templateId)
			.order('version_number', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) this.#fail(error, 'Could not read the template version');
		return data === null || data === undefined ? null : parseTemplateVersion(data);
	}

	createCollection(input: CatalogCollectionInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_create_collection', {
				name: input.name,
				description: input.description,
				tags: input.tags,
				sort_order: input.sortOrder
			}),
			'Could not create the collection',
			parseCollection
		);
	}

	updateCollection(id: string, expectedRevision: number, input: CatalogCollectionInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_update_collection', {
				id,
				expected_revision: expectedRevision,
				name: input.name,
				description: input.description,
				tags: input.tags,
				sort_order: input.sortOrder
			}),
			'Could not update the collection',
			parseCollection
		);
	}

	publishCollection(id: string, expectedRevision: number) {
		return this.#action(
			this.#client.rpc('catalog_admin_publish_collection', {
				id,
				expected_revision: expectedRevision
			}),
			'Could not publish the collection',
			parseCollection
		);
	}

	archiveCollection(id: string, expectedRevision: number, archiveItems: boolean) {
		return this.#action(
			this.#client.rpc('catalog_admin_archive_collection', {
				id,
				expected_revision: expectedRevision,
				archive_items: archiveItems
			}),
			'Could not archive the collection',
			parseCollection
		);
	}

	createAsset(input: CatalogAssetInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_create_asset', {
				collection_id: input.collectionId,
				name: input.name,
				kind: input.kind,
				description: input.description,
				tags: input.tags,
				// The RPC stores this as jsonb; the UI supplies plain metadata.
				provenance: input.provenance as Json,
				sort_order: input.sortOrder
			}),
			'Could not create the asset',
			parseAsset
		);
	}

	updateAsset(id: string, expectedRevision: number, input: CatalogAssetInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_update_asset', {
				id,
				expected_revision: expectedRevision,
				name: input.name,
				description: input.description,
				tags: input.tags,
				collection_id: input.collectionId,
				sort_order: input.sortOrder
			}),
			'Could not update the asset',
			parseAsset
		);
	}

	publishAsset(id: string, versionId: string, expectedRevision: number) {
		return this.#action(
			this.#client.rpc('catalog_admin_publish_asset', {
				id,
				version_id: versionId,
				expected_revision: expectedRevision
			}),
			'Could not publish the asset',
			parseAsset
		);
	}

	archiveAsset(id: string, expectedRevision: number) {
		return this.#action(
			this.#client.rpc('catalog_admin_archive_asset', { id, expected_revision: expectedRevision }),
			'Could not archive the asset',
			parseAsset
		);
	}

	createTemplate(input: CatalogTemplateInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_create_template', {
				title: input.title,
				use_case: input.useCase,
				description: input.description,
				tags: input.tags,
				sort_order: input.sortOrder
			}),
			'Could not create the template',
			parseTemplate
		);
	}

	updateTemplate(id: string, expectedRevision: number, input: CatalogTemplateInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_update_template', {
				id,
				expected_revision: expectedRevision,
				title: input.title,
				use_case: input.useCase,
				description: input.description,
				tags: input.tags,
				sort_order: input.sortOrder
			}),
			'Could not update the template',
			parseTemplate
		);
	}

	publishTemplate(id: string, versionId: string, expectedRevision: number) {
		return this.#action(
			this.#client.rpc('catalog_admin_publish_template', {
				id,
				version_id: versionId,
				expected_revision: expectedRevision
			}),
			'Could not publish the template',
			parseTemplate
		);
	}

	archiveTemplate(id: string, expectedRevision: number) {
		return this.#action(
			this.#client.rpc('catalog_admin_archive_template', {
				id,
				expected_revision: expectedRevision
			}),
			'Could not archive the template',
			parseTemplate
		);
	}

	/**
	 * One atomic draft creation. The document is the cloned presentation snapshot;
	 * the server re-derives every dependency from it and refuses the draft unless
	 * each pinned version is validated and matches the document's asset metadata.
	 */
	createTemplateDraft(input: CatalogTemplateDraftInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_create_template_draft', {
				p_title: input.metadata.title,
				p_use_case: input.metadata.useCase,
				p_document: input.document as Json,
				p_document_sha256: input.documentSha256,
				p_document_bytes: input.documentBytes,
				p_description: input.metadata.description,
				p_tags: input.metadata.tags,
				p_sort_order: input.metadata.sortOrder,
				p_font_requirements: input.fontRequirements as Json
			}),
			'Could not create the template draft',
			parseTemplateDraft
		);
	}

	/**
	 * The next immutable version of an existing template. `expected_revision` is
	 * the stable template revision the editor read; a stale one is a business
	 * refusal (`revision_conflict`) that carries the current template row.
	 */
	saveTemplateVersion(input: CatalogTemplateVersionInput) {
		return this.#action(
			this.#client.rpc('catalog_admin_save_template_version', {
				p_template_id: input.templateId,
				p_expected_revision: input.expectedRevision,
				p_document: input.document as Json,
				p_document_sha256: input.documentSha256,
				p_document_bytes: input.documentBytes,
				p_font_requirements: input.fontRequirements as Json
			}),
			'Could not save the template version',
			parseTemplateDraft
		);
	}

	// ---------------------------------------------------------------------
	// P54/P55/P61: the upload lifecycle. Every mutation is an RPC; the Storage
	// calls go to the fixed private buckets, and the server re-checks the lease
	// and the objects before a version exists.
	// ---------------------------------------------------------------------

	createUploadBatch(request: CatalogUploadRequest) {
		return this.#action(
			this.#client.rpc('catalog_admin_create_upload_batch', {
				p_collection_id: request.collectionId,
				p_files: request.files.map((file) => ({
					name: file.name,
					mime: file.mime,
					bytes: file.bytes
				}))
			}),
			'Could not create the upload batch',
			parseUploadStatus
		);
	}

	async uploadStatus(batchId: string): Promise<CatalogUploadStatus> {
		const { data, error } = await this.#client.rpc('catalog_admin_upload_status', {
			p_batch_id: batchId
		});
		if (error) this.#fail(error, 'Could not read the upload batch');
		return unwrapRead(data, 'upload status', parseUploadStatus);
	}

	async listUploadBatches(cursor?: string | null): Promise<CatalogUploadBatchPage> {
		const position = cursor ? decodeUploadCursor(cursor) : null;
		const { data, error } = await this.#client.rpc('catalog_admin_list_upload_batches', {
			p_limit: UPLOAD_BATCH_PAGE,
			p_before: position?.createdAt ?? null,
			p_before_id: position?.id ?? null
		});
		if (error) this.#fail(error, 'Could not list the upload batches');
		return readUploadBatchPage(data);
	}

	async claimUploadJob(leaseSeconds = 300, jobId?: string): Promise<CatalogUploadClaimResult> {
		const { data, error } = await this.#client.rpc('catalog_admin_claim_upload_job', {
			p_lease_seconds: leaseSeconds,
			p_job_id: jobId ?? null
		});
		if (error) this.#fail(error, 'Could not claim an upload job');
		return parseUploadClaimResult(data);
	}

	/**
	 * Processing runs in the app's own server function (see
	 * `src/routes/api/catalog/process/+server.js`): the browser never decodes the
	 * source, and the lease it holds is the only way to finalize. Without a server
	 * deployment the endpoint is absent, which is reported as `unavailable`
	 * instead of pretending a version was validated.
	 */
	async processUploadJob(jobId: string): Promise<ProcessingOutcome> {
		const session = await this.#client.auth.getSession();
		const token = session.data.session?.access_token;
		if (!token)
			throw new CatalogError('permission', 'Sign in as a catalog administrator to process uploads');
		let response: Response;
		try {
			response = await fetch('/api/catalog/process', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
				body: JSON.stringify({ jobId })
			});
		} catch (cause) {
			throw new CatalogError('unavailable', 'The processing endpoint could not be reached', cause);
		}
		const payload = (await response.json().catch(() => null)) as ProcessingOutcome | null;
		if (response.ok && payload) return payload;
		if (response.status === 409 && payload) return payload;
		if (response.status === 401 || response.status === 403)
			throw new CatalogError('permission', 'Catalog administrator membership is required');
		if (response.status === 404 || response.status === 503)
			throw new CatalogError(
				'unavailable',
				'This site has no processing endpoint, so uploads cannot be validated'
			);
		throw new CatalogError('invalid_data', `The processing endpoint failed (${response.status})`);
	}

	async completeUploadJob(
		jobId: string,
		leaseToken: string,
		report: CatalogAssetVersionReport
	): Promise<CatalogUploadCompletionResult> {
		const { data, error } = await this.#client.rpc('catalog_admin_complete_upload_job', {
			p_job_id: jobId,
			p_lease_token: leaseToken,
			p_report: {
				version_id: report.versionId,
				source_sha256: report.sourceSha256,
				source_bytes: report.sourceBytes,
				source_mime: report.sourceMime,
				derivative_path: report.derivativePath,
				derivative_sha256: report.derivativeSha256,
				derivative_bytes: report.derivativeBytes,
				derivative_mime: report.derivativeMime,
				derivative_width: report.derivativeWidth,
				derivative_height: report.derivativeHeight,
				thumbnail_path: report.thumbnailPath,
				thumbnail_sha256: report.thumbnailSha256,
				thumbnail_bytes: report.thumbnailBytes,
				renderer: report.renderer,
				validation: report.validation as Json
			}
		});
		if (error) this.#fail(error, 'Could not finalize the upload job');
		return parseUploadCompletionResult(data);
	}

	async failUploadJob(
		jobId: string,
		leaseToken: string,
		error: { code: string; message: string }
	): Promise<CatalogActionResult<CatalogUploadJob>> {
		const { data, error: rpcError } = await this.#client.rpc('catalog_admin_fail_upload_job', {
			p_job_id: jobId,
			p_lease_token: leaseToken,
			p_error_code: error.code,
			p_error_message: error.message
		});
		if (rpcError) this.#fail(rpcError, 'Could not record the upload failure');
		return parseActionResult(data, parseUploadJob);
	}

	async retryUploadJob(jobId: string): Promise<CatalogActionResult<CatalogUploadJob>> {
		const { data, error } = await this.#client.rpc('catalog_admin_retry_upload_job', {
			p_job_id: jobId
		});
		if (error) this.#fail(error, 'Could not retry the upload job');
		return parseActionResult(data, parseUploadJob);
	}

	cancelUploadBatch(batchId: string) {
		return this.#action(
			this.#client.rpc('catalog_admin_cancel_upload_batch', { p_batch_id: batchId }),
			'Could not cancel the upload batch',
			parseUploadStatus
		);
	}

	async closeUploadBatch(batchId: string): Promise<CatalogActionResult<CatalogUploadBatchSummary>> {
		const { data, error } = await this.#client.rpc('catalog_admin_close_upload_batch', {
			p_batch_id: batchId
		});
		if (error) this.#fail(error, 'Could not close the upload batch');
		return parseActionResult(data, parseUploadBatchSummary);
	}

	async listOrphanMedia(batchId: string): Promise<CatalogOrphanMedia> {
		const { data, error } = await this.#client.rpc('catalog_admin_list_orphan_media', {
			p_batch_id: batchId,
			p_limit: 200
		});
		if (error) this.#fail(error, 'Could not list abandoned uploads');
		return unwrapRead(data, 'orphan media', parseOrphanMedia);
	}

	async recordUploadCleanup(batchId: string, paths: string[]): Promise<number> {
		const { data, error } = await this.#client.rpc('catalog_admin_record_upload_cleanup', {
			p_batch_id: batchId,
			p_paths: paths
		});
		if (error) this.#fail(error, 'Could not record the cleanup');
		return unwrapRead(data, 'cleanup record', (item) => {
			if (!item || typeof item !== 'object')
				throw new CatalogError('invalid_data', 'Invalid cleanup result');
			const removed = (item as { removed?: unknown }).removed;
			if (typeof removed !== 'number')
				throw new CatalogError('invalid_data', 'Invalid cleanup result');
			return removed;
		});
	}

	async uploadSource(path: string, file: Blob, mime: string): Promise<void> {
		const { error } = await this.#client.storage
			.from(SOURCE_BUCKET)
			.upload(path, file, { contentType: mime, upsert: false });
		if (error) this.#fail(error, 'Could not upload the source file');
	}

	async uploadDerivative(
		path: string,
		bytes: Blob,
		mime: 'image/png' | 'image/webp'
	): Promise<void> {
		const { error } = await this.#client.storage
			.from(BUCKET)
			.upload(path, bytes, { contentType: mime, upsert: false });
		if (error) this.#fail(error, 'Could not upload the derivative');
	}

	async downloadSource(path: string): Promise<Uint8Array> {
		const { data, error } = await this.#client.storage.from(SOURCE_BUCKET).download(path);
		if (error) this.#fail(error, 'Could not download the source file');
		return new Uint8Array(await data.arrayBuffer());
	}

	async removeObjects(
		bucket: 'catalog-sources' | 'catalog-derivatives',
		paths: string[]
	): Promise<void> {
		const { error } = await this.#client.storage.from(bucket).remove(paths);
		if (error) this.#fail(error, 'Could not remove the objects');
	}
}
