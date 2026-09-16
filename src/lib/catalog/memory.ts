/**
 * In-memory catalog repository with the same semantics as the guarded SQL:
 * published-only public reads, keyset paging, compare-and-set revisions and the
 * publish/archive refusals (draft collection, unvalidated version, pinned
 * template dependency, contained items). Tests and browser component contracts
 * drive the real components against this; the Supabase adapter implements the
 * same interface over PostgREST and the RPCs.
 */
import {
	CatalogError,
	catalogPageSize,
	decodeCatalogCursor,
	type CatalogActionResult,
	type CatalogAdminRepository,
	type CatalogAssetInput,
	type CatalogCollectionInput,
	type CatalogListFilters,
	type CatalogRefusal,
	type CatalogRepository,
	type CatalogTemplateInput
} from './repository';
import { takePage } from './parse';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogPage,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateVersion
} from './types';

export type CatalogSeed = {
	collections?: CatalogCollection[];
	assets?: CatalogAsset[];
	versions?: CatalogAssetVersion[];
	templates?: CatalogTemplate[];
	templateVersions?: CatalogTemplateVersion[];
	dependencies?: CatalogTemplateDependency[];
	admins?: string[];
	derivativeUrls?: Map<string, string>;
};

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

export class MemoryCatalog implements CatalogRepository, CatalogAdminRepository {
	collections: CatalogCollection[];
	assets: CatalogAsset[];
	versions: CatalogAssetVersion[];
	templates: CatalogTemplate[];
	templateVersions: CatalogTemplateVersion[];
	dependencies: CatalogTemplateDependency[];
	admins: Set<string>;
	derivativeUrls: Map<string, string>;
	actorId: string | null;

	constructor(seed: CatalogSeed = {}, actorId: string | null = null) {
		this.collections = seed.collections ?? [];
		this.assets = seed.assets ?? [];
		this.versions = seed.versions ?? [];
		this.templates = seed.templates ?? [];
		this.templateVersions = seed.templateVersions ?? [];
		this.dependencies = seed.dependencies ?? [];
		this.admins = new Set(seed.admins ?? []);
		this.derivativeUrls = seed.derivativeUrls ?? new Map();
		this.actorId = actorId;
	}

	#assertAdmin(): string {
		if (!this.actorId) throw new CatalogError('permission', 'Authentication required');
		if (!this.admins.has(this.actorId))
			throw new CatalogError('permission', 'Catalog administrator membership required');
		return this.actorId;
	}

	#page<T extends { sortOrder: number; id: string }>(
		rows: T[],
		filters: CatalogListFilters | undefined,
		matches: (row: T) => boolean
	): CatalogPage<T> {
		const limit = catalogPageSize(filters?.limit);
		const cursor = filters?.cursor ? decodeCatalogCursor(filters.cursor) : null;
		const after = cursor
			? (row: T) =>
					row.sortOrder > cursor.sortOrder ||
					(row.sortOrder === cursor.sortOrder && row.id > cursor.id)
			: () => true;
		const ordered = rows
			.filter((row) => matches(row) && after(row))
			.sort((left, right) => left.sortOrder - right.sortOrder || (left.id < right.id ? -1 : 1));
		return takePage(ordered.slice(0, limit + 1), limit);
	}

	#findCollection(id: string): CatalogCollection | null {
		return this.collections.find((row) => row.id === id) ?? null;
	}

	#findAsset(id: string): CatalogAsset | null {
		return this.assets.find((row) => row.id === id) ?? null;
	}

	#publishedAsset(id: string): CatalogAsset {
		const asset = this.#findAsset(id);
		if (!asset || asset.state !== 'published')
			throw new CatalogError('not_found', 'Asset not found');
		return asset;
	}

	#refusal<T>(
		reason: CatalogRefusal,
		detail: Record<string, unknown> = {}
	): CatalogActionResult<T> {
		return { ok: false, reason, detail };
	}

	#text(row: { name?: string; title?: string; description: string }, query: string): boolean {
		const haystack = `${row.name ?? row.title ?? ''} ${row.description}`.toLowerCase();
		return haystack.includes(query.toLowerCase());
	}

	async listCollections(filters?: CatalogListFilters): Promise<CatalogPage<CatalogCollection>> {
		return this.#page(
			this.collections,
			filters,
			(row) => row.state === 'published' && (!filters?.query || this.#text(row, filters.query))
		);
	}

	async getCollection(id: string): Promise<CatalogCollection> {
		const row = this.#findCollection(id);
		if (!row || row.state !== 'published')
			throw new CatalogError('not_found', 'Collection not found');
		return row;
	}

	async listAssets(filters?: CatalogListFilters): Promise<CatalogPage<CatalogAsset>> {
		return this.#page(
			this.assets,
			filters,
			(row) =>
				row.state === 'published' &&
				(!filters?.collectionId || row.collectionId === filters.collectionId) &&
				(!filters?.kind || row.kind === filters.kind) &&
				(!filters?.query || this.#text(row, filters.query))
		);
	}

	async getAsset(id: string): Promise<CatalogAsset> {
		return this.#publishedAsset(id);
	}

	async getPublishedVersion(assetId: string): Promise<CatalogAssetVersion> {
		const asset = this.#publishedAsset(assetId);
		const version = this.versions.find((row) => row.id === asset.publishedVersionId);
		if (!version) throw new CatalogError('missing_media', 'Published artwork is missing');
		return version;
	}

	async listTemplates(filters?: CatalogListFilters): Promise<CatalogPage<CatalogTemplate>> {
		return this.#page(
			this.templates,
			filters,
			(row) =>
				row.state === 'published' &&
				(!filters?.useCase || row.useCase === filters.useCase) &&
				(!filters?.query || this.#text(row, filters.query))
		);
	}

	async getTemplate(id: string): Promise<CatalogTemplate> {
		const row = this.templates.find((candidate) => candidate.id === id);
		if (!row || row.state !== 'published')
			throw new CatalogError('not_found', 'Template not found');
		return row;
	}

	async getTemplateVersion(templateId: string): Promise<CatalogTemplateVersion> {
		const template = await this.getTemplate(templateId);
		const version = this.templateVersions.find((row) => row.id === template.publishedVersionId);
		if (!version) throw new CatalogError('missing_media', 'Template preview is missing');
		return version;
	}

	async getDependencies(versionId: string): Promise<CatalogTemplateDependency[]> {
		return this.dependencies.filter((row) => row.templateVersionId === versionId);
	}

	async signedDerivativeUrl(path: string, _expiresInSeconds = 60): Promise<string> {
		const url = this.derivativeUrls.get(path);
		if (!url) throw new CatalogError('missing_media', `No stored derivative for ${path}`);
		return url;
	}

	// ---- admin ----

	async isAdmin(): Promise<boolean> {
		return this.actorId !== null && this.admins.has(this.actorId);
	}

	async listCollectionsForAdmin(
		filters?: CatalogListFilters
	): Promise<CatalogPage<CatalogCollection>>;
	async listCollectionsForAdmin(
		filters?: CatalogListFilters
	): Promise<CatalogPage<CatalogCollection>> {
		this.#assertAdmin();
		return this.#page(
			this.collections,
			filters,
			(row) => !filters?.query || this.#text(row, filters.query)
		);
	}

	async createCollection(
		input: CatalogCollectionInput
	): Promise<CatalogActionResult<CatalogCollection>> {
		this.#assertAdmin();
		const item: CatalogCollection = {
			id: uuid(),
			name: input.name,
			description: input.description,
			tags: [...input.tags],
			sortOrder: input.sortOrder,
			state: 'draft',
			revision: 1,
			publishedAt: null,
			archivedAt: null,
			createdAt: now(),
			updatedAt: now()
		};
		this.collections.push(item);
		return { ok: true, item };
	}

	async updateCollection(
		id: string,
		expectedRevision: number,
		input: CatalogCollectionInput
	): Promise<CatalogActionResult<CatalogCollection>> {
		this.#assertAdmin();
		const current = this.#findCollection(id);
		if (!current) return this.#refusal('not_found');
		if (current.state === 'archived') return this.#refusal('archived', { item: current });
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		Object.assign(current, {
			name: input.name,
			description: input.description,
			tags: [...input.tags],
			sortOrder: input.sortOrder,
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	async publishCollection(
		id: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogCollection>> {
		this.#assertAdmin();
		const current = this.#findCollection(id);
		if (!current) return this.#refusal('not_found');
		if (current.state === 'archived') return this.#refusal('archived', { item: current });
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		Object.assign(current, {
			state: 'published',
			publishedAt: current.publishedAt ?? now(),
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	async archiveCollection(
		id: string,
		expectedRevision: number,
		archiveItems: boolean
	): Promise<CatalogActionResult<CatalogCollection>> {
		this.#assertAdmin();
		const current = this.#findCollection(id);
		if (!current) return this.#refusal('not_found');
		if (current.state === 'archived') return { ok: true, item: { ...current } };
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		const contained = this.assets.filter(
			(row) => row.collectionId === id && row.state !== 'archived'
		);
		if (contained.length > 0 && !archiveItems)
			return this.#refusal('contains_items', { count: contained.length });
		const pinned = this.#pinnedTemplates(contained);
		if (pinned.length > 0) return this.#refusal('pinned_by_template', { templates: pinned });
		for (const asset of contained) {
			asset.state = 'archived';
			asset.archivedAt = now();
			asset.revision += 1;
			asset.updatedAt = now();
		}
		Object.assign(current, {
			state: 'archived',
			archivedAt: now(),
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	/** Published templates whose published version pins an asset version in `assets`. */
	#pinnedTemplates(assets: CatalogAsset[]): { id: string; title: string }[] {
		const versions = new Set(
			assets
				.map((asset) => asset.publishedVersionId)
				.filter((versionId): versionId is string => versionId !== null)
		);
		const pinned: { id: string; title: string }[] = [];
		for (const template of this.templates) {
			if (template.state !== 'published' || !template.publishedVersionId) continue;
			const hit = this.dependencies.some(
				(dependency) =>
					dependency.templateVersionId === template.publishedVersionId &&
					versions.has(dependency.assetVersionId)
			);
			if (hit) pinned.push({ id: template.id, title: template.title });
		}
		return pinned;
	}

	async listAssetsForAdmin(filters?: CatalogListFilters): Promise<CatalogPage<CatalogAsset>>;
	async listAssetsForAdmin(filters?: CatalogListFilters): Promise<CatalogPage<CatalogAsset>> {
		this.#assertAdmin();
		return this.#page(
			this.assets,
			filters,
			(row) =>
				(!filters?.collectionId || row.collectionId === filters.collectionId) &&
				(!filters?.kind || row.kind === filters.kind) &&
				(!filters?.query || this.#text(row, filters.query))
		);
	}

	async createAsset(input: CatalogAssetInput): Promise<CatalogActionResult<CatalogAsset>> {
		this.#assertAdmin();
		if (input.collectionId) {
			const collection = this.#findCollection(input.collectionId);
			if (!collection) return this.#refusal('not_found');
			if (collection.state === 'archived') return this.#refusal('collection_archived');
		}
		const item: CatalogAsset = {
			id: uuid(),
			collectionId: input.collectionId,
			name: input.name,
			description: input.description,
			tags: [...input.tags],
			kind: input.kind,
			provenance: { ...input.provenance },
			sortOrder: input.sortOrder,
			state: 'draft',
			revision: 1,
			publishedVersionId: null,
			publishedAt: null,
			archivedAt: null,
			createdAt: now(),
			updatedAt: now()
		};
		this.assets.push(item);
		return { ok: true, item };
	}

	async updateAsset(
		id: string,
		expectedRevision: number,
		input: CatalogAssetInput
	): Promise<CatalogActionResult<CatalogAsset>> {
		this.#assertAdmin();
		const current = this.#findAsset(id);
		if (!current) return this.#refusal('not_found');
		if (current.state === 'archived') return this.#refusal('archived', { item: current });
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		if (input.collectionId) {
			const collection = this.#findCollection(input.collectionId);
			if (!collection) return this.#refusal('not_found');
			if (collection.state === 'archived') return this.#refusal('collection_archived');
		}
		Object.assign(current, {
			collectionId: input.collectionId,
			name: input.name,
			description: input.description,
			tags: [...input.tags],
			kind: input.kind,
			provenance: { ...input.provenance },
			sortOrder: input.sortOrder,
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	async publishAsset(
		id: string,
		versionId: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogAsset>> {
		this.#assertAdmin();
		const current = this.#findAsset(id);
		if (!current) return this.#refusal('not_found');
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		if (current.state === 'archived') return this.#refusal('archived', { item: current });
		const version = this.versions.find((row) => row.id === versionId && row.assetId === id);
		if (!version) return this.#refusal('version_not_found');
		if (version.validationState !== 'validated') return this.#refusal('version_not_validated');
		if (current.collectionId) {
			const collection = this.#findCollection(current.collectionId);
			if (!collection || collection.state !== 'published')
				return this.#refusal('collection_not_published');
		}
		Object.assign(current, {
			state: 'published',
			publishedVersionId: versionId,
			publishedAt: current.publishedAt ?? now(),
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	async archiveAsset(
		id: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogAsset>> {
		this.#assertAdmin();
		const current = this.#findAsset(id);
		if (!current) return this.#refusal('not_found');
		if (current.state === 'archived') return { ok: true, item: { ...current } };
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		const pinned = this.#pinnedTemplates([current]);
		if (pinned.length > 0) return this.#refusal('pinned_by_template', { templates: pinned });
		Object.assign(current, {
			state: 'archived',
			archivedAt: now(),
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	async listTemplatesForAdmin(filters?: CatalogListFilters): Promise<CatalogPage<CatalogTemplate>>;
	async listTemplatesForAdmin(filters?: CatalogListFilters): Promise<CatalogPage<CatalogTemplate>> {
		this.#assertAdmin();
		return this.#page(
			this.templates,
			filters,
			(row) =>
				(!filters?.useCase || row.useCase === filters.useCase) &&
				(!filters?.query || this.#text(row, filters.query))
		);
	}

	async createTemplate(input: CatalogTemplateInput): Promise<CatalogActionResult<CatalogTemplate>> {
		this.#assertAdmin();
		const item: CatalogTemplate = {
			id: uuid(),
			title: input.title,
			useCase: input.useCase,
			description: input.description,
			tags: [...input.tags],
			sortOrder: input.sortOrder,
			state: 'draft',
			revision: 1,
			publishedVersionId: null,
			publishedAt: null,
			archivedAt: null,
			createdAt: now(),
			updatedAt: now()
		};
		this.templates.push(item);
		return { ok: true, item };
	}

	async updateTemplate(
		id: string,
		expectedRevision: number,
		input: CatalogTemplateInput
	): Promise<CatalogActionResult<CatalogTemplate>> {
		this.#assertAdmin();
		const current = this.templates.find((row) => row.id === id);
		if (!current) return this.#refusal('not_found');
		if (current.state === 'archived') return this.#refusal('archived', { item: current });
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		Object.assign(current, {
			title: input.title,
			useCase: input.useCase,
			description: input.description,
			tags: [...input.tags],
			sortOrder: input.sortOrder,
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	async publishTemplate(
		id: string,
		versionId: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogTemplate>> {
		this.#assertAdmin();
		const current = this.templates.find((row) => row.id === id);
		if (!current) return this.#refusal('not_found');
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		if (current.state === 'archived') return this.#refusal('archived', { item: current });
		const version = this.templateVersions.find(
			(row) => row.id === versionId && row.templateId === id
		);
		if (!version) return this.#refusal('version_not_found');
		if (version.validationState !== 'validated') return this.#refusal('version_not_validated');
		const dependencies = this.dependencies.filter((row) => row.templateVersionId === versionId);
		const unavailable = dependencies
			.filter((dependency) => {
				const asset = this.#findAsset(dependency.assetId);
				return (
					!asset ||
					asset.state !== 'published' ||
					asset.publishedVersionId !== dependency.assetVersionId
				);
			})
			.map((dependency) => dependency.assetId);
		if (unavailable.length > 0)
			return this.#refusal('dependency_unavailable', { assetIds: unavailable, version });
		Object.assign(current, {
			state: 'published',
			publishedVersionId: versionId,
			publishedAt: current.publishedAt ?? now(),
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}

	async archiveTemplate(
		id: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogTemplate>> {
		this.#assertAdmin();
		const current = this.templates.find((row) => row.id === id);
		if (!current) return this.#refusal('not_found');
		if (current.state === 'archived') return { ok: true, item: { ...current } };
		if (current.revision !== expectedRevision)
			return this.#refusal('revision_conflict', { item: current });
		Object.assign(current, {
			state: 'archived',
			archivedAt: now(),
			revision: current.revision + 1,
			updatedAt: now()
		});
		return { ok: true, item: { ...current } };
	}
}
