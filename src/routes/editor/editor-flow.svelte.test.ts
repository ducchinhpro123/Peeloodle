/**
 * Deterministic component journey for the first slice:
 * create draft → upload a synthetic PNG → drag/transform → add text → save →
 * reload and reopen from the repository → export a transparent PNG.
 *
 * The editor canvas is the DOM fallback in test mode, but every edit goes through
 * the same document commands, the same `draftSaving` coordinator and the same
 * `renderDocument` export pipeline the browser uses with Konva.
 */

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EditorWorkspace from '$lib/components/EditorWorkspace.svelte';
import { setAppContext } from '$lib/app/context';
import { createMemoryPresentationRepository } from '$lib/presentations/persistence/repository';
import { createPresentationStore } from '$lib/presentations/editor/store.svelte';
import { createDraftSaving } from '$lib/editor/draftSaving';
import { createEditorState, type EditorState } from '$lib/editor/editorState.svelte';
import {
	createMemoryRepository,
	createProjectDocument,
	MemoryRepository
} from '$lib/persistence/repository';
import { renderDocument, readPngSize } from '$lib/exports/renderDocument';

type Harness = {
	repository: MemoryRepository;
	editor: EditorState;
	saving: ReturnType<typeof createDraftSaving>;
	projectId: string;
};

/**
 * Repository with a persistent write failure (like a full quota) and an operation
 * log, so a route transition can prove *which* write happened *when*.
 */
class FlakyRepository extends MemoryRepository {
	failing = false;
	attempts = 0;
	log: string[] = [];

	async saveProjectWithAssets(...args: Parameters<MemoryRepository['saveProjectWithAssets']>) {
		this.attempts += 1;
		this.log.push(`save:${args[0].id}`);
		if (this.failing)
			throw new DOMException(
				'The quota has been exceeded (injected failure)',
				'QuotaExceededError'
			);
		return super.saveProjectWithAssets(...args);
	}

	async getProject(id: string) {
		this.log.push(`load:${id}`);
		return super.getProject(id);
	}
}

function harness(repository: MemoryRepository = createMemoryRepository()): Harness {
	const editor = createEditorState();
	const projectId = editor.createDraft();
	const saving = createDraftSaving(editor);
	return { repository, editor, saving, projectId };
}

/** A real PNG with a transparent border, so artwork bounds are tight. */
async function syntheticPng(width = 64, height = 48) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#e11d48';
	ctx.fillRect(8, 6, width - 16, height - 12);
	const blob = await new Promise<Blob>((resolve) =>
		canvas.toBlob((value) => resolve(value!), 'image/png')
	);
	return new File([blob], 'synthetic-photo.png', { type: 'image/png' });
}

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 4000
): Promise<T> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function buttonNamed(container: HTMLElement, name: string) {
	const element = [...container.querySelectorAll('button')].find((button) =>
		(button.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(name)
	);
	if (!element) throw new Error(`No button starting with "${name}"`);
	return element;
}

async function mountEditor(
	current: Harness,
	overrides: {
		projectId?: string;
		intent?: null;
		onnavigate?: (href: string) => void;
	} = {}
) {
	function Wrapper(...args: unknown[]) {
		setAppContext({
			repository: current.repository,
			editor: current.editor,
			saving: current.saving,
			presentationRepository: createMemoryPresentationRepository(),
			presentationStore: createPresentationStore()
		});
		return EditorWorkspace(...(args as [never, never]));
	}
	const result = await render(Wrapper, {
		projectId: current.projectId,
		intent: null,
		onnavigate: () => {},
		...overrides
	});
	await waitFor(() => current.editor.document?.id === current.projectId, 'the draft to be open');
	return result;
}

async function uploadPhoto(container: HTMLElement, file: File) {
	const input = container.querySelector('[data-testid="photo-file-input"]') as HTMLInputElement;
	const transfer = new DataTransfer();
	transfer.items.add(file);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** A real keydown that bubbles from `target` to the window, like a typed key. */
function pressKey(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}) {
	target.dispatchEvent(
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
	);
}

async function expectMissing(repository: MemoryRepository, projectId: string) {
	try {
		await repository.getProject(projectId);
	} catch {
		return;
	}
	throw new Error(`Expected ${projectId} not to be stored yet`);
}

function pointer(type: string, target: Element, clientX: number, clientY: number) {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			pointerId: 1,
			button: 0,
			clientX,
			clientY
		})
	);
}

describe('editor flow', () => {
	it('uploads, edits by gesture, saves, reopens with its assets, and exports a transparent PNG', async () => {
		const first = harness();
		const { container } = await mountEditor(first);

		// 1. Upload through the real file input and validation pipeline.
		await uploadPhoto(container, await syntheticPng());
		await waitFor(() => first.editor.document?.layers.length === 1, 'the uploaded image layer');
		const imageLayer = first.editor.document!.layers[0]!;
		expect(imageLayer.kind).toBe('image');
		expect(first.editor.uploadError).toBeNull();
		expect(container.querySelector('[data-testid="editor-canvas"]')).not.toBeNull();

		// 2. Drag it on the canvas: one completed gesture is one undo entry.
		const node = (await waitFor(
			() => container.querySelector(`[data-layer-id="${imageLayer.id}"]`),
			'the canvas layer node'
		)) as Element;
		const startX = imageLayer.transform.x;
		const historyBefore = first.editor.past.length;
		pointer('pointerdown', node, 100, 100);
		pointer('pointermove', node, 160, 130);
		pointer('pointerup', node, 160, 130);
		await waitFor(
			() => first.editor.document!.layers[0]!.transform.x !== startX,
			'the drag transform'
		);
		await waitFor(
			() => first.editor.past.length === historyBefore + 1,
			'one history entry for the drag'
		);
		const moved = first.editor.document!.layers[0]!.transform;
		expect(moved.y).not.toBe(imageLayer.transform.y);

		// View-only changes must not dirty the document.
		first.editor.setViewport({ zoom: 2, panX: 20, panY: 20 });
		expect(first.editor.past.length).toBe(historyBefore + 1);

		// 3. Add and edit a text layer through the chrome.
		buttonNamed(container, 'Text').click();
		await waitFor(() => first.editor.document?.layers.length === 2, 'the text layer');
		const textLayer = first.editor.document!.layers.find((layer) => layer.kind === 'text')!;
		expect(textLayer.kind === 'text' && textLayer.content).toBe('Text');

		const content = await waitFor(
			() => container.querySelector('[aria-label="Text content"]') as HTMLTextAreaElement,
			'the text content field'
		);
		content.value = 'Hello slice';
		content.dispatchEvent(new Event('input', { bubbles: true }));
		await waitFor(() => {
			const layer = first.editor.document!.layers.find((item) => item.kind === 'text');
			return layer?.kind === 'text' && layer.content === 'Hello slice';
		}, 'the edited text content');

		// Export uses real fonts; a bundled font face is not registered in this harness,
		// so pick an available family (the Playwright journey covers bundled fonts).
		const fontSelect = container.querySelector('[aria-label="Font family"]') as HTMLSelectElement;
		fontSelect.value = 'Georgia';
		fontSelect.dispatchEvent(new Event('change', { bubbles: true }));

		// 4. Save locally through the coordinator.
		const title = container.querySelector('[aria-label="Sticker title"]') as HTMLInputElement;
		title.value = 'Slice sticker';
		title.dispatchEvent(new Event('input', { bubbles: true }));
		buttonNamed(container, 'Save to My Stickers').click();
		await waitFor(async () => {
			try {
				const saved = await first.repository.getProject(first.projectId);
				return saved.title === 'Slice sticker' && saved.layers.length === 2;
			} catch {
				return false;
			}
		}, 'the saved document');
		const saved = await first.repository.getProject(first.projectId);
		expect(saved.assetIds).toHaveLength(1);
		expect(await first.repository.getAsset(saved.assetIds[0]!)).toBeTruthy();
		await waitFor(() => first.editor.saveStatus === 'saved-locally', 'the saved status');
		expect(first.editor.dirty).toBe(false);

		// 5. Reload: a fresh app state reopens the saved sticker with its assets.
		const reopenedState = createEditorState();
		const second: Harness = {
			repository: first.repository,
			editor: reopenedState,
			saving: createDraftSaving(reopenedState),
			projectId: first.projectId
		};
		const reopened = await mountEditor(second);
		await waitFor(
			() =>
				second.editor.document?.title === 'Slice sticker' &&
				second.editor.document.layers.length === 2,
			'the reopened document'
		);
		expect(second.editor.document?.revision).toBe(saved.revision);
		expect(Object.keys(second.editor.assets)).toHaveLength(1);

		// 6. Export the reopened document: transparent PNG, tight artwork bounds.
		const blob = await renderDocument(second.editor.document!, second.editor.assets, {
			size: 512,
			masks: second.editor.masks,
			bounds: 'artwork'
		});
		expect(blob.type).toBe('image/png');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const size = readPngSize(bytes);
		expect(Math.max(size.width, size.height)).toBe(512);
		expect(size.colorType).toBe(6);

		const bitmap = await createImageBitmap(blob);
		const probe = document.createElement('canvas');
		probe.width = bitmap.width;
		probe.height = bitmap.height;
		const ctx = probe.getContext('2d')!;
		ctx.drawImage(bitmap, 0, 0);
		const corner = ctx.getImageData(0, 0, 1, 1).data;
		expect(corner[3]).toBe(0);
		expect(bitmap.width).toBe(size.width);

		// 7. The export dialog reports honestly instead of pretending a pack was installed.
		buttonNamed(reopened.container, 'Export & Share').click();
		const download = (await waitFor(
			() =>
				[...reopened.container.querySelectorAll('button')].find((button) =>
					button.textContent?.includes('Download PNG')
				),
			'the download button'
		)) as HTMLButtonElement;
		download.click();
		const status = (await waitFor(
			() => reopened.container.querySelector('dialog [role="status"]'),
			'the export status message'
		)) as HTMLElement;
		const message = status.textContent ?? '';
		expect(message).toMatch(/Download started|Exporting/);
		await waitFor(
			() => (status.textContent ?? '').includes('Download started'),
			'the download status'
		);
		expect(status.textContent).toContain('not a WhatsApp or Telegram sticker pack');
	});

	it('keeps a failed save recoverable instead of dropping the draft', async () => {
		const current = harness();
		const { container } = await mountEditor(current);
		await uploadPhoto(container, await syntheticPng());
		await waitFor(() => current.editor.document?.layers.length === 1, 'the uploaded layer');

		current.repository.injectWriteFailure();
		buttonNamed(container, 'Save to My Stickers').click();
		await waitFor(() => current.editor.saveStatus === 'save-failed', 'the failed save status');

		expect(current.editor.document?.layers).toHaveLength(1);
		expect(current.editor.dirty).toBe(true);
		const status = (await waitFor(
			() => container.querySelector('.save-status[data-state="save-failed"]'),
			'the visible failed status'
		)) as HTMLElement;
		expect(status.textContent).toContain('Save failed');

		// The retained revision saves on retry without losing the upload.
		buttonNamed(container, 'Save to My Stickers').click();
		await waitFor(async () => {
			try {
				return (await current.repository.getProject(current.projectId)).layers.length === 1;
			} catch {
				return false;
			}
		}, 'the retried save');
		await waitFor(() => current.editor.saveStatus === 'saved-locally', 'the recovered save status');
	});

	it('writes the latest revision when the editor route departs', async () => {
		const current = harness();
		const { container, unmount } = await mountEditor(current);
		await uploadPhoto(container, await syntheticPng());
		await waitFor(() => current.editor.document?.layers.length === 1, 'the uploaded layer');

		const title = container.querySelector('[aria-label="Sticker title"]') as HTMLInputElement;
		title.value = 'Departing edit';
		title.dispatchEvent(new Event('input', { bubbles: true }));
		await waitFor(() => current.editor.document?.title === 'Departing edit', 'the edited title');
		const revision = current.editor.document!.revision;

		// Leaving the route must flush the revision the user can see, not the one the
		// load effect last read: the departure write is the only writer left here
		// (unmount cancels the debounce timer).
		await unmount();
		const saved = await waitFor(async () => {
			try {
				const stored = await current.repository.getProject(current.projectId);
				return stored.title === 'Departing edit' && stored.revision === revision ? stored : null;
			} catch {
				return null;
			}
		}, 'the departure flush to persist the latest revision');
		expect(saved?.title).toBe('Departing edit');
		expect(saved?.revision).toBe(revision);
	});

	it('ignores destructive editor shortcuts while a native dialog has focus', async () => {
		const current = harness();
		const { container } = await mountEditor(current);
		await uploadPhoto(container, await syntheticPng());
		await waitFor(() => current.editor.document?.layers.length === 1, 'the uploaded layer');
		const layerId = current.editor.document!.layers[0]!.id;
		current.editor.selectLayer(layerId);
		const revision = current.editor.document!.revision;
		const history = current.editor.past.length;
		const startX = current.editor.document!.layers[0]!.transform.x;

		buttonNamed(container, 'Sticker properties').click();
		const dialog = await waitFor(
			() => container.querySelector('dialog[open]'),
			'the properties dialog'
		);
		if (!dialog) throw new Error('The properties dialog did not open');
		const closeButton = dialog.querySelector<HTMLButtonElement>('button[data-slot="dialog-close"]');
		if (!closeButton) throw new Error('The properties dialog has no close button');
		closeButton.focus();
		expect(document.activeElement).toBe(closeButton);

		// Every destructive shortcut, typed from a focused control inside the open
		// dialog, must leave the document (and history) exactly as it was.
		for (const [key, modifiers] of [
			['Delete', {}],
			['Backspace', {}],
			['d', { ctrlKey: true }],
			['z', { ctrlKey: true }],
			['ArrowLeft', {}]
		] as const) {
			pressKey(closeButton, key, modifiers);
		}
		// The dialog element itself and its non-interactive content are covered too:
		// matching only `[role="dialog"]` would miss a native `<dialog open>` subtree.
		const dialogBody = dialog.querySelector('.dialog-scroll');
		if (!dialogBody) throw new Error('The properties dialog has no content container');
		for (const key of ['Delete', 'ArrowRight'] as const) {
			pressKey(dialog, key);
			pressKey(dialogBody, key);
		}
		expect(current.editor.document?.layers.map((layer) => layer.id)).toEqual([layerId]);
		expect(current.editor.document?.revision).toBe(revision);
		expect(current.editor.past.length).toBe(history);
		expect(current.editor.document?.layers[0]!.transform.x).toBe(startX);

		// Closing the dialog hands the keyboard back: the same keys still edit.
		(closeButton as HTMLButtonElement).click();
		await waitFor(() => !container.querySelector('dialog[open]'), 'the dialog to close');
		pressKey(document.body, 'ArrowLeft');
		expect(current.editor.document?.layers[0]!.transform.x).toBeLessThan(startX);
		pressKey(document.body, 'Delete');
		expect(current.editor.document?.layers).toHaveLength(0);
		pressKey(document.body, 'z', { ctrlKey: true });
		expect(current.editor.document?.layers.map((layer) => layer.id)).toEqual([layerId]);
	});

	it('flushes the latest dirty A before loading B when the route parameter changes', async () => {
		const repository = new FlakyRepository();
		const current = harness(repository);
		await repository.saveProjectWithAssets(
			createProjectDocument({ id: 'project-b', title: 'Project B' }),
			[]
		);
		const view = await mountEditor(current);
		await uploadPhoto(view.container, await syntheticPng());
		await waitFor(() => current.editor.document?.layers.length === 1, 'the uploaded layer');

		const title = view.container.querySelector('[aria-label="Sticker title"]') as HTMLInputElement;
		title.value = 'Dirty A';
		title.dispatchEvent(new Event('input', { bubbles: true }));
		await waitFor(() => current.editor.document?.title === 'Dirty A', 'the dirty A title');
		const dirtyRevision = current.editor.document!.revision;

		// Same route, new parameter: the editor component stays mounted.
		await view.rerender({ projectId: 'project-b' });
		await waitFor(() => current.editor.document?.id === 'project-b', 'project B to open');

		const storedA = await current.repository.getProject(current.projectId);
		expect(storedA.title).toBe('Dirty A');
		expect(storedA.revision).toBe(dirtyRevision);
		expect(storedA.layers).toHaveLength(1);
		expect(current.editor.document?.title).toBe('Project B');

		// The write of A happened before B was read, never after.
		expect(repository.log.filter((entry) => entry.startsWith('save:'))).toContain(
			`save:${current.projectId}`
		);
		expect(repository.log.indexOf('load:project-b')).toBeGreaterThan(
			repository.log.lastIndexOf(`save:${current.projectId}`)
		);
	});

	it('retains and keeps protecting dirty A when the replacement flush keeps failing', async () => {
		const repository = new FlakyRepository();
		const current = harness(repository);
		await repository.saveProjectWithAssets(
			createProjectDocument({ id: 'project-b', title: 'Project B' }),
			[]
		);

		const navigations: string[] = [];
		let view: Awaited<ReturnType<typeof mountEditor>> | undefined;
		view = await mountEditor(current, {
			onnavigate: (href) => {
				navigations.push(href);
				// The real app navigates back to the retained project; mirror that here.
				void view?.rerender({ projectId: current.projectId });
			}
		});
		await uploadPhoto(view.container, await syntheticPng());
		await waitFor(() => current.editor.document?.layers.length === 1, 'the uploaded layer');
		const title = view.container.querySelector('[aria-label="Sticker title"]') as HTMLInputElement;
		title.value = 'Never saved A';
		title.dispatchEvent(new Event('input', { bubbles: true }));
		await waitFor(() => current.editor.document?.title === 'Never saved A', 'the dirty A title');

		const attemptsBefore = repository.attempts;
		repository.failing = true;
		await view.rerender({ projectId: 'project-b' });
		await waitFor(() => navigations.length > 0, 'the blocked flush to return to A');
		await waitFor(() => current.editor.document?.id === current.projectId, 'A to stay open');

		// B was refused and A is still the draft in front of the user.
		expect(navigations).toEqual([`/editor/${current.projectId}`]);
		expect(current.editor.document?.title).toBe('Never saved A');
		expect(current.editor.document?.layers).toHaveLength(1);
		expect(current.editor.dirty).toBe(true);
		expect(current.editor.saveStatus).toBe('save-failed');
		expect(current.editor.editorAttached).toBe(true);
		expect(current.saving.hasUnprotectedWork()).toBe(true);
		// The mounted editor reports its own failure, so the layout banner stays quiet.
		expect(current.saving.recoveryDraft()).toBeNull();
		await expectMissing(repository, current.projectId);
		const visibleTitle = view.container.querySelector(
			'[aria-label="Sticker title"]'
		) as HTMLInputElement;
		expect(visibleTitle.value).toBe('Never saved A');

		// A retry while storage is still broken must not replace A either.
		buttonNamed(view.container, 'Save to My Stickers').click();
		await waitFor(
			() => repository.attempts > attemptsBefore + 1,
			'the second, still failing write attempt'
		);
		await waitFor(
			() => current.editor.document?.id === current.projectId,
			'A to stay open after the retry'
		);
		expect(current.editor.saveStatus).toBe('save-failed');
		expect(current.editor.dirty).toBe(true);
		await expectMissing(repository, current.projectId);

		// Once storage recovers, the retained draft is still the one that saves.
		repository.failing = false;
		buttonNamed(view.container, 'Save to My Stickers').click();
		const stored = await waitFor(async () => {
			try {
				const candidate = await repository.getProject(current.projectId);
				return candidate.title === 'Never saved A' ? candidate : null;
			} catch {
				return null;
			}
		}, 'the recovered save');
		expect(stored?.layers).toHaveLength(1);
		expect(current.editor.document?.id).toBe(current.projectId);
	});
});
