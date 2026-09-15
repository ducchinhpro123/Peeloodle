import { expect, test } from '@playwright/test';
import { openBlankEditor, seedStoredPresentation } from './presentations';

/**
 * The responsive journeys, ported from the source "keeps a long saved title
 * usable at the tablet editor width" and "presentation library and preview
 * remain contained on a phone": a long title stays identifiable and never widens
 * the page at 1024px, and the library plus the authoring preview stay reachable
 * and contained at 390px even though the copy points at a laptop.
 */

const LONG_TITLE =
	'Khảo sát trải nghiệm học tập — a deliberately long presentation title that must remain identifiable';

const noHorizontalOverflow = (page: import('@playwright/test').Page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('keeps a long saved title usable at the tablet editor width', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	const sourceId = await openBlankEditor(page);
	const seededId = 'e2e-long-title-deck';
	await seedStoredPresentation(page, sourceId, {
		id: seededId,
		title: LONG_TITLE,
		background: '#ffffff',
		text: ''
	});

	await page.goto('/presentations');
	const card = page.getByRole('link', { name: `Open ${LONG_TITLE}` });
	await expect(card).toBeVisible();
	await expect(card).toContainText(LONG_TITLE);
	await expect(card.locator('.presentation-card-title strong')).toHaveAttribute(
		'title',
		LONG_TITLE
	);
	await expect.poll(() => noHorizontalOverflow(page)).toBe(true);

	await card.click();
	await expect(page).toHaveURL(`/presentations/${seededId}`);
	const heading = page.getByRole('heading', { name: LONG_TITLE });
	await expect(heading).toBeVisible();
	await expect(heading).toHaveAttribute('title', LONG_TITLE);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect.poll(() => noHorizontalOverflow(page)).toBe(true);
});

test('keeps the library and the authoring preview contained on a phone', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/presentations');
	await expect(page.getByRole('heading', { name: /Tell your story/ })).toBeVisible();
	await expect.poll(() => noHorizontalOverflow(page)).toBe(true);

	await page
		.getByRole('button', { name: /Create (your first|a blank) presentation/ })
		.first()
		.click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	// The copy says authoring is for a laptop; the preview and its controls stay
	// reachable at phone width anyway.
	await expect(page.getByText(/Presentation authoring is designed for a laptop/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add text' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add slide' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Duplicate active slide' })).toBeVisible();
	await expect.poll(() => noHorizontalOverflow(page)).toBe(true);

	await page.getByRole('link', { name: 'Back to presentations' }).click();
	await expect(page.getByRole('link', { name: 'Open Untitled presentation' })).toBeVisible();
	await expect.poll(() => noHorizontalOverflow(page)).toBe(true);
});
