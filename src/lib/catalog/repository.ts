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
import type {
	CatalogAsset,
	CatalogAssetKind,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogPage,
	CatalogTemplate,
	CatalogTemplateDependency,
	CatalogTemplateVersion
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
	| 'dependency_unavailable';

export type CatalogActionResult<T> =
	{ ok: true; item: T } | { ok: false; reason: CatalogRefusal; detail: Record<string, unknown> };

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
}
