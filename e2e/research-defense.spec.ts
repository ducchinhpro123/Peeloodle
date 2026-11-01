// Failure modes: category state is lost on reload; All falls back to the task;
// filtering resets scroll/focus or page mode; deck labels follow array position.
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('chip choice survives reload without leaving the research task', async ({ page }) => {
	await page.goto('/presentations?task=research-defense');
	await expect(page.getByRole('button', { name: 'Research', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const chip = page.getByRole('button', { name: 'Class', exact: true });
	await chip.scrollIntoViewIfNeeded();
	const scroll = await page.evaluate(() => scrollY);
	await chip.click();
	await expect(page).toHaveURL(/task=research-defense/);
	await expect(page).toHaveURL(/category=class/);
	await expect(chip).toBeFocused();
	expect(await page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Class', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page).toHaveURL(/task=research-defense/);
	await page.getByRole('button', { name: 'All templates', exact: true }).click();
	await expect(page).toHaveURL(/category=all/);
	await page.reload();
	await expect(page.getByRole('button', { name: 'All templates', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page).toHaveURL(/task=research-defense/);
	await page
		.getByRole('searchbox', { name: 'Search presentation templates' })
		.fill('No matching template');
	await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Preview Class presentation' })).toBeVisible();
});

test('category param wins and invalid values fall back to the task', async ({ page }) => {
	await page.goto('/presentations?category=business');
	await expect(page.getByRole('button', { name: 'Business', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(
		page.getByRole('button', { name: 'Preview Red & white company profile' })
	).toBeVisible();
	await page.goto('/presentations?task=club-pitch&category=bogus');
	await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('deck labels follow each template use case', async ({ page }) => {
	await page.goto('/presentations');
	await expect(page.getByRole('button', { name: 'Preview Research defense' })).toContainText(
		'Research ·'
	);
	await expect(
		page.getByRole('button', { name: 'Preview Red & white company profile' })
	).toContainText('Business ·');
});

test.afterEach(async ({ page }, info) => {
	writeFileSync(
		info.outputPath('research-page-state.json'),
		JSON.stringify(
			{
				url: page.url(),
				viewport: page.viewportSize(),
				selectedCategories: await page
					.locator('.categories [aria-pressed="true"]')
					.allTextContents()
			},
			null,
			2
		)
	);
});
