/**
 * P45 (Svelte) capacity evidence: the 200 MiB media budget, the per-slide element
 * ceiling and the document-size ceiling, measured with real bytes through the
 * app's own stores and the real export dialog.
 *
 * The probes are heavy (hundreds of MiB, big documents) and deliberately excluded
 * from the default suite; the `P45_EVIDENCE` gate turns them on:
 *
 *   P45_EVIDENCE=1 npx playwright test e2e/presentation-limits-evidence.spec.ts
 *
 * Each test writes one report under `proofs/out/p45-svelte-*-report.json` with the
 * measured numbers and the environment. Generated media stays in
 * `/tmp/stickerlab-p45`; only the reports are committed.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, release, totalmem, type } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { encodeRgbaPng } from '../src/lib/presentations/model/fixtures/png';
import {
	createImageElement,
	createPresentationDocument,
	createShapeElement,
	createSlide,
	createTextElement
} from '../src/lib/presentations/model/factories';
import { PRESENTATION_LIMITS } from '../src/lib/presentations/model/limits';
import {
	parsePresentationDocument,
	presentationDocumentToJson
} from '../src/lib/presentations/model/parse';
import {
	addShape,
	exportViaDialog,
	openBlankEditor,
	readPdfFacts,
	readStoredPresentation,
	readStoredPresentationJson,
	seedPresentationStores,
	slideEntryNames
} from './presentations';

const OUT = join(process.cwd(), 'proofs', 'out');
const LARGE = join('/tmp', 'stickerlab-p45');
const MIB = 1024 * 1024;

function gitState(): { revision: string; dirtyWorkingTree: boolean } {
	const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	const dirtyWorkingTree =
		execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
	return { revision, dirtyWorkingTree };
}

async function environment(page: Page, browser: Browser) {
	return {
		browser: `${browser.browserType().name()} ${browser.version()}`,
		node: process.version,
		os: `${type()} ${release()}`,
		arch: process.arch,
		cpus: cpus().length,
		totalMemoryBytes: totalmem(),
		devicePixelRatio: await page.evaluate(() => window.devicePixelRatio)
	};
}

/** Chromium's precise JS heap via CDP (not `performance.memory`, which is quantized). */
async function heapUsed(page: Page): Promise<number> {
	const session = await page.context().newCDPSession(page);
	try {
		await session.send('Performance.enable');
		const { metrics } = await session.send('Performance.getMetrics');
		return Math.round(metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0);
	} finally {
		await session.detach();
	}
}

/* ------------------------------------------------------------------ */
/* Node-side padded PNGs for the budget test                           */
/* ------------------------------------------------------------------ */

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** A real noise PNG with a private ancillary chunk padded to exactly `targetBytes`. */
function paddedPng(edge: number, seed: number, targetBytes: number): Buffer {
	let state = seed >>> 0;
	const base = encodeRgbaPng(edge, edge, () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return [state & 0xff, (state >>> 8) & 0xff, (state >>> 16) & 0xff, 255];
	});
	if (base.length + 12 > targetBytes)
		throw new Error(`the base PNG is already larger than ${targetBytes} bytes`);
	const dataLength = targetBytes - base.length - 12;
	const chunk = new Uint8Array(12 + dataLength);
	new DataView(chunk.buffer).setUint32(0, dataLength);
	chunk.set([0x70, 0x72, 0x56, 0x74], 4); // "prVt": ancillary, private metadata chunk
	new DataView(chunk.buffer).setUint32(8 + dataLength, crc32(chunk.subarray(4, 8 + dataLength)));
	const out = Buffer.alloc(targetBytes);
	out.set(base.subarray(0, base.length - 12), 0);
	out.set(chunk, base.length - 12);
	out.set(base.subarray(base.length - 12), base.length - 12 + chunk.length);
	return out;
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function writeReport(
	name: string,
	payload: Record<string, unknown>,
	page: Page,
	browser: Browser
): Promise<void> {
	await mkdir(OUT, { recursive: true });
	await writeFile(
		join(OUT, name),
		`${JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				git: gitState(),
				environment: await environment(page, browser),
				...payload
			},
			null,
			2
		)}\n`
	);
}

test.describe('P45 capacity evidence', () => {
	test.skip(!process.env.P45_EVIDENCE, 'set P45_EVIDENCE=1 to run the P45 capacity probes');

	test('P45: the media budget accepts what fits and refuses the image that crosses it', async ({
		page,
		browser
	}) => {
		test.setTimeout(2_400_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		// 190 MiB across three valid, padded PNGs: two images fit (1 MiB), the
		// third (12 MiB) crosses the 200 MiB budget.
		const sizes = [64 * MIB, 64 * MIB, 62 * MIB];
		const document = createPresentationDocument({
			id: 'p45-svelte-budget',
			title: 'P45 media budget deck'
		});
		document.assets = [];
		document.slides = [];
		sizes.forEach((_, index) => {
			const assetId = `p45-budget-${index}`;
			document.assets.push({
				id: assetId,
				blobKey: `p45/budget/${index}.png`,
				mimeType: 'image/png',
				width: 128,
				height: 128,
				sha256: '0'.repeat(64),
				byteLength: 0,
				provenance: { source: 'upload', label: `Padded artwork ${index}` }
			});
			const slide = createSlide({
				id: `p45-budget-slide-${index}`,
				name: `Slide ${index + 1}`,
				background: '#ffffff'
			});
			slide.elements.push(
				createImageElement({
					id: `p45-budget-image-${index}`,
					name: `Figure ${index + 1}`,
					assetId,
					x: 200,
					y: 120,
					width: 880,
					height: 560,
					alt: 'Padded artwork'
				})
			);
			document.slides.push(slide);
		});

		await mkdir(LARGE, { recursive: true });
		const underBytes = paddedPng(64, 11, 1 * MIB);
		const overBytes = paddedPng(64, 99, 12 * MIB);
		const underPath = join(LARGE, 'p45-under-budget.png');
		const overPath = join(LARGE, 'p45-over-budget.png');
		await writeFile(underPath, underBytes);
		await writeFile(overPath, overBytes);

		await openBlankEditor(page);
		const heapBeforeSeed = await heapUsed(page);
		const seedStart = Date.now();
		const seeded = await seedPresentationStores(
			page,
			document,
			sizes.map((size, index) => ({
				assetId: `p45-budget-${index}`,
				kind: 'paddedPng' as const,
				edge: 128,
				seed: index + 7,
				targetBytes: size
			}))
		);
		const seedMs = Date.now() - seedStart;
		expect(seeded.mediaBytes).toBe(190 * MIB);

		const openStart = Date.now();
		await page.goto(`/presentations/${document.id}`);
		await expect(page.getByTestId('presentation-canvas')).toBeVisible({ timeout: 180_000 });
		await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
			timeout: 180_000
		});
		const openMs = Date.now() - openStart;
		const heapAfterOpen = await heapUsed(page);

		// 1 MiB fits under the budget.
		const underStart = Date.now();
		await page.setInputFiles('[data-testid="presentation-image-input"]', underPath);
		await expect
			.poll(async () => (await readStoredPresentation(page, document.id))?.assetIds.length ?? 0, {
				timeout: 180_000
			})
			.toBe(4);
		const underInsertMs = Date.now() - underStart;
		const afterUnder = await readStoredPresentationJson(page, document.id);

		// 12 MiB crosses it: refused with the action's own message, and nothing written.
		const overStart = Date.now();
		await page.setInputFiles('[data-testid="presentation-image-input"]', overPath);
		const alert = page.locator('.asset-error');
		await expect(alert).toContainText('200.0 MB', { timeout: 120_000 });
		const overRefusalMs = Date.now() - overStart;
		const message = ((await alert.textContent()) ?? '').trim();
		const afterOver = await readStoredPresentationJson(page, document.id);
		expect(afterOver).toBe(afterUnder);
		expect((await readStoredPresentation(page, document.id))?.assetIds.length).toBe(4);
		expect(seeded.mediaBytes + overBytes.length).toBeGreaterThan(PRESENTATION_LIMITS.maxMediaBytes);

		await writeReport(
			'p45-svelte-media-budget-report.json',
			{
				deck: { id: document.id, slides: document.slides.length, assets: document.assets.length },
				mediaBudget: {
					limitBytes: PRESENTATION_LIMITS.maxMediaBytes,
					limitMib: PRESENTATION_LIMITS.maxMediaBytes / MIB,
					storedBytes: seeded.mediaBytes,
					storedMib: seeded.mediaBytes / MIB,
					seedMs,
					openMs,
					heapBeforeSeedBytes: heapBeforeSeed,
					heapAfterOpenBytes: heapAfterOpen,
					underBudget: {
						path: underPath,
						bytes: underBytes.length,
						sha256: sha256(underBytes),
						insertMs: underInsertMs,
						assetIdsAfter: 4
					},
					overBudget: {
						path: overPath,
						bytes: overBytes.length,
						sha256: sha256(overBytes),
						refusalMs: overRefusalMs,
						message,
						documentUnchanged: true
					}
				},
				notes: [
					'The stored bytes are real, decodable PNGs: an ancillary private chunk pads each to an exact size, so the byte budget is hit precisely instead of approximately.',
					'The under-budget image went through the real file input, validation, persist-first insert and IndexedDB write; the over-budget one was refused before any write (document bytes identical).',
					'Heap numbers are Chromium JSHeapUsedSize from the CDP Performance domain; they cover JS objects and Konva nodes, not IndexedDB storage or decoded image bitmaps, which live outside the JS heap.',
					'The stored bytes are byte-padded PNGs whose pixels are only 128×128, so this probe measures the byte budget, not decoded-bitmap memory at the budget.'
				]
			},
			page,
			browser
		);
	});

	test('P45: a slide at the 200-element ceiling opens and exports both formats', async ({
		page,
		browser
	}) => {
		test.setTimeout(1_200_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		const document = createPresentationDocument({
			id: 'p45-svelte-elements',
			title: 'P45 per-slide ceiling deck'
		});
		const slide = document.slides[0]!;
		slide.id = 'p45-elements-slide-0';
		slide.name = 'Slide 1';
		for (let index = 0; index < PRESENTATION_LIMITS.maxElementsPerSlide; index += 1) {
			// 20 columns × 10 rows of 62×68 cells inside the 1280×720 page.
			const cell = {
				x: (index % 20) * 62 + 6,
				y: Math.floor(index / 20) * 68 + 6,
				width: 56,
				height: 60
			};
			if (index % 2 === 0) {
				slide.elements.push(
					createShapeElement({
						id: `p45-el-shape-${index}`,
						name: `Shape ${index}`,
						shape: index % 4 === 0 ? 'ellipse' : 'rectangle',
						fill: '#e6f7ef',
						stroke: '#08b879',
						strokeWidth: 1,
						...cell
					})
				);
			} else {
				slide.elements.push(
					createTextElement({
						id: `p45-el-text-${index}`,
						name: `Caption ${index}`,
						text: `Ô ${index}`,
						fontId: 'be-vietnam-pro',
						size: 10,
						color: '#08152f',
						...cell
					})
				);
			}
		}
		expect(slide.elements).toHaveLength(PRESENTATION_LIMITS.maxElementsPerSlide);
		const jsonBytes = presentationDocumentToJson(document).length;

		await openBlankEditor(page);
		const heapBeforeOpen = await heapUsed(page);
		const seeded = await seedPresentationStores(page, document, []);
		expect(seeded.assetCount).toBe(0);

		const openStart = Date.now();
		await page.goto(`/presentations/${document.id}`);
		await expect(page.getByTestId('presentation-canvas')).toBeVisible({ timeout: 120_000 });
		await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
			timeout: 120_000
		});
		const openMs = Date.now() - openStart;
		const heapAfterOpen = await heapUsed(page);

		const pdfStart = Date.now();
		const pdfBytes = await exportViaDialog(page, 'Export PDF');
		const pdfMs = Date.now() - pdfStart;
		const pdfFacts = await readPdfFacts(pdfBytes);

		const pptxStart = Date.now();
		const pptxBytes = await exportViaDialog(page, 'Export PPTX');
		const pptxMs = Date.now() - pptxStart;
		const entries = Object.keys(unzipSync(pptxBytes));

		expect(pdfFacts.pages).toBe(1);
		expect(slideEntryNames(entries)).toHaveLength(1);

		await writeReport(
			'p45-svelte-elements-report.json',
			{
				deck: {
					id: document.id,
					slides: document.slides.length,
					elementsOnSlide: slide.elements.length,
					limitPerSlide: PRESENTATION_LIMITS.maxElementsPerSlide,
					documentChars: jsonBytes
				},
				measurements: {
					openMs,
					pdfMs,
					pdfPages: pdfFacts.pages,
					pptxMs,
					pptxSlideParts: slideEntryNames(entries).length,
					heapBeforeOpenBytes: heapBeforeOpen,
					heapAfterOpenBytes: heapAfterOpen
				},
				notes: [
					'The deck sits exactly on the per-slide element ceiling; the parser and the store refuse one more.',
					'Both exports ran through the real dialog and their artifacts were inspected (PDF page count, PPTX slide parts).'
				]
			},
			page,
			browser
		);
	});

	test('P45: a document close to the 8 MiB JSON ceiling opens, saves and exports', async ({
		page,
		browser
	}) => {
		test.setTimeout(1_800_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		const document = createPresentationDocument({
			id: 'p45-svelte-size',
			title: 'P45 document-size deck'
		});
		document.slides = [];
		const target = 7.4 * MIB;
		while (document.slides.length < PRESENTATION_LIMITS.maxSlides) {
			const index = document.slides.length;
			// 200 paragraphs × 20 runs × 5 chars = 20 000 chars, the per-element text
			// ceiling; the run/paragraph counts give the JSON real bulk.
			const paragraphs = Array.from({ length: 200 }, () => ({
				runs: Array.from({ length: 20 }, () => ({
					text: 'abcde',
					fontId: 'be-vietnam-pro',
					size: 14,
					color: '#08152f'
				})),
				alignment: 'left' as const,
				bullet: 'none' as const,
				bulletLevel: 0 as const
			}));
			const element = createTextElement({
				id: `p45-size-text-${index}`,
				name: `Long text ${index}`,
				text: 'abcde',
				x: 24,
				y: 24,
				width: 1232,
				height: 672
			});
			element.paragraphs = paragraphs;
			const slide = createSlide({
				id: `p45-size-slide-${index}`,
				name: `Slide ${index + 1}`,
				background: '#ffffff'
			});
			slide.elements.push(element);
			document.slides.push(slide);
			if (JSON.stringify(document).length >= target) break;
		}

		const json = presentationDocumentToJson(document);
		expect(json.length).toBeLessThan(PRESENTATION_LIMITS.maxDocumentChars);
		const parseStart = performance.now();
		parsePresentationDocument(json);
		const nodeParseMs = performance.now() - parseStart;

		await openBlankEditor(page);
		const heapBeforeOpen = await heapUsed(page);
		await seedPresentationStores(page, document, []);

		const openStart = Date.now();
		await page.goto(`/presentations/${document.id}`);
		await expect(page.getByTestId('presentation-canvas')).toBeVisible({ timeout: 180_000 });
		await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
			timeout: 180_000
		});
		const openMs = Date.now() - openStart;
		const heapAfterOpen = await heapUsed(page);

		// One real edit and its save prove the near-ceiling document writes back.
		const saveStart = Date.now();
		await addShape(page, 'rectangle');
		await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
			timeout: 180_000
		});
		const saveMs = Date.now() - saveStart;

		const pptxStart = Date.now();
		const pptxBytes = await exportViaDialog(page, 'Export PPTX');
		const pptxMs = Date.now() - pptxStart;
		const entries = Object.keys(unzipSync(pptxBytes));
		expect(slideEntryNames(entries)).toHaveLength(document.slides.length);

		await writeReport(
			'p45-svelte-document-size-report.json',
			{
				deck: {
					id: document.id,
					slides: document.slides.length,
					elements: document.slides.length,
					documentChars: json.length,
					limitChars: PRESENTATION_LIMITS.maxDocumentChars,
					ratio: json.length / PRESENTATION_LIMITS.maxDocumentChars,
					textCharsPerElement: 20_000,
					limitTextLength: PRESENTATION_LIMITS.maxTextLength
				},
				measurements: {
					nodeParseMs,
					openMs,
					saveMs,
					pptxMs,
					pptxSlideParts: slideEntryNames(entries).length,
					heapBeforeOpenBytes: heapBeforeOpen,
					heapAfterOpenBytes: heapAfterOpen
				},
				notes: [
					'Each slide carries one text element at the per-element text ceiling (200 paragraphs × 20 runs), which is what gives the JSON its bulk.',
					'The save is a real command (a new rectangle) written through the autosave coordinator; "Saved in this browser" is the app’s own confirmation.',
					'This probe measures capacity; it does not exercise rejection of over-limit documents.'
				]
			},
			page,
			browser
		);
	});
});
