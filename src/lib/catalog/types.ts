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
