import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const routes = ['/', '/presentations', '/templates?tool=presentation', '/my-stickers'];

test('Good CSS keeps the desktop and phone pages contained and keyboard focus visible', async ({
	page
}, info) => {
	const evidence: unknown[] = [];
	for (const width of [1440, 1024, 390, 320]) {
		await page.setViewportSize({ width, height: 900 });
		for (const route of routes) {
			await page.goto(route);
			await expect(page.locator('h1').first()).toBeVisible();
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
				.toBe(true);
			await page.keyboard.press('Tab');
			const state = await page.evaluate(() => {
				const element = document.activeElement!;
				const style = getComputedStyle(element);
				return {
					width: innerWidth,
					scrollWidth: document.documentElement.scrollWidth,
					focusVisible: element.matches(':focus-visible'),
					outlineStyle: style.outlineStyle,
					outlineWidth: style.outlineWidth
				};
			});
			expect(state.focusVisible).toBe(true);
			expect(state.outlineStyle).not.toBe('none');
			expect(parseFloat(state.outlineWidth)).toBeGreaterThanOrEqual(2);
			evidence.push({ route, ...state });
			await page.screenshot({
				path: info.outputPath(`${width}-${route.split('?')[0].replaceAll('/', '') || 'home'}.png`),
				fullPage: true
			});
		}
	}
	await writeFile(info.outputPath('responsive-focus.json'), JSON.stringify(evidence, null, 2));
});

test('Good CSS gives controls press feedback and limits movement to permitted motion', async ({
	page
}, info) => {
	await page.goto('/my-stickers');
	const button = page.getByRole('button', { name: 'New Pack', exact: true });
	await expect(button).toBeVisible();
	const restingBackground = await button.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);
	await button.hover();
	await expect
		.poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor))
		.not.toBe(restingBackground);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	expect(await button.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
		'0s'
	);
	await button.focus();
	await page.keyboard.down('Space');
	const pressedOpacity = await button.evaluate((element) => getComputedStyle(element).opacity);
	await page.keyboard.up('Space');
	expect(Number(pressedOpacity)).toBeLessThan(1);
	const dialog = page.getByRole('dialog', { name: 'Create New Pack' });
	await expect(dialog).toBeVisible();
	const locked = await page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
	expect(locked).toBe('hidden');
	await dialog.getByLabel('Pack Name').fill('CSS verification');
	await page.screenshot({ path: info.outputPath('reduced-motion-dialog.png') });
	await page.keyboard.press('Escape');
	await expect(button).toBeFocused();
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe(
		'hidden'
	);
	await writeFile(
		info.outputPath('interaction.json'),
		JSON.stringify({ pressedOpacity, modalScrollLock: locked, reducedMotion: true }, null, 2)
	);
});

test('Good CSS does not apply hover feedback on touch devices', async ({ browser }, info) => {
	const context = await browser.newContext({
		baseURL: 'http://localhost:4173',
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true
	});
	const page = await context.newPage();
	try {
		await page.goto('/my-stickers');
		const button = page.getByRole('button', { name: 'New Pack', exact: true });
		await expect(button).toBeVisible();
		const before = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
		await button.hover();
		expect(await button.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
			before
		);
		expect(
			await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)
		).toBe(false);
		await button.tap();
		await expect(page.getByRole('dialog', { name: 'Create New Pack' })).toBeVisible();
		await expect(page.getByLabel('Pack Name')).toBeInViewport();
		await page.screenshot({ path: info.outputPath('touch-dialog.png'), animations: 'disabled' });
	} finally {
		await context.close();
	}
});
