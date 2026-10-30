import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBlankEditor, addShape, readStoredPresentationJson } from './presentations';
const host = (page: Page) => page.getByTestId('presentation-canvas');
const layers = (page: Page) => page.locator('.presentation-layer-item');
const stored = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));
const blur = async (page: Page) => {
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
	await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
};
async function evidence(name: string, data: unknown) {
	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		`proofs/out/slide-editor-stage5-review-${name}.json`,
		JSON.stringify(data, null, 2)
	);
}

test('clipboard shortcuts work with body focus and ignore fields outside the editor', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await expect(host(page)).toHaveAttribute('data-ready', 'true');
	await addShape(page, 'rectangle');
	await blur(page);
	await page.keyboard.press('Control+c');
	await page.keyboard.press('Control+v');
	await expect(layers(page)).toHaveCount(2);
	await blur(page);
	await page.keyboard.press('Control+x');
	await expect(layers(page)).toHaveCount(1);
	await page.keyboard.press('Control+v');
	await expect(layers(page)).toHaveCount(2);
	await page.evaluate(() => {
		const input = document.createElement('input');
		input.id = 'outside-editor';
		input.value = 'Outside';
		document.body.append(input);
		input.focus();
		input.select();
	});
	await page.keyboard.press('Control+c');
	await page.keyboard.press('Control+v');
	await expect(layers(page)).toHaveCount(2);
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(2);
	await evidence('body-clipboard', {
		copyPasteFromBody: true,
		cutPasteFromBody: true,
		outsideFieldUntouched: true
	});
});

test('F6 recovers from body and cycles all six editor areas in both directions', async ({
	page
}) => {
	await openBlankEditor(page);
	await expect(host(page)).toHaveAttribute('data-ready', 'true');
	await blur(page);
	const regions = [
		'.presentation-editor-bar',
		'.ribbon',
		'.presentation-slide-rail',
		'.presentation-canvas-panel',
		'.task-pane',
		'.editor-status-bar'
	];
	for (const selector of [...regions, regions[0]]) {
		await page.keyboard.press('F6');
		await expect
			.poll(() => page.locator(selector).evaluate((node) => node.contains(document.activeElement)))
			.toBe(true);
	}
	for (const selector of [...regions].reverse()) {
		await page.keyboard.press('Shift+F6');
		await expect
			.poll(() => page.locator(selector).evaluate((node) => node.contains(document.activeElement)))
			.toBe(true);
	}
	await evidence('six-regions', { order: regions, bodyRecovery: true, reverse: true });
});

test('Align trigger toggles its menu closed on a second click', async ({ page }) => {
	await openBlankEditor(page);
	await addShape(page, 'rectangle');
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	const trigger = page.getByRole('button', { name: 'Align elements', exact: true });
	for (let i = 0; i < 3; i++) {
		await trigger.click();
		await expect(page.getByRole('menu')).toHaveCount(1);
		await trigger.click();
		await expect(page.getByRole('menu')).toHaveCount(0);
	}
	await evidence('align-toggle', { cycles: 3, menuClosed: true });
});

async function field(page: Page, label: string, value: number) {
	const input = page.getByLabel(label, { exact: true });
	await input.fill(String(value));
	await input.press('Enter');
}
async function selectAll(page: Page) {
	await host(page).focus();
	await page.keyboard.press('Control+a');
}
async function layerMenu(page: Page, name: string) {
	const row = page.locator('.presentation-layer-select').filter({ hasText: name }).first();
	await row.focus();
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menu')).toBeVisible();
}

test('AltGr alignment chords never mutate the selected object', async ({ page }) => {
	const id = await openBlankEditor(page);
	await addShape(page, 'rectangle');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(1);
	const before = await readStoredPresentationJson(page, id);
	const original = JSON.parse(before).slides[0].elements[0];
	await host(page).focus();
	for (const key of ['e', 'l', 'r', 't', 'm', 'b']) await page.keyboard.press(`Control+Alt+${key}`);
	await page.evaluate(() =>
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '€',
				code: 'KeyE',
				ctrlKey: true,
				altKey: true,
				bubbles: true
			})
		)
	);
	await expect(page.getByLabel('X position', { exact: true })).toHaveValue(String(original.x));
	await expect(page.getByLabel('Y position', { exact: true })).toHaveValue(String(original.y));
	expect(await readStoredPresentationJson(page, id)).toBe(before);
	await evidence('altgr', { chordsDoNotChangeDeck: true });
});

test('slide panel arrows navigate, duplicate and Delete target slides, and menus move them', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await addShape(page, 'rectangle');
	await page.getByRole('button', { name: 'Add slide', exact: true }).click();
	await page.getByRole('button', { name: 'Add slide', exact: true }).click();
	const cards = page.locator('.presentation-slide-card');
	await cards.first().click();
	await page.keyboard.press('ArrowDown');
	await expect(cards.nth(1)).toBeFocused();
	await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true');
	await page.keyboard.press('ArrowUp');
	await expect(cards.first()).toBeFocused();
	await page.keyboard.press('Control+d');
	await expect(cards).toHaveCount(4);
	await expect(cards.nth(1)).toBeFocused();
	await expect(layers(page)).toHaveCount(1);
	await page.keyboard.press('Delete');
	await expect(cards).toHaveCount(3);
	await page.keyboard.press('Control+z');
	await expect(cards).toHaveCount(4);
	await cards.first().focus();
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menuitem', { name: 'Move up', exact: true })).toBeDisabled();
	await page.getByRole('menuitem', { name: 'Move down', exact: true }).click();
	await expect(cards.nth(1)).toBeFocused();
	await page.keyboard.press('Shift+F10');
	await page.getByRole('menuitem', { name: 'Move up', exact: true }).click();
	await expect(cards.first()).toBeFocused();
	await expect.poll(async () => (await stored(page, id)).slides.length).toBe(4);
	expect((await stored(page, id)).slides[0].elements).toHaveLength(1);
	await evidence('slide-keyboard', {
		arrowsNavigate: true,
		duplicateAndDeleteTargetSlides: true,
		deleteUndo: true,
		moveMenus: true
	});
});

test('distribute uses equal gaps for unequal frames and undoes each axis atomically', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	for (const [x, y, w, h] of [
		[100, 100, 100, 80],
		[300, 180, 200, 120],
		[900, 500, 150, 60]
	]) {
		await addShape(page, 'rectangle');
		await field(page, 'Width', w);
		await field(page, 'Height', h);
		await field(page, 'X position', x);
		await field(page, 'Y position', y);
	}
	await expect.poll(async () => (await stored(page, id)).slides[0].elements[2]?.y).toBe(500);
	const before = (await stored(page, id)).slides[0].elements;
	await selectAll(page);
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	await page.getByRole('button', { name: 'Distribute horizontally', exact: true }).click();
	await expect.poll(async () => (await stored(page, id)).slides[0].elements[1].x).toBe(450);
	await page.keyboard.press('Control+z');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements).toEqual(before);
	await selectAll(page);
	await page.getByRole('button', { name: 'Align elements', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Distribute vertically', exact: true }).click();
	await expect.poll(async () => (await stored(page, id)).slides[0].elements[1].y).toBe(280);
	await page.keyboard.press('Control+z');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements).toEqual(before);
	// A locked interior object becomes a fixed anchor between the outer objects.
	await page.getByRole('tab', { name: 'Home', exact: true }).click();
	await addShape(page, 'rectangle');
	await field(page, 'Width', 100);
	await field(page, 'X position', 1100);
	await page.getByRole('button', { name: 'Lock Rectangle', exact: true }).nth(2).click();
	await expect.poll(async () => (await stored(page, id)).slides[0].elements[1].locked).toBe(true);
	await selectAll(page);
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	await page.getByRole('button', { name: 'Distribute horizontally', exact: true }).click();
	await expect
		.poll(async () => (await stored(page, id)).slides[0].elements.map((element: any) => element.x))
		.toEqual([100, 300, 725, 1100]);
	await page.screenshot({ path: 'proofs/out/slide-editor-stage5-review-arrange.png' });
	await evidence('distribution', {
		unequalFrames: before,
		expectedMiddle: { x: 450, y: 280 },
		eachAxisUndoneTogether: true,
		lockedInteriorAnchorPreserved: true,
		final: (await stored(page, id)).slides[0].elements
	});
});

test('bring forward and send backward move a noncontiguous selection in one undo step', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	for (const x of [100, 350, 600, 850]) {
		await addShape(page, 'rectangle');
		await field(page, 'Width', 150);
		await field(page, 'Height', 100);
		await field(page, 'X position', x);
	}
	await expect.poll(async () => (await stored(page, id)).slides[0].elements[3]?.x).toBe(850);
	const original = (await stored(page, id)).slides[0].elements.map((element: any) => element.id);
	// Select first and third directly on the rendered canvas.
	const { canvasView, at } = await import('./presentations');
	const view = await canvasView(page);
	const a = at(view, 130, 250),
		c = at(view, 630, 250);
	await page.mouse.click(a.x, a.y);
	await page.keyboard.down('Shift');
	await page.mouse.click(c.x, c.y);
	await page.keyboard.up('Shift');
	await expect(host(page)).toHaveAttribute('data-selected-count', '2');
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	await page.getByRole('button', { name: 'Bring forward', exact: true }).click();
	await expect
		.poll(async () => (await stored(page, id)).slides[0].elements.map((element: any) => element.id))
		.toEqual([original[1], original[0], original[3], original[2]]);
	await page.getByRole('button', { name: 'Send backward', exact: true }).click();
	await expect
		.poll(async () => (await stored(page, id)).slides[0].elements.map((element: any) => element.id))
		.toEqual(original);
	await page.keyboard.press('Control+z');
	await expect
		.poll(async () => (await stored(page, id)).slides[0].elements.map((element: any) => element.id))
		.toEqual([original[1], original[0], original[3], original[2]]);
	await page.keyboard.press('Control+z');
	await expect
		.poll(async () => (await stored(page, id)).slides[0].elements.map((element: any) => element.id))
		.toEqual(original);
	await evidence('stacking', {
		original,
		noncontiguousSelection: [original[0], original[2]],
		relativeOrderPreserved: true,
		atomicUndo: true
	});
});

test('context menus expose working edit, replace, format and background actions', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await page.getByTestId('text-edit-field').fill('Context heading');
	await page.keyboard.press('Escape');
	await layerMenu(page, 'Heading');
	await page.getByRole('menuitem', { name: 'Edit text', exact: true }).click();
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Close task pane', exact: true }).click();
	await host(page).focus();
	await page.keyboard.press('Shift+F10');
	await page.getByRole('menuitem', { name: 'Format…', exact: true }).click();
	await expect(page.getByLabel('X position', { exact: true })).toBeFocused();
	await page
		.getByTestId('presentation-image-input')
		.setInputFiles('static/samples/cat-in-console.png');
	await expect.poll(async () => (await stored(page, id)).assets.length).toBe(1);
	const originalImage = (await stored(page, id)).slides[0].elements.find(
		(element: any) => element.kind === 'image'
	);
	await layerMenu(page, 'Image');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace picture', exact: true }).click();
	await (await chooser).setFiles('static/samples/solenodon.png');
	await expect
		.poll(
			async () =>
				(await stored(page, id)).slides[0].elements.find((element: any) => element.kind === 'image')
					?.assetId
		)
		.not.toBe(originalImage.assetId);
	expect(
		(await stored(page, id)).slides[0].elements
			.filter((element: any) => element.kind === 'image')
			.map((element: any) => element.id)
	).toEqual([originalImage.id]);
	await host(page).focus();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Shift+F10');
	await page.getByRole('menuitem', { name: 'Format background…', exact: true }).click();
	await expect(page.getByLabel('Slide background', { exact: true })).toBeFocused();
	await evidence('context-actions', {
		editsText: true,
		replacesImage: true,
		focusesFormat: true,
		focusesBackground: true
	});
});
