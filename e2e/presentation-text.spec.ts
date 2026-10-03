import { expect, test, type Page } from '@playwright/test';
import {
	at,
	canvasView,
	clickAt,
	elementRectOnCanvas,
	openBlankEditor,
	paintedPixelsInRect,
	readStoredPresentationJson
} from './presentations';

/**
 * The text journeys, ported from the source `inserts, edits, saves, and reopens a
 * text box without moving it`, `formats a text selection and keeps it through
 * save and reopen`, `applies paragraph formatting and links, and reports text
 * overflow` and `autosaves a typed edit and keeps it after a reload and reopen`.
 *
 * The source read the React store directly. The production build exposes no
 * store, so every claim is made against the stored IndexedDB row, the app's own
 * DOM seams (the DOM overlay the caret lives in, the canvas host's data-*
 * attributes) and the pixels the canvas really paints.
 */

const canvasHost = (page: Page) => page.getByTestId('presentation-canvas');
// The geometry inspector also offers "Align Left/Center/Right", so every formatting
// control is scoped to the text toolbar to keep the intent unambiguous.
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Text formatting' });
const textField = (page: Page) => page.getByTestId('text-edit-field');
const storedRow = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));
const textElement = (row: any) =>
	row?.slides?.[0]?.elements?.find((element: any) => element.kind === 'text');
const runText = (element: any) =>
	(element?.paragraphs ?? [])
		.flatMap((paragraph: any) => paragraph.runs)
		.map((run: any) => run.text)
		.join('');
const runsOf = (element: any) =>
	(element?.paragraphs ?? [])
		.flatMap((paragraph: any) => paragraph.runs)
		.map((run: any) => ({ text: run.text, bold: run.bold ?? false, size: run.size }));
const geometryOf = ({ x, y, width, height }: any) => ({ x, y, width, height });

/**
 * Re-opens the editing session through the accessible path: select the box in the
 * layer list, then use the editor bar's "Edit text" action. Ending a session with
 * `blur` closes it for real, and the canvas double-click path is already covered
 * by the first journey.
 */
const startEditing = async (page: Page) => {
	await page
		.locator('.presentation-layer-item')
		.first()
		.locator('.presentation-layer-select')
		.click();
	await page.getByRole('button', { name: 'Edit text' }).click();
	await expect(textField(page)).toBeFocused();
};

/**
 * Ends the session from whichever control holds focus. Toolbar buttons keep focus
 * in the field, so `blur` alone works for them; a link or colour input really does
 * take focus, and `blur` on an unfocused field does nothing at all. The click only
 * moves the caret, so every commit already made stands, and ending the session is
 * what releases the autosave debounce.
 */
const endSession = async (page: Page) => {
	await textField(page).click();
	await textField(page).blur();
	await expect(textField(page)).toHaveCount(0);
};

test('inserts, edits, saves, and reopens a text box without moving it', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	// Insert through the toolbar, then type Vietnamese and English into the overlay.
	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(textField(page)).toBeFocused();
	await page.keyboard.type('Xin chào Việt Nam — hello');
	await expect(canvasHost(page)).toHaveAttribute('data-editing-element', /.+/);

	// A click on the slide background closes the session: the box keeps what was
	// typed and the caret is gone.
	await clickAt(page, at(await canvasView(page), 20, 20));
	await expect(textField(page)).toHaveCount(0);

	await expect
		.poll(async () => runText(textElement(await storedRow(page, id))))
		.toBe('Xin chào Việt Nam — hello');
	const inserted = textElement(await storedRow(page, id));
	const placement = geometryOf(inserted);

	// Typing never touches the canvas view.
	await expect(canvasHost(page)).toHaveAttribute('data-view-zoom', '1');
	await expect(canvasHost(page)).toHaveAttribute('data-view-pan-x', '0');
	await expect(canvasHost(page)).toHaveAttribute('data-view-pan-y', '0');

	// Hit testing: a click selects the box, a double click opens the DOM editor on
	// the first text line, which is where the canvas paints the text.
	const firstLine = {
		x: inserted.x + inserted.padding + 8,
		y:
			inserted.y +
			inserted.padding +
			(inserted.paragraphs[0].runs[0].size * inserted.lineHeight) / 2
	};
	await clickAt(page, at(await canvasView(page), firstLine.x, firstLine.y));
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', inserted.id);
	const linePoint = at(await canvasView(page), firstLine.x, firstLine.y);
	await page.mouse.dblclick(linePoint.x, linePoint.y);
	await expect(textField(page)).toBeVisible();
	await expect(textField(page)).toContainText('Xin chào Việt Nam');
	await expect(page.getByRole('button', { name: 'Edit text' })).toBeVisible();

	// The wheel zoom keeps the editing session open: the dashed overlay tracks the
	// element box on screen and the caret keeps its place inside it.
	const content = canvasHost(page).locator('.konvajs-content');
	const contentBox = (await content.boundingBox())!;
	await page.mouse.move(contentBox.x + 30, contentBox.y + 30);
	await page.mouse.wheel(0, -120);
	await expect(canvasHost(page)).not.toHaveAttribute('data-view-zoom', '1');
	await expect(textField(page)).toBeVisible();
	const zoomedRect = await elementRectOnCanvas(page, placement);
	const fieldBox = (await textField(page).boundingBox())!;
	expect(Math.abs(fieldBox.x - (contentBox.x + zoomedRect.x))).toBeLessThanOrEqual(2);
	expect(Math.abs(fieldBox.y - (contentBox.y + zoomedRect.y))).toBeLessThanOrEqual(2);

	// Typing continues from the caret the zoom left behind.
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.type('~');
	await page.keyboard.press('Escape');
	await expect(textField(page)).toHaveCount(0);
	await page.getByRole('button', { name: 'Fit slide to window' }).click();
	await expect(canvasHost(page)).toHaveAttribute('data-view-pan-x', '0');
	await expect(canvasHost(page)).toHaveAttribute('data-view-pan-y', '0');

	await expect
		.poll(async () => runText(textElement(await storedRow(page, id))))
		.toBe('Xin chào Việt Nam — hel~lo');
	// The second session edited the text, not the box: the geometry is untouched.
	expect(geometryOf(textElement(await storedRow(page, id)))).toEqual(placement);

	// An empty box stays reachable: blur without typing, then select it by clicking
	// inside the box the toolbar inserted.
	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(textField(page)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(textField(page)).toHaveCount(0);
	await expect.poll(async () => (await storedRow(page, id)).slides[0].elements.length).toBe(2);
	const empty = (await storedRow(page, id)).slides[0].elements[1];
	await clickAt(
		page,
		at(await canvasView(page), empty.x + empty.width / 2, empty.y + empty.height / 2)
	);
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', empty.id);

	// The autosave writes it; a reload and the library's own reopen path bring the
	// box back where it was, with its text painted inside it and nothing below.
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
		timeout: 10_000
	});
	await page.reload();
	await page.goto('/presentations');
	await page.getByRole('link', { name: 'Open Untitled presentation' }).click();
	await expect(canvasHost(page)).toHaveAttribute('data-ready', 'true');
	expect(geometryOf(textElement(await storedRow(page, id)))).toEqual(placement);
	const boxRect = await elementRectOnCanvas(page, placement);
	await expect.poll(() => paintedPixelsInRect(page, boxRect)).toBeGreaterThan(120);
	const belowRect = await elementRectOnCanvas(page, {
		x: placement.x,
		y: placement.y + placement.height + 40,
		width: placement.width,
		height: 80
	});
	expect(await paintedPixelsInRect(page, belowRect)).toBe(0);
});

test('formats a text selection and keeps it through save and reopen', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	await page.getByRole('button', { name: 'Add text' }).click();
	await textField(page).click();
	await page.keyboard.type('Xin chao');
	await page.keyboard.press('Control+a');
	await page.getByRole('button', { name: 'Bold' }).click();
	await page.getByLabel('Font size').selectOption('40');

	// The toolbar's own controls report the selection's formatting immediately.
	await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Font size')).toHaveValue('40');

	// Blurring ends the session, which is what the autosave debounce waits for.
	await textField(page).blur();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
		timeout: 10_000
	});

	const formatted = runsOf(textElement(await storedRow(page, id)));
	expect(formatted.map((run) => run.text).join('')).toBe('Xin chao');
	expect(formatted.length).toBeGreaterThan(0);
	expect(formatted.every((run) => run.bold)).toBe(true);
	expect(formatted.every((run) => run.size === 40)).toBe(true);

	await page.reload();
	await expect(canvasHost(page)).toHaveAttribute('data-ready', 'true');
	const reopened = runsOf(textElement(await storedRow(page, id)));
	expect(reopened.every((run) => run.bold && run.size === 40)).toBe(true);
});

test('applies paragraph formatting and links, and reports text overflow', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(textField(page)).toBeFocused();
	await page.keyboard.type('Dòng một');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Dòng hai');

	const paragraphs = async () => textElement(await storedRow(page, id)).paragraphs;

	await page.keyboard.press('Control+a');
	await toolbar(page).getByRole('button', { name: 'Align center' }).click();
	await page.keyboard.press('Control+a');
	await toolbar(page).getByRole('button', { name: 'Bulleted list' }).click();
	await textField(page).blur();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
		timeout: 10_000
	});

	const stored = (await storedRow(page, id)).slides[0].elements[0];
	expect(stored.paragraphs.map((paragraph: any) => paragraph.alignment)).toEqual([
		'center',
		'center'
	]);
	expect(stored.paragraphs.map((paragraph: any) => paragraph.bullet)).toEqual(['bullet', 'bullet']);
	expect(runText(stored)).toContain('Dòng một');
	expect(runText(stored)).toContain('Dòng hai');

	// A selection-wide link is applied to every run of the selection...
	await startEditing(page);
	await page.keyboard.press('Control+a');
	await page.getByLabel('Link URL').fill('https://example.com');
	// The address must land in the input, never in the text box. A passive toolbar
	// refresh used to put the field's saved selection back, which is enough for
	// Chromium to hand focus back to the field; the address was then inserted over
	// the selected text and the document lost its content.
	await expect(page.getByLabel('Link URL')).toHaveValue('https://example.com');
	await expect(textField(page)).toContainText('Dòng một');
	await expect(textField(page)).toContainText('Dòng hai');
	await page.getByRole('button', { name: 'Add link' }).click();
	await endSession(page);
	await expect
		.poll(async () =>
			(await paragraphs()).every((paragraph: any) =>
				paragraph.runs.every((run: any) => run.link === 'https://example.com')
			)
		)
		.toBe(true);

	// ...and an unsafe scheme is refused with the reason, not silently dropped.
	await startEditing(page);
	await page.keyboard.press('Control+a');
	await page.getByLabel('Link URL').click();
	await page.keyboard.press('Control+a');
	await page.keyboard.type('javascript:alert(1)');
	await page.getByRole('button', { name: 'Add link' }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Only http, https and mailto links can be added.'
	);
	// The refusal left the document untouched, so the session can simply end.
	await endSession(page);

	// The layout service reports the overflow and offers the one-click fix; the
	// element really grows and the notice goes away. New text now grows
	// automatically, so this manual workflow explicitly chooses a fixed box first.
	await page
		.getByRole('complementary', { name: 'Presentation details' })
		.getByLabel('Text sizing')
		.selectOption('fixed');
	await startEditing(page);
	await page.keyboard.press('Control+a');
	await page.keyboard.type('a'.repeat(600));
	const heightOf = async () => (await storedRow(page, id)).slides[0].elements[0].height;
	const before = await heightOf();
	// The element-properties modal mounts a second copy of the same notice, closed
	// and hidden, so the claim is scoped to the panel the user is actually looking at.
	const panelNotice = page
		.getByRole('complementary', { name: 'Presentation details' })
		.getByText(/Text overflows this box/);
	await expect(panelNotice).toBeVisible();
	await page.getByRole('button', { name: 'Grow box to fit' }).click();
	// Growing the box keeps the session open on purpose, so the notice clears at
	// once; the new height reaches the store as soon as the session ends.
	await expect(panelNotice).toHaveCount(0);
	await endSession(page);
	await expect.poll(heightOf).toBeGreaterThan(before);
});

test('keeps the caret where the user left it while typing', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(textField(page)).toBeFocused();
	await page.keyboard.type('abc');

	// Every keystroke commits the session, and each commit replaces the element
	// object the overlay renders from. If that replaced the caret, the next
	// character would land at the end of the box instead of beside the last one.
	const caretOffset = () =>
		page.evaluate(() => {
			const host = document.querySelector('[data-testid="text-edit-field"]');
			const selection = window.getSelection?.();
			const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
			return range && host && host.contains(range.startContainer) && range.collapsed
				? range.startOffset
				: -1;
		});

	await page.keyboard.press('Home');
	await page.keyboard.type('X');
	await expect.poll(caretOffset).toBe(1);
	await page.keyboard.type('Y');
	await expect.poll(caretOffset).toBe(2);

	await textField(page).blur();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
		timeout: 10_000
	});
	await expect.poll(async () => runText(textElement(await storedRow(page, id)))).toBe('XYabc');
});

test('autosaves a typed edit and keeps it after a reload and reopen', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(textField(page)).toBeFocused();
	await page.keyboard.type('Autosave keeps this line');
	await page.keyboard.press('Escape');
	await expect(textField(page)).toHaveCount(0);

	// No Save click anywhere in this journey: the debounce writes it, and the status
	// only reads saved once the document really is clean.
	await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
		timeout: 10_000
	});

	await page.reload();
	await page.goto('/presentations');
	await page.getByRole('link', { name: 'Open Untitled presentation' }).click();
	await expect(page).toHaveURL(`/presentations/${id}`);
	await expect(canvasHost(page)).toHaveAttribute('data-ready', 'true');
	const reopened = textElement(await storedRow(page, id));
	expect(reopened.kind).toBe('text');
	expect(runText(reopened)).toBe('Autosave keeps this line');
});
