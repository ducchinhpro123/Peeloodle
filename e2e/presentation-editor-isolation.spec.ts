/**
 * Slide editor isolation (redesign stage 1).
 *
 * Every opened deck gets its own editor: document, selection and undo history
 * from one deck must never be visible in the next one, whether the second deck
 * is opened from the library or reached again with browser Back.
 */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBlankEditor, readStoredPresentation } from './presentations';

test('each opened deck gets its own editor state', async ({ page }) => {
	const deckA = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await page.getByTestId('text-edit-field').fill('Deck A heading');
	await page.keyboard.press('Escape');
	await page.locator('.presentation-layer-select').filter({ hasText: 'Heading' }).click();
	await expect
		.poll(async () => (await readStoredPresentation(page, deckA))?.text)
		.toBe('Deck A heading');
	await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

	await page.getByRole('link', { name: 'Back to presentations' }).first().click();
	await expect(page).toHaveURL(/\/presentations$/);
	const deckB = await openBlankEditor(page);
	expect(deckB).not.toBe(deckA);

	// Nothing from deck A: no elements, no history, nothing selected.
	await expect(page.locator('.presentation-layer-item')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Copy element', exact: true })).toBeDisabled();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Untitled presentation');

	// Back returns to the library, Back again reopens deck A with its own content.
	await page.goBack();
	await expect(page).toHaveURL(/\/presentations$/);
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/presentations/${deckA}$`));
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

	const storedA = await readStoredPresentation(page, deckA);
	const storedB = await readStoredPresentation(page, deckB);
	expect(storedA?.elements).toHaveLength(1);
	expect(storedB?.elements).toHaveLength(0);

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-stage1-isolation-report.json',
		JSON.stringify(
			{
				test: 'each opened deck gets its own editor state',
				deckA: { id: deckA, revision: storedA?.revision, elements: storedA?.elements.length },
				deckB: { id: deckB, revision: storedB?.revision, elements: storedB?.elements.length }
			},
			null,
			2
		)
	);
});
