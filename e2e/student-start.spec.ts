import { expect, test } from '@playwright/test';

/** Owns the first visit → task starter → independent saved deck → return journey. */
test('a student can choose an assignment, edit a starter and return to their work', async ({
	page
}, info) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Your next big idea');
	await page.getByRole('button', { name: 'Quick start', exact: true }).click();
	const guide = page.getByRole('dialog', { name: 'Your first presentation' });
	await expect(guide).toContainText('Saved in this browser');
	await expect(guide).toContainText('backup');
	await page.keyboard.press('Escape');

	for (const [task, category, title] of [
		['Research defense', 'Research', 'Research defense'],
		['Club pitch', 'Pitch', 'Club pitch'],
		['Class presentation', 'Class', 'Class presentation']
	]) {
		await page.getByRole('link', { name: new RegExp(`^${task}`) }).click();
		await expect(page.getByRole('button', { name: category, exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.getByRole('button', { name: `Preview ${title}`, exact: true }).click();
		await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
		if (task !== 'Class presentation') {
			await page.keyboard.press('Escape');
			await page.goto('/');
		}
	}
	await page.getByRole('button', { name: 'Use template', exact: true }).click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await page.getByRole('button', { name: 'Add text', exact: true }).click();
	await page.keyboard.type('Our class assignment');
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
	const editorUrl = page.url();
	await page.goto('/');
	await page
		.getByRole('region', { name: 'Recent presentations' })
		.getByRole('link', { name: /Open Class presentation/ })
		.click();
	await expect(page).toHaveURL(editorUrl);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await page.screenshot({ path: info.outputPath('student-starter.png') });
});

test('the student desk works on a phone and personal stickers can start without an upload', async ({
	page
}, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
		.toBe(true);
	await page.screenshot({ path: info.outputPath('student-desk-phone.png'), fullPage: true });
	await page.getByRole('link', { name: /Create a Sticker/ }).click();
	await page.getByRole('button', { name: 'Try a sample photo', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Select Sample cat', exact: true })).toBeVisible();
	await expect(page.locator('[data-testid="editor-canvas"]')).toBeVisible();
	await page.getByRole('button', { name: 'Export and share' }).click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: /Download PNG/ }).click()
	]);
	await download.saveAs(info.outputPath('sample-personal-sticker.png'));
});
