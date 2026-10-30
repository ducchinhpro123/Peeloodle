/**
 * Slide editor keyboard and history behaviour (redesign stages 1–2).
 *
 * Undo and redo jump to the slide a change touched and never leave a selection
 * pointing at an element that no longer exists.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { addShape, openBlankEditor, readStoredPresentationJson } from './presentations';

const stored = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));
const slideCards = (page: Page) => page.locator('.presentation-slide-card');
const activeCard = (page: Page) => page.locator('.presentation-slide-card[aria-current="true"]');

test('undo after deleting the active slide lands on that slide with nothing selected', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add slide', exact: true }).click();
	await expect(slideCards(page)).toHaveCount(2);
	await page.getByRole('button', { name: 'Add body text', exact: true }).click();
	await page.getByTestId('text-edit-field').fill('On slide two');
	await page.keyboard.press('Escape');
	await page.locator('.presentation-layer-select').filter({ hasText: 'Body text' }).click();
	await expect(page.locator('.presentation-layer-item[data-selected="true"]')).toHaveCount(1);
	await expect.poll(async () => (await stored(page, id)).slides[1]?.elements.length).toBe(1);
	const slideTwoId = (await stored(page, id)).slides[1].id;

	await page.getByRole('button', { name: 'Delete slide 2' }).click();
	await expect(slideCards(page)).toHaveCount(1);
	await expect(activeCard(page)).toHaveAttribute('aria-label', 'Show slide 1: Slide 1');

	await page.keyboard.press('Control+z');
	await expect(slideCards(page)).toHaveCount(2);
	await expect(activeCard(page)).toHaveAttribute('data-slide-id', slideTwoId);
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);
	await expect(page.locator('.presentation-layer-item[data-selected="true"]')).toHaveCount(0);

	await page.keyboard.press('Control+Shift+z');
	await expect(slideCards(page)).toHaveCount(1);
	await expect(activeCard(page)).toHaveAttribute('aria-label', 'Show slide 1: Slide 1');
	await expect.poll(async () => (await stored(page, id)).slides.length).toBe(1);

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-stage1-keyboard-report.json',
		JSON.stringify(
			{
				test: 'undo after deleting the active slide lands on that slide with nothing selected',
				deck: id,
				restoredSlide: slideTwoId,
				finalSlides: (await stored(page, id)).slides.length
			},
			null,
			2
		)
	);
});

test('shortcuts do not fire inside inputs and dialogs', async ({ page }) => {
	const id = await openBlankEditor(page);
	await addShape(page, 'Rectangle');
	await expect.poll(async () => (await stored(page, id)).slides[0]?.elements.length).toBe(1);
	const before = await stored(page, id);

	const x = page.locator('.presentation-inspector').getByLabel('X position');
	await x.focus();
	await page.keyboard.press('d');
	await page.keyboard.press('Delete');
	await page.keyboard.press('Control+d');
	await page.keyboard.press('Control+z');
	await x.press('Escape');
	await page.getByRole('button', { name: 'Theme', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Heading font').focus();
	await page.keyboard.press('Delete');
	await page.keyboard.press('Control+d');

	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);
	const after = await stored(page, id);
	expect(after.slides[0].elements).toHaveLength(1);
	expect(after.slides[0].elements[0].id).toBe(before.slides[0].elements[0].id);
});

test('toolbar and keyboard run the same action', async ({ page }) => {
	const id = await openBlankEditor(page);
	await addShape(page, 'Rectangle');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);

	await page.keyboard.press('Control+d');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(2);
	await page.getByRole('button', { name: 'Duplicate Rectangle', exact: true }).click();
	await expect(page.locator('.presentation-layer-item')).toHaveCount(3);
	await expect.poll(async () => (await stored(page, id)).slides[0]?.elements.length).toBe(3);

	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.locator('.presentation-layer-item')).toHaveCount(2);
	await page.keyboard.press('Control+z');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);
	await expect.poll(async () => (await stored(page, id)).slides[0]?.elements.length).toBe(1);

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-stage2-actions-report.json',
		JSON.stringify(
			{
				test: 'toolbar and keyboard run the same action',
				deck: id,
				elementsAfterUndo: (await stored(page, id)).slides[0].elements.length
			},
			null,
			2
		)
	);
});
