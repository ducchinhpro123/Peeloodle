/**
 * Template preview generation (P67).
 *
 * Renders each slide from the exact immutable draft document with the fixed-page
 * rasterizer PDF export and library thumbnails already share, uploads the PNGs
 * to the private derivative bucket under the pending version's own path, and
 * finally commits the manifest through the guarded RPC. The commit is what binds
 * the previews to the document hash; a later edit creates another pending
 * version, so these previews cannot be published for a different document.
 *
 * Failure is staged and honest: `render_failed`, `upload_failed` and
 * `attach_refused` name the step, and nothing is attached unless every object
 * was uploaded and the server accepted the whole manifest. Bounded orphaned
 * preview objects are possible when the commit is refused; they are never
 * referenced by a version.
 */

import { sha256Hex } from '#lib/hash.js';
import type {
	CatalogActionResult,
	CatalogRefusal,
	CatalogTemplatePreviewsInput
} from '#lib/catalog/repository.js';
import type { CatalogTemplateDraft } from '#lib/catalog/types.js';
import { rasterizeSlidePage } from '../rendering/rasterizeSlide';
import type { PresentationImageSources } from '../rendering/renderSlide';
import type { PresentationDocument } from '../model/types';

/** Fixed preview page size; 16:9, half the export raster width. */
export const PREVIEW_WIDTH = 960;
export const PREVIEW_HEIGHT = 540;

export function templatePreviewPath(
	templateId: string,
	versionId: string,
	ordinal: number
): string {
	return `templates/${templateId}/${versionId}/preview-${String(ordinal + 1).padStart(2, '0')}.png`;
}

export type TemplatePreviewErrorCode = 'render_failed' | 'upload_failed' | 'attach_refused';

export class TemplatePreviewError extends Error {
	readonly code: TemplatePreviewErrorCode;
	readonly reason?: CatalogRefusal;
	readonly cause?: unknown;

	constructor(
		code: TemplatePreviewErrorCode,
		message: string,
		options?: { reason?: CatalogRefusal; cause?: unknown }
	) {
		super(message);
		this.name = 'TemplatePreviewError';
		this.code = code;
		this.reason = options?.reason;
		this.cause = options?.cause;
	}
}

export type TemplatePreviewProgress = {
	stage: 'rendering' | 'uploading';
	completed: number;
	total: number;
};

export type GenerateTemplatePreviewsInput = {
	templateId: string;
	versionId: string;
	expectedRevision: number;
	documentSha256: string;
	document: PresentationDocument;
	images: PresentationImageSources;
	/** The slide whose raster becomes the cover; clamped to the deck. */
	coverOrdinal: number;
	width?: number;
	height?: number;
	onProgress?: (progress: TemplatePreviewProgress) => void;
	/** Uploads one PNG to the catalog's derivative bucket. */
	upload: (path: string, blob: Blob) => Promise<void>;
	/** The guarded commit; injected so the service is testable without a backend. */
	attach: (
		input: CatalogTemplatePreviewsInput
	) => Promise<CatalogActionResult<CatalogTemplateDraft>>;
	/** Test seam; defaults to the shared Konva rasterizer. */
	rasterize?: typeof rasterizeSlidePage;
};

export async function generateTemplatePreviews(
	input: GenerateTemplatePreviewsInput
): Promise<CatalogTemplateDraft> {
	const slides = input.document.slides;
	if (slides.length === 0)
		throw new TemplatePreviewError('render_failed', 'This draft has no slides to preview.');
	const width = input.width ?? PREVIEW_WIDTH;
	const height = input.height ?? PREVIEW_HEIGHT;
	const rasterize = input.rasterize ?? rasterizeSlidePage;
	const coverOrdinal = Math.min(Math.max(Math.trunc(input.coverOrdinal), 0), slides.length - 1);

	const rendered: {
		ordinal: number;
		path: string;
		png: Uint8Array;
		sha256: string;
		width: number;
		height: number;
	}[] = [];
	for (const [ordinal, slide] of slides.entries()) {
		try {
			const raster = await rasterize({
				slide,
				pageSize: input.document.pageSize,
				images: input.images,
				width,
				height
			});
			rendered.push({
				ordinal,
				path: templatePreviewPath(input.templateId, input.versionId, ordinal),
				png: raster.bytes,
				sha256: await sha256Hex(raster.bytes),
				width,
				height
			});
		} catch (error) {
			throw new TemplatePreviewError(
				'render_failed',
				`Slide ${ordinal + 1} could not be rendered, so no previews were committed.`,
				{ cause: error }
			);
		}
		input.onProgress?.({ stage: 'rendering', completed: ordinal + 1, total: slides.length });
	}

	for (const [index, preview] of rendered.entries()) {
		try {
			// Copy through a view: `Uint8Array.buffer` is ArrayBufferLike, which a
			// Blob cannot take directly.
			const blobBytes = new Uint8Array(preview.png).slice();
			await input.upload(preview.path, new Blob([blobBytes], { type: 'image/png' }));
		} catch (error) {
			throw new TemplatePreviewError(
				'upload_failed',
				`Preview ${index + 1} could not be uploaded, so no previews were committed.`,
				{ cause: error }
			);
		}
		input.onProgress?.({ stage: 'uploading', completed: index + 1, total: rendered.length });
	}

	const result = await input.attach({
		templateId: input.templateId,
		versionId: input.versionId,
		expectedRevision: input.expectedRevision,
		documentSha256: input.documentSha256,
		coverOrdinal,
		previews: rendered.map(({ png, ...preview }) => ({
			...preview,
			bytes: png.length
		}))
	});
	if (!result.ok)
		throw new TemplatePreviewError('attach_refused', attachRefusalMessage(result.reason), {
			reason: result.reason
		});
	return result.item;
}

function attachRefusalMessage(reason: CatalogRefusal): string {
	switch (reason) {
		case 'revision_conflict':
			return 'Another change happened first. Reload the template and generate the previews again.';
		case 'version_not_pending':
			return 'A newer draft version exists. Reload the template and generate previews for it.';
		case 'media_missing':
			return 'The uploaded previews could not be verified. Check the connection and try again.';
		case 'archived':
			return 'This template was archived, so previews were not attached.';
		case 'not_found':
		case 'version_not_found':
			return 'This template no longer exists.';
		case 'invalid_document':
			return 'The preview manifest was refused as invalid.';
		default:
			return 'The previews were refused.';
	}
}
