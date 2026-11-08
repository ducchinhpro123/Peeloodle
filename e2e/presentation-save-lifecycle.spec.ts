import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
	addShape,
	listStoredPresentations,
	openBlankEditor,
	readStoredMedia,
	readStoredPresentation,
	selectFromElementList
} from './presentations';

const LOCAL_TEXT = 'Keep the work from my original tab';
const WINNING_TEXT = 'The other tab saved this version';

/** Two real editor sessions establish a stale revision without importing app internals. */
async function openConflict(page: Page, withArtwork = false) {
	const id = await openBlankEditor(page);
	if (withArtwork) {
		await page
			.getByTestId('presentation-image-input')
			.setInputFiles('static/samples/cat-in-console.png');
		await expect.poll(async () => (await readStoredPresentation(page, id))?.assets.length).toBe(1);
		await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
	}
	const other = await page.context().newPage();
	await other.goto(page.url());
	await expect(other.getByTestId('presentation-canvas')).toBeVisible();
	await page.getByRole('button', { name: 'Add text', exact: true }).click();
	await page.getByTestId('text-edit-field').fill(LOCAL_TEXT);
	await other.getByRole('button', { name: 'Add text', exact: true }).click();
	await other.getByTestId('text-edit-field').fill(WINNING_TEXT);
	await other.keyboard.press('Escape');
	await other.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(other.getByText('Saved in this browser', { exact: true })).toBeVisible();
	await other.close();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Keep my copy', exact: true })).toBeVisible();
}

async function expectBodyText(page: Page, value: string) {
	await selectFromElementList(page, 'Body text');
	await page.getByRole('button', { name: 'Edit text: Body text', exact: true }).click();
	await expect(page.getByTestId('text-edit-field')).toHaveText(value);
	await page.keyboard.press('Escape');
}

test.use({ trace: 'on' });

test.afterEach(async ({ page }, info) => {
	await page.screenshot({ path: info.outputPath('save-lifecycle.png'), animations: 'disabled' });
	const summaries = await listStoredPresentations(page);
	const documents = await Promise.all(summaries.map(({ id }) => readStoredPresentation(page, id)));
	await writeFile(
		info.outputPath('save-lifecycle.json'),
		JSON.stringify(
			{
				test: info.title,
				status: info.status,
				url: page.url(),
				ui: await page.locator('body').innerText(),
				documents
			},
			null,
			2
		)
	);
});

test('a failed conflict-copy write remains a conflict and can be retried without losing either version', async ({
	page
}) => {
	await openConflict(page);
	// Inject one real storage failure; the application still owns transaction rollback.
	await page.evaluate(() => {
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, ...args) {
			if (this.name === 'presentations' && value.title?.endsWith(' (conflict copy)')) {
				IDBObjectStore.prototype.put = put;
				throw new DOMException('The device is full', 'QuotaExceededError');
			}
			return put.call(this, value, ...args);
		};
	});
	await page.getByRole('button', { name: 'Keep my copy', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('could not be written to local storage');
	const retry = page.getByRole('button', { name: 'Keep my copy', exact: true });
	await expect(retry).toBeVisible();
	await expect(retry).toBeEnabled();
	await retry.click();
	await expect(page.getByText(/Your work was saved as a separate conflict copy/)).toBeVisible();
	await expectBodyText(page, WINNING_TEXT);
	await page.getByRole('link', { name: 'Back to presentations', exact: true }).click();
	await expect(
		page.getByText('2 saved presentations in this browser', { exact: true })
	).toBeVisible();
	await page
		.getByRole('link', { name: 'Open Untitled presentation (conflict copy)', exact: true })
		.click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expectBodyText(page, LOCAL_TEXT);
});

test('retrying a failed reopen reuses the conflict copy that was already saved', async ({
	page
}) => {
	await openConflict(page);
	await page.evaluate((id) => {
		const get = IDBObjectStore.prototype.get;
		IDBObjectStore.prototype.get = function (key) {
			if (this.name === 'presentations' && key === id) {
				IDBObjectStore.prototype.get = get;
				throw new DOMException('Storage could not be read', 'UnknownError');
			}
			return get.call(this, key);
		};
	}, page.url().split('/').pop()!);
	await page.getByRole('button', { name: 'Keep my copy', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('newer version could not be reopened');
	await page.getByRole('button', { name: 'Keep my copy', exact: true }).click();
	await expect(page.getByText(/Your work was saved as a separate conflict copy/)).toBeVisible();
	await expectBodyText(page, WINNING_TEXT);
	await page.getByRole('link', { name: 'Back to presentations', exact: true }).click();
	await expect(
		page.getByText('2 saved presentations in this browser', { exact: true })
	).toBeVisible();
	await page
		.getByRole('link', { name: 'Open Untitled presentation (conflict copy)', exact: true })
		.click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expectBodyText(page, LOCAL_TEXT);
});

test('edits made while reopening remain editable and can be kept in a fresh conflict copy', async ({
	page
}) => {
	await openConflict(page);
	// Hold one completed storage read at the browser boundary, then replay its completion.
	await page.evaluate((id) => {
		const gate = window as Window & {
			recoveryReadHeld?: boolean;
			releaseRecoveryRead?: () => void;
		};
		const get = IDBObjectStore.prototype.get;
		IDBObjectStore.prototype.get = function (key) {
			const request = get.call(this, key);
			if (this.name === 'presentations' && key === id) {
				IDBObjectStore.prototype.get = get;
				request.addEventListener(
					'success',
					(event) => {
						event.stopImmediatePropagation();
						gate.recoveryReadHeld = true;
						gate.releaseRecoveryRead = () => request.dispatchEvent(new Event('success'));
					},
					{ once: true }
				);
			}
			return request;
		};
	}, page.url().split('/').pop()!);
	await page.getByRole('button', { name: 'Keep my copy', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(() => (window as Window & { recoveryReadHeld?: boolean }).recoveryReadHeld)
		)
		.toBe(true);
	await expect(page.getByText('Reopening saved version…', { exact: true })).toBeVisible();
	await addShape(page, 'Ellipse');
	await page.evaluate(() =>
		(window as Window & { releaseRecoveryRead?: () => void }).releaseRecoveryRead?.()
	);
	await expect(page.getByText('Reopening saved version…', { exact: true })).not.toBeVisible();
	await expect(
		page.locator('.presentation-layer-select').filter({ hasText: 'Ellipse' })
	).toBeVisible();
	await page.getByRole('button', { name: 'Keep my copy', exact: true }).click();
	await expect(page.getByText(/Your work was saved as a separate conflict copy/)).toBeVisible();
	await expectBodyText(page, WINNING_TEXT);
	await page.getByRole('link', { name: 'Back to presentations', exact: true }).click();
	await expect(
		page.getByText('3 saved presentations in this browser', { exact: true })
	).toBeVisible();
	await page
		.getByRole('link', {
			name: 'Open Untitled presentation (conflict copy)',
			exact: true
		})
		.first()
		.click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expectBodyText(page, LOCAL_TEXT);
	await expect(
		page.locator('.presentation-layer-select').filter({ hasText: 'Ellipse' })
	).toBeVisible();
});

test('unreadable copy artwork reports the read failure and remains retryable', async ({ page }) => {
	await openConflict(page, true);
	await page.evaluate(() => {
		const get = IDBObjectStore.prototype.get;
		IDBObjectStore.prototype.get = function (key) {
			if (this.name === 'presentationMedia') {
				IDBObjectStore.prototype.get = get;
				throw new DOMException('Artwork could not be read', 'UnknownError');
			}
			return get.call(this, key);
		};
	});
	await page.getByRole('button', { name: 'Keep my copy', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('some of its artwork could not be read back');
	await expectBodyText(page, LOCAL_TEXT);
	await page.getByRole('button', { name: 'Keep my copy', exact: true }).click();
	await expect(page.getByText(/Your work was saved as a separate conflict copy/)).toBeVisible();
	await expectBodyText(page, WINNING_TEXT);
	await page.getByRole('link', { name: 'Back to presentations', exact: true }).click();
	await expect(
		page.getByText('2 saved presentations in this browser', { exact: true })
	).toBeVisible();
	await page
		.getByRole('link', {
			name: 'Open Untitled presentation (conflict copy)',
			exact: true
		})
		.click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expectBodyText(page, LOCAL_TEXT);
	const media = await readStoredMedia(page);
	expect(media).toHaveLength(2);
	expect(media[0].sha256).toBe(media[1].sha256);
	const copy = await readStoredPresentation(page, page.url().split('/').pop()!);
	expect(copy?.assets).toHaveLength(1);
	expect(copy?.elements.filter(({ kind }) => kind === 'image')).toHaveLength(1);
});
