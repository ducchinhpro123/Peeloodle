/**
 * Fixes from the whole-branch review of the slide editor redesign: the slide
 * can't be lost through zoom or resize, overlapping image inserts are refused,
 * nudge undo follows the selection, and the remaining PowerPoint shortcuts.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { addShape, openBlankEditor, readStoredPresentationJson } from './presentations';

const host = (page: Page) => page.getByTestId('presentation-canvas');
const stored = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));

/** How much of the slide (0..1 per axis) is inside the canvas right now. */
async function visibleShare(page: Page) {
	return host(page).evaluate((node) => {
		const zoom = Number(node.getAttribute('data-view-zoom'));
		const panX = Number(node.getAttribute('data-view-pan-x'));
		const panY = Number(node.getAttribute('data-view-pan-y'));
		const rect = node.getBoundingClientRect();
		const scale = Math.min(rect.width / 1280, rect.height / 720) * zoom;
		const w = 1280 * scale;
		const h = 720 * scale;
		const x = (rect.width - w) / 2 + panX;
		const y = (rect.height - h) / 2 + panY;
		const seenX = Math.max(0, Math.min(x + w, rect.width) - Math.max(x, 0));
		const seenY = Math.max(0, Math.min(y + h, rect.height) - Math.max(y, 0));
		return { x: seenX / w, y: seenY / h };
	});
}

test('the slide stays in view after panning, zooming out and resizing', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBlankEditor(page);
	const bar = page.getByRole('contentinfo', { name: 'Editor status' });
	await bar.getByRole('button', { name: 'Zoom in' }).click();
	const box = (await host(page).boundingBox())!;
	await host(page).focus();
	await page.keyboard.down('Space');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 3, box.y + box.height * 3, { steps: 8 });
	await page.mouse.up();
	await page.keyboard.up('Space');
	for (let i = 0; i < 4; i += 1) await bar.getByRole('button', { name: 'Zoom out' }).click();
	let share = await visibleShare(page);
	expect(share.x).toBeGreaterThanOrEqual(0.249);
	expect(share.y).toBeGreaterThanOrEqual(0.249);
	await page.setViewportSize({ width: 1024, height: 700 });
	await page.waitForTimeout(300);
	share = await visibleShare(page);
	expect(share.x).toBeGreaterThanOrEqual(0.249);
	expect(share.y).toBeGreaterThanOrEqual(0.249);
});

test('a second image insert waits for the first instead of racing it', async ({ page }) => {
	const id = await openBlankEditor(page);
	const bytes = [...(await readFile('static/samples/cat-in-console.png'))];
	// Two pastes in the same task: the second arrives while the first is writing.
	await page.evaluate((data) => {
		const file = () => new File([new Uint8Array(data)], 'cat.png', { type: 'image/png' });
		for (let i = 0; i < 2; i += 1) {
			const transfer = new DataTransfer();
			transfer.items.add(file());
			document.body.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
			);
		}
	}, bytes);
	await expect(page.getByRole('alert')).toContainText('Wait for the current image');
	await expect.poll(async () => (await stored(page, id)).slides[0].elements.length).toBe(1);
	await page.waitForTimeout(1500);
	const deck = await stored(page, id);
	expect(deck.slides[0].elements).toHaveLength(1);
	expect(deck.assets).toHaveLength(1);
});

test('nudge undo steps follow the selection', async ({ page }) => {
	const id = await openBlankEditor(page);
	await addShape(page, 'Rectangle');
	await addShape(page, 'Ellipse');
	const xs = async () =>
		(await stored(page, id)).slides[0].elements.map((element: { x: number }) => element.x);
	await expect.poll(xs).toEqual([400, 400]);
	await page.locator('.presentation-layer-select').filter({ hasText: 'Rectangle' }).click();
	await host(page).focus();
	await page.keyboard.press('ArrowRight');
	await page.locator('.presentation-layer-select').filter({ hasText: 'Ellipse' }).click();
	await host(page).focus();
	await page.keyboard.press('ArrowRight');
	await expect.poll(xs).toEqual([408, 408]);
	await page.waitForTimeout(1000);
	await page.keyboard.press('Control+z');
	await expect.poll(xs).toEqual([408, 400]);
});

test('PowerPoint shortcuts and arrange commands', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const id = await openBlankEditor(page);
	const cards = page.locator('.presentation-slide-card');
	const active = page.locator('.presentation-slide-card[aria-current="true"]');

	// Ctrl+M adds a slide after the active one; Page Up/Down move between slides.
	await host(page).focus();
	await page.keyboard.press('Control+m');
	await expect(cards).toHaveCount(2);
	await expect(active).toHaveAttribute('aria-label', /^Show slide 2:/);
	await host(page).focus();
	await page.keyboard.press('PageUp');
	await expect(active).toHaveAttribute('aria-label', /^Show slide 1:/);
	await page.keyboard.press('PageDown');
	await expect(active).toHaveAttribute('aria-label', /^Show slide 2:/);

	// Enter (or F2) on a selected text box starts editing it.
	await page.getByRole('button', { name: 'Add body text', exact: true }).click();
	await page.getByTestId('text-edit-field').fill('Hello');
	await page.keyboard.press('Escape');
	await host(page).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.press('Escape');
	await host(page).focus();
	await page.keyboard.press('F2');
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.press('Escape');

	// Ctrl+= and Ctrl+- zoom the canvas.
	await host(page).focus();
	await page.keyboard.press('Control+=');
	await expect(host(page)).toHaveAttribute('data-view-zoom', '1.25');
	await page.keyboard.press('Control+-');
	await expect(host(page)).toHaveAttribute('data-view-zoom', '1');

	// Bring to front / Send to back and Rotate 90° from the Arrange tab.
	await addShape(page, 'Rectangle');
	const order = async () =>
		((await stored(page, id)).slides[1]?.elements ?? []).map(
			(element: { kind: string }) => element.kind
		);
	await expect.poll(order).toEqual(['text', 'shape']);
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	await page.getByRole('button', { name: 'Send to back', exact: true }).click();
	await expect.poll(order).toEqual(['shape', 'text']);
	await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
	await expect.poll(order).toEqual(['text', 'shape']);
	await page.getByRole('button', { name: 'Rotate right 90°', exact: true }).click();
	const rotation = async () =>
		((await stored(page, id)).slides[1]?.elements ?? []).find(
			(element: { kind: string }) => element.kind === 'shape'
		)?.rotation;
	await expect.poll(rotation).toBe(90);
	await page.getByRole('button', { name: 'Rotate left 90°', exact: true }).click();
	await expect.poll(rotation).toBe(0);

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-review-fixes-report.json',
		JSON.stringify({ deck: id, slides: (await stored(page, id)).slides.length }, null, 2)
	);
});
