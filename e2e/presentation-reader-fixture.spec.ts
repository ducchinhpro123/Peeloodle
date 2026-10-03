/**
 * P44 (Svelte) — the reader fixture from the current app.
 *
 * Builds the P02 fixture plus the two cases a reader must verify (a cropped,
 * flipped and rotated picture, and a rotated text box), writes it and its artwork
 * into the app's own stores, then exports PPTX and PDF through the real Export
 * dialog. With `P44_EVIDENCE=1` it also writes the artifacts the external
 * LibreOffice round-trip script consumes:
 *
 *   P44_EVIDENCE=1 npx playwright test e2e/presentation-reader-fixture.spec.ts
 *   python3 proofs/readers/libreoffice_roundtrip.py \
 *     --pptx proofs/out/p44-svelte-reader-fixture.pptx \
 *     --pdf proofs/out/p44-svelte-reader-fixture.pdf \
 *     --facts proofs/out/p44-svelte-reader-facts.json \
 *     --prefix p44-svelte
 *
 * The facts are derived from the exact document that was exported, so the reader
 * script checks the reader against the export's own contract, not a hand-copied
 * table.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	FIXTURE_IMAGE_ASSET_ID,
	createFixturePresentation,
	fixtureImagePng
} from '../src/lib/presentations/model/fixtures/fixture';
import { createTextElement } from '../src/lib/presentations/model/factories';
import { imageCropSizing, pptxFrame } from '../src/lib/presentations/exports/pptx';
import type { ImageElement } from '../src/lib/presentations/model/types';
import {
	openBlankEditor,
	seedPresentationStores,
	exportViaDialog,
	readPdfFacts
} from './presentations';

const OUT = join(process.cwd(), 'proofs', 'out');
/** Document units are 1/96 inch; LibreOffice reports positions in 1/100 mm. */
const hundredthsMm = (units: number) => Math.round((units / 96) * 2540);

test('P44: the export dialog writes the reader fixture PPTX and PDF', async ({ page }) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	// The P02 fixture plus the two element cases P39 left unverified in a reader.
	const document = createFixturePresentation();
	const slide = document.slides[0]!;
	const image = slide.elements.find((element): element is ImageElement => element.kind === 'image');
	if (!image) throw new Error('the fixture has no image element');
	image.crop = { x: 0.1, y: 0.12, width: 0.7, height: 0.62 };
	image.flipX = true;
	image.rotation = 12;

	const rotated = createTextElement({
		id: 'p44-text-rotated',
		name: 'Rotated note',
		text: 'Xoay văn bản 350 độ',
		fontId: 'be-vietnam-pro',
		size: 28,
		color: '#ffe7a3',
		x: 620,
		y: 560,
		width: 420,
		height: 120
	});
	rotated.rotation = 350;
	rotated.padding = 10;
	rotated.lineHeight = 1.25;
	rotated.verticalAlign = 'top';
	slide.elements.push(rotated);

	const frame = pptxFrame(image);
	const sizing = imageCropSizing(image);
	const facts = {
		id: document.id,
		title: document.title,
		slideCount: document.slides.length,
		slideBackgrounds: document.slides.map((candidate) => candidate.background),
		expectedText: {
			slide1: [
				'Nghiên cứu và trình bày',
				'Building a ',
				'sticker',
				' presentation',
				'Xoay văn bản 350 độ'
			],
			slide2: [
				'Tóm tắt kết quả: ',
				'ấn tượng, rõ ràng và dễ đọc.',
				'Xem hướng dẫn',
				' trước khi nộp bài.',
				'Kết luận và đề xuất.'
			]
		},
		linkUrl: 'https://example.edu/guide',
		image: {
			name: image.name,
			rotation: image.rotation,
			crop: image.crop,
			flipX: image.flipX,
			flipY: image.flipY,
			element: { x: image.x, y: image.y, width: image.width, height: image.height },
			sourcePixels: 256,
			rotationHundredthsDeg: Math.round(image.rotation * 100),
			frameHundredthsMm: {
				x: hundredthsMm(frame.x),
				y: hundredthsMm(frame.y),
				w: hundredthsMm(frame.w),
				h: hundredthsMm(frame.h)
			},
			cropBoxHundredthsMm: {
				x: hundredthsMm(sizing.sizing.x),
				y: hundredthsMm(sizing.sizing.y),
				w: hundredthsMm(sizing.sizing.w),
				h: hundredthsMm(sizing.sizing.h)
			}
		},
		rotatedTextRotationHundredthsDeg: 35000,
		pageSizeHundredthsMm: { width: 33867, height: 19050 },
		pageSizePt: { width: 960, height: 540 }
	};

	// A blank deck first, so the app has created its stores; then the fixture row.
	await openBlankEditor(page);
	const seeded = await seedPresentationStores(page, document, [
		{
			assetId: FIXTURE_IMAGE_ASSET_ID,
			kind: 'provided',
			mimeType: 'image/png',
			bytes: [...fixtureImagePng()]
		}
	]);
	expect(seeded.assetCount).toBe(1);

	await page.goto(`/presentations/${document.id}`);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();

	const pptxBytes = await exportViaDialog(page, 'Export PPTX');
	const pdfBytes = await exportViaDialog(page, 'Export PDF');
	expect(Buffer.from(pptxBytes.subarray(0, 2)).toString('latin1')).toBe('PK');
	expect(Buffer.from(pdfBytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
	const pdfFacts = await readPdfFacts(pdfBytes);
	expect(pdfFacts.pages).toBe(2);
	expect({ width: Math.round(pdfFacts.width), height: Math.round(pdfFacts.height) }).toEqual({
		width: 960,
		height: 540
	});

	if (process.env.P44_EVIDENCE === '1') {
		await mkdir(OUT, { recursive: true });
		await writeFile(join(OUT, 'p44-svelte-reader-fixture.pptx'), pptxBytes);
		await writeFile(join(OUT, 'p44-svelte-reader-fixture.pdf'), pdfBytes);
		await writeFile(
			join(OUT, 'p44-svelte-reader-facts.json'),
			`${JSON.stringify(
				{
					...facts,
					exportedAt: new Date().toISOString(),
					exportPath: 'Export dialog → PresentationEditorPage → exports/pptx.ts | exports/pdf.ts',
					files: {
						pptx: 'proofs/out/p44-svelte-reader-fixture.pptx',
						pptxBytes: pptxBytes.length,
						pdf: 'proofs/out/p44-svelte-reader-fixture.pdf',
						pdfBytes: pdfBytes.length
					},
					pdfPages: pdfFacts.pages,
					pdfPageSizePt: { width: 960, height: 540 },
					notProvenHere:
						'Reader open/edit/save/reopen behaviour is P44 evidence produced by proofs/readers/libreoffice_roundtrip.py, not by this spec.'
				},
				null,
				2
			)}\n`
		);
	}
});
