/**
 * PDF export: one fixed-visual raster page per slide.
 *
 * Documented limitation for this release: the PDF is image-based. Text
 * selection and PDF hyperlinks are not provided; PPTX is the editable path.
 * Slides are rasterized by the shared fixed-page renderer (P36) before this
 * module embeds them, so no editor controls or viewport transforms can leak in.
 */

import { PDFDocument } from 'pdf-lib';
import { pageSizeInPoints } from '../model/geometry';
import { rasterizeSlidePage } from '../rendering/rasterizeSlide';
import type { PresentationImageSources } from '../rendering/renderSlide';
import type { PresentationDocument, Slide } from '../model/types';
import type { PresentationExportSnapshot } from './snapshot';

export const PDF_RASTER_PAGE_WIDTH_PX = 1920;
export const PDF_RASTER_PAGE_HEIGHT_PX = 1080;

export type PresentationExportErrorCode = 'no_pages' | 'invalid_page' | 'pdf_failed';

export class PresentationExportError extends Error {
	readonly code: PresentationExportErrorCode;

	constructor(code: PresentationExportErrorCode, message: string) {
		super(message);
		this.name = 'PresentationExportError';
		this.code = code;
	}
}

/** Builds an ordered image-based PDF; page size is exactly 960×540 points. */
export async function buildRasterPdf(pngPages: Uint8Array[]): Promise<Uint8Array> {
	if (pngPages.length === 0)
		throw new PresentationExportError('no_pages', 'A PDF needs at least one slide');
	const pdf = await PDFDocument.create();
	const { width, height } = pageSizeInPoints();
	for (const [index, bytes] of pngPages.entries()) {
		if (bytes.length === 0)
			throw new PresentationExportError('invalid_page', `Slide ${index + 1} has no rendered image`);
		let image;
		try {
			image = await pdf.embedPng(bytes);
		} catch {
			throw new PresentationExportError('invalid_page', `Slide ${index + 1} is not a valid PNG`);
		}
		const page = pdf.addPage([width, height]);
		page.drawImage(image, { x: 0, y: 0, width, height });
	}
	pdf.setProducer('StickerLab');
	pdf.setCreator('StickerLab presentations');
	return pdf.save();
}

/** One full-page raster per slide; injectable so the ordering can be tested without a canvas. */
export type SlideRasterizer = (
	slide: Slide,
	pageSize: PresentationDocument['pageSize'],
	images: PresentationImageSources
) => Promise<Uint8Array>;

const rasterizeForPdf: SlideRasterizer = async (slide, pageSize, images) => {
	const raster = await rasterizeSlidePage({
		slide,
		pageSize,
		images,
		width: PDF_RASTER_PAGE_WIDTH_PX,
		height: PDF_RASTER_PAGE_HEIGHT_PX
	});
	return raster.bytes;
};

/** Raised when a caller cancels an export between slides. */
export class PresentationExportCancelledError extends Error {
	constructor() {
		super('The export was cancelled');
		this.name = 'PresentationExportCancelledError';
	}
}

export type BuildPdfOptions = {
	signal?: AbortSignal;
	/** Called after each slide is rasterized; `completed` counts finished pages. */
	onProgress?: (completed: number, total: number) => void;
};

/**
 * Renders every slide in document order and packages them into one PDF. Each
 * slide is rasterized one at a time on purpose: a 1920×1080 canvas per page is
 * large, and rendering all slides concurrently would spike memory for no gain.
 * Cancellation is checked between slides, so no partial file is ever produced.
 */
export async function buildPresentationPdf(
	snapshot: PresentationExportSnapshot,
	rasterize: SlideRasterizer = rasterizeForPdf,
	options: BuildPdfOptions = {}
): Promise<Uint8Array> {
	const { document, images } = snapshot;
	const total = document.slides.length;
	const pages: Uint8Array[] = [];
	for (const slide of document.slides) {
		if (options.signal?.aborted) throw new PresentationExportCancelledError();
		pages.push(await rasterize(slide, document.pageSize, images));
		options.onProgress?.(pages.length, total);
	}
	return buildRasterPdf(pages);
}
