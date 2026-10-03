/**
 * The P45 ceilings, ported from the source `presentations-reader-limits.spec.ts`.
 *
 * The source built these decks inside the dev server with `/src/...` imports. This
 * port runs against the production build, so the documents come from the real
 * factories in Node (the parser's own contract) and the artwork is generated in
 * the page and written straight into the app's IndexedDB stores. The claims are the
 * ones a reader cares about: the deck opens, and the exported PDF/PPTX carry every
 * slide and every distinct asset.
 *
 * Deck seeding, export-dialog driving and the PDF/package readers are shared with
 * the other presentation specs through `./presentations`.
 */
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import {
	createImageElement,
	createPresentationDocument,
	createShapeElement,
	createSlide,
	createTextElement,
	type PresentationDocument
} from '../src/lib/presentations/model/factories';
import {
	openBlankEditor,
	seedPresentationStores,
	exportViaDialog,
	readPdfFacts,
	slideEntryNames,
	mediaEntryNames,
	type MediaPlan
} from './presentations';

/** 50 slides, 2 000 elements and 200 distinct assets: the three aggregate ceilings. */
function aggregateCeilingDeck(): { document: PresentationDocument; plan: MediaPlan[] } {
	const document = createPresentationDocument({
		id: 'e2e-p45-aggregate',
		title: 'P45 aggregate ceilings deck'
	});
	const plan: MediaPlan[] = [];
	document.assets = Array.from({ length: 200 }, (_, index) => {
		const assetId = `p45-asset-${index}`;
		plan.push({ kind: 'png', assetId, edge: 96, seed: index + 1 });
		return {
			id: assetId,
			blobKey: `p45/structural/${index}.png`,
			mimeType: 'image/png' as const,
			width: 96,
			height: 96,
			// Filled from the real bytes before the row is written.
			sha256: '0'.repeat(64),
			byteLength: 0,
			provenance: { source: 'upload' as const, label: `P45 structural artwork ${index}` }
		};
	});
	document.slides = [];
	for (let slideIndex = 0; slideIndex < 50; slideIndex += 1) {
		const slide = createSlide({
			id: `p45-slide-${slideIndex}`,
			name: `Slide ${slideIndex + 1}`,
			background: slideIndex % 2 === 0 ? '#ffffff' : '#f6fbf8'
		});
		for (let index = 0; index < 40; index += 1) {
			// 5 rows × 8 columns of 160×144 cells inside the 1280×720 page.
			const cell = {
				x: (index % 8) * 160 + 8,
				y: Math.floor(index / 8) * 144 + 8,
				width: 144,
				height: 128
			};
			const slot = index % 10;
			if (slot === 0) {
				// Four image elements per slide, each a different asset: 200 in total.
				slide.elements.push(
					createImageElement({
						id: `p45-image-${slideIndex}-${index}`,
						name: `Figure ${index}`,
						assetId: `p45-asset-${slideIndex * 4 + Math.floor(index / 10)}`,
						...cell,
						alt: 'P45 structural artwork'
					})
				);
			} else if (slot === 1 || slot === 2) {
				slide.elements.push(
					createTextElement({
						id: `p45-text-${slideIndex}-${index}`,
						name: `Caption ${index}`,
						text: `Ô ${index} · trang ${slideIndex + 1}`,
						fontId: 'be-vietnam-pro',
						size: 16,
						color: '#08152f',
						...cell
					})
				);
			} else {
				slide.elements.push(
					createShapeElement({
						id: `p45-shape-${slideIndex}-${index}`,
						name: `Shape ${index}`,
						shape: slot % 3 === 0 ? 'ellipse' : 'rounded-rectangle',
						fill: slot % 2 === 0 ? '#e6f7ef' : '#ffd166',
						stroke: '#08b879',
						strokeWidth: 2,
						...cell
					})
				);
			}
		}
		document.slides.push(slide);
	}
	return { document, plan };
}

/** 8 slides, one byte-heavy picture each: the media axis, not the element axis. */
function byteHeavyDeck(): { document: PresentationDocument; plan: MediaPlan[] } {
	const document = createPresentationDocument({
		id: 'e2e-p45-bytes',
		title: 'P45 byte-heavy deck'
	});
	const plan: MediaPlan[] = [];
	document.assets = Array.from({ length: 8 }, (_, index) => {
		const assetId = `p45-bytes-asset-${index}`;
		plan.push({ kind: 'png', assetId, edge: 1024, seed: index + 101 });
		return {
			id: assetId,
			blobKey: `p45/bytes/${index}.png`,
			mimeType: 'image/png' as const,
			width: 1024,
			height: 1024,
			sha256: '0'.repeat(64),
			byteLength: 0,
			provenance: { source: 'upload' as const, label: `P45 byte-heavy artwork ${index}` }
		};
	});
	document.slides = Array.from({ length: 8 }, (_, index) => {
		const slide = createSlide({
			id: `p45-bytes-slide-${index}`,
			name: `Photo ${index + 1}`,
			background: '#ffffff'
		});
		slide.elements.push(
			createImageElement({
				id: `p45-bytes-image-${index}`,
				name: `Photo ${index + 1}`,
				assetId: `p45-bytes-asset-${index}`,
				x: 200,
				y: 120,
				width: 880,
				height: 480,
				alt: 'P45 byte-heavy artwork'
			}),
			createTextElement({
				id: `p45-bytes-caption-${index}`,
				name: 'Caption',
				x: 200,
				y: 616,
				width: 880,
				height: 72,
				text: `Ảnh minh họa ${index + 1}: dữ liệu thực địa`,
				fontId: 'be-vietnam-pro',
				size: 24,
				color: '#08152f'
			})
		);
		return slide;
	});
	return { document, plan };
}

test('a deck at the slide, element and asset ceilings exports in measured bounds', async ({
	page
}) => {
	test.setTimeout(900_000);
	const { document, plan } = aggregateCeilingDeck();
	const elements = document.slides.reduce((total, slide) => total + slide.elements.length, 0);
	expect(document.slides).toHaveLength(50);
	expect(elements).toBe(2000);
	expect(document.assets).toHaveLength(200);

	await openBlankEditor(page);
	const seeded = await seedPresentationStores(page, document, plan);
	expect(seeded.mediaBytes).toBeGreaterThan(1_000_000);

	await page.goto(`/presentations/${document.id}`);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();

	const pdfBytes = await exportViaDialog(page, 'Export PDF');
	const pdfFacts = await readPdfFacts(pdfBytes);
	expect(pdfFacts.pages).toBe(50);
	expect({ width: Math.round(pdfFacts.width), height: Math.round(pdfFacts.height) }).toEqual({
		width: 960,
		height: 540
	});

	const pptxBytes = await exportViaDialog(page, 'Export PPTX');
	expect(Buffer.from(pptxBytes.subarray(0, 2)).toString('latin1')).toBe('PK');
	const entries = Object.keys(unzipSync(pptxBytes));
	expect(slideEntryNames(entries)).toHaveLength(50);
	// Each of the 200 distinct assets is embedded once and referenced by picture shapes.
	expect(mediaEntryNames(entries)).toHaveLength(200);
});

test('a byte-heavy deck keeps every artwork in its exports', async ({ page }) => {
	test.setTimeout(900_000);
	const { document, plan } = byteHeavyDeck();

	await openBlankEditor(page);
	const seeded = await seedPresentationStores(page, document, plan);
	// Random 1024² RGBA artwork: the point is bytes per asset, not element count.
	expect(seeded.mediaBytes).toBeGreaterThan(8 * 1024 * 1024);

	await page.goto(`/presentations/${document.id}`);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();

	const pdfBytes = await exportViaDialog(page, 'Export PDF');
	expect((await readPdfFacts(pdfBytes)).pages).toBe(8);

	const pptxBytes = await exportViaDialog(page, 'Export PPTX');
	const entries = Object.keys(unzipSync(pptxBytes));
	expect(slideEntryNames(entries)).toHaveLength(8);
	expect(mediaEntryNames(entries)).toHaveLength(8);
	// The archive carries the stored bytes, so the package cannot be smaller than
	// the artwork it embeds (a dropped or re-encoded picture fails here).
	expect(pptxBytes.length).toBeGreaterThan(seeded.mediaBytes);
});
