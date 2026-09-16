/**
 * The admin-to-student catalog journey (P64), driven through the real screens and
 * the real repositories in one session:
 *
 *   upload (two files that pass, one that cannot be decoded) → per-file results
 *   → publish → insert both into a presentation → save → reopen → export.
 *
 * The processor is a browser-side stand-in that produces genuine PNG derivatives
 * from the real bytes (canvas), because the shipped validator is native code; the
 * native path is covered by `processing/processing.test.ts`. What this test proves
 * is the wiring: the stored bytes are the ones the student inserts, the document
 * keeps catalog provenance, a failed file never becomes a version, private source
 * paths never reach the document, and a reopened deck still has its artwork and
 * exports to a real PDF.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminUploadsPage from './AdminUploadsPage.svelte';
import AdminAssetsPage from './AdminAssetsPage.svelte';
import PresentationEditorPage from '$lib/components/presentation/PresentationEditorPage.svelte';
import '$lib/presentations/rendering/presentation-fonts.css';
import { MemoryCatalog } from '$lib/catalog/memory';
import { ProcessingError } from '$lib/catalog/processing/errors';
import type { ProcessedAsset } from '$lib/catalog/processing/index';
import {
	createMemoryPresentationRepository,
	type MemoryPresentationRepository
} from '$lib/presentations/persistence/repository';
import { createPresentationStore } from '$lib/presentations/editor/store.svelte';
import { prepareExportSnapshot } from '$lib/presentations/exports/snapshot';
import { buildPresentationPdf } from '$lib/presentations/exports/pdf';
import { sha256Hex } from '$lib/hash';
import { createPresentationDocument } from '$lib/presentations/model/factories';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const PRESENTATION_ID = 'catalog-journey';

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 15000
): Promise<NonNullable<T>> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value !== null && value !== undefined && value !== false) return value as NonNullable<T>;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((button) =>
		(button.textContent ?? '').trim().includes(text)
	);
	if (!found) throw new Error(`No button containing “${text}”`);
	return found;
}

function pickFiles(container: HTMLElement, files: File[]): void {
	const input = container.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error('No file input');
	const transfer = new DataTransfer();
	for (const file of files) transfer.items.add(file);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function canvasPng(width: number, height: number): Promise<Uint8Array> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no 2d context');
	context.fillStyle = '#f70';
	context.fillRect(0, 0, width, height);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('no png');
	return new Uint8Array(await blob.arrayBuffer());
}

async function blobOf(bytes: Uint8Array, mime: string): Promise<Blob> {
	return new Blob([bytes as unknown as BlobPart], { type: mime });
}

/**
 * The browser stand-in for the native validator: decode through the browser's own
 * decoders (PNG and SVG both work), draw to a canvas and re-encode as PNG. It has
 * the same contract as `processAssetBytes`, including refusing undecodable bytes.
 */
async function browserProcessor(bytes: Uint8Array): Promise<ProcessedAsset> {
	const source = bytes;
	const format = sniff(source);
	let bitmap: ImageBitmap;
	try {
		bitmap = await decodeToBitmap(
			await blobOf(source, format === 'svg' ? 'image/svg+xml' : 'image/png')
		);
	} catch {
		throw new ProcessingError('decode_failed', 'The image could not be decoded');
	}
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d');
	if (!context) throw new ProcessingError('render_failed', 'No drawing surface');
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	const derivative = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/png')
	);
	if (!derivative)
		throw new ProcessingError('render_failed', 'The derivative could not be encoded');
	const thumbnailCanvas = document.createElement('canvas');
	thumbnailCanvas.width = Math.min(64, canvas.width);
	thumbnailCanvas.height = Math.max(
		1,
		Math.round((canvas.height / canvas.width) * Math.min(64, canvas.width))
	);
	thumbnailCanvas
		.getContext('2d')
		?.drawImage(canvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
	const thumbnail = await new Promise<Blob | null>((resolve) =>
		thumbnailCanvas.toBlob(resolve, 'image/webp')
	);
	if (!thumbnail) throw new ProcessingError('render_failed', 'The thumbnail could not be encoded');
	return {
		sourceFormat: sniff(bytes),
		sourceBytes: source.length,
		sourceSha256: await sha256Hex(source),
		width: canvas.width,
		height: canvas.height,
		png: new Uint8Array(await derivative.arrayBuffer()),
		thumbnail: new Uint8Array(await thumbnail.arrayBuffer())
	};
}

/** Chromium decodes SVG blobs through an image element rather than createImageBitmap. */
async function decodeToBitmap(blob: Blob): Promise<ImageBitmap> {
	try {
		return await createImageBitmap(blob);
	} catch {
		/* SVG and other formats go through an image element. */
	}
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('The image could not be decoded'));
			image.src = url;
		});
		return await createImageBitmap(image);
	} finally {
		URL.revokeObjectURL(url);
	}
}

function sniff(bytes: Uint8Array): ProcessedAsset['sourceFormat'] {
	const head = new TextDecoder().decode(bytes.subarray(0, 200)).trimStart().toLowerCase();
	if (head.startsWith('<svg') || head.includes('<svg')) return 'svg';
	return 'png';
}

const SVG_SAMPLE =
	'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#0a8"/></svg>';

async function seedDeck(repository: MemoryPresentationRepository): Promise<void> {
	await repository.savePresentation(createPresentationDocument({ id: PRESENTATION_ID }));
}

describe('admin upload to student insert journey', () => {
	it(
		'takes real files through review, publication, insertion, reopen and export',
		{ timeout: 90_000 },
		async () => {
			const catalog = new MemoryCatalog({ admins: [ADMIN], process: browserProcessor }, ADMIN);

			// --- Admin: upload a PNG, an SVG and one file the validator must refuse.
			const uploads = render(AdminUploadsPage, { repository: catalog });
			const png = await canvasPng(300, 150);
			pickFiles(uploads.container, [
				new File([png as unknown as BlobPart], 'chart.png', { type: 'image/png' }),
				new File([SVG_SAMPLE], 'logo.svg', { type: 'image/svg+xml' }),
				new File(['not an image at all' as unknown as BlobPart], 'broken.png', {
					type: 'image/png'
				})
			]);
			await waitFor(
				() => !buttonByText(uploads.container, 'Start upload').disabled,
				'the upload button'
			);
			buttonByText(uploads.container, 'Start upload').click();

			await waitFor(
				() => uploads.container.textContent?.includes('2 ready') ?? false,
				'two validated files'
			);
			// The failed file keeps its own row and reason; the other two are unaffected.
			await waitFor(
				() => uploads.container.textContent?.includes('decode_failed') ?? false,
				'the per-file failure reason'
			);
			expect(uploads.container.textContent).toContain('1 failed');
			expect(uploads.container.textContent).not.toContain('Every file in this batch failed');
			expect(uploads.container.textContent).not.toContain(
				'No file in this batch could be validated'
			);
			expect(uploads.container.textContent).toContain('1 failed');
			const failed = catalog.uploadJobs.find((job) => job.stage === 'failed');
			expect(failed?.assetId).toBeTruthy();
			// A failed file never produced a version.
			expect(await catalog.getLatestVersion(failed?.assetId ?? '')).toBeNull();
			await uploads.unmount();

			// --- Admin: review and publish both validated assets.
			const assets = render(AdminAssetsPage, { repository: catalog });
			for (const name of ['chart', 'logo']) {
				const card = await waitFor(
					() =>
						[...assets.container.querySelectorAll<HTMLButtonElement>('button.asset-card')].find(
							(candidate) => (candidate.textContent ?? '').includes(name)
						) ?? null,
					`the ${name} card`
				);
				card.click();
				await waitFor(
					() => assets.container.textContent?.includes('Version 1:') ?? false,
					`the ${name} version facts`
				);
				buttonByText(assets.container, 'Publish').click();
				await waitFor(
					() => assets.container.textContent?.includes('is published') ?? false,
					`${name} to be published`
				);
			}
			await assets.unmount();

			// --- Serve the stored derivative bytes at the signed URLs the picker asks for.
			const served = new Map<string, Uint8Array>();
			for (const object of catalog.objects.filter(
				(object) => object.bucket === 'catalog-derivatives' && object.data
			)) {
				// Unique per object: both derivatives are named asset.png, so the URL has to
				// carry the path or the two assets would resolve to the same bytes.
				const url = `https://example.test/${object.path.replaceAll('/', '_')}`;
				served.set(url, object.data as Uint8Array);
				catalog.derivativeUrls.set(object.path, url);
			}
			const requested: string[] = [];
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async (input: RequestInfo | URL) => {
				const url =
					typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				requested.push(url);
				const bytes = served.get(url);
				if (!bytes) return new Response('not found', { status: 404 });
				return new Response(await blobOf(bytes, 'image/png'), { status: 200 });
			}) as typeof fetch;

			try {
				// --- Student: insert both published images into a presentation.
				const repository = createMemoryPresentationRepository();
				await seedDeck(repository);
				const store = createPresentationStore();
				const editor = await render(PresentationEditorPage, {
					presentationId: PRESENTATION_ID,
					repository,
					catalogRepository: catalog,
					store,
					backhref: '/presentations',
					onback: () => {},
					leaveguard: null
				});
				await waitFor(
					() => editor.container.querySelector('.presentation-editor'),
					'the editor to open'
				);
				buttonByText(editor.container, 'Catalog').click();
				await waitFor(
					() => editor.container.querySelectorAll('button.catalog-item').length === 2,
					'two published catalog items'
				);
				for (const [index, name] of ['chart', 'logo'].entries()) {
					// Insert by name: an index would depend on the catalog's own ordering,
					// and the second round must pick the other tile.
					const tile = await waitFor(
						() =>
							[
								...editor.container.querySelectorAll<HTMLButtonElement>(
									'button.catalog-item:not(:disabled)'
								)
							].find((candidate) => (candidate.textContent ?? '').includes(name)) ?? null,
						`the ${name} tile`
					);
					// Let the lazy preview and the tile's own state settle before clicking.
					await new Promise((resolve) => setTimeout(resolve, 30));
					tile.click();
					await waitFor(
						() =>
							store
								.getState()
								.document?.slides[0]?.elements.filter((element) => element.kind === 'image')
								.length ===
							index + 1,
						`image element ${index + 1}`
					);
					if (index === 0) buttonByText(editor.container, 'Catalog').click();
				}

				const document = store.getState().document;
				if (!document) throw new Error('no document');
				const images =
					document.slides[0]?.elements.filter((element) => element.kind === 'image') ?? [];
				expect(images, 'image elements after two inserts').toHaveLength(2);
				const insertedAssets = document.assets.filter(
					(asset) => asset.provenance.source === 'catalog'
				);
				// Two distinct catalog assets, downloaded through signed URLs. Nothing was
				// copied from Storage directly, so every insert went through a real fetch.
				expect(insertedAssets, 'catalog-provenance assets').toHaveLength(2);
				expect(new Set(insertedAssets.map((asset) => asset.id)).size).toBe(2);
				expect(requested).toHaveLength(2);
				// Private sources never leak into a document: no source path, no bucket name.
				const serialized = JSON.stringify(document);
				expect(serialized).not.toContain('catalog-sources');
				expect(serialized).not.toContain('example.test');

				// --- The bytes are local: they survive closing the editor.
				const stored = await repository.getPresentation(PRESENTATION_ID);
				expect(stored.assets).toHaveLength(2);
				for (const asset of stored.assets) {
					const media = await repository.getMedia(asset.id);
					expect(media.bytes.length).toBe(asset.byteLength);
				}
				await editor.unmount();

				// --- Reopen: the artwork is still there, and it exports to a real PDF.
				const reopenedStore = createPresentationStore();
				const reopened = await render(PresentationEditorPage, {
					presentationId: PRESENTATION_ID,
					repository,
					catalogRepository: null,
					store: reopenedStore,
					backhref: '/presentations',
					onback: () => {},
					leaveguard: null
				});
				await waitFor(
					() => reopened.container.querySelector('.presentation-editor'),
					'the reopened editor'
				);
				const reopenedImages =
					reopenedStore
						.getState()
						.document?.slides[0]?.elements.filter((element) => element.kind === 'image') ?? [];
				expect(reopenedImages).toHaveLength(2);

				const reopenedDocument = reopenedStore.getState().document;
				if (!reopenedDocument) throw new Error('no reopened document');
				const snapshot = await prepareExportSnapshot(repository, reopenedDocument);
				expect(snapshot.images.size).toBeGreaterThanOrEqual(2);
				const pdf = await buildPresentationPdf(snapshot, async () => {
					// A tiny but real PNG page keeps the export fast; the raster path itself
					// is covered by the export suites and the e2e journeys.
					return await canvasPng(16, 9);
				});
				// A complete PDF, not a truncated stream: the trailer only appears at the end.
				expect(pdf.length).toBeGreaterThan(500);
				expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
				expect(new TextDecoder().decode(pdf.subarray(pdf.length - 6))).toContain('%%EOF');
				await reopened.unmount();
			} finally {
				globalThis.fetch = originalFetch;
			}
		}
	);
});
