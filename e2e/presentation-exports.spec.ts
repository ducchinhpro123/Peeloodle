/**
 * Presentation exports against the production build.
 *
 * The design's verification bar is the file, not the click: each download below is
 * parsed here — the PDF with pdf-lib, the PPTX and the backup with fflate — and the
 * backup is then restored through the app's own library, so the archive's promise
 * ("restorable from the presentation library on any device") is exercised rather
 * than taken on trust.
 */
import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { listStoredPresentations, openBlankEditor, readStoredPresentation } from './presentations';

const TEXT = 'Export journey text';

// Failure inventory for the receipt: a failed/cancelled download is not a backup;
// a PDF/PPTX is not restorable here; new edits and same-revision races must be stale.
// Block the real browser image decoder during export (never a production seam).
test('a backup describes the captured deck, not edits made while it is preparing', async ({
	page
}, info) => {
	await page.addInitScript(() => {
		const decode = window.createImageBitmap.bind(window);
		Object.assign(window, { holdExportImage: false, exportImageHeld: false });
		window.createImageBitmap = async (...args: Parameters<typeof createImageBitmap>) => {
			const state = window as unknown as {
				holdExportImage: boolean;
				exportImageHeld: boolean;
				releaseExportImage: () => void;
			};
			if (state.holdExportImage) {
				state.exportImageHeld = true;
				await new Promise<void>((resolve) => {
					state.releaseExportImage = resolve;
				});
			}
			return decode(...args);
		};
	});
	const id = await openBlankEditor(page);
	await page
		.getByTestId('presentation-image-input')
		.setInputFiles(path.resolve('static/samples/cat-in-console.png'));
	await expect.poll(async () => (await readStoredPresentation(page, id))?.assets.length).toBe(1);
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
	await page.evaluate(() => Object.assign(window, { holdExportImage: true }));
	await page.getByRole('button', { name: 'Back up my work', exact: true }).click();
	await expect.poll(() => page.evaluate(() => Reflect.get(window, 'exportImageHeld'))).toBe(true);
	await page.getByRole('button', { name: 'Add slide', exact: true }).click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.evaluate(() => {
			Reflect.set(window, 'holdExportImage', false);
			Reflect.get(window, 'releaseExportImage')();
		})
	]);
	const archive = unzipSync(await bytesOf(download));
	expect(JSON.parse(strFromU8(archive['document.json'])).slides).toHaveLength(1);
	await download.saveAs(info.outputPath('captured-not-live.stickerlab.zip'));
	await expect(
		page.getByText('Your backup is older than your latest edits', { exact: true })
	).toBeVisible();
	await page.screenshot({ path: info.outputPath('stale-backup.png') });
});

/** Opens the export dialog if it is not already showing. */
async function exportDialog(page: Page) {
	const dialog = page.locator('dialog[open]');
	if (!(await dialog.isVisible())) {
		await page.getByRole('button', { name: 'Export', exact: true }).click();
	}
	await expect(dialog).toBeVisible();
	return dialog;
}

/** Chooses one format in the dialog and returns the file the browser was handed. */
async function exportVia(page: Page, label: string): Promise<Download> {
	const dialog = await exportDialog(page);
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', { name: label, exact: true }).click()
	]);
	await expect(
		dialog.getByText('Export ready. Check your browser’s downloads for the file.')
	).toBeVisible();
	return download;
}

async function bytesOf(download: Download): Promise<Uint8Array> {
	const file = await download.path();
	if (!file) throw new Error('the download produced no file');
	return new Uint8Array(await readFile(file));
}

/** All text the slide XML really carries, however the runs were split. */
function pptxText(xml: string): string {
	return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join('');
}

test('the editor writes a real PDF, an editable PPTX and a restorable backup', async ({ page }) => {
	test.setTimeout(180_000);
	const id = await openBlankEditor(page);

	// Something worth finding in every format, on a deck with more than one slide so
	// the order claim has to hold for a file, not for a single page.
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type(TEXT);
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Add slide' }).click();
	await expect(page.locator('.presentation-slide-card')).toHaveCount(2);
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();

	await expect(page.getByText('Back up your work before you leave', { exact: true })).toBeVisible();

	// PDF: one fixed page per slide, at the deck's own 16:9 size, carrying an image.
	const pdfDownload = await exportVia(page, 'Export PDF');
	expect(pdfDownload.suggestedFilename()).toBe('Untitled presentation.pdf');
	const pdfBytes = await bytesOf(pdfDownload);
	expect(Buffer.from(pdfBytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
	const pdf = await PDFDocument.load(pdfBytes);
	expect(pdf.getPageCount()).toBe(2);
	for (const pdfPage of pdf.getPages()) {
		const { width, height } = pdfPage.getSize();
		expect({ width: Math.round(width), height: Math.round(height) }).toEqual({
			width: 960,
			height: 540
		});
	}
	expect(Buffer.from(pdfBytes).includes('/Subtype /Image')).toBe(true);

	// PPTX: a real OOXML package whose first slide carries the typed text and whose
	// slide size is the 13⅓×7.5 in layout the document's 1/96 in units map to.
	const pptxDownload = await exportVia(page, 'Export PPTX');
	expect(pptxDownload.suggestedFilename()).toBe('Untitled presentation.pptx');
	const pptxBytes = await bytesOf(pptxDownload);
	expect(Buffer.from(pptxBytes.subarray(0, 2)).toString('latin1')).toBe('PK');
	const pptxEntries = unzipSync(pptxBytes);
	expect(Object.keys(pptxEntries)).toContain('ppt/slides/slide2.xml');
	expect(pptxText(strFromU8(pptxEntries['ppt/slides/slide1.xml']))).toContain(TEXT);
	expect(strFromU8(pptxEntries['ppt/presentation.xml'])).toContain(
		'<p:sldSz cx="12192000" cy="6858000"/>'
	);

	// PDF/PPTX are handoff files, not this app's restorable backup.
	await expect(
		page.getByText('Back up your work before you leave', { exact: true })
	).toBeAttached();

	// Backup: the manifest and the document travel together in the archive.
	const backupDownload = await exportVia(page, 'Download backup (.zip)');
	expect(backupDownload.suggestedFilename()).toBe('Untitled presentation.stickerlab.zip');
	const backupBytes = await bytesOf(backupDownload);
	const backupEntries = unzipSync(backupBytes);
	const manifest = JSON.parse(strFromU8(backupEntries['manifest.json']));
	expect(manifest.format).toBe('stickerlab-presentation-backup');
	expect(manifest.documentId).toBe(id);
	expect(JSON.parse(strFromU8(backupEntries['document.json'])).slides).toHaveLength(2);
	const savedBackup = test.info().outputPath('export-journey.stickerlab.zip');
	await backupDownload.saveAs(savedBackup);
	await page.keyboard.press('Escape');
	await expect(page.getByText('Backup download started', { exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByText('Backup download started', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Add text', exact: true }).click();
	await page.keyboard.type('Edited after the backup');
	await page.keyboard.press('Escape');
	await expect(
		page.getByText('Your backup is older than your latest edits', { exact: true })
	).toBeVisible();

	// The archive is restorable exactly as the dialog claims: the library reads it
	// back as an independent deck that still holds the typed text.
	await page.goto('/presentations');
	await page.getByTestId('presentation-restore-input').setInputFiles(savedBackup);
	// The restore path names the copy from the archive it just wrote, so this is the
	// app's own reading of the manifest and document, not a title the test supplied.
	await expect(
		page.getByText('Restored “Untitled presentation (restored)” as a new presentation.')
	).toBeVisible();
	const stored = await listStoredPresentations(page);
	const restored = stored.find((candidate) => candidate.id !== id);
	expect(restored?.title).toBe('Untitled presentation (restored)');
	const restoredRow = await readStoredPresentation(page, restored!.id);
	expect(restoredRow?.text).toContain(TEXT);
	expect(restoredRow?.slideCount).toBe(2);
});
