/**
 * Catalog repository contracts.
 *
 * `CatalogRepository` is the student-facing read path: published items only,
 * keyset-paged, with the derivative URL fetched through a short-lived signed
 * URL. `CatalogAdminRepository` is the admin path: draft CRUD and the guarded
 * publish/archive operations, whose business refusals come back as result
 * objects (`revision_conflict`, `pinned_by_template`, …) so the UI can show a
 * conflict without discarding the editor's fields.
 *
 * A refusal is not an error; transport, permission and malformed-row problems
 * are thrown as `CatalogError`.
 */
import type { ProcessingOutcome } from './processing/runJob';
import type {
	CatalogAsset,
	CatalogAssetKind,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogOrphanMedia,
	CatalogPage,
	CatalogState,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateDraft,
	CatalogTemplateVersion,
	CatalogTemplateVersionSummary,
	CatalogUploadBatchPage,
	CatalogUploadBatchSummary,
	CatalogUploadClaim,
	CatalogUploadCompletion,
	CatalogUploadJob,
	CatalogUploadStatus
} from './types';

export type CatalogErrorCode =
	| 'not_found'
	| 'permission'
	| 'invalid_data'
	| 'unavailable'
	| 'missing_media'
	| 'quota'
	| 'unsupported_schema';

export class CatalogError extends Error {
	readonly code: CatalogErrorCode;
	readonly cause?: unknown;

	constructor(code: CatalogErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = 'CatalogError';
		this.code = code;
		this.cause = cause;
	}
}

export function isCatalogError(error: unknown): error is CatalogError {
	return error instanceof CatalogError;
}

/** Business refusals the guarded RPCs return; none of these is a thrown error. */
export type CatalogRefusal =
	| 'not_found'
	| 'revision_conflict'
	| 'archived'
	| 'contains_items'
	| 'pinned_by_template'
	| 'collection_archived'
	| 'collection_not_published'
	| 'version_not_found'
	| 'version_not_validated'
	| 'version_not_pending'
	| 'dependency_unavailable'
	| 'invalid_document'
	| 'none_pending'
	| 'lease_lost'
	| 'already_complete'
	| 'attempts_exhausted'
	| 'batch_not_open'
	| 'invalid_file'
	| 'invalid_report'
	| 'too_many_files'
	| 'media_missing'
	| 'media_referenced';

/**
 * Extra information a refusal carries. `item` is the current server row when a
 * compare-and-set operation is refused, already parsed into the domain type;
 * `templates` names the published templates that pin an asset.
 */
export type CatalogActionDetail<T> = {
	item?: T;
	/** The current template row when a template-version save is refused. */
	template?: CatalogTemplate;
	templates?: { id: string; title: string }[];
	count?: number;
	assetIds?: string[];
	version?: unknown;
	paths?: string[];
	name?: string;
	message?: string;
};

export type CatalogActionResult<T> =
	{ ok: true; item: T } | { ok: false; reason: CatalogRefusal; detail: CatalogActionDetail<T> };

/**
 * Claim and completion refusals carry the current *job* in `detail.item`, not the
 * success item, so those two envelopes get their own failure shape.
 */
export type CatalogUploadClaimResult =
	| { ok: true; item: CatalogUploadClaim }
	| { ok: false; reason: CatalogRefusal; detail: CatalogActionDetail<CatalogUploadJob> };

export type CatalogUploadCompletionResult =
	| { ok: true; item: CatalogUploadCompletion }
	| { ok: false; reason: CatalogRefusal; detail: CatalogActionDetail<CatalogUploadJob> };

export const CATALOG_DEFAULT_PAGE_SIZE = 24;
export const CATALOG_MAX_PAGE_SIZE = 100;

export function catalogPageSize(limit: number | undefined): number {
	if (limit === undefined) return CATALOG_DEFAULT_PAGE_SIZE;
	if (!Number.isSafeInteger(limit) || limit < 1)
		throw new CatalogError('invalid_data', 'Invalid page size');
	return Math.min(limit, CATALOG_MAX_PAGE_SIZE);
}

/** Keyset position in a `(sort_order, id)` ordering; stable across inserts. */
export type CatalogCursor = { sortOrder: number; id: string };

export function encodeCatalogCursor(cursor: CatalogCursor): string {
	return btoa(JSON.stringify([cursor.sortOrder, cursor.id]));
}

export function decodeCatalogCursor(value: string): CatalogCursor {
	const fail = () => new CatalogError('invalid_data', 'Invalid catalog cursor');
	let parsed: unknown;
	try {
		parsed = JSON.parse(atob(value));
	} catch {
		throw fail();
	}
	if (!Array.isArray(parsed) || parsed.length !== 2) throw fail();
	const [sortOrder, id] = parsed;
	// The id is interpolated into a PostgREST filter, so only the uuid shape the
	// catalog actually uses is accepted.
	if (
		!Number.isSafeInteger(sortOrder) ||
		typeof id !== 'string' ||
		!/^[0-9a-fA-F-]{1,64}$/.test(id)
	)
		throw fail();
	return { sortOrder: sortOrder as number, id: id as string };
}

export type CatalogListFilters = {
	/** Free-text match over name/title and description. */
	query?: string;
	collectionId?: string;
	kind?: CatalogAssetKind;
	useCase?: string;
	/** Admin lists only: the exact row state to include. */
	state?: CatalogState;
	limit?: number;
	/** Opaque cursor from the previous page. */
	cursor?: string | null;
};

export type CatalogCollectionInput = {
	name: string;
	description: string;
	tags: string[];
	sortOrder: number;
};

export type CatalogAssetInput = {
	collectionId: string | null;
	name: string;
	description: string;
	tags: string[];
	kind: CatalogAssetKind;
	provenance: Record<string, unknown>;
	sortOrder: number;
};

export type CatalogTemplateInput = {
	title: string;
	useCase: string;
	description: string;
	tags: string[];
	sortOrder: number;
};

/**
 * One atomic draft creation: the metadata, the immutable document snapshot, its
 * hash and size, and every font the document references. Dependencies are not
 * passed separately — the server derives them from the document's assets and
 * refuses the draft unless each one is already a validated catalog version.
 */
export type CatalogTemplateDraftInput = {
	metadata: CatalogTemplateInput;
	document: unknown;
	documentSha256: string;
	documentBytes: number;
	fontRequirements: { fontId: string }[];
};

/**
 * One immutable successor version of an existing template draft. The document,
 * its hash/size and every referenced font move together; dependencies are again
 * derived from the document by the server. `expectedRevision` is the stable
 * template revision the editor read, so a concurrent save is refused instead of
 * silently replaced.
 */
export type CatalogTemplateVersionInput = {
	templateId: string;
	expectedRevision: number;
	document: unknown;
	documentSha256: string;
	documentBytes: number;
	fontRequirements: { fontId: string }[];
};

/** One rendered slide preview the caller uploads before the commit RPC. */
export type CatalogTemplatePreviewInput = {
	ordinal: number;
	path: string;
	sha256: string;
	bytes: number;
	width: number;
	height: number;
};

/**
 * The commit envelope for generated previews. The caller has already uploaded
 * the objects to the private derivative bucket; the server verifies they exist
 * with the declared size and creates the successor immutable version.
 */
export type CatalogTemplatePreviewsInput = {
	templateId: string;
	versionId: string;
	expectedRevision: number;
	documentSha256: string;
	coverOrdinal: number;
	previews: CatalogTemplatePreviewInput[];
};

/** One file the administrator selected; `bytes` is the browser's claimed size. */
export type CatalogUploadFile = { name: string; mime: string; bytes: number };

export type CatalogUploadRequest = { collectionId: string | null; files: CatalogUploadFile[] };

/**
 * What the trusted processor reports for one job. The server validates every
 * field (hashes, sizes, dimensions, the path binding to asset + version) and
 * re-checks that the objects exist, so this is a report, not an instruction.
 */
export type CatalogAssetVersionReport = {
	versionId: string;
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
	thumbnailSha256: string | null;
	thumbnailBytes: number;
	renderer: string;
	validation: Record<string, unknown>;
};

/** Batches page by `(created_at, id)`, newest first. */
export function encodeUploadCursor(cursor: { createdAt: string; id: string }): string {
	return btoa(JSON.stringify([cursor.createdAt, cursor.id]));
}

export function decodeUploadCursor(value: string): { createdAt: string; id: string } {
	const fail = () => new CatalogError('invalid_data', 'Invalid upload cursor');
	let parsed: unknown;
	try {
		parsed = JSON.parse(atob(value));
	} catch {
		throw fail();
	}
	if (!Array.isArray(parsed) || parsed.length !== 2) throw fail();
	const [createdAt, id] = parsed;
	if (
		typeof createdAt !== 'string' ||
		Number.isNaN(Date.parse(createdAt)) ||
		typeof id !== 'string' ||
		!/^[0-9a-fA-F-]{1,64}$/.test(id)
	)
		throw fail();
	return { createdAt, id };
}

/** Buckets a client may write to; the names are fixed, never client-chosen. */
export type CatalogSourceBucket = 'catalog-sources';
export type CatalogDerivativeBucket = 'catalog-derivatives';

export interface CatalogRepository {
	listCollections(filters?: CatalogListFilters): Promise<CatalogPage<CatalogCollection>>;
	getCollection(id: string): Promise<CatalogCollection>;
	listAssets(filters?: CatalogListFilters): Promise<CatalogPage<CatalogAsset>>;
	getAsset(id: string): Promise<CatalogAsset>;
	getPublishedVersion(assetId: string): Promise<CatalogAssetVersion>;
	listTemplates(filters?: CatalogListFilters): Promise<CatalogPage<CatalogTemplate>>;
	getTemplate(id: string): Promise<CatalogTemplate>;
	getTemplateVersion(templateId: string): Promise<CatalogTemplateVersion>;
	getDependencies(versionId: string): Promise<CatalogTemplateDependency[]>;
	/** Short-lived URL for one derivative object; refuses unreadable paths. */
	signedDerivativeUrl(path: string, expiresInSeconds?: number): Promise<string>;
}

export interface CatalogAdminRepository {
	isAdmin(): Promise<boolean>;
	listCollectionsForAdmin(filters?: CatalogListFilters): Promise<CatalogPage<CatalogCollection>>;
	createCollection(input: CatalogCollectionInput): Promise<CatalogActionResult<CatalogCollection>>;
	updateCollection(
		id: string,
		expectedRevision: number,
		input: CatalogCollectionInput
	): Promise<CatalogActionResult<CatalogCollection>>;
	publishCollection(
		id: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogCollection>>;
	archiveCollection(
		id: string,
		expectedRevision: number,
		archiveItems: boolean
	): Promise<CatalogActionResult<CatalogCollection>>;
	listAssetsForAdmin(filters?: CatalogListFilters): Promise<CatalogPage<CatalogAsset>>;
	/**
	 * Short-lived URL for a stored derivative, including a draft's; admins may
	 * read drafts, so the inspector can preview work that is not public yet.
	 */
	signedDerivativeUrl(path: string, expiresInSeconds?: number): Promise<string>;
	/**
	 * The newest version of a draft or published asset, or null when none exists.
	 * The admin inspector needs this to offer publication of a specific version.
	 */
	getLatestVersion(assetId: string): Promise<CatalogAssetVersion | null>;
	createAsset(input: CatalogAssetInput): Promise<CatalogActionResult<CatalogAsset>>;
	updateAsset(
		id: string,
		expectedRevision: number,
		input: CatalogAssetInput
	): Promise<CatalogActionResult<CatalogAsset>>;
	publishAsset(
		id: string,
		versionId: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogAsset>>;
	archiveAsset(id: string, expectedRevision: number): Promise<CatalogActionResult<CatalogAsset>>;
	listTemplatesForAdmin(filters?: CatalogListFilters): Promise<CatalogPage<CatalogTemplate>>;
	/** One template whatever its state, drafts included; the detail screen and editor need it. */
	getTemplateForAdmin(id: string): Promise<CatalogTemplate>;
	/**
	 * Version facts without the full document, newest first. Used by the detail
	 * screen so a list never drags every 10 MB snapshot across the wire.
	 */
	listTemplateVersionsForAdmin(
		templateId: string,
		options?: { limit?: number }
	): Promise<CatalogTemplateVersionSummary[]>;
	/** The newest version including its document; null when the template has none. */
	getLatestTemplateVersionForAdmin(templateId: string): Promise<CatalogTemplateVersion | null>;
	createTemplate(input: CatalogTemplateInput): Promise<CatalogActionResult<CatalogTemplate>>;
	updateTemplate(
		id: string,
		expectedRevision: number,
		input: CatalogTemplateInput
	): Promise<CatalogActionResult<CatalogTemplate>>;
	publishTemplate(
		id: string,
		versionId: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogTemplate>>;
	archiveTemplate(
		id: string,
		expectedRevision: number
	): Promise<CatalogActionResult<CatalogTemplate>>;
	/**
	 * One exact asset version, whatever its state, so the caller can verify a
	 * document's catalog provenance before pinning it. A mismatched asset/version
	 * pair is `not_found`.
	 */
	getAssetVersion(assetId: string, versionId: string): Promise<CatalogAssetVersion>;
	/**
	 * Creates the stable template, its first pending version and every dependency
	 * pin in one transaction. Refused as `invalid_document` or
	 * `dependency_unavailable`; a refusal writes nothing.
	 */
	createTemplateDraft(
		input: CatalogTemplateDraftInput
	): Promise<CatalogActionResult<CatalogTemplateDraft>>;
	/**
	 * Appends the next immutable pending version and advances the stable
	 * template's revision in one transaction. Refused as `revision_conflict`,
	 * `archived`, `not_found`, `invalid_document` or `dependency_unavailable`; a
	 * refusal writes nothing.
	 */
	saveTemplateVersion(
		input: CatalogTemplateVersionInput
	): Promise<CatalogActionResult<CatalogTemplateDraft>>;
	/**
	 * Commits already-uploaded slide previews as the successor immutable version
	 * of the newest pending draft. Refused when the source is superseded or no
	 * longer pending (`version_not_pending`), the document hash differs, or an
	 * object is missing (`media_missing`); a refusal writes nothing.
	 */
	attachTemplatePreviews(
		input: CatalogTemplatePreviewsInput
	): Promise<CatalogActionResult<CatalogTemplateDraft>>;

	// P54/P55: durable batches and leased jobs. Every method re-checks admin
	// membership server-side; the UI gate is only messaging.
	createUploadBatch(
		request: CatalogUploadRequest
	): Promise<CatalogActionResult<CatalogUploadStatus>>;
	uploadStatus(batchId: string): Promise<CatalogUploadStatus>;
	listUploadBatches(cursor?: string | null): Promise<CatalogUploadBatchPage>;
	claimUploadJob(leaseSeconds?: number, jobId?: string): Promise<CatalogUploadClaimResult>;
	/**
	 * Claims the job and runs trusted processing. The Supabase adapter posts to
	 * the app's processing endpoint; the fake runs the same orchestration locally
	 * with an injected processor, because browsers have no native decoder.
	 */
	processUploadJob(jobId: string): Promise<ProcessingOutcome>;
	completeUploadJob(
		jobId: string,
		leaseToken: string,
		report: CatalogAssetVersionReport
	): Promise<CatalogUploadCompletionResult>;
	failUploadJob(
		jobId: string,
		leaseToken: string,
		error: { code: string; message: string }
	): Promise<CatalogActionResult<CatalogUploadJob>>;
	retryUploadJob(jobId: string): Promise<CatalogActionResult<CatalogUploadJob>>;
	cancelUploadBatch(batchId: string): Promise<CatalogActionResult<CatalogUploadStatus>>;
	closeUploadBatch(batchId: string): Promise<CatalogActionResult<CatalogUploadBatchSummary>>;

	// P61: bounded cleanup. The listing and the delete policies share one
	// predicate, so pinned or live media can never be listed or removed.
	listOrphanMedia(batchId: string): Promise<CatalogOrphanMedia>;
	recordUploadCleanup(batchId: string, paths: string[]): Promise<number>;

	// Storage seam. Direct uploads to the private buckets; progress is reported as
	// a per-file stage by the caller, so there is no synthetic byte counter here.
	uploadSource(path: string, file: Blob, mime: string): Promise<void>;
	uploadDerivative(path: string, bytes: Blob, mime: 'image/png' | 'image/webp'): Promise<void>;
	downloadSource(path: string): Promise<Uint8Array>;
	removeObjects(
		bucket: CatalogSourceBucket | CatalogDerivativeBucket,
		paths: string[]
	): Promise<void>;
}
