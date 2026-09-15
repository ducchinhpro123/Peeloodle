/**
 * Slice 5 hardening: reduced motion and keyboard-only operation.
 *
 * The reduced-motion rules are the source stylesheet's (the global
 * `transition: none !important` plus the suppressed dialog reveal). These
 * journeys prove the preference really switches behaviour — not just that the
 * media query parses — and that the primary flows stay operable without a
 * pointer.
 */
import { expect, test, type Page } from '@playwright/test';

/** Presses Tab until the focused element matches, then returns its name. */
async function tabTo(
	page: Page,
	matches: (name: string, tag: string) => boolean,
	limit = 60
): Promise<string> {
	for (let press = 0; press < limit; press += 1) {
		await page.keyboard.press('Tab');
		const focused = await page.evaluate(() => {
			const element = document.activeElement as HTMLElement | null;
			if (!element) return null;
			const name =
				element.getAttribute('aria-label') ??
				element.getAttribute('title') ??
				element.textContent?.trim() ??
				'';
			return { name, tag: element.tagName.toLowerCase() };
		});
		if (focused && matches(focused.name, focused.tag)) return focused.name;
	}
	throw new Error('the control was never reached by Tab');
}

test('reduced motion removes the dialog animation and leaves the dialog usable', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/my-stickers');
	expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
		true
	);

	await page.getByRole('button', { name: 'New Pack' }).click();
	const dialog = page.getByRole('dialog', { name: 'Create New Pack' });
	await expect(dialog).toBeVisible();
	await page.waitForTimeout(60);
	expect(
		await page.evaluate(() => ({
			animationName: getComputedStyle(document.querySelector('dialog[open]')!).animationName,
			running: document.getAnimations().length
		}))
	).toEqual({ animationName: 'none', running: 0 });
	// The dialog is fully usable: its first field is focused and Escape restores focus.
	await expect(dialog.getByLabel('Pack Name')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'New Pack' })).toBeFocused();
});

test('the same dialog reveals through the keyframes when motion is allowed', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/my-stickers');
	await page.getByRole('button', { name: 'New Pack' }).click();
	await expect(page.getByRole('dialog', { name: 'Create New Pack' })).toBeVisible();
	await page.waitForTimeout(60);
	const state = await page.evaluate(() => ({
		animationName: getComputedStyle(document.querySelector('dialog[open]')!).animationName,
		running: document.getAnimations().some((animation) => animation.animationName === 'reveal')
	}));
	expect(state).toEqual({ animationName: 'reveal', running: true });
});

test('primary navigation and the pack flow are operable with the keyboard alone', async ({
	page
}) => {
	// Dashboard → editor through the primary nav, Enter only.
	await page.goto('/');
	await tabTo(page, (name) => name === 'Create');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/editor\/[0-9a-z-]+/, { timeout: 20_000 });
	await expect(page.locator('[aria-label="Sticker title"]')).toBeVisible();

	// The library's create-pack dialog is reachable, its first field takes focus,
	// and Enter creates the pack: no pointer anywhere in this journey.
	await page.goto('/my-stickers');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Your little world.');
	await tabTo(page, (name) => name === 'New Pack');
	await page.keyboard.press('Enter');
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Create New Pack' })).toBeVisible();
	await expect(dialog.getByLabel('Pack Name')).toBeFocused();
	await page.keyboard.type('Keyboard pack');
	await tabTo(page, (name) => name === 'Create Pack');
	await page.keyboard.press('Enter');
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.locator('.pack-grid .pack-card')).toHaveCount(1);
	await expect(page.locator('.pack-detail h2')).toHaveText('Keyboard pack');
});
