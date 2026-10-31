/**
 * Motion: the site animates when motion is allowed, is completely static and fully
 * visible when it is not, and the slide editor's drag/resize path stays untouched.
 * Writes `motion-report.json` plus screenshots as the repeatable artifact.
 */
import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { openBlankEditor } from './presentations';

const animationName = (page: Page, selector: string) =>
	page
		.locator(selector)
		.first()
		.evaluate((element) => getComputedStyle(element).animationName);

const report: Record<string, unknown> = {};

test.afterAll(async () => {
	await writeFile(test.info().outputPath('motion-report.json'), JSON.stringify(report, null, 2));
});

test('motion allowed: landing page, cards and dialogs animate and settle visible', async ({
	page
}, info) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/');
	await expect(page.locator('h1').first()).toBeVisible();

	const hero = await animationName(page, '.hero-copy > *');
	expect(hero).not.toBe('none');
	const collage = await animationName(page, '.collage-cat');
	expect(collage).toContain('sticker-pop');

	const card = page.locator('.template-card').first();
	await card.scrollIntoViewIfNeeded();
	await expect(card).toHaveAttribute('data-reveal', 'shown');
	await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

	await card.hover();
	await expect.poll(() => card.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');

	await card.getByRole('button', { name: /^Preview / }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	const dialogAnimation = await dialog.evaluate((el) => getComputedStyle(el).animationName);
	expect(dialogAnimation).toContain('dialog-pop');
	await page.screenshot({ path: info.outputPath('motion-on-dialog.png'), animations: 'disabled' });
	await page.keyboard.press('Escape');

	report.motionAllowed = { hero, collage, dialog: dialogAnimation };
});

test('reduced motion: nothing animates and nothing is left hidden', async ({ page }, info) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	for (const route of ['/', '/presentations', '/templates?tool=presentation', '/my-stickers']) {
		await page.goto(route);
		await expect(page.locator('h1').first()).toBeVisible();
		const state = await page.evaluate(() => {
			const animated = [...document.querySelectorAll('*')].filter(
				(el) => getComputedStyle(el).animationName !== 'none'
			).length;
			const hidden = [...document.querySelectorAll('[data-reveal]')].filter(
				(el) => getComputedStyle(el).opacity !== '1'
			).length;
			return { animated, hidden };
		});
		expect(state, route).toEqual({ animated: 0, hidden: 0 });
		report[`reduced:${route}`] = state;
	}
	await page.goto('/');
	await page.screenshot({ path: info.outputPath('motion-reduced-home.png'), fullPage: true });
});

test('dashboard task cards reveal as they scroll into view', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/');
	const cards = page.locator('.task-card');
	await expect(cards.first()).toBeVisible();
	expect(await cards.count()).toBeGreaterThan(0);
	for (const card of await cards.all()) {
		await card.scrollIntoViewIfNeeded();
		await expect(card).toHaveAttribute('data-reveal', 'shown');
		await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
	}
});

test('editor: ribbon panel and menus animate, canvas path stays untouched', async ({
	page
}, info) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await openBlankEditor(page);
	const tabs = page.getByRole('tab');
	await tabs.nth(1).click();
	const panel = page.getByRole('tabpanel');
	await expect(panel).toBeVisible();
	const ribbon = await panel.evaluate((el) => getComputedStyle(el).animationName);
	expect(ribbon).toContain('panel-in');

	const canvasAnimated = await page
		.getByTestId('presentation-canvas')
		.evaluate(
			(host) =>
				[host, ...host.querySelectorAll('*')].filter(
					(el) => getComputedStyle(el).animationName !== 'none'
				).length
		);
	expect(canvasAnimated).toBe(0);
	await page.screenshot({ path: info.outputPath('motion-editor.png'), animations: 'disabled' });
	report.editor = { ribbon, canvasAnimated };
});
