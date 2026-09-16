/**
 * Catalog domain model for the read and admin repositories.
 *
 * These are the rows the catalog RPCs and PostgREST selects return, parsed
 * strictly: a malformed row is an error, never a half-populated object. Draft
 * metadata is admin-only; the public read path only ever sees published rows
 * (enforced by RLS, re-checked here by the queries themselves).
 */

export type CatalogState = 'draft' | 'published' | 'archived';
export type CatalogAssetKind = 'raster' | 'svg';
export type CatalogValidationState = 'pending' | 'validated' | 'rejected';

export type CatalogCollection = {
	id: string;
	name: string;
	description: string;
	tags: string[];
	sortOrder: number;
	state: CatalogState;
	revision: number;
	publishedAt: string | null;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CatalogAsset = {
	id: string;
	collectionId: string | null;
	name: string;
	description: string;
	tags: string[];
	kind: CatalogAssetKind;
	provenance: Record<string, unknown>;
	sortOrder: number;
	state: CatalogState;
	revision: number;
	publishedVersionId: string | null;
	publishedAt: string | null;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CatalogAssetVersion = {
	id: string;
	assetId: string;
	versionNumber: number;
	sourcePath: string;
	sourceSha256: string;
	sourceBytes: number;
	sourceMime: string;
	derivativePath: string;
	derivativeSha256: string;
	derivativeBytes: number;
	derivativeMime: 'image/png' | 'image/webp';
	derivativeWidth: number;
	derivativeHeight: number;
	thumbnailPath: string | null;
	validationState: CatalogValidationState;
	createdAt: string;
};

export type CatalogTemplate = {
	id: string;
	title: string;
	useCase: string;
	description: string;
	tags: string[];
	sortOrder: number;
	state: CatalogState;
	revision: number;
	publishedVersionId: string | null;
	publishedAt: string | null;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CatalogSlidePreview = { path: string; ordinal: number };

export type CatalogTemplateVersion = {
	id: string;
	templateId: string;
	versionNumber: number;
	document: unknown;
	coverPath: string;
	slidePreviews: CatalogSlidePreview[];
	validationState: CatalogValidationState;
	createdAt: string;
};

export type CatalogTemplateDependency = {
	templateVersionId: string;
	assetId: string;
	assetVersionId: string;
};

/** One keyset page. `nextCursor` is opaque to callers. */
export type CatalogPage<T> = { items: T[]; nextCursor: string | null };

export type CatalogUploadBatchState = 'open' | 'closed' | 'cancelled';

export type CatalogUploadStage = 'queued' | 'claimed' | 'ready' | 'failed' | 'cancelled';

/** One reserved file slot in a batch. The lease token is never part of this. */
export type CatalogUploadJob = {
	id: string;
	batchId: string;
	assetId: string | null;
	sourcePath: string;
	originalName: string;
	claimedMime: string;
	claimedBytes: number;
	position: number;
	stage: CatalogUploadStage;
	progress: number;
	attempts: number;
	leaseExpiresAt: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
};

/** A job as the dashboard reads it: `stored` is answered from Storage itself. */
export type CatalogUploadJobStatus = CatalogUploadJob & {
	stored: boolean;
	versionId: string | null;
};

export type CatalogUploadCounts = {
	total: number;
	queued: number;
	claimed: number;
	ready: number;
	failed: number;
	cancelled: number;
};

export type CatalogUploadBatch = {
	id: string;
	state: CatalogUploadBatchState;
	createdAt: string;
};

export type CatalogUploadBatchSummary = CatalogUploadBatch & { counts: CatalogUploadCounts };

export type CatalogUploadStatus = {
	batch: CatalogUploadBatchSummary;
	jobs: CatalogUploadJobStatus[];
};

/** A stored object as the orphan listing reports it; `bytes` comes from metadata. */
export type CatalogUploadObject = { path: string; bytes: number };

/** A claimed job plus the lease the worker must present to finalize it. */
export type CatalogUploadClaim = {
	job: CatalogUploadJob;
	leaseToken: string;
	leaseExpiresAt: string;
};

export type CatalogUploadCompletion = {
	job: CatalogUploadJob;
	version: CatalogAssetVersion;
	/** True when a replayed report returned the version already stored. */
	replayed: boolean;
};

export type CatalogUploadBatchPage = {
	items: CatalogUploadBatchSummary[];
	nextCursor: string | null;
};

export type CatalogOrphanMedia = {
	sources: CatalogUploadObject[];
	derivatives: CatalogUploadObject[];
	sourceTotal: number;
	derivativeTotal: number;
	truncated: boolean;
};
