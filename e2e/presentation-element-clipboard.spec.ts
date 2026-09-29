import { expect, test } from '@playwright/test';
import {
	elementRectOnCanvas,
	openBlankEditor,
	paintedPixelsInRect,
	readStoredMedia,
	readStoredPresentationJson
} from './presentations';

const PHOTO = 'static/samples/cat-in-console.png';
const stored = async (page: import('@playwright/test').Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));

test('copies editable elements across slides and keeps artwork and undo intact', async ({
	page
}, testInfo) => {
	const id = await openBlankEditor(page);
	const paste = page.getByRole('button', { name: 'Paste element', exact: true });
	const copy = page.getByRole('button', { name: 'Copy element', exact: true });
	await expect(paste).toBeDisabled();
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await expect(copy).toBeDisabled();
	await page.getByTestId('text-edit-field').fill('Reusable heading');
	await page.keyboard.press('Escape');
	await page.locator('.presentation-layer-select').filter({ hasText: 'Heading' }).click();
	await expect.poll(async () => (await stored(page, id)).slides[0]?.elements.length).toBe(1);
	await page.keyboard.press('Control+c');
	await expect(paste).toBeEnabled();
	const source = (await stored(page, id)).slides[0].elements.find(
		(element: any) => element.kind === 'text'
	);
	await page.getByRole('button', { name: 'Add slide', exact: true }).click();
	await expect(copy).toBeDisabled();
	await page.keyboard.press('Control+v');
	await expect(page.getByRole('button', { name: 'text Heading' })).toHaveCount(1);
	await expect.poll(async () => (await stored(page, id)).slides[1]?.elements.length).toBe(1);
	let deck = await stored(page, id);
	const pastedText = deck.slides[1].elements[0];
	expect(pastedText).toMatchObject({
		kind: 'text',
		x: source.x,
		y: source.y,
		locked: false,
		visible: true,
		paragraphs: source.paragraphs
	});
	expect(pastedText.id).not.toBe(source.id);
	await paste.click();
	await expect.poll(async () => (await stored(page, id)).slides[1]?.elements.length).toBe(2);
	deck = await stored(page, id);
	const repeated = deck.slides[1].elements[1];
	expect(repeated).toMatchObject({ x: source.x + 24, y: source.y + 24 });
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);

	// A text field retains native paste behavior: it must not create an element.
	await page.locator('.presentation-layer-select').filter({ hasText: 'Heading' }).click();
	await page.getByRole('button', { name: 'Edit text' }).click();
	await page.getByTestId('text-edit-field').focus();
	await expect(paste).toBeDisabled();
	await page.keyboard.press('Control+v');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);
	await page.keyboard.press('Escape');

	// A hidden, locked shape's styling survives copying after source removal,
	// but the paste is visible and editable. The clipboard does not survive reload.
	await page.getByRole('button', { name: 'Show slide 1: Slide 1' }).click();
	await page.getByLabel('Add shape', { exact: true }).selectOption('rectangle');
	await expect.poll(async () => (await stored(page, id)).slides[0]?.elements.length).toBe(2);
	await page.locator('.presentation-layer-select').filter({ hasText: 'Rectangle' }).click();
	await page.getByRole('button', { name: 'Hide Rectangle' }).click();
	await page.getByRole('button', { name: 'Lock Rectangle' }).click();
	await expect
		.poll(
			async () =>
				(await stored(page, id)).slides[0].elements.find((element: any) => element.kind === 'shape')
					?.locked
		)
		.toBe(true);
	const shape = (await stored(page, id)).slides[0].elements.find(
		(element: any) => element.kind === 'shape'
	);
	await copy.click();
	await page.keyboard.press('Delete');
	await expect.poll(async () => (await stored(page, id)).slides[0]?.elements.length).toBe(1);
	await page.getByRole('button', { name: 'Show slide 2: Slide 2' }).click();
	await page.keyboard.press('Control+v');
	await expect.poll(async () => (await stored(page, id)).slides[1]?.elements.length).toBe(2);
	const pastedShape = (await stored(page, id)).slides[1].elements.find(
		(element: any) => element.kind === 'shape'
	);
	expect(pastedShape).toMatchObject({
		shape: shape.shape,
		fill: shape.fill,
		stroke: shape.stroke,
		x: shape.x,
		y: shape.y,
		visible: true,
		locked: false
	});
	expect(pastedShape.id).not.toBe(shape.id);

	await page.getByRole('button', { name: 'Show slide 1: Slide 1' }).click();
	await page.getByTestId('presentation-image-input').setInputFiles(PHOTO);
	await expect.poll(async () => (await stored(page, id)).assets.length).toBe(1);
	await page.locator('.presentation-layer-select').filter({ hasText: 'Image' }).click();
	await copy.click();
	await page.getByRole('button', { name: 'Show slide 2: Slide 2' }).click();
	await paste.click();
	await expect.poll(async () => (await stored(page, id)).slides[1].elements.length).toBe(3);
	deck = await stored(page, id);
	const originalImage = deck.slides[0].elements.find((element: any) => element.kind === 'image');
	const pastedImage = deck.slides[1].elements.find((element: any) => element.kind === 'image');
	expect(pastedImage).toMatchObject({
		assetId: originalImage.assetId,
		x: originalImage.x,
		y: originalImage.y,
		locked: false,
		visible: true
	});
	expect(pastedImage.id).not.toBe(originalImage.id);
	expect(deck.assets).toHaveLength(1);
	expect(await readStoredMedia(page)).toHaveLength(1);
	const imageRect = await elementRectOnCanvas(page, pastedImage);
	await expect.poll(() => paintedPixelsInRect(page, imageRect)).toBeGreaterThan(30);
	await page.screenshot({ path: testInfo.outputPath('cross-slide-element-paste.png') });
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(async () => (await stored(page, id)).slides[1].elements.length).toBe(3);
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	await expect(paste).toBeDisabled();
	await page.getByRole('button', { name: 'Show slide 2: Slide 2' }).click();
	const reopened = await stored(page, id);
	expect(reopened.slides[1].elements).toEqual(deck.slides[1].elements);
	await expect.poll(() => paintedPixelsInRect(page, imageRect)).toBeGreaterThan(30);
});
