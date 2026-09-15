import { expect, test, type Page } from '@playwright/test';
import { listStoredPresentations, readStoredPresentation } from './presentations';

/**
 * The library actions journey, ported from the source
 * `presentations-library-actions.spec.ts`: rename, duplicate and delete write
 * real IndexedDB rows, and deleting a copy leaves the original alone. Every claim
 * is read back from the repository rather than from the screen.
 */

async function openLibrary(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1280, height: 768 });
	await page.goto('/presentations');
	await expect(page.getByRole('button', { name: 'Start a blank presentation' })).toBeVisible();
}

/** Creates a blank presentation from the library and returns to the library. */
async function createPresentation(page: Page): Promise<string> {
	// The hero button is the one that always exists, empty library or not.
	await page.getByRole('button', { name: 'Start a blank presentation' }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const id = decodeURIComponent(page.url().split('/').pop()!);
	await page.getByLabel('Back to presentations').click();
	await expect(page).toHaveURL(/\/presentations$/);
	return id;
}

test('renaming stores the new title at the next revision without touching the slides', async ({
	page
}) => {
	await openLibrary(page);
	const id = await createPresentation(page);
	const before = (await readStoredPresentation(page, id))!;

	await page.getByRole('button', { name: `Rename ${before.title}` }).click();
	const dialog = page.getByRole('dialog', { name: 'Rename this presentation' });
	const field = dialog.getByRole('textbox', { name: 'Presentation name' });
	await expect(field).toHaveValue(before.title);
	await field.fill('Bài học về Hà Nội và các bạn');
	// Enter submits the rename form; Escape is covered by the cancel path below.
	await page.keyboard.press('Enter');

	await expect(dialog).toBeHidden();
	await expect(page.getByRole('link', { name: 'Open Bài học về Hà Nội và các bạn' })).toBeVisible();

	const after = (await readStoredPresentation(page, id))!;
	expect(after.title).toBe('Bài học về Hà Nội và các bạn');
	expect(after.revision).toBe(before.revision + 1);
	expect(after.slideIds).toEqual(before.slideIds);
	expect(after.text).toBe(before.text);
});

test('duplicating writes an independent stored row and leaves the source alone', async ({
	page
}) => {
	await openLibrary(page);
	const id = await createPresentation(page);
	const source = (await readStoredPresentation(page, id))!;

	await page.getByRole('button', { name: `Duplicate ${source.title}` }).click();
	await expect(page.getByRole('link', { name: `Open ${source.title} copy` })).toBeVisible();

	const rows = await listStoredPresentations(page);
	expect(rows).toHaveLength(2);
	const copyId = rows.find((row) => row.id !== id)!.id;
	const copy = (await readStoredPresentation(page, copyId))!;
	expect(copy.title).toBe(`${source.title} copy`);
	// Independent document contents, not a shared row.
	expect(copy.slideIds).not.toEqual(source.slideIds);
	expect(copy.slideIds[0]).not.toBe(source.slideIds[0]);

	expect(await readStoredPresentation(page, id)).toMatchObject({
		title: source.title,
		revision: source.revision
	});
});

test('deleting a duplicate cancels safely, removes only that row, and returns focus', async ({
	page
}) => {
	await openLibrary(page);
	const firstId = await createPresentation(page);
	const secondId = await createPresentation(page);
	await page.getByRole('button', { name: 'Duplicate Untitled presentation' }).first().click();
	await expect(page.getByRole('link', { name: 'Open Untitled presentation copy' })).toBeVisible();

	const withCopy = await listStoredPresentations(page);
	expect(withCopy).toHaveLength(3);
	const copyId = withCopy.find((row) => row.id !== firstId && row.id !== secondId)!.id;

	// Cancel first: the confirmation opens on the safe action, and closing it puts
	// focus back on the button that opened it without removing anything.
	const deleteCopy = page.getByRole('button', { name: 'Delete Untitled presentation copy' });
	await deleteCopy.click();
	const confirm = page.getByRole('dialog', { name: 'Delete this presentation?' });
	await expect(confirm.getByRole('button', { name: 'Keep presentation' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(confirm).toBeHidden();
	await expect(deleteCopy).toBeFocused();
	expect(await listStoredPresentations(page)).toHaveLength(3);

	// Confirming removes the copy and nothing else.
	await deleteCopy.click();
	await confirm.getByRole('button', { name: 'Delete presentation' }).click();
	await expect(confirm).toBeHidden();
	await expect(page.getByRole('link', { name: 'Open Untitled presentation copy' })).toHaveCount(0);

	const left = (await listStoredPresentations(page)).map((row) => row.id);
	expect(left).not.toContain(copyId);
	expect([...left].sort()).toEqual([firstId, secondId].sort());

	// Focus lands on a surviving control rather than the document body.
	await expect(
		page.getByRole('button', { name: 'Rename Untitled presentation' }).first()
	).toBeFocused();
});
