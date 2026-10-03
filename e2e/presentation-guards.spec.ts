import { expect, test } from '@playwright/test';
import { openBlankEditor, readStoredPresentation } from './presentations';

/**
 * The guard journeys, ported from the source `presentations-save-guard.spec.ts`
 * and `presentations-shell-guard.spec.ts`. Every claim is read back out of
 * IndexedDB: an edit typed moments before leaving must already be on disk by the
 * time the route changes, because the guard is supposed to write and await it
 * before it lets the navigation through - not fire and forget.
 *
 * The editor's own Back link variant already lives in `presentations.spec.ts`;
 * this file covers the two paths that are not a link the editor owns: the app
 * shell's navigation and the browser Back button.
 */

test('a shell nav link writes the pending edit before it leaves the editor', async ({ page }) => {
	const presentationId = await openBlankEditor(page);

	// The text session is open and the autosave debounce is still counting, so
	// nothing here has been persisted as a revision yet.
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type('Home must not lose this');

	await page.locator('.topnav').getByRole('link', { name: 'Home' }).click();

	// The route change is the proof the write finished first; the row then proves
	// it landed.
	await expect(page).toHaveURL('/');
	const stored = await readStoredPresentation(page, presentationId);
	expect(stored?.text).toContain('Home must not lose this');

	// The editor really is gone and the dashboard is live.
	await expect(page.getByRole('heading', { name: /Your next big idea/ })).toBeVisible();
	await expect(page.getByTestId('presentation-canvas')).toHaveCount(0);
});

test('a clean editor follows a shell nav link immediately', async ({ page }) => {
	await openBlankEditor(page);

	// No edits: the guard must be invisible.
	await page.locator('.topnav').getByRole('link', { name: 'Home' }).click();

	await expect(page).toHaveURL('/');
	await expect(page.getByRole('heading', { name: /Your next big idea/ })).toBeVisible();
	await expect(page.getByText(/could not be saved/i)).toHaveCount(0);
});

test('the browser Back button writes the pending edit before it leaves', async ({
	page
}, testInfo) => {
	const presentationId = await openBlankEditor(page);

	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type('Back must not lose this');

	// Back is not a link: only router-level blocking can hold it.
	await page.goBack();

	await expect(page).toHaveURL('/presentations');
	const stored = await readStoredPresentation(page, presentationId);
	expect(stored?.text).toContain('Back must not lose this');
	await page.screenshot({ path: testInfo.outputPath('saved-after-browser-back.png') });

	// Back must retain real browser history, not replace it with a new push.
	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`/presentations/${presentationId}$`));
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	await expect
		.poll(async () => (await readStoredPresentation(page, presentationId))?.text)
		.toContain('Back must not lose this');
	await page.goBack();
	await expect(page).toHaveURL('/presentations');
});

test('a clean exit navigates back to the library without being blocked', async ({ page }) => {
	await openBlankEditor(page);

	// No edits at all: the guard must be transparent here too.
	await page.getByLabel('Back to presentations').click();
	await expect(page).toHaveURL(/\/presentations$/);
	await expect(page.getByRole('link', { name: 'Open Untitled presentation' })).toBeVisible();
});
