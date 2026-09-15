/**
 * The P45 ceilings, ported from the source `presentations-reader-limits.spec.ts`.
 *
 * The source built these decks inside the dev server with `/src/...` imports. This
 * port runs against the production build, so the documents come from the real
 * factories in Node (the parser's own contract) and the artwork is generated in
 * the page and written straight into the app's IndexedDB stores. The claims are the
 * ones a reader cares about: the deck opens, and the exported PDF/PPTX carry every
 * slide and every distinct asset.
 */
import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import {
	createImageElement,
	createPresentationDocument,
	createShapeElement,
	createSlide,
	createTextElement,
	type PresentationDocument
} from '../src/lib/presentations/model/factories';
import { openBlankEditor } from './presentations';

/** One generated asset: a fully random PNG, so no two assets can deduplicate. */
type ArtworkPlan = {
	assetId: string;
	edge: number;
	/** Distinct per asset, so every stored PNG has different bytes. */
	seed: number;
};

/**
 * Writes the document plus its media into the app's own stores. The page
 * generates each PNG on a canvas and hashes it there: a byte-heavy deck's artwork
 * never has to cross the CDP boundary, and `sha256`/`byteLength` describe the
 * bytes that are really stored.
 */
async function seedDeck(page: Page, document: PresentationDocument, plan: ArtworkPlan[]) {
	const summary = await page.evaluate(
		async ({ docJson, plan }) => {
			const open = () =>
				new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('stickerlab-local');
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			const doc = JSON.parse(docJson) as {
				assets: Array<{
					id: string;
					sha256: string;
					byteLength: number;
					width: number;
					height: number;
				}>;
			};
			const db = await open();
			const media: Array<{ assetId: string; mimeType: string; bytes: ArrayBuffer }> = [];
			let mediaBytes = 0;
			for (const entry of plan) {
				const canvas = document.createElement('canvas');
				canvas.width = entry.edge;
				canvas.height = entry.edge;
				const context = canvas.getContext('2d');
				if (!context) throw new Error('no 2d context');
				const image = context.createImageData(entry.edge, entry.edge);
				let state = (entry.seed * 2654435761 + 1) >>> 0;
				for (let index = 0; index < image.data.length; index += 4) {
					state = (state * 1664525 + 1013904223) >>> 0;
					image.data[index] = state & 0xff;
					image.data[index + 1] = (state >>> 8) & 0xff;
					image.data[index + 2] = (state >>> 16) & 0xff;
					image.data[index + 3] = 255;
				}
				context.putImageData(image, 0, 0);
				const blob = await new Promise<Blob>((resolve, reject) => {
					canvas.toBlob(
						(value) => (value ? resolve(value) : reject(new Error('toBlob produced nothing'))),
						'image/png'
					);
				});
				const bytes = new Uint8Array(await blob.arrayBuffer());
				const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
				const asset = doc.assets.find((candidate) => candidate.id === entry.assetId);
				if (!asset) throw new Error(`the document has no asset ${entry.assetId}`);
				asset.sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
				asset.byteLength = bytes.length;
				asset.width = entry.edge;
				asset.height = entry.edge;
				mediaBytes += bytes.length;
				media.push({ assetId: entry.assetId, mimeType: 'image/png', bytes: bytes.buffer });
			}
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(['presentations', 'presentationMedia'], 'readwrite');
				tx.objectStore('presentations').put(doc);
				const store = tx.objectStore('presentationMedia');
				for (const record of media) store.put(record);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			const assetCount = doc.assets.length;
			return { mediaBytes, assetCount };
		},
		{ docJson: JSON.stringify(document), plan }
	);
	return summary;
}

async function exportViaDialog(page: Page, label: string, waitMs = 600_000): Promise<Uint8Array> {
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog).toBeVisible();
	const pending = page.waitForEvent('download', { timeout: waitMs });
	pending.catch(() => null);
	await dialog.getByRole('button', { name: label, exact: true }).click();
	const outcome = await Promise.race([
		pending.then((download) => ({ failed: false as const, download })),
		dialog
			.getByRole('alert')
			.waitFor({ timeout: waitMs })
			.then(async () => ({
				failed: true as const,
				message: (await dialog.getByRole('alert').allInnerTexts()).join(' ').trim()
			}))
	]);
	if (outcome.failed)
		throw new Error(
			`the ${label} export reported a failure instead of a download: ${outcome.message}`
		);
	const download: Download = outcome.download;
	const file = await download.path();
	if (!file) throw new Error('the download produced no file');
	await expect(dialog.getByText('Export ready')).toBeVisible({ timeout: waitMs });
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	return new Uint8Array(await readFile(file));
}

async function readPdfFacts(
	bytes: Uint8Array
): Promise<{ pages: number; width: number; height: number }> {
	const pdf = await PDFDocument.load(bytes);
	const { width, height } = pdf.getPage(0).getSize();
	return { pages: pdf.getPageCount(), width, height };
}

function slideEntryNames(entries: string[]): string[] {
	return entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
}

function mediaEntryNames(entries: string[]): string[] {
	return entries.filter((name) => /^ppt\/media\/[^/]+$/.test(name));
}

/** 50 slides, 2 000 elements and 200 distinct assets: the three aggregate ceilings. */
function aggregateCeilingDeck(): { document: PresentationDocument; plan: ArtworkPlan[] } {
	const document = createPresentationDocument({
		id: 'e2e-p45-aggregate',
		title: 'P45 aggregate ceilings deck'
	});
	const plan: ArtworkPlan[] = [];
	document.assets = Array.from({ length: 200 }, (_, index) => {
		const assetId = `p45-asset-${index}`;
		plan.push({ assetId, edge: 96, seed: index + 1 });
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
function byteHeavyDeck(): { document: PresentationDocument; plan: ArtworkPlan[] } {
	const document = createPresentationDocument({
		id: 'e2e-p45-bytes',
		title: 'P45 byte-heavy deck'
	});
	const plan: ArtworkPlan[] = [];
	document.assets = Array.from({ length: 8 }, (_, index) => {
		const assetId = `p45-bytes-asset-${index}`;
		plan.push({ assetId, edge: 1024, seed: index + 101 });
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
	const seeded = await seedDeck(page, document, plan);
	expect(seeded.mediaBytes).toBeGreaterThan(1_000_000);

	await page.goto(`/presentations/${document.id}`);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

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
	const seeded = await seedDeck(page, document, plan);
	// Random 1024² RGBA artwork: the point is bytes per asset, not element count.
	expect(seeded.mediaBytes).toBeGreaterThan(8 * 1024 * 1024);

	await page.goto(`/presentations/${document.id}`);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

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
