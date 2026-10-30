/**
 * Slide editor shell (redesign stage 3): a full-screen, PowerPoint-style frame
 * with a title bar, a classic ribbon, a slide panel, a task pane and a status
 * bar.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBlankEditor } from './presentations';

const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Editor status' });

test('editor fills the window without site navigation', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBlankEditor(page);
	await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'StickerLab home' })).toHaveCount(0);
	const titleBar = page.getByRole('banner', { name: 'Presentation title bar' });
	await expect(titleBar.getByRole('heading', { level: 1 })).toHaveText('Untitled presentation');
	await expect(statusBar(page)).toContainText('Slide 1 of 1');
	await page.getByRole('button', { name: 'Add slide', exact: true }).click();
	await expect(statusBar(page)).toContainText('Slide 2 of 2');

	const host = await page.getByTestId('presentation-canvas').boundingBox();
	const status = await statusBar(page).boundingBox();
	expect(host && status).toBeTruthy();
	expect(host!.y + host!.height).toBeLessThanOrEqual(status!.y + 1);
	expect(status!.y + status!.height).toBeLessThanOrEqual(900 + 1);
});

test('status bar zoom controls keep their names', async ({ page }) => {
	await openBlankEditor(page);
	const bar = statusBar(page);
	await expect(bar.getByRole('button', { name: 'Zoom in' })).toBeVisible();
	await expect(bar.getByRole('button', { name: 'Zoom out' })).toBeVisible();
	await expect(bar.getByRole('button', { name: 'Fit slide to window' })).toBeVisible();
	await expect(bar.getByLabel('Canvas zoom')).toHaveText('100%');
	await bar.getByRole('button', { name: 'Zoom in' }).click();
	await expect(bar.getByLabel('Canvas zoom')).toHaveText('125%');

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-stage3-shell-report.json',
		JSON.stringify(
			{ test: 'status bar zoom controls keep their names', zoomAfterZoomIn: '125%' },
			null,
			2
		)
	);
});
