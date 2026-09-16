/**
 * Browser contract for the bulk upload queue (P58) and its abandoned-upload
 * cleanup (P61), driven against `MemoryCatalog` — the same job lifecycle as the
 * guarded RPCs. The fake processor is injected, because browsers have no native
 * decoder; the real byte-level validation is covered by the Node processing
 * tests and the SQL harness.
 *
 * Covers: per-file stages from the database, a batch that is refused before
 * anything is written, a per-file processing failure with its code and a retry,
 * reopening a batch that still has queued work, cancellation, and the cleanup
 * dry run.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminUploadsPage from './AdminUploadsPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import { ProcessingError } from '$lib/catalog/processing/errors';
import type { ProcessedAsset } from '$lib/catalog/processing/index';

const ADMIN = '11111111-1111-4111-8111-111111111111';

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 8000
): Promise<NonNullable<T>> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value !== null && value !== undefined && value !== false) return value as NonNullable<T>;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((button) =>
		(button.textContent ?? '').trim().includes(text)
	);
	if (!found) throw new Error(`No button containing “${text}”`);
	return found;
}

function pickFiles(container: HTMLElement, files: File[]): void {
	const input = container.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error('No file input');
	const transfer = new DataTransfer();
	for (const file of files) transfer.items.add(file);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function startBatch(
	container: HTMLElement,
	files: File[] = [png('chart.png')]
): Promise<void> {
	pickFiles(container, files);
	// The button is disabled until Svelte has flushed the selected files, and a
	// click on a disabled button does nothing.
	await waitFor(() => {
		const button = buttonByText(container, 'Start upload');
		return !button.disabled;
	}, 'the upload button to become enabled');
	buttonByText(container, 'Start upload').click();
}

function png(name: string, bytes = 1024): File {
	return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

describe('admin uploads page', () => {
	it('uploads a batch and validates every file, reporting stages from the database', async () => {
		const repository = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const page = render(AdminUploadsPage, { repository });
		await startBatch(page.container, [png('Chart 01.png'), png('Chart 02.png')]);

		const rows = await waitFor(() => {
			const items = [...page.container.querySelectorAll('li.job')];
			return items.length === 2 &&
				items.every((row) => row.textContent?.includes('Ready to review'))
				? items
				: null;
		}, 'both files to be ready');
		expect(rows[0]?.textContent).toContain('Chart 01.png');
		// The source bytes really reached the fake bucket before validation ran.
		const [job] = repository.uploadJobs;
		expect(repository.objects.map((object) => object.path)).toContain(job?.sourcePath);
		expect(job?.stage).toBe('ready');
		expect(await repository.getLatestVersion(job?.assetId ?? '')).toMatchObject({
			validationState: 'validated',
			versionNumber: 1
		});
		expect(page.container.textContent).toContain('2 ready');
		await page.unmount();
	});

	it('refuses an unsupported file before creating a batch', async () => {
		const repository = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const page = render(AdminUploadsPage, { repository });
		pickFiles(page.container, [new File(['gif'], 'bad.gif', { type: 'image/gif' })]);
		await waitFor(
			() => page.container.textContent?.includes('is not a PNG, static WebP or SVG') ?? false,
			'the refusal message'
		);
		const start = buttonByText(page.container, 'Start upload');
		expect(start.disabled).toBe(true);
		expect(repository.uploadJobs).toHaveLength(0);
		await page.unmount();
	});

	it('shows a processing failure with its code and retries the file', async () => {
		let fail = true;
		const repository = new MemoryCatalog(
			{
				admins: [ADMIN],
				process: async (bytes: Uint8Array): Promise<ProcessedAsset> => {
					if (fail)
						throw new ProcessingError('svg_unsafe', 'Event handler attribute is not allowed');
					const { sha256Hex } = await import('$lib/hash');
					return {
						sourceFormat: 'png',
						sourceBytes: bytes.length,
						sourceSha256: await sha256Hex(bytes),
						width: 64,
						height: 64,
						png: new Uint8Array(2048),
						thumbnail: new Uint8Array(512)
					};
				}
			},
			ADMIN
		);
		const page = render(AdminUploadsPage, { repository });
		await startBatch(page.container, [png('logo.png')]);

		const failedRow = await waitFor(
			() =>
				[...page.container.querySelectorAll('li.job')].find((row) =>
					row.textContent?.includes('svg_unsafe')
				) ?? null,
			'the failure to be shown'
		);
		expect(failedRow.textContent).toContain('Failed');

		fail = false;
		buttonByText(page.container, 'Retry').click();
		await waitFor(
			() =>
				page.container.querySelector('li.job')?.textContent?.includes('Ready to review') ?? false,
			'the retry to succeed'
		);
		const [job] = repository.uploadJobs;
		expect(job?.attempts).toBe(2);
		expect(job?.errorCode).toBeNull();
		await page.unmount();
	});

	it('reports one failed file without blaming the whole batch', async () => {
		// The processor only sees bytes, so the fixture decides by content: the
		// smaller file is the one that cannot be decoded.
		const BROKEN_BYTES = 512;
		const repository = new MemoryCatalog(
			{
				admins: [ADMIN],
				process: async (bytes: Uint8Array): Promise<ProcessedAsset> => {
					if (bytes.length === BROKEN_BYTES)
						throw new ProcessingError('decode_failed', 'The image could not be decoded');
					const { sha256Hex } = await import('$lib/hash');
					return {
						sourceFormat: 'png',
						sourceBytes: bytes.length,
						sourceSha256: await sha256Hex(bytes),
						width: 64,
						height: 64,
						png: new Uint8Array(2048),
						thumbnail: new Uint8Array(512)
					};
				}
			},
			ADMIN
		);
		const page = render(AdminUploadsPage, { repository });
		await startBatch(page.container, [png('chart.png'), png('broken.png', BROKEN_BYTES)]);

		await waitFor(
			() =>
				[...page.container.querySelectorAll('li.job')].some((row) =>
					row.textContent?.includes('decode_failed')
				),
			'the per-file failure'
		);
		expect(page.container.textContent).toContain('1 ready');
		expect(page.container.textContent).toContain('1 failed');
		// The batch still produced a usable asset, so it is not a batch-wide failure.
		expect(page.container.textContent).not.toContain('Every file in this batch failed');
		expect(page.container.textContent).not.toContain('No file in this batch could be validated');
		await page.unmount();
	});

	it('says so when no file in a batch could be validated', async () => {
		const repository = new MemoryCatalog(
			{
				admins: [ADMIN],
				process: async (): Promise<ProcessedAsset> => {
					throw new ProcessingError('decode_failed', 'The image could not be decoded');
				}
			},
			ADMIN
		);
		const page = render(AdminUploadsPage, { repository });
		await startBatch(page.container, [png('one.png'), png('two.png')]);

		await waitFor(
			() =>
				page.container.textContent?.includes('No file in this batch could be validated') ?? false,
			'the batch-wide failure message'
		);
		expect([...page.container.querySelectorAll('li.job')]).toHaveLength(2);
		for (const row of page.container.querySelectorAll('li.job'))
			expect(row.textContent).toContain('decode_failed');
		// One sentence for the batch, and the per-file rows carry the detail.
		expect(page.container.textContent).not.toContain('Every file in this batch failed');
		await page.unmount();
	});

	it('reopens the most recent batch and reports its queued work honestly', async () => {
		const repository = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const created = await repository.createUploadBatch({
			collectionId: null,
			files: [{ name: 'waiting.png', mime: 'image/png', bytes: 512 }]
		});
		if (!created.ok) throw new Error('fixture batch');
		await repository.uploadSource(
			created.item.jobs[0].sourcePath,
			new File([new Uint8Array(512)], 'waiting.png', { type: 'image/png' }),
			'image/png'
		);

		const page = render(AdminUploadsPage, { repository });
		const row = await waitFor(() => page.container.querySelector('li.job'), 'the queued row');
		expect(row.textContent).toContain('Queued for validation');
		expect(page.container.textContent).toContain('1 queued');
		// Nothing pretends to have been validated while the tab was closed.
		expect(page.container.textContent).not.toContain('Ready to review');
		await page.unmount();
	});

	it('cancels a batch through the confirmation dialog', async () => {
		const repository = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const page = render(AdminUploadsPage, { repository });
		await startBatch(page.container, [png('cancel-me.png')]);
		await waitFor(() => page.container.querySelector('li.job'), 'the job row');

		buttonByText(page.container, 'Cancel batch').click();
		const dialog = await waitFor(
			() =>
				[...page.container.querySelectorAll('dialog')].find(
					(candidate) => candidate.open && candidate.textContent?.includes('Cancel this batch?')
				) ?? null,
			'the cancel dialog'
		);
		buttonByText(dialog, 'Cancel batch').click();

		await waitFor(
			() => page.container.textContent?.includes('cancelled') ?? false,
			'the cancelled batch'
		);
		expect(repository.uploadBatches[0]?.state).toBe('cancelled');
		await page.unmount();
	});

	it('lists abandoned uploads and removes only what nothing references', async () => {
		const repository = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const created = await repository.createUploadBatch({
			collectionId: null,
			files: [{ name: 'orphan.png', mime: 'image/png', bytes: 700 }]
		});
		if (!created.ok) throw new Error('fixture batch');
		const job = created.item.jobs[0];
		await repository.uploadSource(
			job.sourcePath,
			new File([new Uint8Array(700)], 'orphan.png', { type: 'image/png' }),
			'image/png'
		);
		await repository.cancelUploadBatch(created.item.batch.id);

		const page = render(AdminUploadsPage, { repository });
		await waitFor(() => {
			try {
				return buttonByText(page.container, 'Check abandoned uploads') !== undefined;
			} catch {
				return false;
			}
		}, 'the cleanup button');
		buttonByText(page.container, 'Check abandoned uploads').click();
		await waitFor(
			() => page.container.textContent?.includes('1 source') ?? false,
			'the orphan count'
		);
		buttonByText(page.container, 'Remove 1 objects').click();
		await waitFor(
			() => page.container.textContent?.includes('Removed 1 abandoned object') ?? false,
			'the cleanup notice'
		);
		expect(repository.objects).toHaveLength(0);
		await page.unmount();
	});
});
