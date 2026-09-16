/**
 * Strict row parsers for the catalog wire shape (snake_case PostgREST rows and
 * RPC results). A malformed row raises `CatalogError('invalid_data')` instead of
 * producing an object with undefined fields.
 */
import {
	CatalogError,
	encodeCatalogCursor,
	encodeUploadCursor,
	type CatalogActionDetail,
	type CatalogActionResult,
	type CatalogRefusal,
	type CatalogUploadClaimResult,
	type CatalogUploadCompletionResult
} from './repository';
import type {
	CatalogAsset,
	CatalogAssetKind,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogOrphanMedia,
	CatalogPage,
	CatalogSlidePreview,
	CatalogState,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateVersion,
	CatalogUploadBatchPage,
	CatalogUploadBatchState,
	CatalogUploadBatchSummary,
	CatalogUploadCounts,
	CatalogUploadJob,
	CatalogUploadJobStatus,
	CatalogUploadObject,
	CatalogUploadStage,
	CatalogUploadStatus,
	CatalogValidationState
} from './types';

const STATES: CatalogState[] = ['draft', 'published', 'archived'];
const VALIDATION: CatalogValidationState[] = ['pending', 'validated', 'rejected'];
const KINDS: CatalogAssetKind[] = ['raster', 'svg'];

function invalid(message: string): never {
	throw new CatalogError('invalid_data', message);
}

function record(value: unknown, what: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`Invalid ${what}`);
	return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
	const value = row[key];
	if (typeof value !== 'string' || value.length === 0) invalid(`Invalid ${key}`);
	return value;
}

function optionalText(row: Record<string, unknown>, key: string): string | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') invalid(`Invalid ${key}`);
	return value;
}

function nullableTimestamp(row: Record<string, unknown>, key: string): string | null {
	const value = optionalText(row, key);
	if (value === null) return null;
	if (Number.isNaN(Date.parse(value))) invalid(`Invalid ${key}`);
	return value;
}

function timestamp(row: Record<string, unknown>, key: string): string {
	const value = nullableTimestamp(row, key);
	if (value === null) invalid(`Missing ${key}`);
	return value;
}

function integer(row: Record<string, unknown>, key: string, minimum = 0): number {
	const value = row[key];
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
		invalid(`Invalid ${key}`);
	return value;
}

function stringArray(row: Record<string, unknown>, key: string): string[] {
	const value = row[key];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
		invalid(`Invalid ${key}`);
	return value as string[];
}

function oneOf<T extends string>(row: Record<string, unknown>, key: string, allowed: T[]): T {
	const value = row[key];
	if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(`Invalid ${key}`);
	return value as T;
}

export function parseCollection(value: unknown): CatalogCollection {
	const row = record(value, 'collection');
	return {
		id: text(row, 'id'),
		name: text(row, 'name'),
		description:
			typeof row.description === 'string' ? row.description : invalid('Invalid description'),
		tags: stringArray(row, 'tags'),
		sortOrder: integer(row, 'sort_order', Number.MIN_SAFE_INTEGER),
		state: oneOf(row, 'state', STATES),
		revision: integer(row, 'revision', 1),
		publishedAt: nullableTimestamp(row, 'published_at'),
		archivedAt: nullableTimestamp(row, 'archived_at'),
		createdAt: timestamp(row, 'created_at'),
		updatedAt: timestamp(row, 'updated_at')
	};
}

export function parseAsset(value: unknown): CatalogAsset {
	const row = record(value, 'asset');
	const provenance = record(row.provenance, 'provenance');
	return {
		id: text(row, 'id'),
		collectionId: optionalText(row, 'collection_id'),
		name: text(row, 'name'),
		description:
			typeof row.description === 'string' ? row.description : invalid('Invalid description'),
		tags: stringArray(row, 'tags'),
		kind: oneOf(row, 'kind', KINDS),
		provenance,
		sortOrder: integer(row, 'sort_order', Number.MIN_SAFE_INTEGER),
		state: oneOf(row, 'state', STATES),
		revision: integer(row, 'revision', 1),
		publishedVersionId: optionalText(row, 'published_version_id'),
		publishedAt: nullableTimestamp(row, 'published_at'),
		archivedAt: nullableTimestamp(row, 'archived_at'),
		createdAt: timestamp(row, 'created_at'),
		updatedAt: timestamp(row, 'updated_at')
	};
}

export function parseAssetVersion(value: unknown): CatalogAssetVersion {
	const row = record(value, 'asset version');
	return {
		id: text(row, 'id'),
		assetId: text(row, 'asset_id'),
		versionNumber: integer(row, 'version_number', 1),
		sourcePath: text(row, 'source_path'),
		sourceSha256: text(row, 'source_sha256'),
		sourceBytes: integer(row, 'source_bytes', 1),
		sourceMime: text(row, 'source_mime'),
		derivativePath: text(row, 'derivative_path'),
		derivativeSha256: text(row, 'derivative_sha256'),
		derivativeBytes: integer(row, 'derivative_bytes', 1),
		derivativeMime: oneOf(row, 'derivative_mime', ['image/png', 'image/webp']),
		derivativeWidth: integer(row, 'derivative_width', 1),
		derivativeHeight: integer(row, 'derivative_height', 1),
		thumbnailPath: optionalText(row, 'thumbnail_path'),
		validationState: oneOf(row, 'validation_state', VALIDATION),
		createdAt: timestamp(row, 'created_at')
	};
}

export function parseTemplate(value: unknown): CatalogTemplate {
	const row = record(value, 'template');
	return {
		id: text(row, 'id'),
		title: text(row, 'title'),
		useCase: text(row, 'use_case'),
		description:
			typeof row.description === 'string' ? row.description : invalid('Invalid description'),
		tags: stringArray(row, 'tags'),
		sortOrder: integer(row, 'sort_order', Number.MIN_SAFE_INTEGER),
		state: oneOf(row, 'state', STATES),
		revision: integer(row, 'revision', 1),
		publishedVersionId: optionalText(row, 'published_version_id'),
		publishedAt: nullableTimestamp(row, 'published_at'),
		archivedAt: nullableTimestamp(row, 'archived_at'),
		createdAt: timestamp(row, 'created_at'),
		updatedAt: timestamp(row, 'updated_at')
	};
}

function parseSlidePreviews(value: unknown): CatalogSlidePreview[] {
	if (!Array.isArray(value)) invalid('Invalid slide_previews');
	return value.map((entry) => {
		const preview = record(entry, 'slide preview');
		return { path: text(preview, 'path'), ordinal: integer(preview, 'ordinal') };
	});
}

export function parseTemplateVersion(value: unknown): CatalogTemplateVersion {
	const row = record(value, 'template version');
	if (row.document === undefined || typeof row.document !== 'object') invalid('Invalid document');
	return {
		id: text(row, 'id'),
		templateId: text(row, 'template_id'),
		versionNumber: integer(row, 'version_number', 1),
		document: row.document,
		coverPath: text(row, 'cover_path'),
		slidePreviews: parseSlidePreviews(row.slide_previews),
		validationState: oneOf(row, 'validation_state', VALIDATION),
		createdAt: timestamp(row, 'created_at')
	};
}

export function parseDependency(value: unknown): CatalogTemplateDependency {
	const row = record(value, 'template dependency');
	return {
		templateVersionId: text(row, 'template_version_id'),
		assetId: text(row, 'asset_id'),
		assetVersionId: text(row, 'asset_version_id')
	};
}

/** `rows` is fetched with `limit + 1` so the extra row can only mean "more". */
export function takePage<T extends { sortOrder: number; id: string }>(
	rows: T[],
	limit: number
): CatalogPage<T> {
	const items = rows.slice(0, limit);
	const last = items.at(-1);
	const nextCursor =
		rows.length > limit && last
			? encodeCatalogCursor({ sortOrder: last.sortOrder, id: last.id })
			: null;
	return { items, nextCursor };
}

const REFUSALS: CatalogRefusal[] = [
	'not_found',
	'revision_conflict',
	'archived',
	'contains_items',
	'pinned_by_template',
	'collection_archived',
	'collection_not_published',
	'version_not_found',
	'version_not_validated',
	'dependency_unavailable',
	'none_pending',
	'lease_lost',
	'already_complete',
	'attempts_exhausted',
	'batch_not_open',
	'invalid_file',
	'invalid_report',
	'too_many_files',
	'media_missing',
	'media_referenced'
];

/**
 * Parses one guarded RPC result envelope into a typed action result. A refusal's
 * `detail.item` (the current server row) is parsed through the same item parser,
 * so no raw wire row reaches the UI; the remaining detail fields are narrowed to
 * the shapes the catalog actually returns.
 */
export function parseActionResult<T>(
	value: unknown,
	parseItem: (item: unknown) => T
): CatalogActionResult<T> {
	const row = record(value, 'action result');
	if (row.ok === true) return { ok: true, item: parseItem(row.item) };
	return refusalDetail(row, parseItem);
}

function refusalDetail<T>(
	row: Record<string, unknown>,
	parseItem: (item: unknown) => T
): { ok: false; reason: CatalogRefusal; detail: CatalogActionDetail<T> } {
	if (
		row.ok === false &&
		typeof row.reason === 'string' &&
		REFUSALS.includes(row.reason as CatalogRefusal)
	) {
		const raw =
			row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
				? (row.detail as Record<string, unknown>)
				: {};
		/** @type {import('./repository').CatalogActionDetail<T>} */
		const detail = {
			templates: Array.isArray(raw.templates)
				? raw.templates.flatMap((entry) => {
						const candidate = entry as Record<string, unknown>;
						return typeof candidate?.id === 'string' && typeof candidate?.title === 'string'
							? [{ id: candidate.id, title: candidate.title }]
							: [];
					})
				: undefined,
			count: typeof raw.count === 'number' ? raw.count : undefined,
			assetIds: Array.isArray(raw.assetIds)
				? raw.assetIds.filter((id): id is string => typeof id === 'string')
				: undefined,
			paths: Array.isArray(raw.paths)
				? raw.paths.filter((entry): entry is string => typeof entry === 'string')
				: undefined,
			name: typeof raw.name === 'string' ? raw.name : undefined,
			message: typeof raw.message === 'string' ? raw.message : undefined,
			version: raw.version,
			item: raw.item === undefined ? undefined : parseItem(raw.item)
		};
		return { ok: false, reason: row.reason as CatalogRefusal, detail };
	}
	return invalid('Invalid action result');
}

const STAGES: CatalogUploadStage[] = ['queued', 'claimed', 'ready', 'failed', 'cancelled'];
const BATCH_STATES: CatalogUploadBatchState[] = ['open', 'closed', 'cancelled'];

function boolean(row: Record<string, unknown>, key: string): boolean {
	const value = row[key];
	if (typeof value !== 'boolean') invalid(`Invalid ${key}`);
	return value;
}

export function parseUploadJob(value: unknown): CatalogUploadJob {
	const row = record(value, 'upload job');
	return {
		id: text(row, 'id'),
		batchId: text(row, 'batch_id'),
		assetId: optionalText(row, 'asset_id'),
		sourcePath: text(row, 'source_path'),
		originalName: text(row, 'original_name'),
		claimedMime: text(row, 'claimed_mime'),
		claimedBytes: integer(row, 'claimed_bytes', 1),
		position: integer(row, 'position'),
		stage: oneOf(row, 'stage', STAGES),
		progress: integer(row, 'progress'),
		attempts: integer(row, 'attempts'),
		leaseExpiresAt: nullableTimestamp(row, 'lease_expires_at'),
		errorCode: optionalText(row, 'error_code'),
		errorMessage: optionalText(row, 'error_message'),
		createdAt: timestamp(row, 'created_at'),
		updatedAt: timestamp(row, 'updated_at')
	};
}

function parseUploadJobStatus(value: unknown): CatalogUploadJobStatus {
	const row = record(value, 'upload job status');
	return {
		...parseUploadJob(value),
		stored: boolean(row, 'stored'),
		versionId: optionalText(row, 'version_id')
	};
}

function parseUploadCounts(value: unknown): CatalogUploadCounts {
	const row = record(value, 'upload counts');
	return {
		total: integer(row, 'total'),
		queued: integer(row, 'queued'),
		claimed: integer(row, 'claimed'),
		ready: integer(row, 'ready'),
		failed: integer(row, 'failed'),
		cancelled: integer(row, 'cancelled')
	};
}

export function parseUploadBatchSummary(value: unknown): CatalogUploadBatchSummary {
	const row = record(value, 'upload batch');
	return {
		id: text(row, 'id'),
		state: oneOf(row, 'state', BATCH_STATES),
		createdAt: timestamp(row, 'created_at'),
		counts: parseUploadCounts(row.counts)
	};
}

export function parseUploadStatus(value: unknown): CatalogUploadStatus {
	const row = record(value, 'upload status');
	if (!Array.isArray(row.jobs)) invalid('Invalid upload jobs');
	return {
		batch: parseUploadBatchSummary(row.batch),
		jobs: row.jobs.map(parseUploadJobStatus)
	};
}

/** The batch list is the one read whose payload is `{ok, items, next}`. */
export function readUploadBatchPage(value: unknown): CatalogUploadBatchPage {
	const envelope = record(value, 'upload batch page');
	if (envelope.ok !== true) {
		if (envelope.ok === false && typeof envelope.reason === 'string')
			throw new CatalogError(
				'invalid_data',
				`Catalog upload batches were refused: ${envelope.reason}`
			);
		return invalid('Invalid upload batch page');
	}
	return parseUploadBatchPage(envelope);
}

export function parseUploadBatchPage(value: unknown): CatalogUploadBatchPage {
	const row = record(value, 'upload batch page');
	if (!Array.isArray(row.items)) invalid('Invalid upload batches');
	const next =
		row.next === null || row.next === undefined ? null : record(row.next, 'upload cursor');
	return {
		items: row.items.map(parseUploadBatchSummary),
		nextCursor: next
			? encodeUploadCursor({
					createdAt: timestamp(next, 'created_at'),
					id: text(next, 'id')
				})
			: null
	};
}

/** Claim envelopes carry the lease outside `item`, so they need their own parse. */
export function parseUploadClaimResult(value: unknown): CatalogUploadClaimResult {
	const row = record(value, 'claim result');
	if (row.ok === true) {
		const lease = record(row.lease, 'lease');
		return {
			ok: true,
			item: {
				job: parseUploadJob(row.item),
				leaseToken: text(lease, 'token'),
				leaseExpiresAt: timestamp(lease, 'expires_at')
			}
		};
	}
	return refusalDetail(row, parseUploadJob);
}

export function parseUploadCompletionResult(value: unknown): CatalogUploadCompletionResult {
	const row = record(value, 'completion result');
	if (row.ok === true) {
		return {
			ok: true,
			item: {
				job: parseUploadJob(row.item),
				version: parseAssetVersion(row.version),
				replayed: row.replayed === true
			}
		};
	}
	return refusalDetail(row, parseUploadJob);
}

export function parseUploadObjectList(value: unknown): CatalogUploadObject[] {
	if (!Array.isArray(value)) invalid('Invalid object list');
	return value.map((entry) => {
		const row = record(entry, 'stored object');
		return { path: text(row, 'path'), bytes: integer(row, 'bytes') };
	});
}

export function parseOrphanMedia(value: unknown): CatalogOrphanMedia {
	const row = record(value, 'orphan media');
	return {
		sources: parseUploadObjectList(row.sources),
		derivatives: parseUploadObjectList(row.derivatives),
		sourceTotal: integer(row, 'source_total'),
		derivativeTotal: integer(row, 'derivative_total'),
		truncated: boolean(row, 'truncated')
	};
}

/** Unwraps a read-only RPC envelope; a refusal is a thrown `CatalogError`. */
export function unwrapRead<T>(value: unknown, reason: string, parse: (item: unknown) => T): T {
	const row = record(value, 'catalog result');
	if (row.ok === true) return parse(row.item);
	if (row.ok === false && typeof row.reason === 'string') {
		throw new CatalogError(
			row.reason === 'not_found' ? 'not_found' : 'invalid_data',
			`Catalog ${reason} was refused: ${row.reason}`
		);
	}
	return invalid('Invalid catalog result');
}
