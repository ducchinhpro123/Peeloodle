/**
 * Strict row parsers for the catalog wire shape (snake_case PostgREST rows and
 * RPC results). A malformed row raises `CatalogError('invalid_data')` instead of
 * producing an object with undefined fields.
 */
import {
	CatalogError,
	encodeCatalogCursor,
	type CatalogActionResult,
	type CatalogRefusal
} from './repository';
import type {
	CatalogAsset,
	CatalogAssetKind,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogPage,
	CatalogSlidePreview,
	CatalogState,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateVersion,
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
	'dependency_unavailable'
];

/** Parses one guarded RPC result envelope into a typed action result. */
export function parseActionResult<T>(
	value: unknown,
	parseItem: (item: unknown) => T
): CatalogActionResult<T> {
	const row = record(value, 'action result');
	if (row.ok === true) return { ok: true, item: parseItem(row.item) };
	if (
		row.ok === false &&
		typeof row.reason === 'string' &&
		REFUSALS.includes(row.reason as CatalogRefusal)
	) {
		const detail =
			row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
				? (row.detail as Record<string, unknown>)
				: {};
		return { ok: false, reason: row.reason as CatalogRefusal, detail };
	}
	return invalid('Invalid action result');
}
