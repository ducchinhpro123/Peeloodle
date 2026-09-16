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
	catalogPageSize,
	decodeCatalogCursor,
	type CatalogActionResult,
	type CatalogAdminRepository,
	type CatalogAssetInput,
	type CatalogCollectionInput,
	type CatalogListFilters,
	type CatalogRepository,
	type CatalogTemplateInput
} from './repository';
import {
	parseActionResult,
	parseAsset,
	parseAssetVersion,
	parseCollection,
	parseDependency,
	parseTemplate,
	parseTemplateVersion,
	takePage
} from './parse';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogPage,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateVersion
} from './types';

const BUCKET = 'catalog-derivatives';

const COLLECTION_COLUMNS =
	'id,name,description,tags,sort_order,state,revision,published_at,archived_at,created_at,updated_at';
const ASSET_COLUMNS =
	'id,collection_id,name,description,tags,kind,provenance,sort_order,state,revision,published_version_id,published_at,archived_at,created_at,updated_at';
const ASSET_VERSION_COLUMNS =
	'id,asset_id,version_number,source_path,source_sha256,source_bytes,source_mime,derivative_path,derivative_sha256,derivative_bytes,derivative_mime,derivative_width,derivative_height,thumbnail_path,validation_state,created_at';
const TEMPLATE_COLUMNS =
	'id,title,use_case,description,tags,sort_order,state,revision,published_version_id,published_at,archived_at,created_at,updated_at';
const TEMPLATE_VERSION_COLUMNS =
	'id,template_id,version_number,cover_path,slide_previews,validation_state,created_at';

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
			.select(`${TEMPLATE_VERSION_COLUMNS},document`)
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

	async listAssetsForAdmin(filters: CatalogListFilters = {}): Promise<CatalogPage<CatalogAsset>> {
		const limit = catalogPageSize(filters.limit);
		const term = filters.query ? searchTerm(filters.query) : '';
		let query = this.#client.from('catalog_assets').select(ASSET_COLUMNS);
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
}
