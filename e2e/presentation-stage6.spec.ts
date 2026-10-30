/** Final accessibility, responsive and journey evidence for the slide editor. */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBlankEditor, addShape, readStoredPresentationJson } from './presentations';
const OUT = 'proofs/out/slide-editor-stage6';
const host = (page: Page) => page.getByTestId('presentation-canvas');
async function report(name: string, value: unknown) {
	await mkdir(OUT, { recursive: true });
	await writeFile(`${OUT}/${name}.json`, JSON.stringify(value, null, 2));
}
async function ready(page: Page) {
	await expect(host(page)).toHaveAttribute('data-ready', 'true');
}

test('Stage 6 accessibility sweep of ribbon, menus, pane, status and phone preview', async ({
	page
}) => {
	test.setTimeout(120_000);
	const id = await openBlankEditor(page);
	await ready(page);
	await addShape(page, 'rectangle');
	const scans: any[] = [];
	const scan = async (state: string) => {
		const result = await new AxeBuilder({ page })
			.include('.presentation-editor')
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
			.analyze();
		scans.push({
			state,
			passes: result.passes.map((rule) => rule.id),
			incomplete: result.incomplete.map((rule) => ({
				id: rule.id,
				nodes: rule.nodes.map((node) => node.target)
			})),
			violations: result.violations.map((rule) => ({
				id: rule.id,
				impact: rule.impact,
				help: rule.help,
				nodes: rule.nodes.map((node) => ({ target: node.target, summary: node.failureSummary }))
			}))
		});
	};
	await scan('home-selected-shape');
	for (const name of ['Insert', 'Design', 'Arrange', 'View', 'Shape Format']) {
		await page.getByRole('tab', { name, exact: true }).click();
		await scan(name);
	}
	await page
		.getByTestId('presentation-image-input')
		.setInputFiles('static/samples/cat-in-console.png');
	await page.getByRole('tab', { name: 'Picture Format', exact: true }).click();
	await scan('Picture Format');
	await page.getByRole('tab', { name: 'Home', exact: true }).click();
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await page.getByTestId('text-edit-field').fill('Accessible heading');
	await scan('text-editing');
	// Axe cannot infer the canvas background behind an editable DOM run.
	// Resolve that review item using the actual saved slide background and run color.
	const background = JSON.parse(await readStoredPresentationJson(page, id)).slides[0].background;
	const textContrast = await page.getByTestId('text-edit-field').evaluate((node, background) => {
		const span = node.querySelector('span')!;
		const foreground = getComputedStyle(span).color;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const ctx = canvas.getContext('2d')!;
		const lum = (color: string) => {
			ctx.fillStyle = color;
			ctx.fillRect(0, 0, 1, 1);
			return Array.from(ctx.getImageData(0, 0, 1, 1).data)
				.slice(0, 3)
				.map((channel) => {
					const s = channel / 255;
					return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
				})
				.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
		};
		const a = lum(foreground),
			b = lum(background);
		return { foreground, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
	}, background);
	expect(textContrast.ratio).toBeGreaterThanOrEqual(4.5);
	scans.at(-1).canvasTextContrastReview = textContrast;
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+F1');
	await scan('collapsed-ribbon');
	await page.keyboard.press('Control+F1');
	await page.getByRole('button', { name: 'Close task pane', exact: true }).click();
	await scan('closed-pane');
	await page.getByRole('tab', { name: 'View', exact: true }).click();
	await page.getByRole('button', { name: 'Format pane', exact: true }).click();
	await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
	await page.getByRole('button', { name: 'Align elements', exact: true }).click();
	await scan('alignment-menu');
	await page.keyboard.press('Escape');
	await host(page).focus();
	await page.keyboard.press('Shift+F10');
	await scan('element-menu');
	await page.keyboard.press('Escape');
	await page.locator('.presentation-slide-card').focus();
	await page.keyboard.press('Shift+F10');
	await scan('slide-menu');
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('tab', { name: 'Home', exact: true }).click();
	await scan('phone-preview');
	await report('accessibility', scans);
	expect(
		scans.flatMap((scan) =>
			scan.incomplete.filter(
				(rule: any) =>
					!(
						scan.state === 'text-editing' &&
						rule.id === 'color-contrast' &&
						scan.canvasTextContrastReview?.ratio >= 4.5
					)
			)
		)
	).toEqual([]);
	expect(
		scans.flatMap((scan) =>
			scan.violations.map((violation: any) => ({ state: scan.state, ...violation }))
		)
	).toEqual([]);
});

test('Stage 6 keyboard focus is visible inside every editor region and selection is announced', async ({
	page
}) => {
	await openBlankEditor(page);
	await ready(page);
	await addShape(page, 'rectangle');
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
	const focus: any[] = [];
	for (let i = 0; i < 6; i++) {
		await page.keyboard.press('F6');
		const sample = await page.evaluate(() => {
			const node = document.activeElement as HTMLElement;
			const css = getComputedStyle(node);
			const rect = node.getBoundingClientRect();
			const pixel = document.createElement('canvas');
			pixel.width = pixel.height = 1;
			const ctx = pixel.getContext('2d')!;
			const rgba = (color: string) => {
				ctx.clearRect(0, 0, 1, 1);
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1, 1);
				return Array.from(ctx.getImageData(0, 0, 1, 1).data);
			};
			let parent: HTMLElement | null = node;
			let background = [255, 255, 255, 255];
			while (parent) {
				const color = rgba(getComputedStyle(parent).backgroundColor);
				if (color[3] === 255) {
					background = color;
					break;
				}
				parent = parent.parentElement;
			}
			const luminance = (color: number[]) =>
				color
					.slice(0, 3)
					.map((channel) => {
						const s = channel / 255;
						return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
					})
					.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
			const a = luminance(rgba(css.outlineColor)),
				b = luminance(background);
			return {
				contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
				tag: node.tagName,
				name: node.getAttribute('aria-label') ?? node.textContent?.trim(),
				outline: css.outlineStyle,
				width: parseFloat(css.outlineWidth),
				offset: parseFloat(css.outlineOffset),
				color: css.outlineColor,
				visible: node.matches(':focus-visible'),
				rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				canvas: node.dataset.testid === 'presentation-canvas'
			};
		});
		focus.push(sample);
	}
	await report('focus', focus);
	for (const sample of focus) {
		expect(sample.visible).toBe(true);
		expect(sample.width).toBeGreaterThanOrEqual(2);
		expect(sample.outline).not.toBe('none');
		expect(sample.contrast).toBeGreaterThanOrEqual(3);
		if (sample.canvas) expect(sample.offset).toBeLessThanOrEqual(-sample.width);
	}
	await host(page).focus();
	await expect(host(page)).toHaveAccessibleName('Slide editing area');
	await page.keyboard.press('Tab');
	await expect(page.getByTestId('canvas-selection-announcement')).toContainText('Rectangle');
	await page.screenshot({ path: `${OUT}/keyboard-focus.png` });
});

test('Stage 6 responsive editor stays contained at 1024–1440 and on a phone', async ({ page }) => {
	await openBlankEditor(page);
	await ready(page);
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await page.getByTestId('text-edit-field').fill('A final responsive proof');
	await page.keyboard.press('Escape');
	const samples: any[] = [];
	for (const width of [1440, 1280, 1100, 1024, 390]) {
		await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
				)
		);
		const sample = await page.evaluate(() => {
			const host = document.querySelector('[data-testid="presentation-canvas"]')!;
			const rect = host.getBoundingClientRect();
			const pane = document.querySelector('.task-pane')!;
			const scale = Math.min(rect.width / 1280, rect.height / 720);
			const p = pane.getBoundingClientRect();
			return {
				width: innerWidth,
				viewportHeight: innerHeight,
				statusBottom: document.querySelector('.editor-status-bar')!.getBoundingClientRect().bottom,
				scrollWidth: document.documentElement.scrollWidth,
				canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				slide: {
					x: rect.x + (rect.width - 1280 * scale) / 2,
					y: rect.y + (rect.height - 720 * scale) / 2,
					width: 1280 * scale,
					height: 720 * scale
				},
				pane: { visible: p.width > 0 && p.height > 0, x: p.x }
			};
		});
		samples.push(sample);
		expect(sample.scrollWidth).toBeLessThanOrEqual(width);
		expect(sample.slide.x).toBeGreaterThanOrEqual(sample.canvas.x - 1);
		expect(sample.slide.x + sample.slide.width).toBeLessThanOrEqual(
			sample.canvas.x + sample.canvas.width + 1
		);
		if (width >= 1024)
			expect(sample.pane.x).toBeGreaterThanOrEqual(sample.canvas.x + sample.canvas.width - 1);
		else {
			expect(sample.pane.visible).toBe(false);
			expect(sample.slide.y + sample.slide.height).toBeLessThanOrEqual(sample.viewportHeight);
			expect(sample.statusBottom).toBeLessThanOrEqual(sample.viewportHeight);
			await expect(
				page.getByRole('heading', { name: 'Untitled presentation', exact: true })
			).toBeInViewport();
			expect(
				await page
					.locator('.presentation-local-status')
					.evaluate((node) => node.scrollWidth <= node.clientWidth)
			).toBe(true);
			await expect(page.getByText(/Presentation authoring is designed for a laptop/)).toBeVisible();
		}
		await page.screenshot({ path: `${OUT}/responsive-${width}.png`, fullPage: true });
		await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
		await page.getByRole('button', { name: 'Align elements', exact: true }).click();
		const menu = (await page.getByRole('menu').boundingBox())!;
		expect(menu.x).toBeGreaterThanOrEqual(0);
		expect(menu.x + menu.width).toBeLessThanOrEqual(width);
		await page.keyboard.press('Escape');
		await page.getByRole('tab', { name: 'Home', exact: true }).click();
	}
	await report('responsive', samples);
});
