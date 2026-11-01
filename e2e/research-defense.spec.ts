// Failure modes: category state is lost on reload; All falls back to the task;
// filtering resets scroll/focus or page mode; deck labels follow array position.
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { listStoredPresentations, readStoredPresentationJson } from './presentations';

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

// Form failures: wrong task mode, unreachable title, lost personal details,
// empty required title, duplicate submission, quota failure, and UTC date drift.
const subtitleLines = (doc: any) =>
	doc.slides[0].elements
		.find((element: any) => element.name === 'Subtitle')
		.paragraphs.map((paragraph: any) => paragraph.runs.map((run: any) => run.text).join(''));
async function openSetup(page: Page) {
	await page.goto('/presentations?task=research-defense');
	await expect(page.getByRole('region', { name: 'Build your defense deck' })).toBeVisible();
}
async function openBuiltDeck(page: Page) {
	await expect(page).toHaveURL(/\/presentations\/[^?]+$/);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	return JSON.parse(
		await readStoredPresentationJson(page, new URL(page.url()).pathname.split('/').at(-1)!)
	);
}

test('research hero replaces the generic hero only for this task', async ({ page }) => {
	await openSetup(page);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Defend your work.');
	await expect(
		page.getByRole('button', { name: 'Set up my defense deck', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Class', exact: true }).click();
	await page.reload();
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Defend your work.');
	await expect(page.getByRole('region', { name: 'Build your defense deck' })).toBeVisible();
	await page.goto('/presentations?task=class');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Tell your story.');
	await expect(page.getByRole('region', { name: 'Build your defense deck' })).toHaveCount(0);
});

test('hero button focuses the title field', async ({ page }) => {
	await openSetup(page);
	await page.getByRole('button', { name: 'Set up my defense deck', exact: true }).click();
	await expect(page.getByLabel('Thesis or project title', { exact: true })).toBeFocused();
});

test('a student builds a personalised defense deck', async ({ page }, info) => {
	await openSetup(page);
	await page.getByLabel('20 minutes · 13 slides').check();
	await page.getByRole('radio', { name: 'Thesis', exact: true }).check();
	await page.getByLabel('Thesis or project title', { exact: true }).fill('Light and Growth');
	await page.getByLabel('Your name', { exact: true }).fill('Ana Lim');
	await page.getByLabel('School or program', { exact: true }).fill('Uni X');
	await page.getByLabel('Advisor', { exact: true }).fill('Dr. B');
	await page.getByLabel('Defense date', { exact: true }).fill('2026-12-05');
	await page.getByLabel('Research question', { exact: true }).fill('Does light matter?');
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	const doc = await openBuiltDeck(page);
	expect(doc.slides).toHaveLength(13);
	expect(doc.title).toBe('Light and Growth');
	expect(subtitleLines(doc)).toEqual(['Ana Lim · Uni X', 'Advisor: Dr. B', 'December 5, 2026']);
	const question = doc.slides
		.find((slide: any) => slide.name === 'Question')
		.elements.find((element: any) => element.name === 'Question body');
	expect(question.paragraphs[0].runs[0].text).toBe('Does light matter?');
	await page.screenshot({ path: info.outputPath('research-defense-editor.png') });
});

test('an empty title is refused in place', async ({ page }) => {
	await openSetup(page);
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	await expect(page.getByText('Add your thesis or project title.', { exact: true })).toBeVisible();
	const title = page.getByLabel('Thesis or project title', { exact: true });
	await expect(title).toBeFocused();
	await expect(title).toHaveAttribute('aria-invalid', 'true');
	await expect(title).toHaveAttribute('aria-describedby', /\S/);
	expect(await listStoredPresentations(page)).toHaveLength(0);
});

test('building twice quickly saves one deck', async ({ page }) => {
	await openSetup(page);
	await page.getByLabel('Thesis or project title', { exact: true }).fill('One defense deck');
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).dblclick();
	await openBuiltDeck(page);
	expect(await listStoredPresentations(page)).toHaveLength(1);
});

test('a failed save keeps the form and stores nothing', async ({ page }) => {
	const key = 'peeloodle-e2e-fail-defense-writes';
	await page.addInitScript((key) => {
		if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, 'on');
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (...args) {
			if (sessionStorage.getItem(key) === 'on' && this.name === 'presentations')
				throw new DOMException(
					'The quota has been exceeded (injected failure)',
					'QuotaExceededError'
				);
			return put.apply(this, args);
		};
	}, key);
	await openSetup(page);
	await page.getByLabel('Thesis or project title', { exact: true }).fill('Keep my research');
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText(
		"Couldn't create your defense deck. Nothing was saved. Please try again."
	);
	await expect(page.getByLabel('Thesis or project title', { exact: true })).toHaveValue(
		'Keep my research'
	);
	expect(await listStoredPresentations(page)).toHaveLength(0);
	await page.evaluate((key) => sessionStorage.setItem(key, 'off'), key);
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	await openBuiltDeck(page);
	expect(await listStoredPresentations(page)).toHaveLength(1);
});

test.describe('local defense date', () => {
	test.use({ timezoneId: 'Pacific/Honolulu' });
	test('defense date keeps the calendar day in Pacific/Honolulu', async ({ page }) => {
		await openSetup(page);
		await page.getByLabel('Thesis or project title', { exact: true }).fill('Calendar day');
		await page.getByLabel('Defense date', { exact: true }).fill('2026-12-05');
		await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
		expect(subtitleLines(await openBuiltDeck(page))).toEqual(['December 5, 2026']);
	});
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
