/**
 * Slide editor canvas behaviour (redesign stage 4): the PowerPoint conventions
 * for fitting, panning, selecting, moving and placeholders.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBlankEditor, readStoredPresentationJson } from './presentations';

const host = (page: Page) => page.getByTestId('presentation-canvas');

/** The slide's rectangle on screen, from the canvas's own view attributes. */
async function slideRect(page: Page) {
	return host(page).evaluate((node) => {
		const zoom = Number(node.getAttribute('data-view-zoom'));
		const panX = Number(node.getAttribute('data-view-pan-x'));
		const panY = Number(node.getAttribute('data-view-pan-y'));
		const rect = node.getBoundingClientRect();
		const fit = Math.min(rect.width / 1280, rect.height / 720);
		const scale = fit * zoom;
		const width = 1280 * scale;
		const height = 720 * scale;
		const x = rect.left + (rect.width - width) / 2 + panX;
		const y = rect.top + (rect.height - height) / 2 + panY;
		return {
			x,
			y,
			width,
			height,
			host: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
		};
	});
}

test('the slide stays fully visible and cannot be lost', async ({ page }) => {
	const id = await openBlankEditor(page);
	const report: Record<string, unknown>[] = [];
	for (const [width, height] of [
		[1440, 900],
		[1280, 800],
		[1100, 800],
		[1024, 768]
	]) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(250);
		const slide = await slideRect(page);
		// Fitted: nothing of the slide is outside the canvas, and no pane covers it.
		expect(slide.x).toBeGreaterThanOrEqual(slide.host.x - 1);
		expect(slide.x + slide.width).toBeLessThanOrEqual(slide.host.x + slide.host.w + 1);
		expect(slide.y).toBeGreaterThanOrEqual(slide.host.y - 1);
		expect(slide.y + slide.height).toBeLessThanOrEqual(slide.host.y + slide.host.h + 1);
		const pane = page.getByRole('complementary', { name: 'Task pane' });
		const paneBox = await pane.boundingBox();
		if (paneBox) expect(paneBox.x).toBeGreaterThanOrEqual(slide.host.x + slide.host.w - 1);
		report.push({ width, height, slide });
	}

	// Dragging empty canvas does not pan any more (it draws a selection box).
	await page.setViewportSize({ width: 1440, height: 900 });
	const before = await readStoredPresentationJson(page, id);
	const box = (await host(page).boundingBox())!;
	await page.mouse.move(box.x + 10, box.y + 10);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
	await page.mouse.up();
	await expect(host(page)).toHaveAttribute('data-view-pan-x', '0');
	await expect(host(page)).toHaveAttribute('data-view-pan-y', '0');

	// Space+drag pans, and the pan is clamped so most of the slide stays in view.
	await host(page).focus();
	await page.keyboard.down('Space');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 3, box.y + box.height * 3, { steps: 8 });
	await expect(host(page)).toHaveClass(/is-panning/);
	await page.mouse.up();
	await page.keyboard.up('Space');
	const panned = await slideRect(page);
	const visibleWidth =
		Math.min(panned.x + panned.width, panned.host.x + panned.host.w) -
		Math.max(panned.x, panned.host.x);
	const visibleHeight =
		Math.min(panned.y + panned.height, panned.host.y + panned.host.h) -
		Math.max(panned.y, panned.host.y);
	expect(visibleWidth).toBeGreaterThanOrEqual(panned.width * 0.25 - 1);
	expect(visibleHeight).toBeGreaterThanOrEqual(panned.height * 0.25 - 1);
	await expect(host(page)).not.toHaveAttribute('data-view-pan-x', '0');
	expect(await readStoredPresentationJson(page, id)).toBe(before);

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-stage4-fit-report.json',
		JSON.stringify({ fits: report, panned }, null, 2)
	);
});
