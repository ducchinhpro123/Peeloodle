<script>
	import { button, buttonIcon, buttonPrimary } from '$lib/ui/styles.js';
	import {
		ArrowLeft,
		Copy,
		GripVertical,
		ImagePlus,
		MonitorUp,
		PenLine,
		Plus,
		Redo2,
		Save,
		ShieldAlert,
		Trash2,
		Type,
		Undo2
	} from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { isPersistenceError } from '$lib/persistence/repository';
	import { isPresentationParseError } from '$lib/presentations/model/parse';
	import { createPresetText } from '$lib/presentations/editor/textPresets';
	import { createBuiltinLayout } from '$lib/presentations/templates/builtinLayouts';
	import BuiltinLayoutDialog from './BuiltinLayoutDialog.svelte';
	import SlideRailPreview from './SlideRailPreview.svelte';
	import { ensurePresentationFonts } from '$lib/presentations/rendering/fonts';
	import { createDecodedArtwork } from '$lib/presentations/rendering/decodedArtwork';
	import {
		preparePresentationImage,
		PrepareImageError
	} from '$lib/presentations/editor/insertImageAsset';
	import { prepareStickerSnapshot } from '$lib/presentations/editor/insertStickerSnapshot';
	import { createSlideShape } from '$lib/presentations/editor/shapeTools';
	import { createPresentationSaving } from '$lib/presentations/editor/presentationSaving';
	import { createPresentationExport } from '$lib/presentations/editor/exportController';
	import { usePresentationOfflineReadiness } from '$lib/presentations/presentationOffline.svelte';
	import { createTextEditSession } from '$lib/presentations/editor/textEditSession.svelte';
	import ElementLayerList from './ElementLayerList.svelte';
	import ElementGeometryInspector from './ElementGeometryInspector.svelte';
	import TextFormatToolbar from './TextFormatToolbar.svelte';
	import ThemeControls from './ThemeControls.svelte';
	import StickerPickerDialog from './StickerPickerDialog.svelte';
	import CatalogPickerDialog from './CatalogPickerDialog.svelte';
	import {
		prepareCatalogAsset,
		CatalogInsertError
	} from '$lib/presentations/editor/insertCatalogAsset';
	import ExportDialog from './ExportDialog.svelte';
	import SaveAsTemplateDialog from './SaveAsTemplateDialog.svelte';
	import { saveAsTemplateDraft } from '$lib/presentations/templates/saveAsTemplateDraft';
	import {
		describeTemplateSaveFailure,
		TEMPLATE_SAVE_CONFLICT_MESSAGE
	} from '$lib/presentations/templates/templateDraftRepository';
	import { loadTemplateLayout } from '$lib/presentations/templates/templateLayout';
	import InsertTemplateDialog from './InsertTemplateDialog.svelte';

	/**
	 * @typedef {(
	 *   kind: 'move' | 'resize' | 'rotate',
	 *   handle: import('$lib/presentations/editor/transformGeometry').ResizeHandle | null,
	 *   event: PointerEvent
	 * ) => void} GestureStarter
	 */

	const SHORTCUT_EXEMPT =
		'input, textarea, select, [contenteditable="true"], [role="slider"], [data-slot="slider"], [role="dialog"]';

	/** @type {{
	 *   presentationId: string,
	 *   repository: import('$lib/presentations/persistence/repository').PresentationRepository,
	 *   stickerRepository?: import('$lib/persistence/repository').StickerLabRepository | null,
	 *   catalogRepository?: import('$lib/catalog/repository').CatalogRepository | null,
	 *   catalogAdminRepository?: import('$lib/catalog/repository').CatalogAdminRepository | null,
	 *   store: import('$lib/presentations/editor/store.svelte').PresentationStore,
	 *   backhref: string,
	 *   onback: () => void | Promise<void>,
	 *   mode?: 'local' | 'template',
	 *   onreload?: (() => void) | null,
	 *   leaveguard?: {
	 *     hasUnsavedWork: () => boolean,
	 *     saveBeforeLeave: () => Promise<boolean>,
	 *     reportFailure: () => void
	 *   } | null
	 * }} */
	// `mode: 'template'` swaps the persistence story: the repository is the
	// catalog adapter (one immutable draft version per explicit save), autosave is
	// off, and insert-local-media/export actions are hidden because a template
	// draft may only reference catalog artwork. `onreload` is template mode's
	// explicit “discard my changes and reload the server draft” edge.
	let {
		presentationId,
		repository,
		stickerRepository = null,
		catalogRepository = null,
		catalogAdminRepository = null,
		store,
		backhref,
		onback,
		mode = 'local',
		onreload = null,
		// `$bindable` compiles to a prop getter/setter, so this component only ever
		// publishes the guard; the route reads it back through the binding, which
		// leaves the initial value unread here. The repo's ESLint flags this without
		// the directive even though the Svelte autofixer reports it as unused.
		// eslint-disable-next-line no-useless-assignment
		leaveguard = $bindable(null)
	} = $props();

	const templateMode = $derived(mode === 'template');

	/** The editor that opens a text session owns it; save flushes through it. */
	const textSession = createTextEditSession();

	// The route keys this page on the presentation id, so a different document
	// remounts the component instead of reassigning these props.
	// svelte-ignore state_referenced_locally
	const saving = createPresentationSaving({
		repository,
		documentId: presentationId,
		flushText: () => textSession.flush(),
		store,
		// Template mode writes catalog versions, so a local-storage failure message
		// would be wrong: the adapter's own wording is shown instead.
		...(mode === 'template'
			? {
					describeFailure: describeTemplateSaveFailure,
					conflictMessage: TEMPLATE_SAVE_CONFLICT_MESSAGE
				}
			: {})
	});
	let saveState = $state.raw(saving.getStatus());

	/**
	 * The reload guidance both the readiness line and a failed export use: the page
	 * holds the write state, so it — not the offline module — decides whether a reload
	 * is safe to suggest. `dirty` is read live from the store at failure time.
	 */
	// svelte-ignore state_referenced_locally
	const exportController = createPresentationExport({
		repository,
		getDocument: () => store.getState().document,
		flushText: () => textSession.flush(),
		reloadSafety: () => ({ unsavedWork: store.getState().dirty, saveFailed: saveReported })
	});
	let exportState = $state.raw(exportController.getState());
	// A deep link straight into the editor still prepares offline use for this session.
	const offline = usePresentationOfflineReadiness();

	/** @type {'loading' | 'ready' | 'missing' | 'missing-media' | 'unsupported' | 'error'} */
	let loadState = $state.raw('loading');
	/** @type {string | null} */
	let loadMessage = $state(null);
	/** @type {Error | null} */
	let loadFailure = $state(null);
	let attempt = $state(0);
	/** @type {import('$lib/presentations/rendering/renderSlide').PresentationImageSources} */
	let images = $state.raw(new Map());
	/**
	 * Konva's Node entry hard-requires the native `canvas` package, so the slide
	 * canvas is client-only — the same seam `EditorCanvas` uses for the artboard.
	 * A static import here put Konva in the SSR graph and 500'd this route.
	 *
	 * @type {typeof import('./PresentationCanvas.svelte').default | null}
	 */
	let PresentationCanvas = $state(null);
	/** @type {import('$lib/presentations/rendering/decodedArtwork').DecodedArtwork | null} */
	let decodedArtwork = null;
	/** @type {string | null} */
	let insertError = $state(null);
	let inserting = $state(false);
	/** @type {string | null} */
	let editorNote = $state(null);
	let recovering = $state(false);
	/** @type {string | null} */
	let replaceTargetId = $state(null);
	/** @type {HTMLInputElement | null} */
	let imageInput = $state(null);
	/** @type {HTMLButtonElement | null} */
	let propertiesOpener = $state(null);
	/** @type {HTMLButtonElement | null} */
	let themeOpener = $state(null);
	let propertiesOpen = $state(false);
	let themeOpen = $state(false);
	/** @type {string | null} */
	let focusSlideId = $state(null);
	/** @type {{ id: string, pointerId: number, x: number, y: number } | null} */
	let slideDrag = null;
	/** @type {string | null} */
	let draggingSlideId = $state(null);
	/** @type {string | null} */
	let dropSlideId = $state(null);
	/** @type {'before' | 'after' | null} */
	let dropPosition = $state(null);
	let suppressSlideClick = false;
	/** @type {Map<string, HTMLButtonElement>} */
	// Slide buttons are addressed imperatively by the focus effect below and never
	// read from the template, so they stay out of the reactive graph.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const slideButtons = new Map();

	const editorState = $derived(store.current);
	const presentation = $derived(editorState.document);
	const activeSlide = $derived(
		presentation?.slides.find((slide) => slide.id === editorState.view.activeSlideId) ??
			presentation?.slides[0]
	);
	const selectedElement = $derived(
		activeSlide?.elements.find((element) => element.id === editorState.view.selectedElementIds[0])
	);
	const selectedText = $derived(selectedElement?.kind === 'text' ? selectedElement : null);
	const canUndo = $derived(editorState.past.length > 0);
	const canRedo = $derived(editorState.future.length > 0);
	const saveReported = $derived(saveState.status === 'failed' || saveState.status === 'conflict');
	const saveLabel = $derived(
		saveState.status === 'conflict'
			? 'Save conflict'
			: saveState.status === 'failed'
				? 'Save failed'
				: saveState.status === 'saving'
					? templateMode
						? 'Saving version…'
						: 'Saving…'
					: editorState.dirty
						? 'Unsaved changes'
						: templateMode
							? 'Draft saved'
							: 'Saved locally'
	);
	// A failure is shown in words, not only in a tooltip: what happened and that
	// the edit is still here with a way to retry it.
	const saveStatus = $derived(
		saveReported && saveState.message ? `${saveLabel} — ${saveState.message}` : saveLabel
	);

	// Effects never run during SSR, so the import alone is the client-only seam;
	// the placeholder below holds the canvas track until it resolves.
	$effect(() => {
		void import('./PresentationCanvas.svelte').then((module) => {
			PresentationCanvas = module.default;
		});
	});

	$effect(() => {
		const unsubscribe = saving.subscribeStatus(() => (saveState = saving.getStatus()));
		// Template mode has no autosave: every write creates an immutable version,
		// so a version is only ever created by an explicit Save (or a held
		// navigation the leave guard commits).
		const autosave = templateMode ? null : saving.attachAutosave();
		return () => {
			unsubscribe();
			autosave?.detach();
		};
	});

	$effect(() => {
		const unsubscribe = exportController.subscribeState(
			() => (exportState = exportController.getState())
		);
		return () => {
			unsubscribe();
			exportController.destroy();
		};
	});

	$effect(() => {
		// The route owns history, the page owns the write: publishing this guard
		// through the binding is how an in-app navigation is held until the unsaved
		// work is committed. The route starts with `null`, so it must be handed the
		// object rather than have a placeholder mutated.
		leaveguard = {
			hasUnsavedWork: () => {
				const current = store.getState();
				return current.dirty && current.document?.id === presentationId;
			},
			saveBeforeLeave: async () => {
				// A conflict needs a deliberate answer from the administrator;
				// navigating away must not replace the other tab's version.
				if (templateMode && saving.getStatus().status === 'conflict') return false;
				return saving.saveBeforeLeave();
			},
			reportFailure: () =>
				(editorNote = templateMode
					? 'This draft could not be saved, so it is still open. Press Save version to try again — or reload the draft to discard these changes.'
					: 'This presentation could not be saved, so it is still open. Press Save to try again — or press Keep my copy if another tab or window has a newer version.')
		};
		return () => {
			// The guard must not outlive the editor it speaks for.
			leaveguard = null;
		};
	});

	/**
	 * Decodes one document's artwork; the caller owns disposal of the result.
	 * @param {import('$lib/presentations/model/types').PresentationDocument} loaded
	 */
	async function decodeDocumentMedia(loaded) {
		const media = await Promise.all(loaded.assets.map((asset) => repository.getMedia(asset.id)));
		const decoded = createDecodedArtwork();
		await decoded.add(media);
		return decoded;
	}

	/**
	 * Opens the routed presentation: loads its fonts and artwork, then adopts the
	 * document into the store. `live` guards that async read so an unmount (or a
	 * retry that has already replaced it) disposes what it decoded instead of
	 * swapping it in after the editor has moved on.
	 */
	$effect(() => {
		// "Try again" bumps the attempt counter to re-run this read.
		void attempt;
		let live = true;
		loadState = 'loading';
		loadMessage = null;
		void (async () => {
			try {
				const fontPromise = ensurePresentationFonts();
				const loaded = await repository.getPresentation(presentationId);
				let decoded;
				try {
					const media = await Promise.all(
						loaded.assets.map((asset) => repository.getMedia(asset.id))
					);
					decoded = createDecodedArtwork();
					await decoded.add(media);
				} catch (mediaError) {
					// The document exists but its artwork does not: do not report the whole
					// presentation as deleted, and keep retry available.
					void fontPromise.catch(() => {});
					if (isPersistenceError(mediaError) && mediaError.code === 'not_found') {
						if (live) loadState = 'missing-media';
						return;
					}
					throw mediaError;
				}
				await fontPromise;
				if (!live) {
					decoded.dispose();
					return;
				}
				decodedArtwork?.dispose();
				decodedArtwork = decoded;
				images = new Map(decoded.images);
				store.getState().loadDocument(loaded, { saved: true });
				loadState = 'ready';
			} catch (error) {
				if (!live) return;
				loadFailure = /** @type {Error} */ (error);
				if (isPersistenceError(error) && error.code === 'not_found') loadState = 'missing';
				else if (
					(isPersistenceError(error) && error.code === 'unsupported_schema') ||
					(isPresentationParseError(error) && error.code === 'unsupported_schema')
				)
					loadState = 'unsupported';
				else {
					loadState = 'error';
					loadMessage = 'Your other saved work is unchanged.';
				}
			}
		})();

		return () => {
			live = false;
			decodedArtwork?.dispose();
			decodedArtwork = null;
			if (store.getState().document?.id === presentationId) store.getState().closeDocument();
		};
	});

	/** The newer stored revision's artwork, after a conflict copy was kept. */
	async function reloadStoredArtwork() {
		const loaded = await repository.getPresentation(presentationId);
		const decoded = await decodeDocumentMedia(loaded);
		decodedArtwork?.dispose();
		decodedArtwork = decoded;
		images = new Map(decoded.images);
	}

	/** @param {import('$lib/presentations/editor/textPresets').TextPreset} [preset] */
	function addTextBox(preset = 'body') {
		const state = store.getState();
		if (!state.document || !activeSlide) return;
		// A preset box is ordinary editable text: theme fonts/colors, the preset's
		// size, and automatic growth so the store can fit it as the text changes.
		textSession.flush();
		const id = store.getState().addElement(createPresetText(preset, state.document.theme));
		// Open the editor straight away so the new box can be typed into immediately.
		if (id) store.getState().startTextEdit(id);
		else insertError = 'This slide cannot hold another text box. Remove an element first.';
	}

	/** @param {import('$lib/presentations/templates/builtinLayouts').BuiltinLayoutId} layoutId */
	function addBuiltinLayout(layoutId) {
		textSession.flush();
		store.getState().endTextEdit();
		store.getState().endHistoryGroup();
		const current = store.getState().document;
		if (!current) return { ok: false, message: 'Open a presentation before adding a layout.' };
		const slide = createBuiltinLayout(layoutId, current.theme);
		const id = store.getState().insertSlide(slide);
		if (!id)
			return { ok: false, message: 'This presentation has reached its slide or element limit.' };
		// In template mode the existing saver still requires an explicit Save, so a
		// local layout insertion never publishes a draft version by itself.
		focusSlideId = id;
		return { ok: true };
	}

	function addSlide() {
		const id = store.getState().addSlide();
		if (id) focusSlideId = id;
	}

	function duplicateActiveSlide() {
		const activeId = store.getState().view.activeSlideId;
		if (!activeId) return;
		const id = store.getState().duplicateSlide(activeId);
		if (id) focusSlideId = id;
	}

	/**
	 * @param {string} slideId
	 * @param {number} targetIndex
	 */
	function moveSlide(slideId, targetIndex) {
		store.getState().reorderSlide(slideId, targetIndex);
	}

	/** @param {string} id @param {PointerEvent} event */
	function startSlideDrag(id, event) {
		if (
			event.button !== 0 ||
			(event.pointerType === 'touch' &&
				/** @type {HTMLElement} */ (event.currentTarget).classList.contains(
					'presentation-slide-card'
				))
		)
			return;
		event.preventDefault();
		slideDrag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
		/** @type {HTMLButtonElement} */ (event.currentTarget).setPointerCapture(event.pointerId);
	}

	/** @param {PointerEvent} event */
	function moveSlideDrag(event) {
		const drag = slideDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (!draggingSlideId && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
		draggingSlideId = drag.id;
		// Pointer capture keeps events on the source even above another card.
		// Use the pointer's geometry rather than elementFromPoint's captured hit.
		const target = [...document.querySelectorAll('.presentation-slide-card')].find((card) => {
			const rect = card.getBoundingClientRect();
			return (
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom
			);
		});
		const id = target?.getAttribute('data-slide-id');
		if (!target || !id || id === drag.id) {
			dropSlideId = null;
			dropPosition = null;
			return;
		}
		const rect = target.getBoundingClientRect();
		const horizontal = window.matchMedia('(max-width: 720px)').matches;
		dropSlideId = id;
		dropPosition = horizontal
			? event.clientX < rect.left + rect.width / 2
				? 'before'
				: 'after'
			: event.clientY < rect.top + rect.height / 2
				? 'before'
				: 'after';
	}

	/** @param {PointerEvent} event @param {boolean} commit */
	function finishSlideDrag(event, commit) {
		const drag = slideDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (draggingSlideId) {
			suppressSlideClick = true;
			setTimeout(() => (suppressSlideClick = false), 0);
			if (commit && dropSlideId && dropPosition) {
				const slides = store.getState().document?.slides ?? [];
				const source = slides.findIndex((item) => item.id === drag.id);
				const target = slides.findIndex((item) => item.id === dropSlideId);
				if (source !== -1 && target !== -1) {
					const index = target + (dropPosition === 'after' ? 1 : 0) - (source < target ? 1 : 0);
					moveSlide(drag.id, index);
				}
			}
		}
		slideDrag = null;
		draggingSlideId = null;
		dropSlideId = null;
		dropPosition = null;
	}

	/** @param {string} id @param {KeyboardEvent} event */
	function slideKeyDown(id, event) {
		if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
		const slides = store.getState().document?.slides ?? [];
		const index = slides.findIndex((slide) => slide.id === id);
		const next = index + (event.key === 'ArrowUp' ? -1 : 1);
		if (index < 0 || next < 0 || next >= slides.length) return;
		event.preventDefault();
		moveSlide(id, next);
		focusSlideId = id;
	}

	/** @param {string} slideId */
	function deleteSlide(slideId) {
		if (!store.getState().removeSlide(slideId)) return;
		const survivor = store.getState().view.activeSlideId;
		if (survivor) focusSlideId = survivor;
	}

	$effect(() => {
		const target = focusSlideId;
		if (!target) return;
		focusSlideId = null;
		const button = slideButtons.get(target);
		if (button) button.focus();
	});

	/**
	 * Keeps every slide's button addressable for the focus effect above. `bind:this`
	 * cannot take a per-item computed expression, so the button registers itself
	 * through an attachment and unregisters when it leaves the DOM.
	 * @param {string} id
	 * @returns {import('svelte/attachments').Attachment<HTMLButtonElement>}
	 */
	function registerSlideButton(id) {
		return (node) => {
			slideButtons.set(id, node);
			return () => slideButtons.delete(id);
		};
	}

	/** @param {import('$lib/presentations/editor/shapeTools').ShapeInsertKind} kind */
	function addShape(kind) {
		const state = store.getState();
		if (!state.document || !kind) return;
		const element = createSlideShape(kind, state.document.pageSize);
		// Blocks take the document's accent; linear kinds keep their stroke colour.
		if (element.shape !== 'line' && element.shape !== 'arrow')
			element.fill = state.document.theme.colors.accent ?? element.fill;
		state.addElement(element);
	}

	/**
	 * Persist, then adopt: the repository writes the document and this image's
	 * bytes in one transaction, and only then does the editor show the artwork.
	 * Shared by insertion and replacement so neither path can report success for
	 * a half-written change.
	 * @param {() => Promise<import('$lib/presentations/editor/insertImageAsset').PreparedPresentationImage>} prepare
	 * @param {(prepared: import('$lib/presentations/editor/insertImageAsset').PreparedPresentationImage) => Promise<import('$lib/presentations/editor/presentationSaving').PersistInsertOutcome>} write
	 * @param {string} fallback
	 */
	async function runImageWrite(prepare, write, fallback) {
		const state = store.getState();
		if (!state.document) return;
		if (!decodedArtwork) {
			insertError =
				'This presentation is still opening its artwork, so the image was not added. Try again once the slide appears.';
			return;
		}
		insertError = null;
		inserting = true;
		// Past the write the element, its asset and its bytes are stored, so a later
		// display failure must not be reported as a failed write.
		let persisted = false;
		try {
			const prepared = await prepare();
			const outcome = await write(prepared);
			if (!outcome.ok) {
				insertError =
					outcome.reason === 'failed' || outcome.reason === 'conflict' ? null : outcome.message;
				return;
			}
			persisted = true;
			const media = decodedArtwork;
			if (!media) {
				insertError =
					'This image was saved, but this editor can no longer display it. Reopen the presentation to see it.';
				return;
			}
			await media.add([prepared.media]);
			// A fresh Map so the canvas re-renders with the new artwork.
			images = new Map(media.images);
		} catch (error) {
			if (error instanceof PrepareImageError || error instanceof CatalogInsertError)
				insertError = error.message;
			else if (persisted)
				insertError =
					'This image was saved, but it cannot be displayed here yet. Reopen the presentation to see it.';
			else insertError = fallback;
		} finally {
			inserting = false;
		}
	}

	/** @param {File} file */
	function addImage(file) {
		return runImageWrite(
			() => preparePresentationImage(file),
			(prepared) => saving.persistInsert(prepared),
			'This image could not be added.'
		);
	}

	/** @param {string} elementId */
	function beginReplaceImage(elementId) {
		propertiesOpen = false;
		replaceTargetId = elementId;
		imageInput?.click();
	}

	/** @param {File} file */
	function replacePhoto(file) {
		const target = replaceTargetId;
		if (!target) return;
		replaceTargetId = null;
		return runImageWrite(
			() => preparePresentationImage(file),
			(prepared) => saving.persistReplace(target, prepared),
			'This photo could not be replaced.'
		);
	}

	/**
	 * Copies a published catalog image: the bytes are downloaded and validated
	 * *before* the document is written (P63), so a failed download leaves the deck
	 * untouched and the stored copy no longer depends on the catalog.
	 * @param {import('$lib/presentations/editor/insertCatalogAsset').CatalogInsertSource} source
	 */
	function addCatalogImage(source) {
		return runImageWrite(
			() => prepareCatalogAsset(catalogRepository, source),
			(prepared) => saving.persistInsert(prepared),
			'This catalog image could not be added.'
		);
	}

	/**
	 * Composes a saved sticker once and places the snapshot as an immutable image.
	 * @param {string} projectId
	 */
	function addSticker(projectId) {
		if (!stickerRepository) {
			insertError = 'Saved stickers are not available in this session.';
			return;
		}
		return runImageWrite(
			() => prepareStickerSnapshot(stickerRepository, projectId),
			(prepared) => saving.persistInsert(prepared),
			'This sticker could not be added.'
		);
	}

	async function requestSave() {
		editorNote = null;
		const result = await saving.save();
		if (templateMode && result === 'saved') editorNote = 'Saved as a new draft version.';
	}

	/**
	 * Template mode's conflict exit: discards the local edits and reloads the
	 * newest server draft. Only ever reached through its explicit button.
	 */
	function reloadDraft() {
		if (!onreload) return;
		editorNote = null;
		onreload();
	}

	/**
	 * Captures one snapshot for the template draft: pending text is flushed first,
	 * then the service runs against the flushed document. The local save path is
	 * untouched — the local deck is a read-only source for the copy.
	 * @param {{ metadata: import('$lib/catalog/repository').CatalogTemplateInput, collectionId: string | null }} input
	 */
	async function saveAsTemplate(input) {
		if (!catalogAdminRepository) return;
		await textSession.flush();
		const document = store.getState().document;
		if (!document) return;
		const draft = await saveAsTemplateDraft({
			sourceDocument: document,
			presentationRepository: repository,
			catalogRepository: catalogAdminRepository,
			collectionId: input.collectionId,
			metadata: input.metadata
		});
		editorNote = `Template draft “${draft.template.title}” created.`;
	}

	/**
	 * Downloads the chosen slides from a published template and writes them into
	 * this deck as one persisted, undoable insertion (P71). A failure leaves the
	 * deck untouched; the dialog shows the staged message.
	 * @param {string} templateId
	 * @param {number[]} slideOrdinals
	 */
	async function insertTemplateLayout(templateId, slideOrdinals) {
		if (!catalogRepository)
			return { ok: false, message: 'The catalog is not configured for this site.' };
		try {
			const layout = await loadTemplateLayout({
				catalogRepository,
				templateId,
				slideOrdinals
			});
			const outcome = await saving.persistSlides({
				slides: layout.slides,
				assets: layout.assets,
				media: layout.media
			});
			if (!outcome.ok) return { ok: false, message: outcome.message };
			editorNote = 'Template slides inserted.';
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error ? error.message : 'The slides could not be inserted.'
			};
		}
	}

	/**
	 * The way out of a stale revision: keep the local work as a copy, then re-open
	 * the newer stored revision so Save is no longer dead.
	 */
	async function recoverFromConflict() {
		recovering = true;
		editorNote = null;
		let reopened = false;
		try {
			const outcome = await saving.keepMineAsCopy();
			if (!outcome.ok) {
				editorNote = outcome.message;
				return;
			}
			// The store holds the newer revision from here on; only its artwork is left.
			reopened = true;
			await reloadStoredArtwork();
			editorNote =
				'Your work was saved as a separate conflict copy. The newer saved version is open now.';
		} catch {
			editorNote = reopened
				? 'Your work was saved as a separate conflict copy, and the newer saved version is open — but its artwork could not be shown yet. Reload this page to see it.'
				: 'The newer version could not be reopened. Reload this page to continue.';
		} finally {
			recovering = false;
		}
	}

	/** @param {MouseEvent} event */
	async function leave(event) {
		event.preventDefault();
		editorNote = null;
		if (await saving.saveBeforeLeave()) await onback();
		else
			editorNote =
				'This presentation could not be saved, so it is still open. Press Save to try again — or press Keep my copy if another tab or window has a newer version.';
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.defaultPrevented) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest(SHORTCUT_EXEMPT)) return;
		if (
			(event.key === 'Delete' || event.key === 'Backspace') &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey
		) {
			const state = store.getState();
			const id = state.view.selectedElementIds[0];
			if (!id || state.view.editingElementId) return;
			event.preventDefault();
			state.removeElement(id);
			return;
		}
		if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) {
			const state = store.getState();
			if (state.view.selectedElementIds.length === 0) return;
			event.preventDefault();
			state.selectElements([]);
			return;
		}
		if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
		const key = event.key.toLowerCase();
		const state = store.getState();
		if (key === 'd' && !event.shiftKey && state.view.selectedElementIds[0]) {
			event.preventDefault();
			state.duplicateElement(state.view.selectedElementIds[0]);
			return;
		}
		if (key !== 'z' && key !== 'y') return;
		event.preventDefault();
		// Ctrl/Cmd+Shift+Z and Ctrl+Y both redo; plain Ctrl/Cmd+Z undoes.
		if (key === 'y' || event.shiftKey) state.redo();
		else state.undo();
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onbeforeunload={(event) => {
		const state = store.getState();
		if (!state.dirty || state.document?.id !== presentationId) return;
		event.preventDefault();
		event.returnValue = '';
	}}
	onpagehide={() => {
		// A template version is only ever created deliberately (or by the leave
		// guard, which can report back); the unload path cannot.
		if (!templateMode) void saving.save();
	}}
/>

{#if loadState === 'loading'}
	<section class="card presentation-route-state">
		<p role="status">Opening presentation…</p>
	</section>
{:else if loadState !== 'ready' || !presentation}
	<section class="card presentation-route-state">
		<ShieldAlert size={34} aria-hidden="true" />
		<h1>
			{loadState === 'missing'
				? 'Presentation not found'
				: loadState === 'missing-media'
					? 'Presentation artwork is missing'
					: loadState === 'unsupported'
						? 'This presentation needs a newer StickerLab'
						: 'Presentation could not be opened'}
		</h1>
		<p>
			{loadState === 'missing'
				? 'It may have been removed from this browser.'
				: loadState === 'missing-media'
					? 'This browser no longer has the saved artwork for this presentation. Retry, or open it from the library after restoring your local data.'
					: loadState === 'unsupported'
						? 'This saved file uses a document version this app cannot safely edit.'
						: (loadMessage ?? 'This presentation could not be opened.')}
		</p>
		{#if loadState === 'error' && loadFailure}<p class="muted [color:var(--muted)]">
				{loadFailure.message}
			</p>{/if}
		<div class="button-row [display:flex] [flex-wrap:wrap] [gap:8px]">
			<a class={buttonPrimary} href={backhref}>Back to presentations</a>
			{#if loadState !== 'missing' && loadState !== 'unsupported'}<button
					type="button"
					class={button}
					onclick={() => (attempt += 1)}>Try again</button
				>{/if}
		</div>
	</section>
{:else}
	<div class="presentation-editor">
		<header class="presentation-editor-bar">
			<div class="presentation-editor-heading">
				<a class={buttonIcon} aria-label="Back to presentations" href={backhref} onclick={leave}
					><ArrowLeft size={19} /></a
				>
				<div class="presentation-editor-title">
					<p>{templateMode ? 'Template draft' : 'Presentation'}</p>
					<h1 title={presentation.title}>{presentation.title}</h1>
				</div>
				<p class="presentation-local-status" role="status" title={saveState.message ?? undefined}>
					{editorNote ?? saveStatus}
				</p>
				<button type="button" class={button} onclick={requestSave}
					><Save size={16} aria-hidden="true" /> {templateMode ? 'Save version' : 'Save'}</button
				>
			</div>
			<div class="presentation-editor-actions" role="group" aria-label="Presentation tools">
				<button
					type="button"
					class={buttonIcon}
					aria-label="Undo"
					title="Undo (Ctrl+Z)"
					disabled={!canUndo}
					onclick={() => store.getState().undo()}><Undo2 size={17} aria-hidden="true" /></button
				>
				<button
					type="button"
					class={buttonIcon}
					aria-label="Redo"
					title="Redo (Ctrl+Shift+Z)"
					disabled={!canRedo}
					onclick={() => store.getState().redo()}><Redo2 size={17} aria-hidden="true" /></button
				>
				{#if !templateMode}
					<ExportDialog
						{exportState}
						offline={offline.snapshot}
						reloadSafety={{ unsavedWork: editorState.dirty, saveFailed: saveReported }}
						onexport={(format) => void exportController.exportDeck(format)}
						oncancel={() => exportController.cancel()}
					/>
				{/if}
				<label class="presentation-add-shape"
					><span class="sr-only">Add shape</span><select
						aria-label="Add shape"
						value=""
						onchange={(event) => {
							const kind =
								/** @type {import('$lib/presentations/editor/shapeTools').ShapeInsertKind | ''} */ (
									event.currentTarget.value
								);
							event.currentTarget.value = '';
							if (kind) addShape(kind);
						}}
						><option value="">Add shape…</option><option value="rectangle">Rectangle</option><option
							value="rounded-rectangle">Rounded rectangle</option
						><option value="ellipse">Ellipse</option><option value="line">Line</option><option
							value="arrow">Arrow</option
						></select
					></label
				>
				<span class="presentation-add-text">
					<button type="button" class={button} onclick={() => addTextBox('heading')}
						>Add heading</button
					>
					<button type="button" class={button} onclick={() => addTextBox('subheading')}
						>Add subheading</button
					>
					<button type="button" class={button} onclick={() => addTextBox('body')}
						>Add body text</button
					>
					<button type="button" class={button} onclick={() => addTextBox()}
						><Type size={16} aria-hidden="true" /> Add text</button
					>
				</span>
				{#if !templateMode}
					<button
						type="button"
						class={button}
						disabled={inserting}
						onclick={() => {
							replaceTargetId = null;
							imageInput?.click();
						}}
						><ImagePlus size={16} aria-hidden="true" />
						{inserting ? 'Adding image…' : 'Add image'}</button
					>
				{/if}
				{#if catalogRepository}<CatalogPickerDialog
						repository={catalogRepository}
						disabled={inserting}
						oninsert={addCatalogImage}
					/>{/if}
				{#if catalogRepository && !templateMode}<InsertTemplateDialog
						repository={catalogRepository}
						disabled={inserting}
						oninsert={insertTemplateLayout}
					/>{/if}
				{#if catalogAdminRepository && !templateMode}<SaveAsTemplateDialog
						repository={catalogAdminRepository}
						needsCollection={presentation.assets.some(
							(asset) => asset.provenance.source !== 'catalog'
						)}
						defaultTitle={presentation.title}
						onsave={(input) => saveAsTemplate(input)}
					/>{/if}
				{#if stickerRepository && !templateMode}<StickerPickerDialog
						repository={stickerRepository}
						disabled={inserting}
						onpick={(projectId) => void addSticker(projectId)}
					/>{/if}
				{#if !templateMode}
					<input
						bind:this={imageInput}
						class="sr-only"
						type="file"
						accept="image/png,image/jpeg,image/webp"
						aria-label="Choose image file"
						data-testid="presentation-image-input"
						onchange={(event) => {
							const input = event.currentTarget;
							const file = input.files?.[0];
							input.value = '';
							if (!file) return;
							if (replaceTargetId) void replacePhoto(file);
							else void addImage(file);
						}}
					/>
				{/if}
				{#if selectedText}<button
						type="button"
						class={button}
						aria-label="Edit text: {selectedText.name}"
						onclick={() => store.getState().startTextEdit(selectedText.id)}
						><PenLine size={16} aria-hidden="true" /> Edit text</button
					>{/if}
				{#if selectedElement}
					<!-- The wide pane is hidden from 1150px down, so the same numeric fields
					     stay reachable through the shared dialog at tablet and phone widths. -->
					<button
						type="button"
						class={[button, 'properties-toggle']}
						bind:this={propertiesOpener}
						onclick={() => (propertiesOpen = true)}>Element properties</button
					>
				{/if}
				<button
					type="button"
					class={button}
					bind:this={themeOpener}
					onclick={() => (themeOpen = true)}>Theme</button
				>
				{#if saveState.status === 'conflict' && templateMode}
					<button
						type="button"
						class={button}
						title="Discard your changes and load the newest saved draft"
						onclick={reloadDraft}>Reload draft (discards my changes)</button
					>
				{:else if saveState.status === 'conflict'}
					<button
						type="button"
						class={button}
						disabled={recovering}
						onclick={() => void recoverFromConflict()}
						>{recovering ? 'Keeping your copy…' : 'Keep my copy'}</button
					>
				{/if}
				{#if saveReported && !templateMode}
					<!-- Recovery guidance: if the local write fails, the work can still leave
					     the browser as a backup archive. -->
					<button
						type="button"
						class={button}
						onclick={() => void exportController.exportDeck('backup')}>Download backup</button
					>
				{/if}
			</div>
			{#if saveReported || editorNote}<p
					class="presentation-editor-feedback"
					role={saveReported ? 'alert' : 'status'}
				>
					{editorNote ?? saveState.message ?? saveStatus}
				</p>{/if}
		</header>
		{#if editorState.view.editingElementId}<TextFormatToolbar session={textSession} />{/if}
		{#if insertError}<p class="asset-error" role="alert">{insertError}</p>{/if}
		<div class="presentation-mobile-note [display:none]">
			<MonitorUp size={18} aria-hidden="true" />
			<span
				>Presentation authoring is designed for a laptop or desktop. This preview remains available
				on your phone.</span
			>
		</div>
		<div
			class="presentation-workspace [display:grid] [min-height:0] [min-width:0] [flex:1] [grid-template-columns:168px_minmax(0,_1fr)_220px]"
		>
			<aside
				class="presentation-slide-rail [border-right:1px_solid_var(--line)]"
				aria-label="Slides"
			>
				<p>Slides</p>
				<p class="slide-order-hint">Drag · Alt+↑/↓</p>
				<span id="slide-order-hint" class="sr-only"
					>Drag to reorder. On touchscreens, use the handle at the top left of a slide. Or focus the
					slide and press Alt plus the up or down arrow key.</span
				>
				<div
					class="presentation-slide-rail-actions [margin-bottom:var(--space-3)] [display:grid] [gap:var(--space-2)]"
				>
					<button
						type="button"
						class={button}
						aria-label="Add slide"
						title="Add slide"
						onclick={addSlide}><Plus size={16} aria-hidden="true" /><span>Add slide</span></button
					>
					<BuiltinLayoutDialog
						theme={presentation.theme}
						disabled={inserting}
						oninsert={addBuiltinLayout}
					/>
					<button
						type="button"
						class={button}
						aria-label="Duplicate active slide"
						title="Duplicate active slide"
						onclick={duplicateActiveSlide}
						><Copy size={16} aria-hidden="true" /><span>Duplicate</span></button
					>
				</div>
				<div class="presentation-slide-list">
					{#each presentation.slides as slide, index (slide.id)}
						<div
							class="presentation-slide-item [min-width:0]"
							class:is-dragging={draggingSlideId === slide.id}
						>
							<button
								type="button"
								class="presentation-slide-card"
								data-slide-id={slide.id}
								data-drop-position={dropSlideId === slide.id ? dropPosition : undefined}
								aria-current={slide.id === activeSlide?.id ? 'true' : undefined}
								aria-label="Show slide {index + 1}: {slide.name}"
								aria-describedby="slide-order-hint"
								ondragstart={(event) => event.preventDefault()}
								onpointerdown={(event) => startSlideDrag(slide.id, event)}
								onpointermove={moveSlideDrag}
								onpointerup={(event) => finishSlideDrag(event, true)}
								onpointercancel={(event) => finishSlideDrag(event, false)}
								onkeydown={(event) => slideKeyDown(slide.id, event)}
								onclick={() => {
									if (!suppressSlideClick) store.getState().selectSlide(slide.id);
								}}
								{@attach registerSlideButton(slide.id)}
							>
								<SlideRailPreview {slide} pageSize={presentation.pageSize} {images} />
								<b>{slide.name}</b>
							</button>
							<button
								type="button"
								class="presentation-slide-grip"
								aria-label="Drag slide {index + 1} to reorder"
								aria-describedby="slide-order-hint"
								onpointerdown={(event) => startSlideDrag(slide.id, event)}
								onpointermove={moveSlideDrag}
								onpointerup={(event) => finishSlideDrag(event, true)}
								onpointercancel={(event) => finishSlideDrag(event, false)}
								><GripVertical size={16} aria-hidden="true" /></button
							>
							<button
								type="button"
								class="presentation-slide-delete"
								aria-label="Delete slide {index + 1}"
								title="Delete slide {index + 1}"
								disabled={presentation.slides.length <= 1}
								onclick={() => deleteSlide(slide.id)}
								><Trash2 size={16} aria-hidden="true" /></button
							>
						</div>
					{/each}
				</div>
				<p>Elements</p>
				<ElementLayerList {store} />
			</aside>
			{#if PresentationCanvas}
				<PresentationCanvas {store} {images} session={textSession} />
			{:else}
				<!-- Holds the canvas track and its panel tone until Konva arrives. -->
				<div
					class="presentation-canvas-placeholder [min-height:0] [min-width:0] [background:#dfe8e6]"
				></div>
			{/if}
			<aside
				class="presentation-inspector [border-left:1px_solid_var(--line)]"
				aria-label="Presentation details"
			>
				<p>Page</p>
				<dl>
					<div>
						<dt>Size</dt>
						<dd>{presentation.pageSize.width} × {presentation.pageSize.height}</dd>
					</div>
					<div>
						<dt>Slides</dt>
						<dd>{presentation.slides.length}</dd>
					</div>
					<div>
						<dt>Elements</dt>
						<dd>{activeSlide?.elements.length ?? 0}</dd>
					</div>
				</dl>
				{#if activeSlide}
					<label
						class="presentation-slide-background [margin-bottom:var(--space-5)] [display:grid] [gap:var(--space-1)] [font-size:11px] [font-weight:700] [color:var(--muted)]"
					>
						Slide background
						<input
							type="color"
							aria-label="Slide background"
							value={activeSlide.background}
							oninput={(event) =>
								store.getState().setSlideBackground(activeSlide.id, event.currentTarget.value, {
									historyGroup: `slide-bg:${activeSlide.id}`
								})}
							onblur={() => store.getState().endHistoryGroup()}
						/>
					</label>
				{/if}
				{#if selectedElement}
					<p>{selectedElement.name || 'Element'}</p>
					<ElementGeometryInspector
						element={selectedElement}
						{store}
						onreplaceimage={templateMode ? undefined : beginReplaceImage}
					/>
				{/if}
				<p class="muted [color:var(--muted)]">
					Drag an element to move it. Use a corner handle to resize and the round handle to rotate.
					Delete removes it, Ctrl+D duplicates it, and Escape clears the selection. Type a value
					above for exact placement.
				</p>
			</aside>
		</div>
	</div>

	<Modal
		open={propertiesOpen}
		title="Element properties"
		description="Exact document values for the selected element. Typing here is the keyboard path to the same numbers the canvas handles produce."
		onclose={() => (propertiesOpen = false)}
		onclosed={() => propertiesOpener?.focus()}
	>
		{#if selectedElement}<ElementGeometryInspector
				element={selectedElement}
				{store}
				onreplaceimage={templateMode ? undefined : beginReplaceImage}
			/>{/if}
	</Modal>

	<Modal
		open={themeOpen}
		title="Presentation theme"
		description="Defaults for new slides and text. Existing elements keep their own styles."
		onclose={() => (themeOpen = false)}
		onclosed={() => themeOpener?.focus()}
	>
		<ThemeControls
			theme={presentation.theme}
			onchange={(next) => store.getState().setTheme(next, { historyGroup: 'theme' })}
			onendgroup={() => store.getState().endHistoryGroup()}
		/>
	</Modal>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.card {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
	}
	.asset-error {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--cream);
		color: var(--ink);
		font-size: 13px;
	}

	.presentation-route-state {
		display: grid;
		min-height: 100%;
		place-content: center;
		justify-items: center;
		gap: var(--space-4);
		padding: var(--space-7);
		text-align: center;
	}
	.presentation-route-state h1 {
		margin: 0;
	}
	.presentation-route-state p {
		margin: 0;
	}
	.presentation-route-state p {
		max-width: 58ch;
		color: var(--muted);
	}
	.presentation-editor {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		background: #f2f6f5;
	}
	/* Keep the deck title and Save fixed. Tools have their own single scrollable
	 * row so selecting an element or changing the save status never shifts the slide. */
	.presentation-editor-bar {
		display: flex;
		min-width: 0;
		flex-direction: column;
		border-bottom: 1px solid var(--line);
		background: var(--surface);
	}
	.presentation-editor-heading {
		display: flex;
		min-width: 0;
		min-height: 52px;
		align-items: center;
		gap: var(--space-3);
		padding: 5px var(--space-4);
	}
	.presentation-editor-heading > .button {
		flex: none;
	}
	.presentation-editor-actions {
		display: flex;
		min-width: 0;
		width: 100%;
		align-items: center;
		gap: var(--space-2);
		overflow-x: auto;
		overflow-y: hidden;
		padding: 5px var(--space-4) 8px;
		border-top: 1px solid var(--line);
		scrollbar-width: thin;
	}
	.presentation-editor-actions > :global(*) {
		flex: none;
	}
	.presentation-editor-actions :global(.button) {
		white-space: nowrap;
	}
	.presentation-add-text {
		display: inline-flex;
		flex: none;
		gap: var(--space-2);
	}
	.presentation-editor-title {
		flex: 1 1 auto;
		min-width: 0;
	}
	.presentation-editor-title p {
		margin: 0;
	}
	.presentation-editor-title h1 {
		margin: 0;
	}
	.presentation-editor-title p {
		color: var(--muted);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.presentation-editor-title h1 {
		max-width: 100%;
		overflow: hidden;
		font-size: 18px;
		line-height: 1.3;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-local-status {
		flex: 0 1 30ch;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		color: #007b55;
		font-size: 12px;
		font-weight: 800;
		text-align: right;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-editor-feedback {
		margin: 0;
		padding: 8px var(--space-4);
		background: var(--warning-bg);
		color: var(--warning-ink);
		font-size: 12px;
	}
	.presentation-add-shape select {
		min-height: 36px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
	.presentation-slide-background input {
		width: 100%;
		min-height: 36px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
	}
	.presentation-slide-rail {
		min-height: 0;
		padding: var(--space-4);
		overflow: auto;
		background: var(--surface);
	}
	.presentation-inspector {
		min-height: 0;
		padding: var(--space-4);
		overflow: auto;
		background: var(--surface);
	}
	.presentation-slide-rail > p {
		margin: 0 0 var(--space-3);
		color: var(--muted);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.presentation-slide-rail > .slide-order-hint {
		font-weight: 500;
		letter-spacing: 0;
		line-height: 1.4;
		text-transform: none;
	}
	.presentation-inspector > p:not(.muted) {
		margin: 0 0 var(--space-3);
		color: var(--muted);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.presentation-slide-rail-actions .button {
		width: 100%;
		min-height: 38px;
		justify-content: flex-start;
		padding: 8px;
		font-size: 11px;
	}
	.presentation-slide-list {
		display: grid;
		gap: var(--space-3);
	}
	.presentation-slide-item {
		position: relative;
	}
	.presentation-slide-item.is-dragging {
		opacity: 0.6;
	}
	.presentation-slide-card {
		display: grid;
		width: 100%;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 2px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		text-align: left;
		cursor: grab;
		touch-action: pan-x pan-y;
	}
	.presentation-slide-card:active {
		cursor: grabbing;
	}
	.presentation-slide-card[data-drop-position='before'] {
		box-shadow: 0 -4px 0 var(--mint);
	}
	.presentation-slide-card[data-drop-position='after'] {
		box-shadow: 0 4px 0 var(--mint);
	}
	.presentation-slide-card:hover {
		border-color: var(--mint);
	}
	.presentation-slide-card[aria-current] {
		border-color: var(--mint);
		background: var(--pale);
	}
	.presentation-slide-card:focus-visible {
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}

	.presentation-slide-card b {
		overflow: hidden;
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-slide-grip {
		position: absolute;
		top: 5px;
		left: 5px;
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--muted);
		box-shadow: var(--shadow);
		cursor: grab;
		touch-action: none;
		opacity: 0;
		transition: opacity 150ms ease;
	}
	.presentation-slide-item:hover .presentation-slide-grip,
	.presentation-slide-item:focus-within .presentation-slide-grip {
		opacity: 1;
	}
	.presentation-slide-grip:focus-visible {
		opacity: 1;
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	.presentation-slide-delete {
		position: absolute;
		top: 5px;
		right: 5px;
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border: 1px solid var(--danger-line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--danger);
		box-shadow: var(--shadow);
		cursor: pointer;
		opacity: 0;
		transition: opacity 150ms ease;
	}
	.presentation-slide-item:hover .presentation-slide-delete,
	.presentation-slide-item:focus-within .presentation-slide-delete {
		opacity: 1;
	}
	.presentation-slide-delete:focus-visible {
		opacity: 1;
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	.presentation-slide-delete:hover:not(:disabled) {
		background: var(--danger-tint);
		color: var(--danger-strong);
	}
	.presentation-slide-delete:disabled {
		cursor: not-allowed;
	}
	.presentation-slide-item:hover .presentation-slide-delete:disabled,
	.presentation-slide-item:focus-within .presentation-slide-delete:disabled {
		opacity: 0.5;
	}
	@media (hover: none) {
		.presentation-slide-grip,
		.presentation-slide-card[aria-current] ~ .presentation-slide-delete {
			opacity: 1;
		}
	}
	.presentation-inspector dl {
		display: grid;
		gap: var(--space-3);
		margin: 0 0 var(--space-5);
	}
	.presentation-inspector dl div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
		font-size: 12px;
	}
	.presentation-inspector dt {
		color: var(--muted);
	}
	.presentation-inspector dd {
		margin: 0;
		font-weight: 800;
	}
	.presentation-inspector .muted {
		margin-top: var(--space-5);
		font-size: 12px;
	}
	@media (max-width: 1150px) {
		.presentation-workspace {
			grid-template-columns: 148px minmax(0, 1fr);
		}
		.presentation-inspector {
			display: none;
		}
	}
	@media (max-width: 720px) {
		.presentation-editor {
			min-height: calc(100dvh - var(--header-height));
		}
		.presentation-editor-heading {
			gap: var(--space-2);
			padding-inline: var(--space-3);
		}
		.presentation-editor-heading > .button {
			min-height: 40px;
			padding-inline: var(--space-2);
		}
		.presentation-local-status {
			flex-basis: 7ch;
			font-size: 10px;
		}
		.presentation-editor-actions {
			padding-inline: var(--space-3);
		}
		.presentation-editor-title h1 {
			display: -webkit-box;
			overflow: hidden;
			white-space: normal;
			overflow-wrap: anywhere;
			-webkit-box-orient: vertical;
			line-clamp: 2;
			-webkit-line-clamp: 2;
		}
		.presentation-mobile-note {
			display: flex;
			align-items: flex-start;
			gap: var(--space-2);
			padding: var(--space-3) var(--space-4);
			border-bottom: 1px solid #d8e4df;
			background: var(--pale);
			color: #315b4e;
			font-size: 12px;
			line-height: 1.5;
		}
		.presentation-workspace {
			display: block;
			min-height: 0;
			flex: 1;
		}
		.presentation-slide-rail {
			display: block;
			padding: var(--space-3) var(--space-4);
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
		.presentation-inspector {
			display: none;
		}
		.presentation-slide-rail-actions {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.presentation-slide-list {
			display: flex;
			min-width: 0;
			gap: var(--space-3);
			overflow-x: auto;
			padding-bottom: var(--space-1);
			scrollbar-width: thin;
		}
		.presentation-slide-item {
			flex: 0 0 144px;
		}
		.presentation-slide-grip {
			opacity: 1;
		}
		.presentation-slide-card[data-drop-position='before'] {
			box-shadow: -4px 0 0 var(--mint);
		}
		.presentation-slide-card[data-drop-position='after'] {
			box-shadow: 4px 0 0 var(--mint);
		}
	}
</style>
