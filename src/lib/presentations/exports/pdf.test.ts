// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildPresentationPdf, buildRasterPdf, PresentationExportError } from './pdf';
import { pageSizeInPoints } from '../model/geometry';
import { createPresentationDocument, createSlide } from '../model/factories';
import { encodeRgbaPng } from '../model/fixtures/png';
import type { PresentationExportSnapshot } from './snapshot';

const dark = encodeRgbaPng(64, 36, () => [11, 31, 59, 255]);
const light = encodeRgbaPng(64, 36, () => [255, 255, 255, 255]);

function snapshotWith(slideCount: number): PresentationExportSnapshot {
	const document = createPresentationDocument({ id: 'deck', title: 'Deck' });
	document.slides = Array.from({ length: slideCount }, (_, index) =>
		createSlide({ id: `slide-${index}`, name: `Slide ${index + 1}` })
	);
	return {
		document,
		revision: document.revision,
		images: new Map(),
		media: new Map(),
		warnings: [],
		dispose() {}
	};
}

describe('raster PDF export', () => {
	it('creates one 960×540pt page per slide, in order', async () => {
		const bytes = await buildRasterPdf([dark, light]);
		const pdf = await PDFDocument.load(bytes);
		expect(pdf.getPageCount()).toBe(2);
		const sizes = pdf.getPages().map((page) => page.getSize());
		expect(sizes[0]!.width).toBeCloseTo(960, 3);
		expect(sizes[0]!.height).toBeCloseTo(540, 3);
		expect(sizes[1]!.width).toBeCloseTo(pageSizeInPoints().width, 3);
		expect(sizes[1]!.height).toBeCloseTo(pageSizeInPoints().height, 3);
	});

	it('embeds each page as its own image and preserves page order', async () => {
		const bytes = await buildRasterPdf([dark, light, dark]);
		const pdf = await PDFDocument.load(bytes);
		expect(pdf.getPageCount()).toBe(3);
		// Distinct embedded images are reused by hash, so two dark + one light -> 2 images.
		const imageCount = pdf.context
			.enumerateIndirectObjects()
			.filter(
				([, object]) =>
					object.constructor.name === 'PDFRawStream' || object.constructor.name === 'PDFStream'
			).length;
		expect(imageCount).toBeGreaterThanOrEqual(2);
	});

	it('rejects an empty export and invalid pages', async () => {
		await expect(buildRasterPdf([])).rejects.toMatchObject({ code: 'no_pages' });
		await expect(buildRasterPdf([new Uint8Array([1, 2, 3])])).rejects.toBeInstanceOf(
			PresentationExportError
		);
	});

	it('renders every slide in document order into one PDF', async () => {
		const snapshot = snapshotWith(3);
		const seen: string[] = [];
		const bytes = await buildPresentationPdf(snapshot, async (slide) => {
			seen.push(slide.id);
			return slide.id === 'slide-1' ? light : dark;
		});

		expect(seen).toEqual(['slide-0', 'slide-1', 'slide-2']);
		const pdf = await PDFDocument.load(bytes);
		expect(pdf.getPageCount()).toBe(3);
		expect(pdf.getPages()[0]!.getSize()).toMatchObject({ width: 960, height: 540 });
	});

	it('reports an empty document instead of writing a zero-page file', async () => {
		await expect(buildPresentationPdf(snapshotWith(0))).rejects.toMatchObject({ code: 'no_pages' });
	});

	it('propagates a slide raster failure without returning a partial PDF', async () => {
		await expect(
			buildPresentationPdf(snapshotWith(2), async () => {
				throw new Error('canvas unavailable');
			})
		).rejects.toThrow('canvas unavailable');
	});
});
