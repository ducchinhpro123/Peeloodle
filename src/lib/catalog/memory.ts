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
	type CatalogActionDetail,
	type CatalogActionResult,
	type CatalogAdminRepository,
	type CatalogAssetInput,
	type CatalogCollectionInput,
	type CatalogListFilters,
	type CatalogUploadClaimResult,
	type CatalogUploadCompletionResult,
	type CatalogRefusal,
	type CatalogRepository,
	type CatalogAssetVersionReport,
	type CatalogTemplateInput,
	type CatalogUploadRequest,
	decodeUploadCursor,
	encodeUploadCursor
} from './repository';
import { takePage } from './parse';
import { runProcessingJob, type ProcessingOutcome } from './processing/runJob';
import type { ProcessedAsset } from './processing/index';
import { sha256Hex } from '$lib/hash';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogOrphanMedia,
	CatalogPage,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateVersion,
	CatalogUploadBatch,
	CatalogUploadBatchPage,
	CatalogUploadBatchSummary,
	CatalogUploadJob,
	CatalogUploadJobStatus,
	CatalogUploadObject,
	CatalogUploadStage,
	CatalogUploadStatus
} from './types';

/**
 * Deterministic placeholder processor for the in-memory repository. It keeps the
 * upload contract exercisable in browser tests without shipping a native decoder
 * to the browser; real bytes are decoded by the Node processing tests.
 */
const defaultProcessor = async (bytes: Uint8Array): Promise<ProcessedAsset> => ({
	sourceFormat: 'png',
	sourceBytes: bytes.length,
	sourceSha256: await sha256Hex(bytes),
	width: 64,
	height: 64,
	png: new Uint8Array(2048),
	thumbnail: new Uint8Array(512)
});

const UPLOAD_EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/svg+xml': 'svg'
};

function normalizeUploadMime(mime: string): string {
	const value = (mime ?? '').toLowerCase().trim();
	return value === 'image/jpg' ? 'image/jpeg' : value;
}

/** One object in the fake's private Storage stand-in. */
export type MemoryObject = {
	bucket: 'catalog-sources' | 'catalog-derivatives';
	path: string;
	bytes: number;
	mime: string;
};

export type CatalogSeed = {
	collections?: CatalogCollection[];
	assets?: CatalogAsset[];
	versions?: CatalogAssetVersion[];
	templates?: CatalogTemplate[];
	templateVersions?: CatalogTemplateVersion[];
	dependencies?: CatalogTemplateDependency[];
	admins?: string[];
	derivativeUrls?: Map<string, string>;
	objects?: MemoryObject[];
	/**
	 * The browser has no native decoder, so the fake takes the processor as a
	 * dependency. The default is deterministic placeholder bytes: enough for the
	 * UI contract, not a claim about real decoding (the SQL and Node tests cover
	 * that separately).
	 */
	process?: (bytes: Uint8Array) => Promise<ProcessedAsset>;
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
	objects: MemoryObject[];
	processor: (bytes: Uint8Array) => Promise<ProcessedAsset>;
	uploadBatches: CatalogUploadBatch[];
	uploadJobs: CatalogUploadJob[];
	leases: Map<string, { token: string; expiresAt: number }>;
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
		this.objects = seed.objects ?? [];
		this.processor = seed.process ?? defaultProcessor;
		this.uploadBatches = [];
		this.uploadJobs = [];
		this.leases = new Map();
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

	/**
	 * Failure-only shape for envelopes whose `detail.item` is a job rather than the
	 * success item (claim and completion), matching the SQL and the adapter.
	 */
	#refusalDetail<T>(
		reason: CatalogRefusal,
		detail: Record<string, unknown> = {}
	): { ok: false; reason: CatalogRefusal; detail: CatalogActionDetail<T> } {
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

	async processUploadJob(jobId: string): Promise<ProcessingOutcome> {
		this.#assertAdmin();
		return runProcessingJob(
			{
				claim: (job, leaseSeconds) => this.claimUploadJob(leaseSeconds, job),
				downloadSource: (path) => this.downloadSource(path),
				uploadDerivative: (path, bytes, mime) => this.uploadDerivative(path, bytes, mime),
				complete: (job, token, report) => this.completeUploadJob(job, token, report),
				fail: (job, token, error) => this.failUploadJob(job, token, error),
				process: this.processor
			},
			jobId
		);
	}

	// ---------------------------------------------------------------------
	// P54/P55/P61: batch uploads, leases and cleanup. These mirror the SQL in
	// `20260916160000_catalog_uploads.sql`; the SQL harness is the authority.
	// ---------------------------------------------------------------------

	#job(id: string): CatalogUploadJob {
		const job = this.uploadJobs.find((row) => row.id === id);
		if (!job) throw new CatalogError('not_found', 'Upload job not found');
		return job;
	}

	#batch(id: string) {
		const batch = this.uploadBatches.find((row) => row.id === id);
		if (!batch) throw new CatalogError('not_found', 'Upload batch not found');
		return batch;
	}

	#object(bucket: MemoryObject['bucket'], path: string): MemoryObject | undefined {
		return this.objects.find((row) => row.bucket === bucket && row.path === path);
	}

	#counts(batchId: string): CatalogUploadStatus['batch']['counts'] {
		const jobs = this.uploadJobs.filter((job) => job.batchId === batchId);
		const count = (stage: CatalogUploadStage) => jobs.filter((job) => job.stage === stage).length;
		return {
			total: jobs.length,
			queued: count('queued'),
			claimed: count('claimed'),
			ready: count('ready'),
			failed: count('failed'),
			cancelled: count('cancelled')
		};
	}

	#batchSummary(batchId: string): CatalogUploadBatchSummary {
		const batch = this.#batch(batchId);
		return { ...batch, counts: this.#counts(batchId) };
	}

	#jobStatus(job: CatalogUploadJob): CatalogUploadJobStatus {
		const version = this.versions
			.filter((row) => row.assetId === job.assetId)
			.sort((left, right) => right.versionNumber - left.versionNumber)[0];
		return {
			...job,
			stored: this.#object('catalog-sources', job.sourcePath) !== undefined,
			versionId: version?.id ?? null
		};
	}

	#status(batchId: string): CatalogUploadStatus {
		return {
			batch: this.#batchSummary(batchId),
			jobs: this.uploadJobs
				.filter((job) => job.batchId === batchId)
				.sort((left, right) => left.position - right.position)
				.map((job) => this.#jobStatus(job))
		};
	}

	/** Mirrors the server-side report validation; returns a reason or null. */
	#reportProblem(job: CatalogUploadJob, report: CatalogAssetVersionReport): CatalogRefusal | null {
		const hex = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
		const uuid = (value: unknown) =>
			typeof value === 'string' &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
		if (!uuid(report?.versionId) || !hex(report?.sourceSha256) || !hex(report?.derivativeSha256))
			return 'invalid_report';
		if (report.derivativeMime !== 'image/png' && report.derivativeMime !== 'image/webp')
			return 'invalid_report';
		if (
			report.sourceBytes < 1 ||
			report.derivativeBytes < 1 ||
			report.derivativeWidth < 1 ||
			report.derivativeWidth > 4096 ||
			report.derivativeHeight < 1 ||
			report.derivativeHeight > 4096
		)
			return 'invalid_report';
		const prefix = `assets/${job.assetId}/${report.versionId}/`;
		if (
			typeof report.derivativePath !== 'string' ||
			!report.derivativePath.startsWith(prefix) ||
			!/^[A-Za-z0-9._-]{1,120}$/.test(report.derivativePath.slice(prefix.length))
		)
			return 'invalid_report';
		if (report.thumbnailPath !== null && report.thumbnailPath !== undefined) {
			if (
				!report.thumbnailPath.startsWith(prefix) ||
				!/^[A-Za-z0-9._-]{1,120}$/.test(report.thumbnailPath.slice(prefix.length)) ||
				!hex(report.thumbnailSha256)
			)
				return 'invalid_report';
		}
		return null;
	}

	#leaseHolds(job: CatalogUploadJob, token: string | undefined): boolean {
		const lease = this.leases.get(job.id);
		return (
			job.stage === 'claimed' &&
			token !== undefined &&
			lease !== undefined &&
			lease.token === token &&
			lease.expiresAt > Date.now()
		);
	}

	async createUploadBatch(
		request: CatalogUploadRequest
	): Promise<CatalogActionResult<CatalogUploadStatus>> {
		this.#assertAdmin();
		const files = request?.files;
		if (!Array.isArray(files) || files.length < 1 || files.length > 100)
			return this.#refusal('too_many_files', { count: Array.isArray(files) ? files.length : 0 });
		for (const file of files) {
			if (
				typeof file?.name !== 'string' ||
				file.name.length === 0 ||
				file.name.length > 300 ||
				file.name.includes('/') ||
				file.name.includes('\\')
			)
				return this.#refusal('invalid_file', { name: file?.name });
			if (!UPLOAD_EXTENSIONS[normalizeUploadMime(file.mime)])
				return this.#refusal('invalid_file', {
					name: file.name,
					message: 'Unsupported content type'
				});
			if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 20971520)
				return this.#refusal('invalid_file', {
					name: file.name,
					message: 'File size is outside the accepted range'
				});
		}
		if (request.collectionId !== null && request.collectionId !== undefined) {
			const collection = this.#findCollection(request.collectionId);
			if (!collection) return this.#refusal('not_found');
			if (collection.state === 'archived') return this.#refusal('collection_archived');
		}

		const batchId = uuid();
		this.uploadBatches.push({ id: batchId, state: 'open', createdAt: now() });
		files.forEach((file, index) => {
			const mime = normalizeUploadMime(file.mime);
			const extension = UPLOAD_EXTENSIONS[mime] as string;
			const kind: CatalogAsset['kind'] = extension === 'svg' ? 'svg' : 'raster';
			const title = file.name.replace(/\.[A-Za-z0-9]{1,8}$/, '').trim() || file.name;
			const asset: CatalogAsset = {
				id: uuid(),
				collectionId: request.collectionId ?? null,
				name: title.slice(0, 200),
				description: '',
				tags: [],
				kind,
				provenance: { original_name: file.name, source: 'upload' },
				sortOrder: 0,
				state: 'draft',
				revision: 1,
				publishedVersionId: null,
				publishedAt: null,
				archivedAt: null,
				createdAt: now(),
				updatedAt: now()
			};
			this.assets.push(asset);
			this.uploadJobs.push({
				id: uuid(),
				batchId,
				assetId: asset.id,
				sourcePath: `${batchId}/${uuid()}.${extension}`,
				originalName: file.name,
				claimedMime: mime,
				claimedBytes: file.bytes,
				position: index,
				stage: 'queued',
				progress: 0,
				attempts: 0,
				leaseExpiresAt: null,
				errorCode: null,
				errorMessage: null,
				createdAt: now(),
				updatedAt: now()
			});
		});
		return { ok: true, item: this.#status(batchId) };
	}

	async uploadStatus(batchId: string): Promise<CatalogUploadStatus> {
		this.#assertAdmin();
		return this.#status(this.#batch(batchId).id);
	}

	async listUploadBatches(cursor?: string | null): Promise<CatalogUploadBatchPage> {
		this.#assertAdmin();
		const position = cursor ? decodeUploadCursor(cursor) : null;
		const ordered = [...this.uploadBatches].sort(
			(left, right) =>
				right.createdAt.localeCompare(left.createdAt) || (left.id < right.id ? 1 : -1)
		);
		const after = position
			? ordered.filter(
					(batch) =>
						batch.createdAt < position.createdAt ||
						(batch.createdAt === position.createdAt && batch.id < position.id)
				)
			: ordered;
		const page = after.slice(0, 10);
		const last = page.at(-1);
		return {
			items: page.map((batch) => this.#batchSummary(batch.id)),
			nextCursor:
				after.length > page.length && last
					? encodeUploadCursor({ createdAt: last.createdAt, id: last.id })
					: null
		};
	}

	async claimUploadJob(leaseSeconds = 300, jobId?: string): Promise<CatalogUploadClaimResult> {
		this.#assertAdmin();
		const seconds = Math.min(Math.max(leaseSeconds, 30), 3600);
		const candidate = this.uploadJobs
			.filter((job) => {
				if (jobId !== undefined && job.id !== jobId) return false;
				if (job.attempts >= 10) return false;
				const batch = this.uploadBatches.find((row) => row.id === job.batchId);
				if (batch?.state !== 'open') return false;
				if (job.stage !== 'queued' && job.stage !== 'claimed') return false;
				if (job.stage === 'claimed' && (this.leases.get(job.id)?.expiresAt ?? 0) > Date.now())
					return false;
				const object = this.#object('catalog-sources', job.sourcePath);
				return object?.bytes === job.claimedBytes && object.mime === job.claimedMime;
			})
			.sort(
				(left, right) =>
					left.createdAt.localeCompare(right.createdAt) ||
					left.position - right.position ||
					(left.id < right.id ? -1 : 1)
			)[0];
		if (!candidate) return this.#refusalDetail('none_pending');
		const token = uuid();
		const expiresAt = Date.now() + seconds * 1000;
		this.leases.set(candidate.id, { token, expiresAt });
		Object.assign(candidate, {
			stage: 'claimed',
			attempts: candidate.attempts + 1,
			progress: 0,
			leaseExpiresAt: new Date(expiresAt).toISOString(),
			errorCode: null,
			errorMessage: null,
			updatedAt: now()
		});
		return {
			ok: true,
			item: {
				job: { ...candidate },
				leaseToken: token,
				leaseExpiresAt: candidate.leaseExpiresAt as string
			}
		};
	}

	async completeUploadJob(
		jobId: string,
		leaseToken: string,
		report: CatalogAssetVersionReport
	): Promise<CatalogUploadCompletionResult> {
		this.#assertAdmin();
		const job = this.#job(jobId);
		if (job.stage === 'ready') {
			const existing = this.versions.find(
				(row) => row.id === report?.versionId && row.assetId === job.assetId
			);
			if (existing)
				return { ok: true, item: { job: { ...job }, version: existing, replayed: true } };
			return this.#refusalDetail('already_complete', { item: job });
		}
		const problem = this.#reportProblem(job, report);
		if (problem) return this.#refusalDetail(problem, { item: job });
		if (!this.#leaseHolds(job, leaseToken)) return this.#refusalDetail('lease_lost', { item: job });
		const derivative = this.#object('catalog-derivatives', report.derivativePath);
		if (!derivative || derivative.bytes !== report.derivativeBytes)
			return this.#refusalDetail('media_missing', {
				message: 'The derivative object has not been stored'
			});
		if (report.thumbnailPath) {
			const thumbnail = this.#object('catalog-derivatives', report.thumbnailPath);
			if (!thumbnail || thumbnail.bytes !== report.thumbnailBytes)
				return this.#refusalDetail('media_missing', {
					message: 'The thumbnail object has not been stored'
				});
		}
		const versionNumber =
			this.versions
				.filter((row) => row.assetId === job.assetId)
				.reduce((max, row) => Math.max(max, row.versionNumber), 0) + 1;
		const version: CatalogAssetVersion = {
			id: report.versionId,
			assetId: job.assetId as string,
			versionNumber,
			sourcePath: job.sourcePath,
			sourceSha256: report.sourceSha256,
			sourceBytes: report.sourceBytes,
			sourceMime: report.sourceMime,
			derivativePath: report.derivativePath,
			derivativeSha256: report.derivativeSha256,
			derivativeBytes: report.derivativeBytes,
			derivativeMime: report.derivativeMime,
			derivativeWidth: report.derivativeWidth,
			derivativeHeight: report.derivativeHeight,
			thumbnailPath: report.thumbnailPath,
			validationState: 'validated',
			createdAt: now()
		};
		this.versions.push(version);
		this.leases.delete(job.id);
		Object.assign(job, {
			stage: 'ready',
			progress: 100,
			leaseExpiresAt: null,
			errorCode: null,
			errorMessage: null,
			updatedAt: now()
		});
		return { ok: true, item: { job: { ...job }, version, replayed: false } };
	}

	async failUploadJob(
		jobId: string,
		leaseToken: string,
		error: { code: string; message: string }
	): Promise<CatalogActionResult<CatalogUploadJob>> {
		this.#assertAdmin();
		const job = this.#job(jobId);
		if (job.stage !== 'claimed' && job.stage !== 'queued')
			return this.#refusal('lease_lost', { item: job });
		if (job.stage === 'claimed' && !this.#leaseHolds(job, leaseToken))
			return this.#refusal('lease_lost', { item: job });
		this.leases.delete(job.id);
		Object.assign(job, {
			stage: 'failed',
			leaseExpiresAt: null,
			errorCode: (error?.code ?? 'processing_failed').slice(0, 100),
			errorMessage: (error?.message ?? 'Processing failed').slice(0, 2000),
			updatedAt: now()
		});
		return { ok: true, item: { ...job } };
	}

	async retryUploadJob(jobId: string): Promise<CatalogActionResult<CatalogUploadJob>> {
		this.#assertAdmin();
		const job = this.#job(jobId);
		const batch = this.#batch(job.batchId);
		if (batch.state !== 'open') return this.#refusal('batch_not_open', { item: job });
		if (job.stage === 'ready') return this.#refusal('already_complete', { item: job });
		if (job.attempts >= 10) return this.#refusal('attempts_exhausted', { item: job });
		if (job.stage === 'queued' || job.stage === 'claimed') return { ok: true, item: { ...job } };
		this.leases.delete(job.id);
		Object.assign(job, {
			stage: 'queued',
			progress: 0,
			leaseExpiresAt: null,
			errorCode: null,
			errorMessage: null,
			updatedAt: now()
		});
		return { ok: true, item: { ...job } };
	}

	async cancelUploadBatch(batchId: string): Promise<CatalogActionResult<CatalogUploadStatus>> {
		this.#assertAdmin();
		const batch = this.#batch(batchId);
		if (batch.state !== 'open') return this.#refusal('batch_not_open', { item: batch });
		batch.state = 'cancelled';
		for (const job of this.uploadJobs.filter((row) => row.batchId === batchId)) {
			if (job.stage === 'queued' || job.stage === 'claimed') {
				this.leases.delete(job.id);
				Object.assign(job, { stage: 'cancelled', leaseExpiresAt: null, updatedAt: now() });
			}
		}
		return { ok: true, item: this.#status(batchId) };
	}

	async closeUploadBatch(batchId: string): Promise<CatalogActionResult<CatalogUploadBatchSummary>> {
		this.#assertAdmin();
		const batch = this.#batch(batchId);
		if (batch.state === 'open') batch.state = 'closed';
		return { ok: true, item: this.#batchSummary(batchId) };
	}

	#referencedPaths(): Set<string> {
		const referenced = new Set<string>();
		for (const version of this.versions) {
			referenced.add(version.sourcePath);
			referenced.add(version.derivativePath);
			if (version.thumbnailPath) referenced.add(version.thumbnailPath);
		}
		for (const template of this.templateVersions) {
			referenced.add(template.coverPath);
			for (const preview of template.slidePreviews) referenced.add(preview.path);
		}
		return referenced;
	}

	async listOrphanMedia(batchId: string): Promise<CatalogOrphanMedia> {
		this.#assertAdmin();
		const batch = this.#batch(batchId);
		const assetIds = new Set(
			this.uploadJobs.filter((job) => job.batchId === batch.id).map((job) => job.assetId)
		);
		const referenced = this.#referencedPaths();
		const sources = this.objects
			.filter(
				(object) =>
					object.bucket === 'catalog-sources' &&
					object.path.startsWith(`${batch.id}/`) &&
					!referenced.has(object.path)
			)
			.map((object): CatalogUploadObject => ({ path: object.path, bytes: object.bytes }));
		const derivatives = this.objects
			.filter((object) => {
				if (object.bucket !== 'catalog-derivatives' || referenced.has(object.path)) return false;
				const [, assetId] = object.path.split('/');
				return assetIds.has(assetId);
			})
			.map((object): CatalogUploadObject => ({ path: object.path, bytes: object.bytes }));
		return {
			sources,
			derivatives,
			sourceTotal: sources.length,
			derivativeTotal: derivatives.length,
			truncated: sources.length + derivatives.length > 200
		};
	}

	async recordUploadCleanup(batchId: string, paths: string[]): Promise<number> {
		this.#assertAdmin();
		this.#batch(batchId);
		if (!Array.isArray(paths) || paths.length < 1 || paths.length > 200)
			throw new CatalogError('invalid_data', 'paths must contain 1..200 entries');
		const referenced = this.#referencedPaths();
		const pinned = paths.filter((path) => referenced.has(path));
		if (pinned.length > 0)
			throw new CatalogError('missing_media', `Referenced media cannot be removed: ${pinned[0]}`);
		return paths.length;
	}

	async uploadSource(path: string, file: Blob, mime: string): Promise<void> {
		this.#assertAdmin();
		this.objects.push({ bucket: 'catalog-sources', path, bytes: file.size, mime });
	}

	async uploadDerivative(
		path: string,
		bytes: Blob,
		mime: 'image/png' | 'image/webp'
	): Promise<void> {
		this.#assertAdmin();
		this.objects.push({ bucket: 'catalog-derivatives', path, bytes: bytes.size, mime });
	}

	async downloadSource(path: string): Promise<Uint8Array> {
		this.#assertAdmin();
		const object = this.#object('catalog-sources', path);
		if (!object) throw new CatalogError('not_found', 'Stored source not found');
		return new Uint8Array(object.bytes);
	}

	async removeObjects(
		bucket: 'catalog-sources' | 'catalog-derivatives',
		paths: string[]
	): Promise<void> {
		this.#assertAdmin();
		const referenced = this.#referencedPaths();
		this.objects = this.objects.filter((object) => {
			if (object.bucket !== bucket || !paths.includes(object.path)) return true;
			if (referenced.has(object.path)) return true;
			if (bucket === 'catalog-sources') {
				const batch = this.uploadBatches.find((row) => object.path.startsWith(`${row.id}/`));
				if (!batch || batch.state === 'open') return true;
			}
			return false;
		});
	}
}
