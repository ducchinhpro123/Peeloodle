/** One replayable evidence set: create, edit with editor conventions, export and reopen. */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import {
	openBlankEditor,
	addShape,
	readStoredPresentationJson,
	readStoredMedia,
	canvasView,
	at,
	paintedPixelsInRect,
	elementRectOnCanvas
} from './presentations';
const OUT = 'proofs/out/slide-editor-stage6';
const host = (page: Page) => page.getByTestId('presentation-canvas');
const stored = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));
async function field(page: Page, label: string, value: number) {
	const node = page.getByLabel(label, { exact: true });
	await node.fill(String(value));
	await node.press('Enter');
}

test('Stage 6 final journey creates, edits, exports and reopens an editable deck', async ({
	page,
	context
}) => {
	test.setTimeout(120_000);
	await mkdir(OUT, { recursive: true });
	await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
	try {
		await page.setViewportSize({ width: 1280, height: 900 });
		const id = await openBlankEditor(page);
		await expect(host(page)).toHaveAttribute('data-ready', 'true');
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		for (let i = 0; i < 4; i++) await page.keyboard.press('F6');
		await expect(host(page)).toBeFocused();
		await page.getByRole('button', { name: 'Add heading', exact: true }).click();
		await page.getByTestId('text-edit-field').fill('Final editor journey');
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Add body text', exact: true }).click();
		await page.getByTestId('text-edit-field').fill('Select together. Arrange. Save. Share.');
		await page.keyboard.press('Escape');
		await addShape(page, 'rectangle');
		await field(page, 'Width', 220);
		await field(page, 'Height', 120);
		await field(page, 'X position', 240);
		await field(page, 'Y position', 440);
		await addShape(page, 'ellipse');
		await field(page, 'Width', 220);
		await field(page, 'Height', 120);
		await field(page, 'X position', 700);
		await field(page, 'Y position', 520);
		await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(4);
		const originalShapes = (await stored(page, id)).slides[0].elements.filter(
			(element: any) => element.kind === 'shape'
		);
		const selectPair = async () => {
			const view = await canvasView(page);
			const first = at(view, 270, 470),
				second = at(view, 730, 550);
			await page.mouse.click(first.x, first.y);
			await page.keyboard.down('Shift');
			await page.mouse.click(second.x, second.y);
			await page.keyboard.up('Shift');
			await expect(host(page)).toHaveAttribute('data-selected-count', '2');
		};
		await selectPair();
		await page.keyboard.press('Control+d');
		await expect(page.locator('.presentation-layer-item')).toHaveCount(6);
		await page.keyboard.press('Control+z');
		await expect(page.locator('.presentation-layer-item')).toHaveCount(4);
		await selectPair();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Control+ArrowLeft');
		await page.keyboard.press('Shift+F10');
		await page.getByRole('menuitem', { name: 'Align top', exact: true }).click();
		await expect
			.poll(async () =>
				(await stored(page, id)).slides[0].elements
					.filter((element: any) => element.kind === 'shape')
					.map((element: any) => ({ x: element.x, y: element.y }))
			)
			.toEqual([
				{ x: 247, y: 440 },
				{ x: 707, y: 440 }
			]);
		await page.keyboard.press('Control+c');
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		await page.keyboard.press('Control+v');
		await expect(page.locator('.presentation-layer-item')).toHaveCount(6);
		await page.keyboard.press('Control+z');
		await expect(page.locator('.presentation-layer-item')).toHaveCount(4);
		await page
			.getByTestId('presentation-image-input')
			.setInputFiles('static/samples/cat-in-console.png');
		await field(page, 'Width', 240);
		await field(page, 'Height', 200);
		await field(page, 'X position', 900);
		await field(page, 'Y position', 100);
		await expect.poll(async () => (await stored(page, id)).assets.length).toBe(1);
		// With the slide panel focused, Ctrl+D duplicates the whole slide.
		await page.locator('.presentation-slide-card').focus();
		await page.keyboard.press('Control+d');
		await expect(page.locator('.presentation-slide-card')).toHaveCount(2);
		await page.keyboard.press('ArrowUp');
		await expect(page.locator('.presentation-slide-card').first()).toBeFocused();
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
		const saved = await stored(page, id);
		expect(saved.slides).toHaveLength(2);
		expect(saved.slides[0].elements).toHaveLength(5);
		const image = saved.slides[0].elements.find((element: any) => element.kind === 'image');
		const imageRect = await elementRectOnCanvas(page, image);
		await expect.poll(() => paintedPixelsInRect(page, imageRect)).toBeGreaterThan(100);
		await page.screenshot({ path: `${OUT}/journey-edited.png` });
		await writeFile(`${OUT}/saved-deck.json`, JSON.stringify(saved, null, 2));
		const files: Record<string, any> = {};
		for (const [label, name] of [
			['Export PDF', 'deck.pdf'],
			['Export PPTX', 'deck.pptx'],
			['Download backup (.zip)', 'deck.stickerlab.zip']
		]) {
			await page.getByRole('button', { name: 'Export', exact: true }).click();
			const pending = page.waitForEvent('download');
			await page
				.getByRole('dialog', { name: 'Export presentation', exact: true })
				.getByRole('button', { name: label, exact: true })
				.click();
			const download = await pending;
			await download.saveAs(`${OUT}/${name}`);
			const bytes = await readFile(`${OUT}/${name}`);
			files[name] = {
				bytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex')
			};
			await page.keyboard.press('Escape');
		}
		const pdf = await PDFDocument.load(await readFile(`${OUT}/deck.pdf`));
		expect(pdf.getPageCount()).toBe(2);
		const pptx = unzipSync(await readFile(`${OUT}/deck.pptx`));
		expect(strFromU8(pptx['ppt/slides/slide1.xml'])).toContain('Final editor journey');
		expect(strFromU8(pptx['ppt/slides/slide2.xml'])).toContain('Final editor journey');
		expect(Object.keys(pptx).some((name) => name.startsWith('ppt/media/'))).toBe(true);
		const backup = unzipSync(await readFile(`${OUT}/deck.stickerlab.zip`));
		expect(JSON.parse(strFromU8(backup['document.json'])).slides).toEqual(saved.slides);
		await page.getByRole('link', { name: 'Back to presentations', exact: true }).click();
		await expect(page).toHaveURL(/\/presentations$/);
		await page.reload();
		await page.getByRole('link', { name: 'Open Untitled presentation', exact: true }).click();
		await expect(host(page)).toHaveAttribute('data-ready', 'true');
		const reopened = await stored(page, id);
		expect(reopened).toEqual(saved);
		await expect
			.poll(async () => paintedPixelsInRect(page, await elementRectOnCanvas(page, image)))
			.toBeGreaterThan(100);
		expect(await readStoredMedia(page)).toHaveLength(1);
		await page.screenshot({ path: `${OUT}/journey-reopened.png` });
		await writeFile(`${OUT}/reopened-deck.json`, JSON.stringify(reopened, null, 2));
		await page.getByRole('link', { name: 'Back to presentations', exact: true }).click();
		await expect(page).toHaveURL(/\/presentations$/);
		await page
			.getByTestId('presentation-restore-input')
			.setInputFiles(`${OUT}/deck.stickerlab.zip`);
		await expect(
			page.getByRole('link', { name: 'Open Untitled presentation (restored)', exact: true })
		).toBeVisible();
		await page
			.getByRole('link', { name: 'Open Untitled presentation (restored)', exact: true })
			.click();
		await expect(host(page)).toHaveAttribute('data-ready', 'true');
		const restoredId = decodeURIComponent(page.url().split('/').pop()!);
		expect(restoredId).not.toBe(id);
		const restored = await stored(page, restoredId);
		// Restoring intentionally gives the deck, slides, objects and artwork new IDs.
		const content = (deck: any) =>
			deck.slides.map(({ id: _slideId, elements, ...slide }: any) => ({
				...slide,
				elements: elements.map(({ id: _elementId, assetId, ...element }: any) => ({
					...element,
					...(assetId
						? { artworkHash: deck.assets.find((asset: any) => asset.id === assetId)?.sha256 }
						: {})
				}))
			}));
		expect(content(restored)).toEqual(content(saved));
		expect(restored.slides[0].id).not.toBe(saved.slides[0].id);
		expect(restored.slides[0].elements[0].id).not.toBe(saved.slides[0].elements[0].id);
		expect(restored.assets[0].sha256).toBe(saved.assets[0].sha256);
		await writeFile(
			`${OUT}/journey.json`,
			JSON.stringify(
				{
					id,
					restoredId,
					slides: saved.slides.length,
					elementsPerSlide: saved.slides.map((slide: any) => slide.elements.length),
					originalShapes,
					checks: [
						'F6 body recovery',
						'Shift selection',
						'group duplicate and undo',
						'coarse and fine nudge',
						'context-menu alignment',
						'BODY clipboard paste',
						'slide-panel duplicate',
						'image pixels',
						'PDF pages',
						'editable PPTX text and artwork',
						'exact reopen',
						'backup restoration'
					],
					exports: files
				},
				null,
				2
			)
		);
	} finally {
		await context.tracing.stop({ path: `${OUT}/journey-trace.zip` });
	}
});
