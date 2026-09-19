import { expect, test, type Page } from '@playwright/test';
import { openBlankEditor, readStoredPresentationJson } from './presentations';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Presentation details' });
const textField = (page: Page) => page.getByTestId('text-edit-field');
const storedRow = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));

/** Every paragraph child must stay inside the field's border box. */
const fieldsFit = (page: Page) =>
	textField(page).evaluate((host) => {
		const rect = host.getBoundingClientRect();
		return Array.from(host.children).every((child) => {
			const box = child.getBoundingClientRect();
			return box.bottom <= rect.bottom + 1 && box.right <= rect.right + 1;
		});
	});

test('multiline text remains inside its auto-growing box while typing', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text', exact: true }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await field.fill('Xin chào Việt Nam\nSecond line\nThird line\nFourth line\nFifth line');
	await expect.poll(() => fieldsFit(page)).toBe(true);
	await field.blur();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const row = JSON.parse(await readStoredPresentationJson(page, id));
	expect(row.slides[0].elements[0].autoGrow).toBe(true);
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	const reopened = JSON.parse(await readStoredPresentationJson(page, id));
	expect(reopened.slides[0].elements[0]).toEqual(row.slides[0].elements[0]);
});

test('heading preset styles survive first typing, clearing and reopening', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.type('My heading');
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const row = await storedRow(page, id);
	const text = row.slides[0].elements[0];
	expect(text.paragraphs[0].runs[0].size).toBe(56);
	expect(text.paragraphs[0].runs[0].fontId).toBe(row.theme.headingFontId);
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	expect((await storedRow(page, id)).slides[0].elements[0]).toEqual(text);

	// Clearing the field and typing again keeps the heading size and font.
	await page
		.locator('.presentation-layer-item')
		.first()
		.locator('.presentation-layer-select')
		.click();
	await page.getByRole('button', { name: 'Edit text' }).click();
	const field = textField(page);
	await expect(field).toBeFocused();
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Backspace');
	await page.keyboard.type('Again');
	await page.keyboard.press('Escape');
	await expect
		.poll(async () => (await storedRow(page, id)).slides[0].elements[0].paragraphs[0].runs[0])
		.toMatchObject({ text: 'Again', size: 56, fontId: row.theme.headingFontId });
});

test('keeps blank lines, an unbroken link and mixed sizes inside the box', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text', exact: true }).click();
	const field = textField(page);
	await expect(field).toBeFocused();
	await field.blur();
	await panel(page).getByLabel('Text sizing').selectOption('grow');
	await page.getByRole('button', { name: 'Edit text' }).click();
	await expect(field).toBeFocused();

	await page.keyboard.type('above');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('below https://averyveryverylongunbrokenword.example/🦊');
	await expect.poll(() => fieldsFit(page)).toBe(true);

	// Mixed sizes: the whole content at 96 units must still fit and wrap.
	await page.keyboard.press('Control+a');
	const sizeSelect = page.getByRole('toolbar', { name: 'Text formatting' }).getByLabel('Font size');
	// The toolbar reflects the live selection; waiting for a uniform value proves the
	// cached range is ready before the change is applied.
	await expect(sizeSelect).toHaveValue('28');
	await sizeSelect.selectOption('96');
	await expect.poll(() => fieldsFit(page)).toBe(true);
	await field.blur();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

	// Autosave settles asynchronously; poll for the committed structure instead of
	// reading a row that may still hold the pre-change document. An empty
	// placeholder paragraph keeps its own default run size, so only non-empty runs
	// are required to carry the chosen size.
	await expect
		.poll(
			async () => {
				const text = (await storedRow(page, id)).slides[0].elements[0];
				if (!text) return null;
				const runs = text.paragraphs.flatMap((paragraph: any) => paragraph.runs);
				const joined = text.paragraphs
					.map((paragraph: any) => paragraph.runs.map((run: any) => run.text).join(''))
					.join('\n');
				return {
					blankLine: /above\n{2,}below/.test(joined),
					// Newline-only runs are structural (a browser break is not text-selectable),
					// so every run that carries visible text must have taken the new size.
					visibleRunsAt96: runs
						.filter((run: any) => run.text.replace(/\n/g, '') !== '')
						.every((run: any) => run.size === 96),
					autoGrow: text.autoGrow === true
				};
			},
			{ message: 'stored blank-line/size structure' }
		)
		.toEqual({ blankLine: true, visibleRunsAt96: true, autoGrow: true });
});

test('rotates the editing field with its element and refits height after a width change', async ({
	page
}) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text', exact: true }).click();
	const field = textField(page);
	await expect(field).toBeFocused();
	await field.blur();
	await panel(page).getByLabel('Text sizing').selectOption('grow');
	// Start from a height that cannot already hold the line, so auto-growth and the
	// later width-driven reflow are both observable.
	await panel(page).getByLabel('Height').fill('40');
	await panel(page).getByLabel('Height').blur();
	await page.getByRole('button', { name: 'Edit text' }).click();
	await page.keyboard.type('A line that will need to wrap when the box narrows');
	await field.blur();
	await expect
		.poll(async () => (await storedRow(page, id)).slides[0]?.elements[0]?.height ?? 0)
		.toBeGreaterThan(40);
	const heightBefore = (await storedRow(page, id)).slides[0].elements[0].height;

	// The stored rotation must reach the editing field itself, not only the canvas.
	await panel(page).getByLabel('Rotation').fill('15');
	await panel(page).getByLabel('Rotation').blur();
	await expect
		.poll(async () => (await storedRow(page, id)).slides[0].elements[0].rotation)
		.toBeCloseTo(15);
	await page.getByRole('button', { name: 'Edit text' }).click();
	await expect(field).toHaveCSS('transform', /matrix/);
	await field.blur();

	// Narrowing the box refits the auto-grown height inside the same command.
	const widthInput = panel(page).getByLabel('Width');
	await widthInput.fill('300');
	await expect(widthInput).toHaveValue('300');
	await widthInput.blur();
	await expect.poll(async () => (await storedRow(page, id)).slides[0].elements[0].width).toBe(300);
	const after = (await storedRow(page, id)).slides[0].elements[0];
	expect(after.height).toBeGreaterThan(heightBefore);
});
