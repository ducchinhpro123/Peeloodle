<script>
	import { tick } from 'svelte';
	import { button, buttonIcon, buttonPrimary } from '#lib/ui/styles.js';
	import {
		ArrowLeft,
		Home,
		Copy,
		GripVertical,
		ImagePlus,
		MonitorUp,
		PenLine,
		Plus,
		Save,
		ShieldAlert,
		Trash2,
		Type
	} from 'lucide-svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { shellHref } from '#lib/app/navigation.js';
	import { isPersistenceError } from '#lib/persistence/repository.js';
	import { isPresentationParseError } from '#lib/presentations/model/parse.js';
	import { createPresetText } from '#lib/presentations/editor/textPresets.js';
	import { createBuiltinLayout } from '#lib/presentations/templates/builtinLayouts.js';
	import BuiltinLayoutDialog from './BuiltinLayoutDialog.svelte';
	import SlideRailPreview from './SlideRailPreview.svelte';
	import { ensurePresentationFonts } from '#lib/presentations/rendering/fonts.js';
	import { createDecodedArtwork } from '#lib/presentations/rendering/decodedArtwork.js';
	import {
		preparePresentationImage,
		PrepareImageError
	} from '#lib/presentations/editor/insertImageAsset.js';
	import { prepareStickerSnapshot } from '#lib/presentations/editor/insertStickerSnapshot.js';
	import { createSlideShape } from '#lib/presentations/editor/shapeTools.js';
	import { createSlideEditor } from '#lib/presentations/editor/createSlideEditor.svelte.js';
	import { setSlideEditor } from '#lib/presentations/editor/context.js';
	import { attachKeymap } from '#lib/presentations/editor/actions/keymap.js';
	import { attachFocusNavigation } from '#lib/presentations/editor/focusNavigation.js';
	import { PRESENTATION_LIMITS } from '#lib/presentations/model/limits.js';
	import ActionMenu from './shell/ActionMenu.svelte';
	import AlignMenu from './shell/AlignMenu.svelte';
	import ActionButton from './shell/ActionButton.svelte';
	import StatusBar from './shell/StatusBar.svelte';
	import Ribbon from './shell/Ribbon.svelte';
	import RibbonGroup from './shell/RibbonGroup.svelte';
	import ShapeStyleInspector from './ShapeStyleInspector.svelte';
	import ImageAdjustInspector from './ImageAdjustInspector.svelte';
	import TaskPane from './panes/TaskPane.svelte';
	import MessageBar from './shell/MessageBar.svelte';
	import { OK } from '#lib/presentations/editor/actions/registry.js';
	import { usePresentationOfflineReadiness } from '#lib/presentations/presentationOffline.svelte.js';
	import ElementLayerList from './ElementLayerList.svelte';
	import ElementGeometryInspector from './ElementGeometryInspector.svelte';
	import TextFormatToolbar from './TextFormatToolbar.svelte';
	import ThemeControls from './ThemeControls.svelte';
	import StickerPickerDialog from './StickerPickerDialog.svelte';
	import CatalogPickerDialog from './CatalogPickerDialog.svelte';
	import {
		prepareCatalogAsset,
		CatalogInsertError
	} from '#lib/presentations/editor/insertCatalogAsset.js';
	import ExportDialog from './ExportDialog.svelte';
	import SaveAsTemplateDialog from './SaveAsTemplateDialog.svelte';
	import { saveAsTemplateDraft } from '#lib/presentations/templates/saveAsTemplateDraft.js';
	import { localPolicy } from '#lib/presentations/editor/persistence/policies.js';
	import { loadTemplateLayout } from '#lib/presentations/templates/templateLayout.js';
	import InsertTemplateDialog from './InsertTemplateDialog.svelte';

	/**
	 * @typedef {(
	 *   kind: 'move' | 'resize' | 'rotate',
	 *   handle: import('#lib/presentations/editor/transformGeometry.js').ResizeHandle | null,
	 *   event: PointerEvent
	 * ) => void} GestureStarter
	 */

	// Native <dialog> elements have no role attribute, so they are listed by tag.
	const SHORTCUT_EXEMPT =
		'input, textarea, select, [contenteditable="true"], [role="slider"], [data-slot="slider"], [role="dialog"], dialog, [role="menu"]';

	/** @type {{
	 *   presentationId: string,
	 *   repository: import('#lib/presentations/persistence/repository.js').PresentationRepository,
	 *   stickerRepository?: import('#lib/persistence/repository.js').StickerLabRepository | null,
	 *   catalogRepository?: import('#lib/catalog/repository.js').CatalogRepository | null,
	 *   catalogAdminRepository?: import('#lib/catalog/repository.js').CatalogAdminRepository | null,
	 *   backhref: string,
	 *   onback: () => void | Promise<void>,
	 *   policy?: import('#lib/presentations/editor/persistence/policies.js').EditorPolicy,
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
		backhref,
		onback,
		policy = localPolicy,
		onreload = null,
		// `$bindable` compiles to a prop getter/setter, so this component only ever
		// publishes the guard; the route reads it back through the binding, which
		// leaves the initial value unread here.
		leaveguard = $bindable(null)
	} = $props();

	// The route keys this page on the presentation id, so a different document
	// remounts the component (and creates a fresh editor) instead of reassigning props.
	// svelte-ignore state_referenced_locally
	const editor = createSlideEditor({
		presentationId,
		repository,
		// Template mode writes catalog versions, so a local-storage failure message
		// would be wrong: the adapter's own wording is shown instead.
		describeFailure: policy.describeFailure,
		conflictMessage: policy.conflictMessage
	});
	setSlideEditor(editor);
	$effect(() => attachKeymap(editor.actions, window, { exempt: SHORTCUT_EXEMPT }));

	const {
		doc,
		selection,
		viewport,
		interaction,
		persistence: saving,
		exports: exportController,
		text: textSession
	} = editor;

	/** @type {{ x: number, y: number, trigger: HTMLElement, items: string[], label: string } | null} */
	let contextMenu = $state(null);
	const elementMenuItems = [
		'clipboard.cut',
		'clipboard.copy',
		'clipboard.paste',
		'element.duplicate',
		'element.delete',
		'arrange.bringForward',
		'arrange.sendBackward',
		'element.toggleLock',
		'element.editText',
		'element.replacePicture',
		'element.format',
		'align.left',
		'align.center-horizontal',
		'align.right',
		'align.top',
		'align.middle-vertical',
		'align.bottom',
		'distribute.horizontal',
		'distribute.vertical'
	];
	/** @param {number} x @param {number} y @param {HTMLElement} trigger */
	function openCanvasMenu(x, y, trigger) {
		contextMenu = {
			x,
			y,
			trigger,
			items: selection.ids.length
				? elementMenuItems
				: ['clipboard.paste', 'selection.selectAll', 'slide.add', 'slide.formatBackground'],
			label: selection.ids.length ? 'Element actions' : 'Canvas actions'
		};
	}
	/** @param {boolean} background */
	function showFormat(background = false) {
		setPaneState({ ...paneState, open: true, format: true });
		void tick().then(() => {
			const selector = background
				? '.presentation-slide-background input'
				: '.presentation-geometry-fields input';
			/** @type {HTMLInputElement | null} */ (document.querySelector(selector))?.focus();
		});
	}

	function closeContextMenu(restore = true) {
		const trigger = contextMenu?.trigger;
		contextMenu = null;
		if (restore) {
			if (trigger?.isConnected) trigger.focus();
			else
				/** @type {HTMLButtonElement | null} */ (
					document.querySelector('.presentation-slide-card[aria-current="true"]')
				)?.focus();
		}
	}
	/** @param {HTMLDivElement} root */
	function editorInteractions(root) {
		const detachFocus = attachFocusNavigation(root, () => {
			closeContextMenu(false);
			textSession.flush();
			selection.endTextEdit();
		});
		/** @param {EventTarget | null} target */
		const belongsToEditor = (target) =>
			target instanceof Node && (target === document.body || root.contains(target));
		/** @param {ClipboardEvent} event */
		const paste = (event) => {
			if (event.defaultPrevented || !belongsToEditor(event.target)) return;
			if (event.target instanceof HTMLElement && event.target.closest(SHORTCUT_EXEMPT)) return;
			if (!event.clipboardData) return;
			event.preventDefault();
			editor.messages.clear();
			editor.clipboard.pasteData(event.clipboardData);
		};
		/** @param {MouseEvent | KeyboardEvent} event */
		const menu = (event) => {
			if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
			if (
				event instanceof KeyboardEvent &&
				event.key !== 'ContextMenu' &&
				!(event.key === 'F10' && event.shiftKey)
			)
				return;
			const slide = event.target.closest('.presentation-slide-card');
			const layer = event.target.closest('.presentation-layer-item');
			if (!slide && !layer) return;
			event.preventDefault();
			const trigger = /** @type {HTMLElement} */ (
				slide ?? layer?.querySelector('.presentation-layer-select')
			);
			if (slide) {
				const id = slide.getAttribute('data-slide-id');
				if (id) selection.selectSlide(id);
			} else {
				const id = layer?.getAttribute('data-element-id');
				if (id && !selection.ids.includes(id)) selection.select([id]);
			}
			const rect = trigger.getBoundingClientRect();
			const pointer = event instanceof MouseEvent && event.button === 2;
			contextMenu = {
				x: pointer ? event.clientX : rect.left + 12,
				y: pointer ? event.clientY : rect.top + 12,
				trigger,
				items: slide
					? ['slide.add', 'slide.duplicate', 'slide.delete', 'slide.moveUp', 'slide.moveDown']
					: elementMenuItems,
				label: slide ? 'Slide actions' : 'Element actions'
			};
		};
		/** @param {ClipboardEvent} event */
		const copy = (event) => {
			if (event.defaultPrevented || !belongsToEditor(event.target)) return;
			if (event.target instanceof HTMLElement && event.target.closest(SHORTCUT_EXEMPT)) return;
			if (event.clipboardData && editor.clipboard.copy(event.type === 'cut', event.clipboardData))
				event.preventDefault();
		};
		document.addEventListener('copy', copy);
		document.addEventListener('cut', copy);
		document.addEventListener('paste', paste);
		root.addEventListener('contextmenu', menu);
		root.addEventListener('keydown', menu);
		return () => {
			detachFocus();
			document.removeEventListener('copy', copy);
			document.removeEventListener('cut', copy);
			document.removeEventListener('paste', paste);
			root.removeEventListener('contextmenu', menu);
			root.removeEventListener('keydown', menu);
		};
	}
	editor.clipboard.configure({
		text(value) {
			const document = doc.document;
			if (!document || !activeSlide) return;
			try {
				const id = doc.addElement(createPresetText('body', document.theme, value));
				if (!id)
					editor.messages.show('This slide cannot hold another text box. Remove an element first.');
			} catch {
				editor.messages.show('This text could not be pasted. Try copying a shorter passage.');
			}
		},
		image(file) {
			if (!policy.capabilities.localMedia) {
				editor.messages.show('Paste images from the catalog when editing a template.');
				return;
			}
			return addImage(file);
		}
	});

	let ribbonTab = $state('home');
	let ribbonCollapsed = $state(false);

	const PANE_KEY = 'stickerlab_slide_editor_pane';
	/** @typedef {{ open: boolean, format: boolean, selection: boolean }} PaneState */
	/** @returns {PaneState} */
	function readPaneState() {
		const fallback = { open: true, format: true, selection: true };
		if (typeof localStorage === 'undefined') return fallback;
		try {
			const stored = JSON.parse(localStorage.getItem(PANE_KEY) ?? 'null');
			if (
				stored &&
				typeof stored.open === 'boolean' &&
				typeof stored.format === 'boolean' &&
				typeof stored.selection === 'boolean'
			)
				return stored;
		} catch {
			// A corrupt preference falls back to the default layout.
		}
		return fallback;
	}
	let paneState = $state(readPaneState());
	/** @param {PaneState} next */
	function setPaneState(next) {
		paneState = next;
		try {
			localStorage.setItem(PANE_KEY, JSON.stringify(next));
		} catch {
			// Storage can be unavailable (private mode); the layout still applies now.
		}
	}
	/** Shows a closed pane section, or hides an open one; no sections left closes the pane. */
	/** @param {'format' | 'selection'} section */
	function togglePaneSection(section) {
		if (!paneState.open) {
			setPaneState({ ...paneState, open: true, [section]: true });
			return;
		}
		const next = { ...paneState, [section]: !paneState[section] };
		setPaneState({ ...next, open: next.format || next.selection });
	}
	/** Contextual tabs exist only while their kind of element is selected. */
	const ribbonTabs = $derived([
		{ id: 'home', label: 'Home' },
		{ id: 'insert', label: 'Insert' },
		{ id: 'design', label: 'Design' },
		{ id: 'arrange', label: 'Arrange' },
		{ id: 'view', label: 'View' },
		...(selection.primary?.kind === 'shape'
			? [{ id: 'shapeFormat', label: 'Shape Format', contextual: true }]
			: []),
		...(selection.primary?.kind === 'image'
			? [{ id: 'pictureFormat', label: 'Picture Format', contextual: true }]
			: [])
	]);

	/** @param {string} id A tab id, or `toggle:<id>` from a double-click. */
	function selectRibbonTab(id) {
		if (id.startsWith('toggle:')) {
			ribbonTab = id.slice('toggle:'.length);
			ribbonCollapsed = !ribbonCollapsed;
			return;
		}
		ribbonTab = id;
		ribbonCollapsed = false;
	}

	// Text formatting lives on Home, so starting a text edit brings Home forward.
	$effect(() => {
		if (selection.editingId) ribbonTab = 'home';
	});

	editor.actions.register([
		{
			id: 'element.editText',
			label: 'Edit text',
			available: () => selection.ids.length === 1 && selection.primary?.kind === 'text',
			enabled: () => !selection.primary?.locked && !selection.editingId,
			run: () => {
				if (selection.primary) selection.startTextEdit(selection.primary.id);
				return OK;
			}
		},
		{
			id: 'element.replacePicture',
			label: 'Replace picture',
			available: () =>
				policy.capabilities.localMedia &&
				selection.ids.length === 1 &&
				selection.primary?.kind === 'image',
			enabled: () => !selection.primary?.locked && !inserting,
			run: () => {
				if (selection.primary) beginReplaceImage(selection.primary.id);
				return OK;
			}
		},
		{
			id: 'element.format',
			label: 'Format…',
			enabled: () => selection.primary !== null,
			run: () => {
				showFormat();
				return OK;
			}
		},
		{
			id: 'slide.formatBackground',
			label: 'Format background…',
			enabled: () => selection.activeSlide !== undefined,
			run: () => {
				showFormat(true);
				return OK;
			}
		},
		...['up', 'down'].map((direction) => ({
			id: direction === 'up' ? 'slide.moveUp' : 'slide.moveDown',
			label: direction === 'up' ? 'Move up' : 'Move down',
			enabled: () => {
				const slides = doc.document?.slides ?? [];
				const index = slides.findIndex((slide) => slide.id === selection.activeSlideId);
				return index >= 0 && (direction === 'up' ? index > 0 : index < slides.length - 1);
			},
			run: () => {
				const id = selection.activeSlideId;
				const index = doc.document?.slides.findIndex((slide) => slide.id === id) ?? -1;
				if (id && index >= 0) {
					moveSlide(id, index + (direction === 'up' ? -1 : 1));
					focusSlideId = id;
				}
				return OK;
			}
		})),
		{
			id: 'slide.add',
			label: 'Add slide',
			enabled: () => (doc.document?.slides.length ?? 0) < PRESENTATION_LIMITS.maxSlides,
			run: () => {
				addSlide();
				return OK;
			}
		},
		{
			id: 'slide.duplicate',
			label: 'Duplicate slide',
			enabled: () =>
				selection.activeSlide !== undefined &&
				(doc.document?.slides.length ?? 0) < PRESENTATION_LIMITS.maxSlides,
			run: () => {
				duplicateActiveSlide();
				return OK;
			}
		},
		{
			id: 'slide.delete',
			label: 'Delete slide',
			enabled: () => (doc.document?.slides.length ?? 0) > 1,
			run: () => {
				if (selection.activeSlideId) deleteSlide(selection.activeSlideId);
				return OK;
			}
		},
		{
			id: 'view.fit',
			label: 'Fit to window',
			enabled: () => true,
			run: () => {
				viewport.setZoom(1);
				viewport.setPan({ x: 0, y: 0 });
				return OK;
			}
		},
		{
			id: 'view.formatPane',
			label: 'Format pane',
			enabled: () => true,
			run: () => {
				togglePaneSection('format');
				return OK;
			}
		},
		{
			id: 'view.selectionPane',
			label: 'Selection pane',
			enabled: () => true,
			run: () => {
				togglePaneSection('selection');
				return OK;
			}
		},
		{
			id: 'view.toggleRibbon',
			label: 'Collapse ribbon',
			shortLabel: 'Collapse ribbon',
			shortcuts: [{ key: 'F1', mod: true }],
			enabled: () => true,
			run: () => {
				ribbonCollapsed = !ribbonCollapsed;
				return OK;
			}
		}
	]);
	let saveState = $state.raw(saving.getStatus());
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
	/** @type {import('#lib/presentations/rendering/renderSlide.js').PresentationImageSources} */
	let images = $state.raw(new Map());
	/**
	 * Konva's Node entry hard-requires the native `canvas` package, so the slide
	 * canvas is client-only — the same seam `EditorCanvas` uses for the artboard.
	 * A static import here put Konva in the SSR graph and 500'd this route.
	 *
	 * @type {typeof import('./PresentationCanvas.svelte').default | null}
	 */
	let PresentationCanvas = $state(null);
	/** @type {import('#lib/presentations/rendering/decodedArtwork.js').DecodedArtwork | null} */
	let decodedArtwork = null;
	let inserting = $state(false);
	/** @type {string | null} */
	let editorNote = $state(null);
	let recovering = $state(false);
	/** @type {string | null} */
	let replaceTargetId = $state(null);
	/** @type {HTMLInputElement | null} */
	let imageInput = $state(null);
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
	const slideButtons = new Map();

	const editorState = $derived(doc.snapshot());
	const presentation = $derived(editorState.document);
	const activeSlide = $derived(
		presentation?.slides.find((slide) => slide.id === selection.activeSlideId) ??
			presentation?.slides[0]
	);
	const selectedElement = $derived(
		activeSlide?.elements.find((element) => element.id === selection.ids[0])
	);
	const selectedText = $derived(selectedElement?.kind === 'text' ? selectedElement : null);
	const saveReported = $derived(saveState.status === 'failed' || saveState.status === 'conflict');
	const saveLabel = $derived(
		saveState.status === 'conflict'
			? 'Save conflict'
			: saveState.status === 'failed'
				? 'Save failed'
				: saveState.status === 'saving'
					? policy.labels.saving
					: editorState.dirty
						? 'Unsaved changes'
						: policy.labels.saved
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
		const autosave = policy.capabilities.autosave ? saving.attachAutosave() : null;
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
				const current = doc.snapshot();
				return current.dirty && current.document?.id === presentationId;
			},
			saveBeforeLeave: async () => {
				// A conflict needs a deliberate answer from the administrator;
				// navigating away must not replace the other tab's version.
				if (policy.conflictRecovery === 'reload-draft' && saving.getStatus().status === 'conflict')
					return false;
				return saving.saveBeforeLeave();
			},
			reportFailure: () => (editorNote = policy.labels.leaveFailure)
		};
		return () => {
			// The guard must not outlive the editor it speaks for.
			leaveguard = null;
		};
	});

	/**
	 * Decodes one document's artwork; the caller owns disposal of the result.
	 * @param {import('#lib/presentations/model/types.js').PresentationDocument} loaded
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
				doc.loadDocument(loaded, { saved: true });
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

	/** @param {import('#lib/presentations/editor/textPresets.js').TextPreset} [preset] */
	function addTextBox(preset = 'body') {
		const state = doc.snapshot();
		if (!state.document || !activeSlide) return;
		// A preset box is ordinary editable text: theme fonts/colors, the preset's
		// size, and automatic growth so the store can fit it as the text changes.
		textSession.flush();
		const id = doc.addElement(createPresetText(preset, state.document.theme));
		// Open the editor straight away so the new box can be typed into immediately.
		if (id) selection.startTextEdit(id);
		else editor.messages.show('This slide cannot hold another text box. Remove an element first.');
	}

	/** @param {import('#lib/presentations/templates/builtinLayouts.js').BuiltinLayoutId} layoutId */
	function addBuiltinLayout(layoutId) {
		textSession.flush();
		selection.endTextEdit();
		doc.endHistoryGroup();
		const current = doc.document;
		if (!current) return { ok: false, message: 'Open a presentation before adding a layout.' };
		const slide = createBuiltinLayout(layoutId, current.theme);
		const id = doc.insertSlide(slide);
		if (!id)
			return { ok: false, message: 'This presentation has reached its slide or element limit.' };
		// In template mode the existing saver still requires an explicit Save, so a
		// local layout insertion never publishes a draft version by itself.
		focusSlideId = id;
		return { ok: true };
	}

	function addSlide() {
		const id = doc.addSlide();
		if (id) focusSlideId = id;
	}

	function duplicateActiveSlide() {
		const activeId = selection.activeSlideId;
		if (!activeId) return;
		const id = doc.duplicateSlide(activeId);
		if (id) focusSlideId = id;
	}

	/**
	 * @param {string} slideId
	 * @param {number} targetIndex
	 */
	function moveSlide(slideId, targetIndex) {
		doc.reorderSlide(slideId, targetIndex);
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
				const slides = doc.document?.slides ?? [];
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
		if (
			event.defaultPrevented ||
			(event.target instanceof HTMLElement &&
				event.target.closest('input, textarea, select, [contenteditable], [role="menu"], dialog'))
		)
			return;
		const slides = doc.document?.slides ?? [];
		const index = slides.findIndex((slide) => slide.id === id);
		if (index < 0) return;
		if (
			(event.ctrlKey || event.metaKey) &&
			!event.altKey &&
			!event.shiftKey &&
			event.key.toLowerCase() === 'd'
		) {
			event.preventDefault();
			selection.selectSlide(id);
			editor.actions.run('slide.duplicate');
			return;
		}
		if (
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey &&
			(event.key === 'Delete' || event.key === 'Backspace')
		) {
			event.preventDefault();
			selection.selectSlide(id);
			editor.actions.run('slide.delete');
			return;
		}
		if (
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) ||
			(event.altKey && event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
		)
			return;
		event.preventDefault();
		if (event.altKey) {
			selection.selectSlide(id);
			editor.actions.run(event.key === 'ArrowUp' ? 'slide.moveUp' : 'slide.moveDown');
			return;
		}
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? slides.length - 1
					: Math.max(0, Math.min(slides.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
		const target = slides[next];
		if (target) {
			selection.selectSlide(target.id);
			focusSlideId = target.id;
		}
	}

	/** @param {HTMLElement} node */
	function slideKeyboard(node) {
		/** @param {KeyboardEvent} event */
		const onkeydown = (event) => {
			const item =
				event.target instanceof HTMLElement ? event.target.closest('[data-slide-row]') : null;
			const id = item?.getAttribute('data-slide-row') ?? selection.activeSlideId;
			if (id) slideKeyDown(id, event);
		};
		node.addEventListener('keydown', onkeydown);
		return () => node.removeEventListener('keydown', onkeydown);
	}

	/** @param {string} slideId */
	function deleteSlide(slideId) {
		if (!doc.removeSlide(slideId)) return;
		const survivor = selection.activeSlideId;
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

	/** @param {import('#lib/presentations/editor/shapeTools.js').ShapeInsertKind} kind */
	function addShape(kind) {
		const state = doc.snapshot();
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
	 * @param {() => Promise<import('#lib/presentations/editor/insertImageAsset.js').PreparedPresentationImage>} prepare
	 * @param {(prepared: import('#lib/presentations/editor/insertImageAsset.js').PreparedPresentationImage) => Promise<import('#lib/presentations/editor/persistence/persistence.svelte.js').PersistInsertOutcome>} write
	 * @param {string} fallback
	 */
	async function runImageWrite(prepare, write, fallback) {
		const state = doc.snapshot();
		if (!state.document) return;
		if (!decodedArtwork) {
			editor.messages.show(
				'This presentation is still opening its artwork, so the image was not added. Try again once the slide appears.'
			);
			return;
		}
		editor.messages.clear();
		inserting = true;
		// Past the write the element, its asset and its bytes are stored, so a later
		// display failure must not be reported as a failed write.
		let persisted = false;
		try {
			const prepared = await prepare();
			const outcome = await write(prepared);
			if (!outcome.ok) {
				// A failed or conflicting write is reported by the save status instead.
				if (outcome.reason === 'failed' || outcome.reason === 'conflict') editor.messages.clear();
				else editor.messages.show(outcome.message);
				return;
			}
			persisted = true;
			const media = decodedArtwork;
			if (!media) {
				editor.messages.show(
					'This image was saved, but this editor can no longer display it. Reopen the presentation to see it.'
				);
				return;
			}
			await media.add([prepared.media]);
			// A fresh Map so the canvas re-renders with the new artwork.
			images = new Map(media.images);
		} catch (error) {
			if (error instanceof PrepareImageError || error instanceof CatalogInsertError)
				editor.messages.show(error.message);
			else if (persisted)
				editor.messages.show(
					'This image was saved, but it cannot be displayed here yet. Reopen the presentation to see it.'
				);
			else editor.messages.show(fallback);
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
	 * @param {import('#lib/presentations/editor/insertCatalogAsset.js').CatalogInsertSource} source
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
			editor.messages.show('Saved stickers are not available in this session.');
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
		if (result === 'saved' && policy.labels.savedNote) editorNote = policy.labels.savedNote;
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
	 * @param {{ metadata: import('#lib/catalog/repository.js').CatalogTemplateInput, collectionId: string | null }} input
	 */
	async function saveAsTemplate(input) {
		if (!catalogAdminRepository) return;
		await textSession.flush();
		const document = doc.document;
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
</script>

<svelte:window
	onbeforeunload={(event) => {
		const state = doc.snapshot();
		if (!state.dirty || state.document?.id !== presentationId) return;
		event.preventDefault();
		event.returnValue = '';
	}}
	onpagehide={() => {
		// A template version is only ever created deliberately (or by the leave
		// guard, which can report back); the unload path cannot.
		if (policy.capabilities.autosave) void saving.save();
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
	<div class="presentation-editor" {@attach editorInteractions}>
		<div class="presentation-editor-bar" role="banner" aria-label="Presentation title bar">
			<div class="presentation-editor-heading">
				<a class={buttonIcon} aria-label="Back to presentations" href={backhref} onclick={leave}
					><ArrowLeft size={19} /></a
				>
				<a class={buttonIcon} aria-label="Home" title="StickerLab home" href={shellHref('/')}
					><Home size={18} aria-hidden="true" /></a
				>
				<div class="presentation-editor-title">
					<p>{policy.labels.heading}</p>
					<h1 title={presentation.title}>{presentation.title}</h1>
				</div>
				<p class="presentation-local-status" role="status" title={saveState.message ?? undefined}>
					{saveLabel}
				</p>
				<button type="button" class={button} onclick={requestSave}
					><Save size={16} aria-hidden="true" /> {policy.labels.save}</button
				>
				{#if policy.capabilities.export}
					<ExportDialog
						{exportState}
						offline={offline.snapshot}
						reloadSafety={{ unsavedWork: editorState.dirty, saveFailed: saveReported }}
						onexport={(format) => void exportController.exportDeck(format)}
						oncancel={() => exportController.cancel()}
					/>
				{/if}
				{#if catalogAdminRepository && policy.capabilities.saveAsTemplate}<SaveAsTemplateDialog
						repository={catalogAdminRepository}
						needsCollection={presentation.assets.some(
							(asset) => asset.provenance.source !== 'catalog'
						)}
						defaultTitle={presentation.title}
						onsave={(input) => saveAsTemplate(input)}
					/>{/if}
				{#if saveState.status === 'conflict' && policy.conflictRecovery === 'reload-draft'}
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
				{#if saveReported && policy.capabilities.export}
					<!-- Recovery guidance: if the local write fails, the work can still leave
					     the browser as a backup archive. -->
					<button
						type="button"
						class={button}
						onclick={() => void exportController.exportDeck('backup')}>Download backup</button
					>
				{/if}
			</div>
		</div>
		{#if policy.capabilities.localMedia}
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
		<Ribbon
			tabs={ribbonTabs}
			active={ribbonTab}
			collapsed={ribbonCollapsed}
			onselect={selectRibbonTab}
			panel={ribbonPanel}
		/>
		{#if saveReported || editorNote}<MessageBar
				tone={saveReported ? 'warning' : 'info'}
				role={saveReported ? 'alert' : 'status'}
				>{editorNote ?? saveState.message ?? saveStatus}</MessageBar
			>{/if}
		{#if editor.messages.current}<MessageBar tone="error" role="alert" class="asset-error"
				>{editor.messages.current}</MessageBar
			>{/if}
		<div class="presentation-mobile-note [display:none]">
			<MonitorUp size={18} aria-hidden="true" />
			<span
				>Presentation authoring is designed for a laptop or desktop. This preview remains available
				on your phone.</span
			>
		</div>
		<div
			class={[
				'presentation-workspace [display:grid] [flex:1] [min-block-size:0] [min-inline-size:0]',
				{ 'has-task-pane': paneState.open }
			]}
		>
			<aside
				class="presentation-slide-rail [border-inline-end:1px_solid_var(--line)]"
				aria-label="Slides"
				{@attach slideKeyboard}
			>
				<p>Slides</p>
				<p class="slide-order-hint">↑/↓ to select · Alt+↑/↓ to reorder</p>
				<span id="slide-order-hint" class="sr-only"
					>Drag to reorder. On touchscreens, use the handle at the top left of a slide. Or focus the
					slide and press Alt plus the up or down arrow key.</span
				>
				<div class="presentation-slide-list">
					{#each presentation.slides as slide, index (slide.id)}
						<div
							class="presentation-slide-item [min-inline-size:0]"
							data-slide-row={slide.id}
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
								onclick={() => {
									if (!suppressSlideClick) {
										selection.selectSlide(slide.id);
										focusSlideId = slide.id;
									}
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
			</aside>
			{#if PresentationCanvas}
				<PresentationCanvas {images} session={textSession} oncontextrequest={openCanvasMenu} />
			{:else}
				<!-- Holds the canvas track and its panel tone until Konva arrives. -->
				<div
					class="presentation-canvas-placeholder [background:oklch(0.923614_0.009985_181.3932)] [min-block-size:0] [min-inline-size:0]"
				></div>
			{/if}
			{#if paneState.open}
				<TaskPane
					showFormat={paneState.format}
					showSelection={paneState.selection}
					onclose={() => setPaneState({ ...paneState, open: false })}
				>
					{#snippet format()}
						<div class="presentation-inspector">
							{#if activeSlide}
								<label
									class="presentation-slide-background [margin-block-end:var(--space-5)] [display:grid] [gap:var(--space-1)] [font-size:11px] [font-weight:700] [color:var(--muted)]"
								>
									Slide background
									<input
										type="color"
										aria-label="Slide background"
										value={activeSlide.background}
										oninput={(event) =>
											doc.setSlideBackground(activeSlide.id, event.currentTarget.value, {
												historyGroup: `slide-bg:${activeSlide.id}`
											})}
										onblur={() => doc.endHistoryGroup()}
									/>
								</label>
							{/if}
							{#if selectedElement}
								<p>{selectedElement.name || 'Element'}</p>
								<ElementGeometryInspector
									element={selectedElement}
									onreplaceimage={policy.capabilities.localMedia ? beginReplaceImage : undefined}
								/>
							{/if}
						</div>
					{/snippet}
					{#snippet selection()}
						<ElementLayerList />
					{/snippet}
				</TaskPane>
			{/if}
		</div>
		{#if contextMenu}<ActionMenu
				items={contextMenu.items}
				x={contextMenu.x}
				y={contextMenu.y}
				label={contextMenu.label}
				onclose={closeContextMenu}
			/>{/if}
		<StatusBar />
	</div>
{/if}

{#snippet slideActions()}
	{#if presentation}
		<button type="button" class={button} aria-label="Add slide" title="Add slide" onclick={addSlide}
			><Plus size={16} aria-hidden="true" /><span class="ribbon-label">Add slide</span></button
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
			><Copy size={16} aria-hidden="true" /><span class="ribbon-label">Duplicate</span></button
		>
	{/if}
{/snippet}

{#snippet textButtons()}
	<button type="button" class={button} onclick={() => addTextBox('heading')}>Add heading</button>
	<button type="button" class={button} onclick={() => addTextBox('subheading')}
		>Add subheading</button
	>
	<button type="button" class={button} onclick={() => addTextBox('body')}>Add body text</button>
	<button type="button" class={button} onclick={() => addTextBox()}
		><Type size={16} aria-hidden="true" /> Add text</button
	>
{/snippet}

{#snippet shapePicker()}
	<label class="presentation-add-shape"
		><span class="sr-only">Add shape</span><select
			aria-label="Add shape"
			value=""
			onchange={(event) => {
				const kind =
					/** @type {import('#lib/presentations/editor/shapeTools.js').ShapeInsertKind | ''} */ (
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
{/snippet}

{#snippet ribbonPanel(/** @type {string} */ tab)}
	{#if tab === 'home'}
		<RibbonGroup label="Undo">
			<ActionButton id="history.undo" variant="icon" iconSize={17} />
			<ActionButton id="history.redo" variant="icon" iconSize={17} />
		</RibbonGroup>
		<RibbonGroup label="Clipboard">
			<ActionButton id="clipboard.paste" />
			<ActionButton id="clipboard.copy" />
			<ActionButton id="clipboard.cut" />
			<ActionButton id="element.duplicate" />
		</RibbonGroup>
		<RibbonGroup label="Slides">{@render slideActions()}</RibbonGroup>
		<RibbonGroup label="Font and paragraph">
			{#if selection.editingId}<TextFormatToolbar session={textSession} />{:else}<p
					class="ribbon-hint"
				>
					Double-click text to format it.
				</p>{/if}
		</RibbonGroup>
		<RibbonGroup label="Drawing">
			{@render shapePicker()}
			{@render textButtons()}
		</RibbonGroup>
		{#if selectedText}
			<RibbonGroup label="Editing">
				<button
					type="button"
					class={button}
					aria-label="Edit text: {selectedText.name}"
					onclick={() => selection.startTextEdit(selectedText.id)}
					><PenLine size={16} aria-hidden="true" /> Edit text</button
				>
			</RibbonGroup>
		{/if}
	{:else if tab === 'insert'}
		<RibbonGroup label="Slides">
			<button
				type="button"
				class={button}
				aria-label="Add slide"
				title="Add slide"
				onclick={addSlide}
				><Plus size={16} aria-hidden="true" /><span class="ribbon-label">Add slide</span></button
			>
			{#if catalogRepository && policy.capabilities.templateSlides}<InsertTemplateDialog
					repository={catalogRepository}
					disabled={inserting}
					oninsert={insertTemplateLayout}
				/>{/if}
		</RibbonGroup>
		<RibbonGroup label="Text">{@render textButtons()}</RibbonGroup>
		<RibbonGroup label="Images">
			{#if policy.capabilities.localMedia}
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
			{#if stickerRepository && policy.capabilities.stickers}<StickerPickerDialog
					repository={stickerRepository}
					disabled={inserting}
					onpick={(projectId) => void addSticker(projectId)}
				/>{/if}
			{#if catalogRepository}<CatalogPickerDialog
					repository={catalogRepository}
					disabled={inserting}
					oninsert={addCatalogImage}
				/>{/if}
		</RibbonGroup>
		<RibbonGroup label="Illustrations">{@render shapePicker()}</RibbonGroup>
	{:else if tab === 'design' && presentation}
		<RibbonGroup label="Theme">
			<ThemeControls
				theme={presentation.theme}
				onchange={(next) => doc.setTheme(next, { historyGroup: 'theme' })}
				onendgroup={() => doc.endHistoryGroup()}
			/>
		</RibbonGroup>
	{:else if tab === 'arrange'}
		<RibbonGroup label="Align"><AlignMenu /></RibbonGroup>
		<RibbonGroup label="Distribute"
			><ActionButton id="distribute.horizontal" /><ActionButton
				id="distribute.vertical"
			/></RibbonGroup
		>
		<RibbonGroup label="Order">
			<ActionButton id="arrange.bringForward" />
			<ActionButton id="arrange.sendBackward" />
		</RibbonGroup>
		<RibbonGroup label="Element">
			<ActionButton id="element.toggleLock" />
			<ActionButton id="element.toggleVisible" />
			<ActionButton id="element.delete" />
		</RibbonGroup>
	{:else if tab === 'view'}
		<RibbonGroup label="Zoom">
			<ActionButton id="view.fit" />
		</RibbonGroup>
		<RibbonGroup label="Show">
			<ActionButton id="view.formatPane" />
			<ActionButton id="view.selectionPane" />
		</RibbonGroup>
		<RibbonGroup label="Ribbon">
			<ActionButton id="view.toggleRibbon" />
		</RibbonGroup>
	{:else if tab === 'shapeFormat' && selectedElement?.kind === 'shape'}
		<RibbonGroup label="Shape style"><ShapeStyleInspector element={selectedElement} /></RibbonGroup>
	{:else if tab === 'pictureFormat' && selectedElement?.kind === 'image'}
		<RibbonGroup label="Picture">
			<ImageAdjustInspector
				element={selectedElement}
				onreplace={policy.capabilities.localMedia ? beginReplaceImage : undefined}
			/>
		</RibbonGroup>
	{/if}
{/snippet}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.card {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: oklch(1 0 none);
	}

	.presentation-route-state {
		display: grid;
		min-block-size: 100%;
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
		max-inline-size: 58ch;
		color: var(--muted);
	}
	.presentation-editor {
		--muted: oklch(0.49 0.035 264);
		display: flex;
		min-inline-size: 0;
		min-block-size: 0;
		flex: 1;
		flex-direction: column;
		background: oklch(0.969839 0.004443 179.7348);
	}
	.presentation-editor
		:global(:is(button, a, input, select, textarea, [tabindex], [contenteditable]):focus-visible) {
		outline: 3px solid var(--primary);
		outline-offset: -3px;
	}

	/* Keep the deck title and Save fixed. Tools have their own single scrollable
	 * row so selecting an element or changing the save status never shifts the slide. */
	.presentation-editor-bar {
		display: flex;
		min-inline-size: 0;
		flex-direction: column;
		border-block-end: 1px solid var(--line);
		background: var(--surface);
	}
	.presentation-editor-heading {
		display: flex;
		min-inline-size: 0;
		min-block-size: 44px;
		align-items: center;
		gap: var(--space-2);
		padding-block: 4px;
		padding-inline: var(--space-2) var(--space-3);
		background: oklch(0.968 0.003 264);
	}
	.presentation-editor-heading :global(.button) {
		min-block-size: 32px;
		padding-inline: 12px;
		padding-block: 4px;
		border-radius: 5px;
		font-size: 13px;
		box-shadow: none;
	}
	.presentation-editor-heading :global(.button.icon) {
		inline-size: 32px;
		padding: 0;
	}
	.ribbon-hint {
		max-inline-size: 15ch;
		margin: 0;
		color: var(--muted);
		font-size: 11px;
		line-height: 1.35;
	}
	.presentation-editor-heading > .button {
		flex: none;
	}
	.presentation-editor-title {
		flex: 1 1 auto;
		min-inline-size: 0;
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
		max-inline-size: 100%;
		overflow: hidden;
		font-size: 15px;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-local-status {
		flex: 0 1 30ch;
		min-inline-size: 0;
		margin: 0;
		overflow: hidden;
		color: oklch(0.515677 0.11125 163.1262);
		font-size: 12px;
		font-weight: 800;
		text-align: end;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-add-shape {
		position: relative;
	}
	.presentation-add-shape select {
		min-block-size: 30px;
		padding-block-start: 6px;
		padding-block-end: 6px;
		padding-inline-start: 8px;
		padding-inline-end: 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
	.presentation-slide-background input {
		inline-size: 100%;
		min-block-size: 36px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
	}
	.presentation-slide-rail {
		min-block-size: 0;
		padding: var(--space-4);
		overflow: auto;
		background: var(--surface);
	}
	.presentation-inspector {
		min-block-size: 0;
	}
	.presentation-workspace {
		position: relative;
		grid-template-columns: 200px minmax(0, 1fr);
	}
	.presentation-workspace.has-task-pane {
		grid-template-columns: 200px minmax(0, 1fr) 300px;
	}
	.presentation-slide-rail > p {
		margin-block-start: 0;
		margin-block-end: var(--space-3);
		margin-inline-start: 0;
		margin-inline-end: 0;
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
		margin-block-start: 0;
		margin-block-end: var(--space-3);
		margin-inline-start: 0;
		margin-inline-end: 0;
		color: var(--muted);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
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
		inline-size: 100%;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 2px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		text-align: start;
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
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-card:hover {
			border-color: var(--mint);
		}
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
		inset-block-start: 5px;
		inset-inline-start: 5px;
		display: grid;
		inline-size: 32px;
		block-size: 32px;
		place-items: center;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--muted);
		box-shadow: var(--shadow);
		cursor: grab;
		touch-action: none;
		opacity: 0;
		transition: opacity 150ms ease-out;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-item:hover .presentation-slide-grip {
			opacity: 1;
		}
	}

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
		inset-block-start: 5px;
		inset-inline-end: 5px;
		display: grid;
		inline-size: 32px;
		block-size: 32px;
		place-items: center;
		border: 1px solid var(--danger-line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--danger);
		box-shadow: var(--shadow);
		cursor: pointer;
		opacity: 0;
		transition: opacity 150ms ease-out;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-item:hover .presentation-slide-delete {
			opacity: 1;
		}
	}

	.presentation-slide-item:focus-within .presentation-slide-delete {
		opacity: 1;
	}
	.presentation-slide-delete:focus-visible {
		opacity: 1;
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-delete:hover:not(:disabled) {
			background: var(--danger-tint);
			color: var(--danger-strong);
		}
	}
	.presentation-slide-delete:disabled {
		cursor: not-allowed;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-item:hover .presentation-slide-delete:disabled {
			opacity: 0.5;
		}
	}

	.presentation-slide-item:focus-within .presentation-slide-delete:disabled {
		opacity: 0.5;
	}
	@media (hover: none) {
		.presentation-slide-grip,
		.presentation-slide-card[aria-current] ~ .presentation-slide-delete {
			opacity: 1;
		}
	}
	.presentation-inspector .muted {
		margin-block-start: var(--space-5);
		font-size: 12px;
	}
	/* Laptop and tablet widths keep the task pane docked but narrower, so it
	 * never covers the slide. */
	@media (max-width: 1279px) {
		.presentation-workspace {
			grid-template-columns: 160px minmax(0, 1fr);
		}
		.presentation-workspace.has-task-pane {
			grid-template-columns: 160px minmax(0, 1fr) clamp(240px, 26vw, 300px);
		}
	}
	@media (max-width: 720px) {
		.presentation-editor {
			min-block-size: calc(100dvh - var(--header-height));
		}
		.presentation-editor-heading {
			display: grid;
			grid-template-columns: 40px 40px minmax(0, 1fr) auto auto;
			gap: 4px;
			padding-inline: var(--space-2);
		}
		.presentation-editor-heading > a:nth-child(1) {
			grid-column: 1;
			grid-row: 1;
		}
		.presentation-editor-heading > a:nth-child(2) {
			grid-column: 2;
			grid-row: 1;
		}
		.presentation-editor-title {
			grid-column: 3 / -1;
			grid-row: 1;
		}
		.presentation-editor-title p {
			display: none;
		}
		.presentation-local-status {
			grid-column: 1 / 4;
			grid-row: 2;
			text-align: start;
		}
		.presentation-editor-heading > :global(button) {
			grid-row: 2;
		}

		.presentation-editor-heading > .button {
			min-block-size: 40px;
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
			display: block;
			white-space: nowrap;
		}
		.presentation-mobile-note {
			display: flex;
			align-items: flex-start;
			gap: var(--space-2);
			padding-block-start: var(--space-3);
			padding-block-end: var(--space-3);
			padding-inline-start: var(--space-4);
			padding-inline-end: var(--space-4);
			border-block-end: 1px solid oklch(0.908386 0.014482 169.213);
			background: var(--pale);
			color: oklch(0.436246 0.052317 171.7714);
			font-size: 12px;
			line-height: 1.5;
		}
		.presentation-workspace {
			display: block;
			min-block-size: 0;
			flex: 1;
		}
		.presentation-slide-rail {
			display: block;
			padding-block-start: var(--space-3);
			padding-block-end: var(--space-3);
			padding-inline-start: var(--space-4);
			padding-inline-end: var(--space-4);
			border-inline-end: 0;
			border-block-end: 1px solid var(--line);
		}
		.presentation-workspace :global(.task-pane) {
			display: none;
		}
		.presentation-slide-list {
			display: flex;
			min-inline-size: 0;
			gap: var(--space-3);
			overflow-x: auto;
			padding-block-end: var(--space-1);
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
