import { expect, test, type Page } from '@playwright/test';
import { seedStoredPresentation } from './presentations';

/**
 * The thumbnail journeys, ported from the source
 * `presentations-library-thumbnails.spec.ts`: every library card paints a real
 * render of its own first slide, the render can never widen or break the card,
 * and deleting a deck takes its thumbnail with it.
 *
 * Two decks are seeded behind the library with distinct slide backgrounds and
 * text, so "the pixels came from this document" is checkable: the most common
 * pixel of a card's thumbnail must be that deck's own background, and the two
 * thumbnails must not be the same image.
 */

type SeededDeck = { id: string; title: string; background: string; text: string };

const DECKS: SeededDeck[] = [
	{ id: 'thumb-deck-a', title: 'Deck A about bees', background: '#e7f6c9', text: 'Alpha' },
	{ id: 'thumb-deck-b', title: 'Deck B about moons', background: '#f3d9ff', text: 'Beta' }
];

/**
 * Builds a real deck through the editor (so its schema is the app's own), then
 * clones it behind the library twice with the seeded backgrounds and text, and
 * removes the source so exactly the two seeded decks remain.
 */
async function openLibraryWithDecks(page: Page, decks: SeededDeck[]): Promise<void> {
	await page.goto('/presentations');
	await page.getByRole('button', { name: 'Start a blank presentation' }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const sourceId = decodeURIComponent(page.url().split('/').pop()!);

	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.type('Seed');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('text-edit-field')).not.toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await page.getByLabel('Back to presentations').click();
	await expect(page).toHaveURL(/\/presentations$/);

	for (const deck of decks) await seedStoredPresentation(page, sourceId, deck);

	// Remove the source deck so the grid holds exactly the two seeded decks.
	await page.reload();
	await page.getByRole('button', { name: 'Delete Untitled presentation' }).click();
	const confirm = page.getByRole('dialog', { name: 'Delete this presentation?' });
	await confirm.getByRole('button', { name: 'Delete presentation' }).click();
	await expect(confirm).toBeHidden();

	await expect(page.getByRole('heading', { name: 'Your presentations' })).toBeVisible();
	// Lazy thumbnails only start once a card is near the viewport.
	await page.getByRole('heading', { name: 'Your presentations' }).scrollIntoViewIfNeeded();
}

function hexToRgb(hex: string): string {
	const value = Number.parseInt(hex.slice(1), 16);
	return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
}

/**
 * The pixels a card actually paints: drawn from the image's own natural size, so
 * card CSS (scaling, object-fit) cannot colour the result.
 */
async function thumbnailPixels(page: Page, title: string) {
	const image = page
		.locator('.presentation-card')
		.filter({ has: page.getByRole('link', { name: `Open ${title}` }) })
		.getByTestId('presentation-card-thumb');
	await expect(image).toBeVisible();
	return image.evaluate((element: HTMLImageElement) => {
		const canvas = document.createElement('canvas');
		canvas.width = element.naturalWidth;
		canvas.height = element.naturalHeight;
		const context = canvas.getContext('2d')!;
		context.drawImage(element, 0, 0);
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		const counts = new Map<string, number>();
		let hash = 2166136261;
		for (let index = 0; index < pixels.length; index += 4) {
			const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
			hash = Math.imul(
				hash ^ pixels[index]! ^ (pixels[index + 1]! << 8) ^ (pixels[index + 2]! << 16),
				16777619
			);
		}
		let dominant = '';
		let dominantCount = 0;
		for (const [key, count] of counts) {
			if (count > dominantCount) {
				dominant = key;
				dominantCount = count;
			}
		}
		return {
			width: canvas.width,
			height: canvas.height,
			dominant,
			dominantCount,
			total: canvas.width * canvas.height,
			colourCount: counts.size,
			hash: hash >>> 0
		};
	});
}

test('each card paints a real render of its own first slide', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	await openLibraryWithDecks(page, DECKS);

	const first = await thumbnailPixels(page, DECKS[0]!.title);
	const second = await thumbnailPixels(page, DECKS[1]!.title);

	for (const [pixels, deck] of [
		[first, DECKS[0]!],
		[second, DECKS[1]!]
	] as const) {
		// A full 16:9 slide raster, not a fragment.
		expect(pixels.width).toBe(480);
		expect(pixels.height).toBe(270);
		// The fill of THIS deck's slide covers most of it…
		expect(pixels.dominant).toBe(hexToRgb(deck.background));
		expect(pixels.dominantCount / pixels.total).toBeGreaterThan(0.5);
		// …and the seeded text is painted on top, so it is not a flat placeholder.
		expect(pixels.colourCount).toBeGreaterThan(20);
	}

	// Two decks, two images: not one shared or recycled thumbnail.
	expect(first.hash).not.toBe(second.hash);
	expect(first.dominant).not.toBe(second.dominant);
	await expect(page.getByTestId('presentation-card-thumb')).toHaveCount(2);
});

test('deleting a deck removes its thumbnail and leaves the other card alone', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	await openLibraryWithDecks(page, DECKS);
	await thumbnailPixels(page, DECKS[1]!.title);

	await page.getByRole('button', { name: `Delete ${DECKS[1]!.title}` }).click();
	const confirm = page.getByRole('dialog', { name: 'Delete this presentation?' });
	await confirm.getByRole('button', { name: 'Delete presentation' }).click();
	await expect(page.getByRole('link', { name: `Open ${DECKS[1]!.title}` })).toHaveCount(0);

	const surviving = await thumbnailPixels(page, DECKS[0]!.title);
	expect(surviving.dominant).toBe(hexToRgb(DECKS[0]!.background));
	await expect(page.getByTestId('presentation-card-thumb')).toHaveCount(1);
});

test('a thumbnail stays inside the card preview without widening the page', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	await openLibraryWithDecks(page, DECKS);
	await expect(page.getByTestId('presentation-card-thumb').first()).toBeVisible();

	for (const viewport of [
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
			.toBe(true);

		const box = await page
			.locator('.presentation-card')
			.first()
			.evaluate((card) => {
				const preview = card.querySelector('.presentation-card-preview')!.getBoundingClientRect();
				const image = card
					.querySelector('[data-testid="presentation-card-thumb"]')!
					.getBoundingClientRect();
				const link = card.querySelector('.presentation-card-link')!.getBoundingClientRect();
				return {
					overlapsPreview:
						image.left >= preview.left - 0.5 &&
						image.right <= preview.right + 0.5 &&
						image.top >= preview.top - 0.5 &&
						image.bottom <= preview.bottom + 0.5,
					previewInsideCard: preview.width <= link.width + 0.5,
					imageWidth: image.width
				};
			});
		expect(box.overlapsPreview).toBe(true);
		expect(box.previewInsideCard).toBe(true);
		expect(box.imageWidth).toBeGreaterThan(0);
	}
});
