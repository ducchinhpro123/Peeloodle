import { expect, test } from '@playwright/test';
import {
	readStoredPresentation,
	readStoredPresentationJson,
	readStoredMedia
} from './presentations';

test('creates a company-profile deck with editable text and self-contained artwork', async ({
	page
}, testInfo) => {
	await page.goto('/presentations');
	const card = page.getByRole('button', { name: 'Preview Red & white company profile' });
	await expect(card).toBeVisible();
	await card.click();
	const dialog = page.getByRole('dialog', { name: 'Red & white company profile' });
	await expect(dialog.getByRole('img', { name: 'Slide 1 preview' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Next slide' }).click();
	await expect(dialog.getByText('Slide 2 of 15')).toBeVisible();
	await dialog.getByRole('button', { name: 'Use template' }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	const id = decodeURIComponent(page.url().split('/').pop()!);
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	const deck = JSON.parse(await readStoredPresentationJson(page, id));
	expect(deck.slides).toHaveLength(15);
	expect(deck.assets).toHaveLength(15);
	expect(
		deck.slides[0].elements.some(
			(element: { kind: string; locked: boolean }) => element.kind === 'image' && element.locked
		)
	).toBe(true);
	expect(
		deck.slides[0].elements.some(
			(element: { kind: string; paragraphs?: { runs: { text: string }[] }[] }) =>
				element.kind === 'text' &&
				element.paragraphs?.some((p) => p.runs.some((r) => r.text.includes('COMPANY')))
		)
	).toBe(true);
	const media = await readStoredMedia(page);
	expect(media).toHaveLength(15);
	expect(media.every((item) => item.byteLength > 500)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('company-profile-editor.png') });
	// The supplied title really is editable, rather than lettering baked into a screenshot.
	await page.getByRole('button', { name: 'text COMPANY' }).click();
	await page.getByRole('button', { name: 'Edit text' }).click();
	const text = page.getByTestId('text-edit-field');
	await expect(text).toContainText('COMPANY');
	await text.fill('MY COMPANY');
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
	await expect
		.poll(async () => (await readStoredPresentation(page, id))?.text)
		.toContain('MY COMPANY');
	// Artwork is a background layer: dragging empty paper must still pan the canvas.
	const canvas = page.getByTestId('presentation-canvas');
	const bounds = (await canvas.boundingBox())!;
	await page.mouse.move(bounds.x + 35, bounds.y + 35);
	await page.mouse.down();
	await page.mouse.move(bounds.x + 75, bounds.y + 65);
	await page.mouse.up();
	await expect(canvas).not.toHaveAttribute('data-view-pan-x', '0');
	await page.getByRole('button', { name: 'Fit slide to window' }).click();
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	await expect(page.getByRole('button', { name: 'Show slide 15: Thank you' })).toBeVisible();
	await page.getByRole('button', { name: 'Show slide 3: About company' }).click();
	await page.screenshot({ path: testInfo.outputPath('company-profile-about.png') });
	await page.getByRole('button', { name: 'Show slide 8: The process' }).click();
	await page.screenshot({ path: testInfo.outputPath('company-profile-process.png') });
	await page.getByRole('button', { name: 'Show slide 15: Thank you' }).click();
	await expect(page.getByTestId('slide-rail-preview').last()).toBeVisible();
	const reopened = await readStoredPresentation(page, id);
	expect(reopened?.slideCount).toBe(15);
	expect(reopened?.text).toContain('MY COMPANY');
});

test('browses built-in decks, previews slides and creates an editable local copy', async ({
	page
}, testInfo) => {
	await page.goto('/presentations');
	const gallery = page.getByRole('region', { name: 'Start with a template' });
	await expect(gallery).toBeVisible();
	await expect(gallery.locator('.template-cover img')).toHaveCount(4);
	await gallery.screenshot({ path: testInfo.outputPath('template-gallery.png') });
	await gallery.getByLabel('Search presentation templates').fill('research');
	await expect(gallery.getByRole('button', { name: 'Preview Research defense' })).toBeVisible();
	await expect(gallery.getByRole('button', { name: 'Preview Club pitch' })).toHaveCount(0);
	await gallery.getByLabel('Search presentation templates').fill('nothing-matches');
	await expect(gallery.getByText('No templates match your search.')).toBeVisible();
	await gallery.getByRole('button', { name: 'Clear filters' }).click();
	await gallery.getByRole('button', { name: 'Preview Club pitch' }).click();
	const dialog = page.getByRole('dialog', { name: 'Club pitch' });
	await expect(dialog.getByRole('img', { name: 'Slide 1 preview' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Next slide' }).click();
	await expect(dialog.getByText('Slide 2 of 8')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('template-preview.png') });
	await dialog.getByRole('button', { name: 'Use template' }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	const firstSlidePreview = page
		.getByRole('button', { name: 'Show slide 1: Mission' })
		.getByTestId('slide-rail-preview');
	await expect(firstSlidePreview).toHaveAttribute('src', /^data:image\/png;base64,/);
	const secondSlideButton = page.getByRole('button', { name: 'Show slide 2: Problem' });
	await secondSlideButton.scrollIntoViewIfNeeded();
	const secondSlidePreview = secondSlideButton.getByTestId('slide-rail-preview');
	await expect(secondSlidePreview).toHaveAttribute('src', /^data:image\/png;base64,/);
	expect(await firstSlidePreview.getAttribute('src')).not.toBe(
		await secondSlidePreview.getAttribute('src')
	);
	await page.screenshot({ path: testInfo.outputPath('editable-slide-previews.png') });
	const beforeEdit = await firstSlidePreview.getAttribute('src');
	await page.getByRole('button', { name: 'Show slide 1: Mission' }).click();
	await page.getByLabel('Slide background').fill('#aabbcc');
	await page.getByLabel('Slide background').blur();
	await expect
		.poll(async () => (await readStoredPresentation(page, page.url().split('/').pop()!))?.revision)
		.toBeGreaterThan(0);
	await expect
		.poll(async () => (await firstSlidePreview.getAttribute('src')) !== beforeEdit)
		.toBe(true);
	await expect(secondSlidePreview).toHaveAttribute('src', /^data:image\/png;base64,/);
	const id = page.url().split('/').pop()!;
	const stored = await readStoredPresentation(page, id);
	expect(stored?.slideCount).toBe(8);
	expect(stored?.elements.some((element) => element.kind === 'text')).toBe(true);
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	expect((await readStoredPresentation(page, id))?.slideCount).toBe(8);
});
