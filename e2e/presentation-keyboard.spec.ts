/**
 * Slide editor keyboard and history behaviour (redesign stages 1–2).
 *
 * Undo and redo jump to the slide a change touched and never leave a selection
 * pointing at an element that no longer exists.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBlankEditor, readStoredPresentationJson } from './presentations';

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
