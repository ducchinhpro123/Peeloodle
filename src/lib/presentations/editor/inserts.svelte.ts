/**
 * Everything that adds content to the open deck: text boxes, shapes, built-in
 * layouts, pictures (device, catalog, saved stickers), picture replacement and
 * template slides. Image writes are persist-first and one at a time: the
 * document and the new bytes are stored together before the editor shows them,
 * and a second write is refused while one is running.
 */

import type { CatalogAdminRepository, CatalogRepository } from '#lib/catalog/repository.js';
import type { StickerLabRepository } from '#lib/persistence/repository.js';
import type { PresentationRepository } from '../persistence/repository';
import { createBuiltinLayout, type BuiltinLayoutId } from '../templates/builtinLayouts';
import { loadTemplateLayout } from '../templates/templateLayout';
import { saveAsTemplateDraft } from '../templates/saveAsTemplateDraft';
import type { CatalogTemplateInput } from '#lib/catalog/repository.js';
import type { EditorArtwork } from './artwork.svelte';
import type { DocumentState } from './document/documentState.svelte';
import {
	prepareCatalogAsset,
	CatalogInsertError,
	type CatalogInsertSource
} from './insertCatalogAsset';
import {
	preparePresentationImage,
	PrepareImageError,
	type PreparedPresentationImage
} from './insertImageAsset';
import { prepareStickerSnapshot } from './insertStickerSnapshot';
import type { MessageBar } from './messages.svelte';
import type { PersistInsertOutcome, PresentationSaving } from './persistence/persistence.svelte';
import type { SelectionState } from './selection.svelte';
import { createSlideShape, type ShapeInsertKind } from './shapeTools';
import type { TextEditSession } from './textEditSession.svelte';
import { createPresetText, type TextPreset } from './textPresets';

/** Repositories that arrive (or change) after the editor is created. */
export type EditorServices = {
	readonly stickers: StickerLabRepository | null;
	readonly catalog: CatalogRepository | null;
	readonly catalogAdmin: CatalogAdminRepository | null;
};

export type InsertResult = { ok: true; slideId?: string } | { ok: false; message: string };

export type EditorInserts = {
	/** True while an image write is running; every image path shares it. */
	readonly inserting: boolean;
	addTextBox(preset?: TextPreset): void;
	addShape(kind: ShapeInsertKind): void;
	addBuiltinLayout(layoutId: BuiltinLayoutId): InsertResult;
	/** The page's hidden file input; picking a file adds or replaces a picture. */
	registerImageInput(input: HTMLInputElement | null): void;
	/** Opens the file picker to add a new picture. */
	pickImage(): void;
	/** Opens the file picker to replace this element's picture. */
	beginReplaceImage(elementId: string): void;
	/** Called with the file the picker returned. */
	acceptPickedFile(file: File): Promise<void>;
	addImage(file: File): Promise<void>;
	addCatalogImage(source: CatalogInsertSource): Promise<void>;
	addSticker(projectId: string): Promise<void>;
	insertTemplateLayout(templateId: string, slideOrdinals: number[]): Promise<InsertResult>;
	saveAsTemplate(input: {
		metadata: CatalogTemplateInput;
		collectionId: string | null;
	}): Promise<void>;
};

export function createEditorInserts(input: {
	repository: PresentationRepository;
	doc: DocumentState;
	selection: SelectionState;
	text: TextEditSession;
	messages: MessageBar;
	persistence: PresentationSaving;
	artwork: EditorArtwork;
	services: EditorServices;
}): EditorInserts {
	const { repository, doc, selection, text, messages, persistence, artwork, services } = input;
	let inserting = $state(false);
	let imageInput: HTMLInputElement | null = null;
	let replaceTargetId: string | null = null;

	/**
	 * Persist, then adopt: the repository writes the document and this image's
	 * bytes in one transaction, and only then does the editor show the artwork.
	 * Shared by insertion and replacement so neither path can report success for
	 * a half-written change.
	 */
	async function runImageWrite(
		prepare: () => Promise<PreparedPresentationImage>,
		write: (prepared: PreparedPresentationImage) => Promise<PersistInsertOutcome>,
		fallback: string
	) {
		// One image write at a time: a second one would plan against the same
		// revision and could store a deck without the first image.
		if (inserting) {
			messages.show('Wait for the current image to finish adding, then try again.');
			return;
		}
		if (!doc.document) return;
		if (!artwork.ready) {
			messages.show(
				'This presentation is still opening its artwork, so the image was not added. Try again once the slide appears.'
			);
			return;
		}
		messages.clear();
		inserting = true;
		// Past the write the element, its asset and its bytes are stored, so a later
		// display failure must not be reported as a failed write.
		let persisted = false;
		try {
			const prepared = await prepare();
			const outcome = await write(prepared);
			if (!outcome.ok) {
				// A failed or conflicting write is reported by the save status instead.
				if (outcome.reason === 'failed' || outcome.reason === 'conflict') messages.clear();
				else messages.show(outcome.message);
				return;
			}
			persisted = true;
			if (!artwork.ready) {
				messages.show(
					'This image was saved, but this editor can no longer display it. Reopen the presentation to see it.'
				);
				return;
			}
			await artwork.add([prepared.media]);
		} catch (error) {
			if (error instanceof PrepareImageError || error instanceof CatalogInsertError)
				messages.show(error.message);
			else if (persisted)
				messages.show(
					'This image was saved, but it cannot be displayed here yet. Reopen the presentation to see it.'
				);
			else messages.show(fallback);
		} finally {
			inserting = false;
		}
	}

	const addImage = (file: File) =>
		runImageWrite(
			() => preparePresentationImage(file),
			(prepared) => persistence.persistInsert(prepared),
			'This image could not be added.'
		);

	const replacePhoto = (file: File) => {
		const target = replaceTargetId;
		replaceTargetId = null;
		if (!target) return Promise.resolve();
		return runImageWrite(
			() => preparePresentationImage(file),
			(prepared) => persistence.persistReplace(target, prepared),
			'This photo could not be replaced.'
		);
	};

	return {
		get inserting() {
			return inserting;
		},
		addTextBox(preset = 'body') {
			const document = doc.document;
			if (!document || !selection.activeSlide) return;
			// A preset box is ordinary editable text: theme fonts/colors, the preset's
			// size, and automatic growth so the store can fit it as the text changes.
			text.flush();
			const id = doc.addElement(createPresetText(preset, document.theme));
			// Open the editor straight away so the new box can be typed into immediately.
			if (id) selection.startTextEdit(id);
			else messages.show('This slide cannot hold another text box. Remove an element first.');
		},
		addShape(kind) {
			const document = doc.document;
			if (!document || !kind) return;
			const element = createSlideShape(kind, document.pageSize);
			// Blocks take the document's accent; linear kinds keep their stroke colour.
			if (element.shape !== 'line' && element.shape !== 'arrow')
				element.fill = document.theme.colors.accent ?? element.fill;
			doc.addElement(element);
		},
		addBuiltinLayout(layoutId) {
			text.flush();
			selection.endTextEdit();
			doc.endHistoryGroup();
			const current = doc.document;
			if (!current) return { ok: false, message: 'Open a presentation before adding a layout.' };
			const id = doc.insertSlide(createBuiltinLayout(layoutId, current.theme));
			if (!id)
				return { ok: false, message: 'This presentation has reached its slide or element limit.' };
			// In template mode the saver still requires an explicit Save, so a local
			// layout insertion never publishes a draft version by itself.
			return { ok: true, slideId: id };
		},
		registerImageInput(next) {
			imageInput = next;
		},
		pickImage() {
			replaceTargetId = null;
			imageInput?.click();
		},
		beginReplaceImage(elementId) {
			replaceTargetId = elementId;
			imageInput?.click();
		},
		acceptPickedFile(file) {
			return replaceTargetId ? replacePhoto(file) : addImage(file);
		},
		addImage,
		/**
		 * Copies a published catalog image: the bytes are downloaded and validated
		 * before the document is written, so a failed download leaves the deck
		 * untouched and the stored copy no longer depends on the catalog.
		 */
		addCatalogImage(source) {
			return runImageWrite(
				() => prepareCatalogAsset(services.catalog, source),
				(prepared) => persistence.persistInsert(prepared),
				'This catalog image could not be added.'
			);
		},
		/** Composes a saved sticker once and places the snapshot as an immutable image. */
		async addSticker(projectId) {
			const stickers = services.stickers;
			if (!stickers) {
				messages.show('Saved stickers are not available in this session.');
				return;
			}
			await runImageWrite(
				() => prepareStickerSnapshot(stickers, projectId),
				(prepared) => persistence.persistInsert(prepared),
				'This sticker could not be added.'
			);
		},
		/**
		 * Downloads the chosen slides from a published template and writes them into
		 * this deck as one persisted, undoable insertion. A failure leaves the deck
		 * untouched; the dialog shows the staged message.
		 */
		async insertTemplateLayout(templateId, slideOrdinals) {
			const catalogRepository = services.catalog;
			if (!catalogRepository)
				return { ok: false, message: 'The catalog is not configured for this site.' };
			try {
				const layout = await loadTemplateLayout({ catalogRepository, templateId, slideOrdinals });
				const outcome = await persistence.persistSlides({
					slides: layout.slides,
					assets: layout.assets,
					media: layout.media
				});
				if (!outcome.ok) return { ok: false, message: outcome.message };
				messages.showNotice('Template slides inserted.');
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : 'The slides could not be inserted.'
				};
			}
		},
		/**
		 * Captures one snapshot for a template draft: pending text is flushed first,
		 * then the service runs against the flushed document. The local deck is only
		 * a read-only source for the copy.
		 */
		async saveAsTemplate({ metadata, collectionId }) {
			const catalogRepository = services.catalogAdmin;
			if (!catalogRepository) return;
			await text.flush();
			const document = doc.document;
			if (!document) return;
			const draft = await saveAsTemplateDraft({
				sourceDocument: document,
				presentationRepository: repository,
				catalogRepository,
				collectionId,
				metadata
			});
			messages.showNotice(`Template draft “${draft.template.title}” created.`);
		}
	};
}
