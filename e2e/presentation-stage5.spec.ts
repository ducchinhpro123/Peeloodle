/** Stage 5 journeys against the production app, including real browser clipboard data. */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import {
	addShape,
	canvasView,
	at,
	openBlankEditor,
	readStoredPresentationJson,
	readStoredMedia
} from './presentations';

const host = (page: Page) => page.getByTestId('presentation-canvas');
const stored = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));
const layers = (page: Page) => page.locator('.presentation-layer-item');
const menu = (page: Page) => page.getByRole('menu');
async function evidence(name: string, value: unknown) {
	await mkdir('proofs/out', { recursive: true });
	await writeFile(`proofs/out/slide-editor-stage5-${name}.json`, JSON.stringify(value, null, 2));
}
async function ready(page: Page) {
	await expect(host(page)).toHaveAttribute('data-ready', 'true');
}
async function selectAll(page: Page) {
	await host(page).focus();
	await page.keyboard.press('Control+a');
}

// No mocks in the menu and clipboard journeys: these use Chromium's OS clipboard.
test('context menus target the clicked object, retain multi-selection, and fit the viewport', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await ready(page);
	await addShape(page, 'rectangle');
	await page.getByLabel('X position', { exact: true }).fill('100');
	await page.getByLabel('X position', { exact: true }).press('Enter');
	await addShape(page, 'ellipse');
	await page.getByLabel('X position', { exact: true }).fill('700');
	await page.getByLabel('X position', { exact: true }).press('Enter');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(2);
	const deck = await stored(page, id);
	const first = deck.slides[0].elements[0];
	const point = at(await canvasView(page), first.x + 30, first.y + 30);
	await page.mouse.click(point.x, point.y, { button: 'right' });
	await expect(menu(page)).toHaveAccessibleName('Element actions');
	await page.screenshot({ path: 'proofs/out/slide-editor-stage5-element-menu.png' });
	await expect(host(page)).toHaveAttribute('data-selected-element', first.id);
	await expect(menu(page).getByRole('menuitem', { name: /^Cut/ })).toBeFocused();
	await page.keyboard.press('End');
	await expect(menu(page).getByRole('menuitem', { name: /^Align bottom/ })).toBeFocused();
	await page.keyboard.press('Home');
	await page.keyboard.press('Escape');
	await expect(host(page)).toBeFocused();
	await selectAll(page);
	await page.mouse.click(point.x, point.y, { button: 'right' });
	await expect(host(page)).toHaveAttribute('data-selected-count', '2');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Shift+F10');
	await expect(menu(page)).toBeVisible();
	await menu(page)
		.getByRole('menuitem', { name: /^Duplicate element/ })
		.click();
	await expect(layers(page)).toHaveCount(4);
	await page.keyboard.press('Control+z');
	await expect(layers(page)).toHaveCount(2);

	await page.setViewportSize({ width: 1024, height: 768 });
	// Let the browser deliver resize before opening a menu (resize dismisses menus).
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
	const box = (await host(page).boundingBox())!;
	await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6, { button: 'right' });
	await expect(menu(page)).toHaveAccessibleName('Canvas actions');
	await expect(host(page)).toHaveAttribute('data-selected-count', '0');
	const rect = (await menu(page).boundingBox())!;
	expect(rect.x).toBeGreaterThanOrEqual(0);
	expect(rect.y + rect.height).toBeLessThanOrEqual(768);
	expect(rect.x + rect.width).toBeLessThanOrEqual(1024);
	await page.screenshot({ path: 'proofs/out/slide-editor-stage5-context-menu.png' });
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	await expect(menu(page)).toHaveCount(0);
	await evidence('menus', {
		objectTargeted: first.id,
		multiSelectionPreserved: true,
		duplicateUndone: true,
		rect,
		viewport: { width: 1024, height: 768 }
	});
});

test('slide menus open from the keyboard and restore focus after deletion', async ({ page }) => {
	const id = await openBlankEditor(page);
	await ready(page);
	let card = page.locator('.presentation-slide-card').first();
	await card.focus();
	await page.keyboard.press('Shift+F10');
	await expect(menu(page)).toHaveAccessibleName('Slide actions');
	await expect(
		menu(page).getByRole('menuitem', { name: 'Delete slide', exact: true })
	).toBeDisabled();
	await menu(page).getByRole('menuitem', { name: 'Duplicate slide', exact: true }).click();
	await expect(page.locator('.presentation-slide-card')).toHaveCount(2);
	card = page.locator('.presentation-slide-card').last();
	await card.focus();
	await page.keyboard.press('Shift+F10');
	await menu(page).getByRole('menuitem', { name: 'Delete slide', exact: true }).click();
	await expect(page.locator('.presentation-slide-card')).toHaveCount(1);
	await expect(page.locator('.presentation-slide-card')).toBeFocused();
	await page.keyboard.press('Control+z');
	await expect(page.locator('.presentation-slide-card')).toHaveCount(2);
	await expect.poll(async () => (await stored(page, id)).slides.length).toBe(2);
	await evidence('slides', { keyboardMenu: true, lastSlideProtected: true, deleteUndone: true });
});

test('cut and system paste preserve a selection, locks and one-step undo across reload', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const id = await openBlankEditor(page);
	await ready(page);
	await addShape(page, 'rectangle');
	await addShape(page, 'ellipse');
	await page.getByRole('button', { name: 'Lock Ellipse', exact: true }).click();
	await selectAll(page);
	await page.keyboard.press('Control+x');
	await expect(layers(page)).toHaveCount(1);
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(1);
	expect((await stored(page, id)).slides[0].elements[0]).toMatchObject({
		name: 'Ellipse',
		locked: true
	});
	await page.keyboard.press('Control+z');
	await expect(layers(page)).toHaveCount(2);
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(2);
	await selectAll(page);
	await page.keyboard.press('Control+c');
	await page.reload();
	await ready(page);
	await host(page).focus();
	await page.keyboard.press('Control+v');
	await expect(layers(page)).toHaveCount(4);
	await expect(host(page)).toHaveAttribute('data-selected-count', '2');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(4);
	const deck = await stored(page, id);
	const originals = deck.slides[0].elements.slice(0, 2);
	const pasted = deck.slides[0].elements.slice(2);
	expect(pasted.every((element: any) => !element.locked && element.visible)).toBe(true);
	expect(pasted[1].x - pasted[0].x).toBe(originals[1].x - originals[0].x);
	await page.keyboard.press('Control+z');
	await expect(layers(page)).toHaveCount(2);
	await page.keyboard.press('Control+Shift+z');
	await expect(layers(page)).toHaveCount(4);
	await evidence('clipboard', {
		cutSkippedLocked: true,
		undoRestoredBoth: true,
		survivesReload: true,
		originals,
		pasted
	});
});

test('external text and images paste as editable persisted content while fields keep native paste', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const id = await openBlankEditor(page);
	await ready(page);
	await page.evaluate(() =>
		navigator.clipboard.writeText('Outside text\nSecond line <script>literal</script>')
	);
	await host(page).focus();
	await page.keyboard.press('Control+v');
	await expect(layers(page)).toHaveCount(1);
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(1);
	let deck = await stored(page, id);
	expect(
		deck.slides[0].elements[0].paragraphs
			.flatMap((paragraph: any) => paragraph.runs)
			.map((run: any) => run.text)
			.join('\n')
	).toContain('Outside text');
	await page.getByRole('button', { name: 'Edit text', exact: false }).click();
	await page.evaluate(() => navigator.clipboard.writeText('Native field paste'));
	await page.getByTestId('text-edit-field').focus();
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Control+v');
	await expect(page.getByTestId('text-edit-field')).toHaveText('Native field paste');
	await expect(layers(page)).toHaveCount(1);
	await page.keyboard.press('Escape');
	await host(page).focus();
	await page.keyboard.press('Control+c');
	// Rich-text applications prefer HTML, so it must contain readable content too.
	const copiedHtmlText = await page.evaluate(async () => {
		const items = await navigator.clipboard.read();
		const html = await (await items[0].getType('text/html')).text();
		return new DOMParser().parseFromString(html, 'text/html').body.textContent;
	});
	expect(copiedHtmlText).toBe('Native field paste');
	await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 80;
		canvas.height = 60;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'red';
		ctx.fillRect(0, 0, 80, 60);
		const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
	});
	await host(page).focus();
	await page.keyboard.press('Control+v');
	await expect(layers(page)).toHaveCount(2);
	await expect.poll(async () => (await stored(page, id)).assets.length).toBe(1);
	expect(await readStoredMedia(page)).toHaveLength(1);
	deck = await stored(page, id);
	await page.reload();
	await ready(page);
	expect((await stored(page, id)).slides[0].elements).toEqual(deck.slides[0].elements);
	await evidence('external-paste', {
		elements: deck.slides[0].elements,
		assets: deck.assets,
		persistedMedia: 1,
		nativeTextFieldPaste: true,
		copiedHtmlText
	});
});

test('alignment menus share geometry, respect locks and undo a selection together', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await ready(page);
	await addShape(page, 'rectangle');
	await addShape(page, 'ellipse');
	await page.getByLabel('X position', { exact: true }).fill('600');
	await page.getByLabel('X position', { exact: true }).press('Enter');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements[1]?.x).toBe(600);
	const original = (await stored(page, id)).slides[0].elements;
	await selectAll(page);
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	await page.getByRole('button', { name: 'Align elements', exact: true }).click();
	await page.screenshot({ path: 'proofs/out/slide-editor-stage5-align-menu.png' });
	await menu(page)
		.getByRole('menuitem', { name: /^Align left/ })
		.click();
	await expect
		.poll(async () => (await stored(page, id)).slides[0].elements.map((element: any) => element.x))
		.toEqual([original[0].x, original[0].x]);
	await page.keyboard.press('Control+z');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements).toEqual(original);
	await selectAll(page);
	await page.getByRole('button', { name: 'Align elements', exact: true }).click();
	await menu(page)
		.getByRole('menuitem', { name: /^Align right/ })
		.click();
	await expect
		.poll(async () => {
			const elements = (await stored(page, id)).slides[0].elements;
			return elements.map((element: any) => element.x + element.width);
		})
		.toEqual([original[1].x + original[1].width, original[1].x + original[1].width]);
	await page.keyboard.press('Control+z');
	await page.getByRole('button', { name: 'Lock Rectangle', exact: true }).click();
	await selectAll(page);
	await page.getByRole('button', { name: 'Align elements', exact: true }).click();
	await menu(page)
		.getByRole('menuitem', { name: /^Align right/ })
		.click();
	await expect
		.poll(async () => (await stored(page, id)).slides[0].elements[0].x)
		.toBe(original[0].x);
	// A single selection uses the slide instead of the selection frame.
	await page.locator('.presentation-layer-select').filter({ hasText: 'Ellipse' }).click();
	await host(page).focus();
	await page.getByRole('button', { name: 'Align elements', exact: true }).click();
	await menu(page)
		.getByRole('menuitem', { name: /^Align bottom/ })
		.click();
	await expect
		.poll(async () => {
			const deck = await stored(page, id);
			const element = deck.slides[0].elements[1];
			return element.y + element.height;
		})
		.toBe(720);
	await page.screenshot({ path: 'proofs/out/slide-editor-stage5-alignment.png' });
	await evidence('alignment', {
		menusUseSameGeometry: true,
		selectionUndoAtomic: true,
		lockedElementFixed: true,
		final: (await stored(page, id)).slides[0].elements
	});
});

test('F6 cycles visible areas in both directions, skips a closed pane and leaves dialogs alone', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await ready(page);
	await addShape(page, 'rectangle');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(1);
	const before = await readStoredPresentationJson(page, id);
	await page.getByRole('tab', { name: 'Home', exact: true }).focus();
	await page.keyboard.press('F6');
	await expect(page.locator('.presentation-slide-card[aria-current="true"]')).toBeFocused();
	await page.keyboard.press('F6');
	await expect(host(page)).toBeFocused();
	await page.keyboard.press('F6');
	await expect(page.getByRole('button', { name: 'Close task pane' })).toBeFocused();
	await page.keyboard.press('Shift+F6');
	await expect(host(page)).toBeFocused();
	await page.keyboard.press('Shift+F6');
	await expect(page.locator('.presentation-slide-card[aria-current="true"]')).toBeFocused();
	await page.getByLabel('X position', { exact: true }).focus();
	await page.keyboard.press('F6');
	await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
	await page.keyboard.press('F6');
	await expect(
		page.getByRole('link', { name: 'Back to presentations', exact: true })
	).toBeFocused();
	await page.keyboard.press('F6');
	await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeFocused();
	await page.keyboard.press('Shift+F6');
	await page.keyboard.press('Shift+F6');
	await page.keyboard.press('Shift+F6');
	await expect(page.getByLabel('X position', { exact: true })).toBeFocused();
	await page.getByRole('button', { name: 'Close task pane' }).click();
	await host(page).focus();
	await page.keyboard.press('F6');
	await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
	await page.keyboard.press('F6');
	await page.keyboard.press('F6');
	await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeFocused();
	expect(await readStoredPresentationJson(page, id)).toBe(before);
	await page.getByRole('button', { name: 'Add layout', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a slide layout' });
	await dialog.getByRole('button', { name: 'Two columns', exact: true }).focus();
	await page.keyboard.press('F6');
	await expect(dialog.getByRole('button', { name: 'Two columns', exact: true })).toBeFocused();
	await evidence('focus', {
		forwardAndReverse: true,
		restoresLastControl: true,
		closedPaneSkipped: true,
		dialogPreserved: true,
		documentUnchanged: true
	});
});

test('blocked clipboard reads fall back to the local snapshot and malformed paste is atomic', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await ready(page);
	await addShape(page, 'rectangle');
	await page.evaluate(() => {
		Object.defineProperty(navigator.clipboard, 'read', {
			value: async () => {
				throw new DOMException('Denied', 'NotAllowedError');
			}
		});
	});
	await page.getByRole('button', { name: 'Paste element', exact: true }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: 'Clipboard access was blocked' })
	).toBeVisible();
	await page.getByRole('button', { name: 'Copy element', exact: true }).click();
	await page.getByRole('button', { name: 'Paste element', exact: true }).click();
	await expect(layers(page)).toHaveCount(2);
	await page.keyboard.press('Control+z');
	await expect(layers(page)).toHaveCount(1);
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(1);
	const before = await readStoredPresentationJson(page, id);
	await host(page).focus();
	await host(page).evaluate((node) => {
		const data = new DataTransfer();
		data.setData(
			'application/x-peeloodle-elements+json',
			JSON.stringify({
				version: 1,
				documentId: 'bad',
				slideId: 'bad',
				elements: [{ kind: 'shape', x: NaN }]
			})
		);
		node.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
	});
	await expect(page.getByRole('alert').filter({ hasText: /could not be pasted/ })).toBeVisible();
	expect(await readStoredPresentationJson(page, id)).toBe(before);
	await evidence('refusals', {
		blockedReadReported: true,
		localFallbackWorks: true,
		malformedPasteLeavesDocumentUnchanged: true
	});
});

test('a pending menu paste cannot land on a different slide', async ({ page }) => {
	const id = await openBlankEditor(page);
	await ready(page);
	await page.evaluate(() => {
		Object.defineProperty(navigator.clipboard, 'read', {
			value: () =>
				new Promise((resolve) => {
					(window as any).resolveClipboard = () =>
						resolve([
							new ClipboardItem({
								'text/plain': new Blob(['Delayed text'], { type: 'text/plain' })
							})
						]);
				})
		});
	});
	await page.getByRole('button', { name: 'Paste element', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => typeof (window as any).resolveClipboard))
		.toBe('function');
	await page.getByRole('button', { name: 'Add slide', exact: true }).click();
	await expect(page.locator('.presentation-slide-card')).toHaveCount(2);
	await page.evaluate(() => (window as any).resolveClipboard());
	await expect.poll(async () => (await stored(page, id)).slides.length).toBe(2);
	expect((await stored(page, id)).slides.every((slide: any) => slide.elements.length === 0)).toBe(
		true
	);
	await evidence('pending-paste', {
		slideChangedDuringClipboardRead: true,
		noElementsInserted: true
	});
});
