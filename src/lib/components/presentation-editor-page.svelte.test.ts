/**
 * Browser contract for the presentation editor page.
 *
 * The page is the one place that wires the framework-independent editor modules
 * together (store, saving coordinator, canvas, text session, repository), so
 * these tests drive the real component: the same autosave debounce, the same
 * atomic image insert and the same conflict recovery the route uses.
 *
 * The presentation typefaces come from the production stylesheet, because the
 * page refuses to show a slide whose text cannot be measured against them.
 */

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '$lib/presentations/rendering/presentation-fonts.css';
import PresentationEditorPage from './presentation/PresentationEditorPage.svelte';
import {
	createMemoryPresentationRepository,
	type MemoryPresentationRepository
} from '$lib/presentations/persistence/repository';
import { createPresentationDocument, createImageElement } from '$lib/presentations/model/factories';
import { createPresentationStore } from '$lib/presentations/editor/store.svelte';
import {
	FIXTURE_IMAGE_BYTE_LENGTH,
	fixtureImagePng
} from '$lib/presentations/model/fixtures/fixture';
import { MemoryCatalog } from '$lib/catalog/memory';
import { sha256Hex } from '$lib/hash';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import { createTemplateDraftRepository } from '$lib/presentations/templates/templateDraftRepository';
import type { CatalogAssetVersion } from '$lib/catalog/types';
import type { PresentationDocument, TextElement } from '$lib/presentations/model/types';

const PRESENTATION_ID = 'editor-deck';

/**
 * Polls until `check` produces something: an element, an id, a true flag.
 * The return type drops the absent cases so callers get the value itself.
 */
async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 5000
): Promise<NonNullable<T>> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value !== null && value !== undefined && value !== false) {
			return value as NonNullable<T>;
		}
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
	const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
		(candidate.textContent ?? '').trim().includes(text)
	);
	if (!found) throw new Error(`No button containing ${text}`);
	return found;
}

/** Exact trimmed text, so the dialog's “Download backup (.zip)” never matches the header's. */
function hasButtonWithText(container: HTMLElement, text: string): boolean {
	return [...container.querySelectorAll<HTMLButtonElement>('button')].some(
		(candidate) => (candidate.textContent ?? '').trim() === text
	);
}

/** Icon-only controls carry their name in `aria-label`, not in their text. */
function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement {
	const found = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(
		(candidate) => candidate.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`No button named ${label}`);
	return found;
}

/** A published catalog item with a signed URL for its derivative. */
function catalogFixture() {
	const assetId = 'a0000000-0000-4000-8000-0000000000a1';
	const versionId = 'v0000000-0000-4000-8000-0000000000a1';
	const derivativePath = `assets/${assetId}/${versionId}/asset.png`;
	const repository = new MemoryCatalog(
		{
			collections: [
				{
					id: 'c0000000-0000-4000-8000-0000000000a1',
					name: 'Animals',
					description: '',
					tags: [],
					sortOrder: 1,
					state: 'published',
					revision: 1,
					publishedAt: '2026-09-16T00:00:00.000Z',
					archivedAt: null,
					createdAt: '2026-09-16T00:00:00.000Z',
					updatedAt: '2026-09-16T00:00:00.000Z'
				}
			],
			assets: [
				{
					id: assetId,
					collectionId: 'c0000000-0000-4000-8000-0000000000a1',
					name: 'Cat',
					description: '',
					tags: [],
					kind: 'raster',
					provenance: {},
					sortOrder: 1,
					state: 'published',
					revision: 2,
					publishedVersionId: versionId,
					publishedAt: '2026-09-16T00:00:00.000Z',
					archivedAt: null,
					createdAt: '2026-09-16T00:00:00.000Z',
					updatedAt: '2026-09-16T00:00:00.000Z'
				}
			],
			versions: [
				{
					id: versionId,
					assetId,
					versionNumber: 1,
					sourcePath: 'batches/b/j.png',
					sourceSha256: 'a'.repeat(64),
					sourceBytes: 1024,
					sourceMime: 'image/png',
					derivativePath,
					derivativeSha256: 'b'.repeat(64),
					derivativeBytes: 2048,
					derivativeMime: 'image/png',
					derivativeWidth: 64,
					derivativeHeight: 64,
					thumbnailPath: `assets/${assetId}/${versionId}/thumb.webp`,
					validationState: 'validated',
					createdAt: '2026-09-16T00:00:00.000Z'
				}
			],
			derivativeUrls: new Map([
				[derivativePath, 'https://example.test/catalog-full.png'],
				[`assets/${assetId}/${versionId}/thumb.webp`, 'https://example.test/catalog-thumb.webp']
			])
		},
		null
	);
	return { repository, assetId, versionId, derivativePath };
}

function textModels(document: PresentationDocument | null): TextElement[] {
	return (document?.slides ?? [])
		.flatMap((slide) => slide.elements)
		.filter((element): element is TextElement => element.kind === 'text');
}

const ADMIN_ACTOR = '22222222-2222-4222-8222-222222222222';

/** A non-archived collection the save-as-template dialog can target. */
function templateCollection(): import('$lib/catalog/types').CatalogCollection {
	return {
		id: 'c1000000-0000-4000-8000-000000000001',
		name: 'Template art',
		description: '',
		tags: [],
		sortOrder: 1,
		state: 'published',
		revision: 1,
		publishedAt: '2026-09-16T00:00:00.000Z',
		archivedAt: null,
		createdAt: '2026-09-16T00:00:00.000Z',
		updatedAt: '2026-09-16T00:00:00.000Z'
	};
}

function documentText(document: PresentationDocument | null): string {
	return textModels(document)
		.flatMap((element) => element.paragraphs)
		.flatMap((paragraph) => paragraph.runs)
		.map((run) => run.text)
		.join('');
}

/** Types into the overlay the way a keyboard does: mutate the block, then notify. */
function typeIntoField(field: HTMLElement, text: string) {
	const block = field.querySelector('[data-p]');
	if (!block) throw new Error('the text field has no paragraph block');
	block.textContent = text;
	field.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function pressEscape(field: HTMLElement) {
	field.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
	);
}

async function seedPresentation(
	repository: MemoryPresentationRepository,
	id = PRESENTATION_ID,
	title = 'Editor deck'
) {
	const document = createPresentationDocument({ id, title });
	await repository.savePresentation(document);
	return document;
}

async function openEditor(
	options: {
		repository?: MemoryPresentationRepository;
		id?: string;
		seed?: (repository: MemoryPresentationRepository) => Promise<unknown>;
		/** `panel` waits for a settled load failure instead of an open editor. */
		expect?: 'editor' | 'panel';
		/** The optional published-catalog read path the picker uses (P62). */
		catalogRepository?: import('$lib/catalog/repository').CatalogRepository | null;
		catalogAdminRepository?: import('$lib/catalog/repository').CatalogAdminRepository | null;
	} = {}
) {
	const repository = options.repository ?? createMemoryPresentationRepository();
	const id = options.id ?? PRESENTATION_ID;
	if (options.seed) await options.seed(repository);
	else await seedPresentation(repository, id);
	const store = createPresentationStore();
	const rendered = await render(PresentationEditorPage, {
		presentationId: id,
		repository,
		catalogRepository: options.catalogRepository ?? null,
		catalogAdminRepository: options.catalogAdminRepository ?? null,
		store,
		backhref: '/presentations',
		onback: () => {},
		leaveguard: null
	});
	// The same panel is used while loading, so a settled failure is the heading
	// that only the finished state renders.
	if (options.expect === 'panel') {
		await waitFor(
			() => rendered.container.querySelector('.presentation-route-state h1'),
			`the load state for ${id} to settle`
		);
	} else {
		await waitFor(
			() => rendered.container.querySelector('.presentation-editor'),
			`the editor for ${id} to open`
		);
	}
	return {
		repository,
		store,
		container: rendered.container,
		unmount: async () => {
			await rendered.unmount();
			store.getState().closeDocument();
		}
	};
}

describe('presentation editor page', () => {
	it('opens a stored presentation and reports it saved locally', async () => {
		const editor = await openEditor();

		expect(editor.container.querySelector('.presentation-editor-title h1')?.textContent).toBe(
			'Editor deck'
		);
		expect(editor.container.textContent).toContain('Saved locally');
		const canvas = await waitFor(
			() => editor.container.querySelector('[data-testid="presentation-canvas"]'),
			'the client-only canvas to mount'
		);
		expect(canvas.getAttribute('data-document-width')).toBe('1280');
		expect(canvas.getAttribute('data-document-height')).toBe('720');
		expect(editor.container.querySelector('.presentation-blank-slide')).not.toBeNull();

		await editor.unmount();
	});

	it('offers PDF, PPTX and backup export with an honest description', async () => {
		const editor = await openEditor();
		buttonWithText(editor.container, 'Export').click();

		const dialog = await waitFor(
			() => editor.container.querySelector<HTMLDialogElement>('dialog[open]'),
			'the export dialog'
		);
		expect(dialog.textContent).toContain('Export PDF');
		expect(dialog.textContent).toContain('Export PPTX');
		expect(dialog.textContent).toContain('Download backup (.zip)');
		expect(dialog.textContent).toContain('PDF keeps the exact slide visuals as fixed pages');
		// Idle: nothing is running, so there is nothing to cancel and no status line.
		expect(dialog.textContent).not.toContain('Cancel export');
		expect(dialog.textContent).not.toContain('Export ready');

		dialog.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')?.click();
		await waitFor(
			() => !editor.container.querySelector('dialog[open]'),
			'the export dialog to close'
		);
		await editor.unmount();
	});

	it('adds a text box and autosaves what was typed once the session ends', async () => {
		const editor = await openEditor();
		buttonWithText(editor.container, 'Add text').click();

		const field = await waitFor(
			() => editor.container.querySelector<HTMLElement>('[data-testid="text-edit-field"]'),
			'the text field to open'
		);
		typeIntoField(field, 'Hello deck');
		expect(documentText(editor.store.getState().document)).toBe('Hello deck');

		pressEscape(field);
		// Wait for the claim itself, not the status text: “Saved locally” is already on
		// screen from the insert's own save, so it cannot say the text commit finished.
		const stored = await waitFor(async () => {
			const row = await editor.repository.getPresentation(PRESENTATION_ID);
			return row.revision === 2 ? row : null;
		}, 'the text commit to reach disk');
		expect(documentText(stored)).toBe('Hello deck');
		// One revision for inserting the box, one for the text committed into it.
		expect(stored.revision).toBe(2);

		await editor.unmount();
	});

	it('writes text that is still only on screen before an explicit save', async () => {
		const editor = await openEditor();
		buttonWithText(editor.container, 'Add text').click();
		const field = await waitFor(
			() => editor.container.querySelector<HTMLElement>('[data-testid="text-edit-field"]'),
			'the text field to open'
		);
		typeIntoField(field, 'Typed but not left');

		// The session is still open: only the save path may commit this text.
		expect(editor.store.getState().view.editingElementId).not.toBeNull();
		buttonWithText(editor.container, 'Save').click();
		await waitFor(
			() => editor.container.textContent?.includes('Saved locally'),
			'the explicit save to finish'
		);

		expect(documentText((await editor.repository.getPresentation(PRESENTATION_ID)) ?? null)).toBe(
			'Typed but not left'
		);
		await editor.unmount();
	});

	it('reports a failed write in words and lets Save retry it', async () => {
		const editor = await openEditor();
		editor.repository.injectWriteFailure();
		buttonWithText(editor.container, 'Add text').click();
		await waitFor(
			() => editor.container.textContent?.includes('Save failed'),
			'the failed autosave to be reported'
		);
		expect(editor.container.textContent).toContain('Your changes are still here and stay editable');
		expect(documentText(editor.store.getState().document)).toBe('');
		// Recovery guidance: while the write is failing the work can still leave the
		// browser as a backup, and the offer is not made once saving works again.
		expect(hasButtonWithText(editor.container, 'Download backup')).toBe(true);

		buttonWithText(editor.container, 'Save').click();
		await waitFor(
			() => editor.container.textContent?.includes('Saved locally'),
			'the retry to succeed'
		);
		expect((await editor.repository.getPresentation(PRESENTATION_ID)).revision).toBe(1);
		expect(hasButtonWithText(editor.container, 'Download backup')).toBe(false);

		await editor.unmount();
	});

	it('keeps local work as a conflict copy and reopens the newer stored revision', async () => {
		const editor = await openEditor();
		buttonWithText(editor.container, 'Add text').click();
		const field = await waitFor(
			() => editor.container.querySelector<HTMLElement>('[data-testid="text-edit-field"]'),
			'the text field to open'
		);
		typeIntoField(field, 'Work from this tab');
		pressEscape(field);

		// Another tab saves a newer revision of the same presentation.
		const stored = await editor.repository.getPresentation(PRESENTATION_ID);
		await editor.repository.savePresentation({
			...stored,
			revision: stored.revision + 1,
			title: 'Newer from another tab'
		});

		buttonWithText(editor.container, 'Save').click();
		await waitFor(
			() => editor.container.textContent?.includes('Save conflict'),
			'the conflict to be reported'
		);
		expect(buttonWithText(editor.container, 'Keep my copy').disabled).toBe(false);
		buttonWithText(editor.container, 'Keep my copy').click();

		await waitFor(
			() =>
				editor.container.textContent?.includes('Your work was saved as a separate conflict copy'),
			'the recovery to finish'
		);
		const summaries = await editor.repository.listPresentations();
		expect(summaries).toHaveLength(2);
		expect(summaries.some((summary) => summary.title.includes('conflict copy'))).toBe(true);
		expect(editor.container.querySelector('.presentation-editor-title h1')?.textContent).toBe(
			'Newer from another tab'
		);

		await editor.unmount();
	});

	it('reports a missing presentation honestly and offers the way back', async () => {
		const editor = await openEditor({
			id: 'not-stored',
			seed: async () => {},
			expect: 'panel'
		});

		expect(editor.container.textContent).toContain('Presentation not found');
		expect(editor.container.textContent).toContain('It may have been removed from this browser');
		expect(editor.container.querySelector('a[href="/presentations"]')).not.toBeNull();
		// Retrying a deleted document cannot bring it back, so it is not offered.
		expect(
			[...editor.container.querySelectorAll('button')].some(
				(candidate) => candidate.textContent?.trim() === 'Try again'
			)
		).toBe(false);

		await editor.unmount();
	});

	it('refuses to open a document from a newer schema instead of editing it blind', async () => {
		const editor = await openEditor({
			id: 'future-deck',
			expect: 'panel',
			seed: async (repository) => {
				repository.seedRawDocument('future-deck', {
					...createPresentationDocument({ id: 'future-deck' }),
					schemaVersion: 999
				});
			}
		});

		expect(editor.container.textContent).toContain('This presentation needs a newer StickerLab');
		// An unsupported document is not retried into an endless loop.
		expect(
			[...editor.container.querySelectorAll('button')].some(
				(candidate) => candidate.textContent?.trim() === 'Try again'
			)
		).toBe(false);

		await editor.unmount();
	});

	it('adds a slide, moves focus to it, and reorders it through the rail', async () => {
		const editor = await openEditor();
		const rail = editor.container.querySelector('.presentation-slide-list');
		expect(rail?.querySelectorAll('.presentation-slide-card')).toHaveLength(1);

		buttonWithText(editor.container, 'Add slide').click();
		await waitFor(
			() => rail?.querySelectorAll('.presentation-slide-card').length === 2,
			'the new slide to appear'
		);
		// Focus lands on the new slide's own button, which proves the attachment
		// registration and the focus effect agree about which button is which.
		await waitFor(
			() =>
				document.activeElement instanceof HTMLElement &&
				document.activeElement.getAttribute('aria-label') === 'Show slide 2: Slide 2',
			'the new slide to take focus'
		);

		buttonNamed(editor.container, 'Move slide 2 up').click();
		await waitFor(
			() =>
				[...rail!.querySelectorAll('.presentation-slide-card b')]
					.map((node) => node.textContent)
					.join(',') === 'Slide 2,Slide 1',
			'the slides to swap places'
		);
		expect(
			[...rail!.querySelectorAll('.presentation-slide-card b')].map((node) => node.textContent)
		).toEqual(['Slide 2', 'Slide 1']);

		await editor.unmount();
	});

	it('undoes and redoes an insert through the toolbar', async () => {
		const editor = await openEditor();
		expect(buttonNamed(editor.container, 'Undo').disabled).toBe(true);

		buttonWithText(editor.container, 'Add text').click();
		await waitFor(
			() => editor.store.getState().document?.slides[0]?.elements.length === 1,
			'the text box to be added'
		);

		buttonNamed(editor.container, 'Undo').click();
		await waitFor(
			() => editor.store.getState().document?.slides[0]?.elements.length === 0,
			'the insert to be undone'
		);
		buttonNamed(editor.container, 'Redo').click();
		await waitFor(
			() => editor.store.getState().document?.slides[0]?.elements.length === 1,
			'the insert to be redone'
		);

		await editor.unmount();
	});

	it('commits a typed geometry value to the document', async () => {
		const editor = await openEditor();
		buttonWithText(editor.container, 'Add text').click();
		pressEscape(
			await waitFor(
				() => editor.container.querySelector<HTMLElement>('[data-testid="text-edit-field"]'),
				'the text field to open'
			)
		);
		const elementId = await waitFor(
			() => editor.store.getState().document?.slides[0]?.elements[0]?.id,
			'the text element to exist'
		);
		editor.store.getState().selectElements([elementId]);

		// The numeric fields share the wide pane, which this viewport does not have,
		// with the dialog they are also reachable from.
		buttonWithText(editor.container, 'Element properties').click();
		const x = await waitFor(
			() => editor.container.querySelector<HTMLInputElement>('input[aria-label="X position"]'),
			'the geometry field to appear'
		);
		x.value = '321';
		x.dispatchEvent(new Event('input', { bubbles: true }));
		x.dispatchEvent(new Event('blur', { bubbles: true }));

		await waitFor(
			() => editor.store.getState().document?.slides[0]?.elements[0]?.x === 321,
			'the typed value to reach the document'
		);
		expect(editor.store.getState().document?.slides[0]?.elements[0]?.x).toBe(321);

		await editor.unmount();
	});

	it('copies a published catalog image into the deck, bytes and provenance included', async () => {
		const catalog = catalogFixture();
		const editor = await openEditor({ catalogRepository: catalog.repository });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Blob([fixtureImagePng() as unknown as BlobPart], { type: 'image/png' }), {
				status: 200
			})) as typeof fetch;
		try {
			buttonWithText(editor.container, 'Catalog').click();
			const tile = await waitFor(
				() =>
					editor.container.querySelector<HTMLButtonElement>('button.catalog-item:not(:disabled)'),
				'the catalog tile'
			);
			tile.click();

			const element = await waitFor(() => {
				const found = editor.store
					.getState()
					.document?.slides[0]?.elements.find((candidate) => candidate.kind === 'image');
				return found ?? null;
			}, 'the catalog image element');
			const document = editor.store.getState().document;
			if (!document) throw new Error('no document');
			const asset = document.assets.find((candidate) => candidate.id === element.assetId);
			expect(asset?.provenance).toMatchObject({
				source: 'catalog',
				catalogItemId: catalog.assetId,
				catalogVersionId: catalog.versionId
			});
			// The copy is stored locally, so a later catalog change cannot alter it.
			const stored = await editor.repository.getPresentation(PRESENTATION_ID);
			const storedAsset = stored.assets.find((candidate) => candidate.id === element.assetId);
			expect(storedAsset?.provenance.source).toBe('catalog');
			const media = await editor.repository.getMedia(asset?.id ?? '');
			expect(media.bytes.length).toBe(FIXTURE_IMAGE_BYTE_LENGTH);
			expect(editor.container.textContent).toContain('Saved locally');
			await editor.unmount();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('leaves the deck untouched when a catalog download fails', async () => {
		const catalog = catalogFixture();
		const editor = await openEditor({ catalogRepository: catalog.repository });
		const before = JSON.stringify(editor.store.getState().document);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
		try {
			buttonWithText(editor.container, 'Catalog').click();
			const tile = await waitFor(
				() =>
					editor.container.querySelector<HTMLButtonElement>('button.catalog-item:not(:disabled)'),
				'the catalog tile'
			);
			tile.click();

			const alert = await waitFor(
				() => editor.container.querySelector('[role="alert"]'),
				'the download failure'
			);
			expect(alert.textContent).toContain('could not be downloaded');
			expect(JSON.stringify(editor.store.getState().document)).toBe(before);
			const stored = await editor.repository.getPresentation(PRESENTATION_ID);
			expect(stored.assets).toHaveLength(0);
			await editor.unmount();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('adds a photo through the file input and stores its bytes with the document', async () => {
		const editor = await openEditor();
		const input = editor.container.querySelector<HTMLInputElement>(
			'[data-testid="presentation-image-input"]'
		);
		expect(input).not.toBeNull();

		const transfer = new DataTransfer();
		transfer.items.add(new File([fixturePngBuffer()], 'circle.png', { type: 'image/png' }));
		input!.files = transfer.files;
		input!.dispatchEvent(new Event('change', { bubbles: true }));

		const elementId = await waitFor(
			() => editor.store.getState().document?.slides[0]?.elements[0]?.id,
			'the image element to be adopted'
		);
		const element = await waitFor(() => {
			const found = editor.store
				.getState()
				.document?.slides[0]?.elements.find((candidate) => candidate.id === elementId);
			return found?.kind === 'image' ? found : null;
		}, 'the image element model');
		// Persisted before it was shown: the bytes travel with the same write.
		const stored = await editor.repository.getPresentation(PRESENTATION_ID);
		expect(stored.assets).toHaveLength(1);
		expect(stored.assets[0]!.id).toBe(element.assetId);
		expect((await editor.repository.getMedia(element.assetId)).bytes.length).toBe(
			FIXTURE_IMAGE_BYTE_LENGTH
		);
		expect(editor.container.textContent).toContain('Saved locally');

		await editor.unmount();
	});

	it('refuses a file that is not an image without adding an element', async () => {
		const editor = await openEditor();
		const input = editor.container.querySelector<HTMLInputElement>(
			'[data-testid="presentation-image-input"]'
		);

		const transfer = new DataTransfer();
		transfer.items.add(new File(['not an image'], 'note.txt', { type: 'text/plain' }));
		input!.files = transfer.files;
		input!.dispatchEvent(new Event('change', { bubbles: true }));

		const alert = await waitFor(
			() => editor.container.querySelector('[role="alert"]'),
			'the refusal to be reported'
		);
		expect(alert.textContent).toContain('PNG');
		expect(editor.store.getState().document?.slides[0]?.elements).toHaveLength(0);
		expect(editor.store.getState().dirty).toBe(false);

		await editor.unmount();
	});

	it('hides “Save as template” without the admin repository', async () => {
		const editor = await openEditor();

		expect(hasButtonWithText(editor.container, 'Save as template')).toBe(false);

		await editor.unmount();
	});

	it('saves a text-only deck as a pending template draft', async () => {
		const catalog = new MemoryCatalog(
			{ admins: [ADMIN_ACTOR], collections: [templateCollection()] },
			ADMIN_ACTOR
		);
		const editor = await openEditor({ catalogAdminRepository: catalog });
		const before = JSON.stringify(await editor.repository.getPresentation(PRESENTATION_ID));
		buttonWithText(editor.container, 'Save as template').click();

		const dialog = await waitFor(
			() => editor.container.querySelector<HTMLDialogElement>('dialog[open]'),
			'the save-as-template dialog'
		);
		expect(dialog.textContent).toContain('Save as template');
		const title = dialog.querySelector<HTMLInputElement>('input[type="text"]');
		expect(title?.value).toBe('Editor deck template');

		dialog.querySelector<HTMLFormElement>('form')?.requestSubmit();
		const stored = await waitFor(
			() => catalog.templateVersions[0] ?? null,
			'the template draft to be created'
		);
		expect(stored.validationState).toBe('pending');
		expect(stored.coverPath).toBeNull();
		expect(editor.container.textContent).toContain(
			'Template draft “Editor deck template” created.'
		);
		await waitFor(
			() => !editor.container.querySelector('dialog[open]'),
			'the dialog to close after success'
		);
		const localDocument = await editor.repository.getPresentation(PRESENTATION_ID);
		expect(JSON.stringify(localDocument)).toBe(before);
		expect(localDocument.assets).toHaveLength(0);
		expect(localDocument.title).toBe('Editor deck');
		expect(catalog.templates).toHaveLength(1);
		expect(catalog.templates[0].title).toBe('Editor deck template');

		await editor.unmount();
	});

	it('requires a collection for a local-image deck and reports the failure', async () => {
		const catalog = new MemoryCatalog(
			{
				admins: [ADMIN_ACTOR],
				collections: [templateCollection()],
				process: async () => {
					throw new Error('decode exploded');
				}
			},
			ADMIN_ACTOR
		);
		const editor = await openEditor({
			catalogAdminRepository: catalog,
			seed: async (repository) => {
				const document = createPresentationDocument({ id: PRESENTATION_ID, title: 'Editor deck' });
				const bytes = fixtureImagePng();
				document.assets = [
					{
						id: 'asset-local-1',
						blobKey: 'media/asset-local-1',
						mimeType: 'image/png',
						width: 64,
						height: 64,
						sha256: 'c'.repeat(64),
						byteLength: bytes.length,
						provenance: { source: 'upload', label: 'Photo' }
					}
				];
				document.slides[0].elements = [
					createImageElement({
						id: 'element-local-1',
						name: 'Photo',
						x: 0,
						y: 0,
						width: 100,
						height: 100,
						assetId: 'asset-local-1'
					})
				];
				await repository.savePresentation(document, [
					{ assetId: 'asset-local-1', bytes, mimeType: 'image/png' }
				]);
			}
		});
		const before = JSON.stringify(editor.store.getState().document);
		buttonWithText(editor.container, 'Save as template').click();

		const dialog = await waitFor(
			() => editor.container.querySelector<HTMLDialogElement>('dialog[open]'),
			'the save-as-template dialog'
		);
		const collectionSelect = Array.from(dialog.querySelectorAll('label'))
			.find((label) => label.textContent?.trim().startsWith('Collection'))
			?.querySelector('select');
		expect(collectionSelect).not.toBeNull();
		expect(catalog.uploadBatches).toHaveLength(0);
		expect(collectionSelect?.checkValidity()).toBe(false);
		expect(
			dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled ?? false
		).toBe(true);

		dialog.querySelector<HTMLFormElement>('form')?.requestSubmit();
		expect(catalog.uploadBatches).toHaveLength(0);
		await waitFor(() => collectionSelect?.options.length === 2, 'collections loaded');
		if (!collectionSelect) throw new Error('Missing collection selector');
		collectionSelect.value = templateCollection().id;
		collectionSelect.dispatchEvent(new Event('change', { bubbles: true }));
		await waitFor(
			() => !dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
			'valid form'
		);
		dialog.querySelector<HTMLFormElement>('form')!.requestSubmit();
		const alert = await waitFor(() => dialog.querySelector('[role="alert"]'), 'processing failure');
		expect(alert.textContent).toContain('decode exploded');
		expect(dialog.open).toBe(true);
		expect(catalog.templateVersions).toHaveLength(0);
		expect(JSON.stringify(editor.store.getState().document)).toBe(before);

		await editor.unmount();
	});
});

/** The fixture's deterministic PNG bytes, copied into an `ArrayBuffer` for `File`. */
function fixturePngBuffer(): ArrayBuffer {
	return new Uint8Array(fixtureImagePng()).buffer;
}

describe('presentation editor page in template mode', () => {
	async function openTemplateEditor(onreload: () => void = () => {}) {
		const bytes = fixtureImagePng();
		const sha = await sha256Hex(bytes);
		const assetId = 'a0000000-0000-4000-8000-0000000000b1';
		const versionId = 'v0000000-0000-4000-8000-0000000000b1';
		const derivativePath = `assets/${assetId}/${versionId}/asset.png`;
		const version: CatalogAssetVersion = {
			id: versionId,
			assetId,
			versionNumber: 1,
			sourcePath: 'batches/b/j.png',
			sourceSha256: 'a'.repeat(64),
			sourceBytes: 1024,
			sourceMime: 'image/png',
			derivativePath,
			derivativeSha256: sha,
			derivativeBytes: bytes.length,
			derivativeMime: 'image/png',
			derivativeWidth: 256,
			derivativeHeight: 256,
			thumbnailPath: null,
			validationState: 'validated',
			createdAt: '2026-09-16T00:00:00.000Z'
		};
		const document = createPresentationDocument({ id: 'template-doc', title: 'Template draft' });
		const asset = {
			id: `asset-${sha}`,
			blobKey: `catalog/${sha}`,
			mimeType: 'image/png' as const,
			width: 256,
			height: 256,
			sha256: sha,
			byteLength: bytes.length,
			provenance: {
				source: 'catalog' as const,
				label: 'Catalog art',
				catalogItemId: assetId,
				catalogVersionId: versionId
			}
		};
		document.assets = [asset];
		document.slides[0]!.elements.push(
			createImageElement({ assetId: asset.id, width: 256, height: 256 })
		);
		const json = presentationDocumentToJson(document);
		const encoded = new TextEncoder().encode(json);
		const catalog = new MemoryCatalog(
			{
				admins: [ADMIN_ACTOR],
				versions: [version],
				derivativeUrls: new Map([[derivativePath, 'https://example.test/template.png']])
			},
			ADMIN_ACTOR
		);
		const created = await catalog.createTemplateDraft({
			metadata: {
				title: 'Template draft',
				useCase: 'class',
				description: '',
				tags: [],
				sortOrder: 0
			},
			document: JSON.parse(json),
			documentSha256: await sha256Hex(encoded),
			documentBytes: encoded.length,
			fontRequirements: []
		});
		if (!created.ok) throw new Error(JSON.stringify(created));
		const templateId = created.item.template.id;
		const repository = createTemplateDraftRepository({
			catalog,
			templateId,
			fetch: async () =>
				new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
		});
		const store = createPresentationStore();
		const rendered = await render(PresentationEditorPage, {
			presentationId: templateId,
			repository,
			catalogRepository: catalog,
			store,
			mode: 'template',
			backhref: '/admin/templates',
			onback: () => {},
			onreload,
			leaveguard: null
		});
		await waitFor(
			() => rendered.container.querySelector('.presentation-editor'),
			'the template editor to open'
		);
		return {
			bytes,
			catalog,
			templateId,
			store,
			container: rendered.container,
			unmount: async () => {
				await rendered.unmount();
				store.getState().closeDocument();
			}
		};
	}

	it('offers template actions and hides local-media and export actions', async () => {
		const editor = await openTemplateEditor();

		expect(editor.container.textContent).toContain('Template draft');
		expect(hasButtonWithText(editor.container, 'Save version')).toBe(true);
		expect(hasButtonWithText(editor.container, 'Add image')).toBe(false);
		expect(hasButtonWithText(editor.container, 'Export')).toBe(false);
		expect(hasButtonWithText(editor.container, 'Save as template')).toBe(false);
		expect(editor.container.querySelector('[data-testid="presentation-image-input"]')).toBeNull();
		expect(
			editor.container.querySelector('button[aria-label="Add a catalog image"]')
		).not.toBeNull();

		await editor.unmount();
	});

	it('creates one immutable version per explicit save and never autosaves', async () => {
		const editor = await openTemplateEditor();
		buttonWithText(editor.container, 'Add text').click();
		await waitFor(() => editor.store.getState().dirty, 'the edit to land');

		// Template mode has no autosave: waiting past the local debounce adds nothing.
		await new Promise((resolve) => setTimeout(resolve, 1100));
		expect(editor.catalog.templateVersions).toHaveLength(1);

		buttonWithText(editor.container, 'Save version').click();
		await waitFor(
			() => editor.container.textContent?.includes('Saved as a new draft version.'),
			'the saved note'
		);
		expect(editor.catalog.templateVersions).toHaveLength(2);
		expect(editor.catalog.templateVersions[1]!.versionNumber).toBe(2);
		expect(editor.store.getState().dirty).toBe(false);

		await editor.unmount();
	});

	it('keeps a local layout insertion out of the draft until Save version', async () => {
		const editor = await openTemplateEditor();
		const versionsBefore = editor.catalog.templateVersions.length;
		buttonWithText(editor.container, 'Add layout').click();
		const dialog = await waitFor(
			() => editor.container.querySelector('dialog[open]'),
			'the layout dialog'
		);
		buttonWithText(dialog as HTMLElement, 'Section header').click();
		await waitFor(() => editor.store.getState().document!.slides.length === 2, 'the new slide');
		// No autosave in template mode: the draft is untouched until the explicit save.
		expect(editor.catalog.templateVersions).toHaveLength(versionsBefore);

		buttonWithText(editor.container, 'Save version').click();
		await waitFor(
			() => editor.catalog.templateVersions.length === versionsBefore + 1,
			'a new draft version'
		);
		const savedVersion = editor.catalog.templateVersions.at(-1)!;
		expect((savedVersion.document as PresentationDocument).slides).toHaveLength(2);
		await editor.unmount();
	});

	it('keeps the work on a conflict and replaces only on an explicit second save', async () => {
		const editor = await openTemplateEditor();
		buttonWithText(editor.container, 'Add text').click();
		await waitFor(() => editor.store.getState().dirty, 'the edit to land');

		// Another administrator saves version 2 first.
		const stored = editor.catalog.templateVersions[0]!.document as PresentationDocument;
		const other = { ...JSON.parse(JSON.stringify(stored)), title: 'Other tab' };
		const otherJson = JSON.stringify(other);
		const saved = await editor.catalog.saveTemplateVersion({
			templateId: editor.templateId,
			expectedRevision: 1,
			document: other,
			documentSha256: await sha256Hex(new TextEncoder().encode(otherJson)),
			documentBytes: otherJson.length,
			fontRequirements: []
		});
		expect(saved.ok).toBe(true);

		buttonWithText(editor.container, 'Save version').click();
		await waitFor(
			() =>
				editor.container.textContent?.includes('Another administrator saved a newer draft first'),
			'the conflict message'
		);
		expect(hasButtonWithText(editor.container, 'Reload draft (discards my changes)')).toBe(true);
		expect(editor.store.getState().dirty).toBe(true);
		expect(editor.catalog.templateVersions).toHaveLength(2);

		// The explicit retry replaces the other version.
		buttonWithText(editor.container, 'Save version').click();
		await waitFor(
			() => editor.container.textContent?.includes('Saved as a new draft version.'),
			'the retry save'
		);
		expect(editor.catalog.templateVersions).toHaveLength(3);
		expect((editor.catalog.templateVersions[2]!.document as PresentationDocument).title).toBe(
			'Template draft'
		);

		await editor.unmount();
	});

	it('asks the route to discard and reload when the conflict is abandoned', async () => {
		let reloads = 0;
		const editor = await openTemplateEditor(() => (reloads += 1));
		buttonWithText(editor.container, 'Add text').click();
		await waitFor(() => editor.store.getState().dirty, 'the edit to land');

		const stored = editor.catalog.templateVersions[0]!.document as PresentationDocument;
		const other = { ...JSON.parse(JSON.stringify(stored)), title: 'Other tab' };
		const otherJson = JSON.stringify(other);
		const saved = await editor.catalog.saveTemplateVersion({
			templateId: editor.templateId,
			expectedRevision: 1,
			document: other,
			documentSha256: await sha256Hex(new TextEncoder().encode(otherJson)),
			documentBytes: otherJson.length,
			fontRequirements: []
		});
		expect(saved.ok).toBe(true);

		buttonWithText(editor.container, 'Save version').click();
		await waitFor(
			() => hasButtonWithText(editor.container, 'Reload draft (discards my changes)'),
			'the reload button'
		);
		buttonWithText(editor.container, 'Reload draft (discards my changes)').click();
		expect(reloads).toBe(1);

		await editor.unmount();
	});
});
