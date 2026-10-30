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

test('ribbon tabs work like PowerPoint', async ({ page }) => {
	await openBlankEditor(page);
	const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
	const tab = (name: string) => ribbon.getByRole('tab', { name, exact: true });
	for (const name of ['Home', 'Insert', 'Design', 'Arrange', 'View'])
		await expect(tab(name)).toBeVisible();
	await expect(tab('Home')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tabpanel', { name: 'Home' })).toBeVisible();
	await expect(tab('Shape Format')).toHaveCount(0);

	// Arrow keys move focus between tabs; Enter opens the focused one.
	await tab('Home').focus();
	await page.keyboard.press('ArrowRight');
	await expect(tab('Insert')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(tab('Insert')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('button', { name: 'Add image', exact: true })).toBeVisible();

	await tab('Design').click();
	await expect(page.getByLabel('Heading font')).toBeVisible();

	// A contextual tab appears only while a shape is selected, and falls back to
	// Home when its selection disappears.
	await tab('Home').click();
	await page.getByLabel('Add shape', { exact: true }).selectOption('Rectangle');
	await expect(tab('Shape Format')).toBeVisible();
	await tab('Shape Format').click();
	await expect(page.getByLabel('Shape fill color')).toBeVisible();
	await page.keyboard.press('Control+z');
	await expect(tab('Shape Format')).toHaveCount(0);
	await expect(tab('Home')).toHaveAttribute('aria-selected', 'true');

	// Ctrl+F1 collapses the ribbon to its tabs and restores it.
	await page.keyboard.press('Control+F1');
	await expect(page.getByRole('tabpanel')).toHaveCount(0);
	await page.keyboard.press('Control+F1');
	await expect(page.getByRole('tabpanel', { name: 'Home' })).toBeVisible();
});

test('task pane shows format and selection, closes, and remembers it', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBlankEditor(page);
	const pane = page.getByRole('complementary', { name: 'Task pane' });
	await expect(pane.getByRole('region', { name: 'Format' })).toBeVisible();
	await expect(pane.getByRole('region', { name: 'Selection' })).toBeVisible();
	// The left panel holds slides only.
	const slides = page.getByRole('complementary', { name: 'Slides' });
	await expect(slides.locator('.presentation-layer-item')).toHaveCount(0);
	await expect(pane.getByText('Drag an element to move it.')).toHaveCount(0);

	await page.getByLabel('Add shape', { exact: true }).selectOption('Rectangle');
	await expect(pane.getByLabel('X position', { exact: true })).toBeVisible();
	await expect(pane.locator('.presentation-layer-item')).toHaveCount(1);

	// View › Selection pane hides and shows the element list.
	await page.getByRole('tab', { name: 'View', exact: true }).click();
	await page.getByRole('button', { name: 'Selection pane', exact: true }).click();
	await expect(pane.getByRole('region', { name: 'Selection' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Selection pane', exact: true }).click();
	await expect(pane.getByRole('region', { name: 'Selection' })).toBeVisible();

	// Closing the pane gives the canvas the room and survives a reload.
	const before = (await page.getByTestId('presentation-canvas').boundingBox())!.width;
	await pane.getByRole('button', { name: 'Close task pane', exact: true }).click();
	await expect(pane).toHaveCount(0);
	await expect
		.poll(async () => (await page.getByTestId('presentation-canvas').boundingBox())!.width)
		.toBeGreaterThan(before + 200);
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByRole('complementary', { name: 'Task pane' })).toHaveCount(0);
	await page.getByRole('tab', { name: 'View', exact: true }).click();
	await page.getByRole('button', { name: 'Format pane', exact: true }).click();
	await expect(page.getByRole('complementary', { name: 'Task pane' })).toBeVisible();

	// Between 1024 and 1279 px the pane floats over the canvas instead of taking a column.
	await page.setViewportSize({ width: 1100, height: 800 });
	const position = await page
		.getByRole('complementary', { name: 'Task pane' })
		.evaluate((node) => getComputedStyle(node).position);
	expect(position).toBe('absolute');
});
