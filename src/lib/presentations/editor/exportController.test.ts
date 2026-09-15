import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresentationExport, exportFailureMessage, exportFileName } from './exportController';
import { createMemoryPresentationRepository } from '$lib/presentations/persistence/repository';
import { createPresentationDocument, createSlide } from '../model/factories';
import { createPresentationStore } from './store.svelte';
import type { PresentationExportSnapshot } from '../exports/snapshot';

const store = createPresentationStore();

function snapshotWith(
	slideCount: number,
	warnings: PresentationExportSnapshot['warnings'] = []
): PresentationExportSnapshot {
	const document = createPresentationDocument({ id: 'deck', title: 'Deck' });
	document.slides = Array.from({ length: slideCount }, (_, index) =>
		createSlide({ id: `slide-${index}`, name: `Slide ${index + 1}` })
	);
	return {
		document,
		revision: document.revision,
		images: new Map(),
		media: new Map(),
		warnings,
		dispose: vi.fn()
	};
}

function controllerFor(
	overrides: Parameters<typeof createPresentationExport>[0] extends infer T
		? Omit<Extract<T, object>, 'repository' | 'getDocument' | 'flushText'> & {
				repository?: ReturnType<typeof createMemoryPresentationRepository>;
				getDocument?: () => ReturnType<typeof store.getState>['document'];
				flushText?: () => void;
			}
		: never = {}
) {
	return createPresentationExport({
		repository: overrides.repository ?? createMemoryPresentationRepository(),
		getDocument: overrides.getDocument ?? (() => store.getState().document),
		flushText: overrides.flushText ?? (() => {}),
		...overrides
	});
}

beforeEach(() => {
	store.getState().closeDocument();
	store
		.getState()
		.loadDocument(createPresentationDocument({ id: 'live', title: 'Live deck' }), { saved: true });
});

describe('presentation export controller', () => {
	it('reports that no presentation is open instead of exporting', async () => {
		store.getState().closeDocument();
		const controller = controllerFor({ getDocument: () => null });

		await controller.exportDeck('pdf');

		expect(controller.getState()).toMatchObject({
			phase: 'failed',
			message: expect.stringContaining('Open a presentation before exporting.')
		});
	});

	it('prepares, reports progress, downloads once and disposes the snapshot', async () => {
		const snapshot = snapshotWith(2);
		const download = vi.fn();
		const progress: number[] = [];
		const controller = controllerFor({
			prepare: async () => snapshot,
			download,
			buildPdf: async (_snapshot, _rasterize, options) => {
				options?.onProgress?.(1, 2);
				progress.push(1);
				options?.onProgress?.(2, 2);
				progress.push(2);
				return new Uint8Array([1, 2, 3]);
			}
		});

		await controller.exportDeck('pdf');

		expect(progress).toEqual([1, 2]);
		expect(download).toHaveBeenCalledTimes(1);
		const [blob, filename] = download.mock.calls[0]!;
		expect((blob as Blob).type).toBe('application/pdf');
		expect(filename).toBe('Deck.pdf');
		expect(snapshot.dispose).toHaveBeenCalledTimes(1);
		expect(controller.getState()).toMatchObject({
			phase: 'done',
			format: 'pdf',
			completed: 2,
			total: 2
		});
	});

	it('cancels between slides without downloading and still disposes', async () => {
		const snapshot = snapshotWith(3);
		const download = vi.fn();
		const states: string[] = [];
		const controller = controllerFor({
			prepare: async () => snapshot,
			download,
			buildPdf: (_snapshot, _rasterize, options) =>
				new Promise<Uint8Array>((_resolve, reject) => {
					options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')));
				})
		});
		controller.subscribeState(() => states.push(controller.getState().phase));

		const running = controller.exportDeck('pdf');
		await vi.waitFor(() => expect(controller.getState().phase).toBe('rendering'));
		controller.cancel();
		await running;

		expect(download).not.toHaveBeenCalled();
		expect(snapshot.dispose).toHaveBeenCalledTimes(1);
		expect(controller.getState().phase).toBe('cancelled');
		expect(states.at(-1)).toBe('cancelled');
	});

	it('reports a failure in words and never downloads partial bytes', async () => {
		const snapshot = snapshotWith(1);
		const download = vi.fn();
		const controller = controllerFor({
			prepare: async () => snapshot,
			download,
			buildPdf: async () => {
				throw new Error('Some artwork could not be decoded');
			}
		});

		await controller.exportDeck('pdf');

		expect(download).not.toHaveBeenCalled();
		expect(snapshot.dispose).toHaveBeenCalledTimes(1);
		expect(controller.getState()).toMatchObject({
			phase: 'failed',
			message: 'Some artwork could not be decoded'
		});
	});

	it('runs one export at a time', async () => {
		const snapshot = snapshotWith(1);
		const download = vi.fn();
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const buildPdf = vi.fn(async () => {
			await gate;
			return new Uint8Array([1]);
		});
		const controller = controllerFor({ prepare: async () => snapshot, download, buildPdf });

		const first = controller.exportDeck('pdf');
		await controller.exportDeck('pdf');
		release!();
		await first;

		expect(buildPdf).toHaveBeenCalledTimes(1);
		expect(download).toHaveBeenCalledTimes(1);
	});

	it('sanitizes the download name and keeps the extension', () => {
		expect(exportFileName('Bài: "Deck" *', 'pptx')).toBe('Bài Deck.pptx');
		expect(exportFileName('   ', 'pdf')).toBe('presentation.pdf');
	});

	it('turns an unloadable builder into reload guidance instead of a browser string', () => {
		// Chromium, Firefox and Safari word the same failure differently; all three
		// mean the chunk is not in memory and cannot be fetched again in this page.
		for (const raw of [
			'Failed to fetch dynamically imported module: http://localhost/assets/pdf-x.js',
			'error loading dynamically imported module: http://localhost/assets/pptx-x.js',
			'Importing a module script failed.'
		]) {
			const message = exportFailureMessage(new Error(raw));
			expect(message).toContain('Reconnect and reload the page');
			expect(message).toContain('Your saved work is not affected.');
			expect(message).not.toContain('dynamically imported module');
		}
		expect(exportFailureMessage(new Error('The presentation has no slides'))).toBe(
			'The presentation has no slides'
		);
		expect(exportFailureMessage(undefined)).toBe('The export failed.');
	});

	it('never words the reload instruction over the editor’s unwritten work', async () => {
		const moduleError =
			'Failed to fetch dynamically imported module: http://127.0.0.1:4176/assets/pdf-x.js';
		// Saved work keeps the plain instruction; unwritten work must be written first.
		expect(
			exportFailureMessage(new Error(moduleError), { unsavedWork: false, saveFailed: false })
		).toContain('Reconnect and reload the page');
		expect(
			exportFailureMessage(new Error(moduleError), { unsavedWork: true, saveFailed: false })
		).toBe(
			'This export needs a part of the app that could not be loaded. Reconnect and press Save, then wait for “Saved locally” before reloading this page.'
		);
		expect(
			exportFailureMessage(new Error(moduleError), { unsavedWork: true, saveFailed: true })
		).toContain('Do not reload or close this tab');

		// The same state reaches the dialog's message: a failed export while the save is
		// failing must not offer a reload, because the browser's close prompt would take
		// the edits with it.
		const snapshot = snapshotWith(1);
		const controller = controllerFor({
			reloadSafety: () => ({ unsavedWork: true, saveFailed: true }),
			prepare: async () => snapshot,
			buildPdf: async () => {
				throw new Error(moduleError);
			}
		});

		await controller.exportDeck('pdf');

		expect(controller.getState()).toMatchObject({
			phase: 'failed',
			message: expect.stringContaining('Do not reload or close this tab')
		});
		expect(controller.getState().message).not.toContain('reload the page');
	});

	it('flushes an open text session before it captures the document', async () => {
		const snapshot = snapshotWith(1);
		const order: string[] = [];
		const controller = controllerFor({
			flushText: () => order.push('flush'),
			prepare: async (_repository, document) => {
				order.push(`prepare:${document.slides.length}`);
				return snapshot;
			}
		});
		store.getState().addSlide();

		await controller.exportDeck('pptx');

		expect(order).toEqual(['flush', 'prepare:2']);
		expect(snapshot.dispose).toHaveBeenCalledTimes(1);
	});
});
