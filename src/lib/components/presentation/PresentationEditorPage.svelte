<script>
	import { untrack } from 'svelte';
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
	import BuiltinLayoutDialog from './BuiltinLayoutDialog.svelte';
	import SlideRailPreview from './SlideRailPreview.svelte';
	import { ensurePresentationFonts } from '#lib/presentations/rendering/fonts.js';
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
	import SlidePanel from './slides/SlidePanel.svelte';
	import MessageBar from './shell/MessageBar.svelte';
	import { OK } from '#lib/presentations/editor/actions/registry.js';
	import { usePresentationOfflineReadiness } from '#lib/presentations/presentationOffline.svelte.js';
	import ElementLayerList from './ElementLayerList.svelte';
	import ElementGeometryInspector from './ElementGeometryInspector.svelte';
	import TextFormatToolbar from './TextFormatToolbar.svelte';
	import ThemeControls from './ThemeControls.svelte';
	import StickerPickerDialog from './StickerPickerDialog.svelte';
	import CatalogPickerDialog from './CatalogPickerDialog.svelte';
	import ExportDialog from './ExportDialog.svelte';
	import SaveAsTemplateDialog from './SaveAsTemplateDialog.svelte';
	import { localPolicy } from '#lib/presentations/editor/persistence/policies.js';
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
		conflictMessage: policy.conflictMessage,
		services: {
			get stickers() {
				return stickerRepository;
			},
			get catalog() {
				return catalogRepository;
			},
			get catalogAdmin() {
				return catalogAdminRepository;
			}
		}
	});
	setSlideEditor(editor);
	$effect(() => attachKeymap(editor.actions, window, { exempt: SHORTCUT_EXEMPT }));

	const { ui, artwork, inserts, actions } = editor;
	const {
		doc,
		selection,
		viewport,
		interaction,
		persistence: saving,
		exports: exportController,
		text: textSession
	} = editor;

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
		ui.menu.open({
			x,
			y,
			trigger,
			items: selection.ids.length
				? elementMenuItems
				: ['clipboard.paste', 'selection.selectAll', 'slide.add', 'slide.formatBackground'],
			label: selection.ids.length ? 'Element actions' : 'Canvas actions'
		});
	}
	/** @param {HTMLDivElement} root */
	function editorInteractions(root) {
		const detachFocus = attachFocusNavigation(root, () => {
			ui.menu.close(false);
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
			ui.menu.open({
				x: pointer ? event.clientX : rect.left + 12,
				y: pointer ? event.clientY : rect.top + 12,
				trigger,
				items: slide
					? ['slide.add', 'slide.duplicate', 'slide.delete', 'slide.moveUp', 'slide.moveDown']
					: elementMenuItems,
				label: slide ? 'Slide actions' : 'Element actions'
			});
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
			return inserts.addImage(file);
		}
	});

	// Text formatting lives on Home, so starting a text edit brings Home forward.
	$effect(() => {
		if (selection.editingId) ui.ribbon.select('home');
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
			enabled: () => !selection.primary?.locked && !inserts.inserting,
			run: () => {
				if (selection.primary) inserts.beginReplaceImage(selection.primary.id);
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
	/**
	 * Konva's Node entry hard-requires the native `canvas` package, so the slide
	 * canvas is client-only — the same seam `EditorCanvas` uses for the artboard.
	 * A static import here put Konva in the SSR graph and 500'd this route.
	 *
	 * @type {typeof import('./PresentationCanvas.svelte').default | null}
	 */
	let PresentationCanvas = $state(null);
	let recovering = $state(false);

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
		// Attaching reads the document; untracked so the effect does not re-run (and
		// restart the autosave timer) on every state change.
		const autosave = policy.capabilities.autosave ? untrack(() => saving.attachAutosave()) : null;
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
			saveBeforeLeave: saveBeforeLeaving,
			reportFailure: () => editor.messages.showNotice(policy.labels.leaveFailure)
		};
		return () => {
			// The guard must not outlive the editor it speaks for.
			leaveguard = null;
		};
	});

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
					decoded = await artwork.decode(loaded);
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
				artwork.adopt(decoded);
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
			artwork.dispose();
		};
	});

	/** @param {import('#lib/presentations/templates/builtinLayouts.js').BuiltinLayoutId} layoutId */
	function addBuiltinLayout(layoutId) {
		const result = inserts.addBuiltinLayout(layoutId);
		if (result.ok && result.slideId) ui.focusSlide(result.slideId);
		return result;
	}

	async function requestSave() {
		editor.messages.clearNotice();
		const result = await saving.save();
		if (result === 'saved' && policy.labels.savedNote)
			editor.messages.showNotice(policy.labels.savedNote);
	}

	/**
	 * Template mode's conflict exit: discards the local edits and reloads the
	 * newest server draft. Only ever reached through its explicit button.
	 */
	function reloadDraft() {
		if (!onreload) return;
		editor.messages.clearNotice();
		onreload();
	}

	/**
	 * The way out of a stale revision: keep the local work as a copy, then re-open
	 * the newer stored revision so Save is no longer dead.
	 */
	async function recoverFromConflict() {
		recovering = true;
		editor.messages.clearNotice();
		let reopened = false;
		try {
			const outcome = await saving.keepMineAsCopy();
			if (!outcome.ok) {
				editor.messages.showNotice(outcome.message);
				return;
			}
			// The store holds the newer revision from here on; only its artwork is left.
			reopened = true;
			await artwork.reload(presentationId);
			editor.messages.showNotice(
				'Your work was saved as a separate conflict copy. The newer saved version is open now.'
			);
		} catch {
			editor.messages.showNotice(
				reopened
					? 'Your work was saved as a separate conflict copy, and the newer saved version is open — but its artwork could not be shown yet. Reload this page to see it.'
					: 'The newer version could not be reopened. Reload this page to continue.'
			);
		} finally {
			recovering = false;
		}
	}

	/**
	 * The one save-before-leaving rule for every way out (route guard and the
	 * Back button): a template conflict needs a deliberate answer from the
	 * administrator, so leaving must not replace the other tab's version.
	 */
	async function saveBeforeLeaving() {
		if (policy.conflictRecovery === 'reload-draft' && saving.getStatus().status === 'conflict')
			return false;
		return saving.saveBeforeLeave();
	}

	/** @param {MouseEvent} event */
	async function leave(event) {
		event.preventDefault();
		editor.messages.clearNotice();
		if (await saveBeforeLeaving()) await onback();
		else editor.messages.showNotice(policy.labels.leaveFailure);
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
						onsave={(input) => inserts.saveAsTemplate(input)}
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
				{@attach (/** @type {HTMLInputElement} */ node) => {
					inserts.registerImageInput(node);
					return () => inserts.registerImageInput(null);
				}}
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
					void inserts.acceptPickedFile(file);
				}}
			/>
		{/if}
		<Ribbon
			tabs={ui.ribbon.tabs}
			active={ui.ribbon.tab}
			collapsed={ui.ribbon.collapsed}
			onselect={(id) => ui.ribbon.select(id)}
			panel={ribbonPanel}
		/>
		{#if saveReported || editor.messages.notice}<MessageBar
				tone={saveReported ? 'warning' : 'info'}
				role={saveReported ? 'alert' : 'status'}
				>{editor.messages.notice ?? saveState.message ?? saveStatus}</MessageBar
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
				{ 'has-task-pane': ui.panes.state.open }
			]}
		>
			<SlidePanel />
			{#if PresentationCanvas}
				<PresentationCanvas
					images={artwork.images}
					session={textSession}
					oncontextrequest={openCanvasMenu}
				/>
			{:else}
				<!-- Holds the canvas track and its panel tone until Konva arrives. -->
				<div
					class="presentation-canvas-placeholder [background:oklch(0.923614_0.009985_181.3932)] [min-block-size:0] [min-inline-size:0]"
				></div>
			{/if}
			{#if ui.panes.state.open}
				<TaskPane
					showFormat={ui.panes.state.format}
					showSelection={ui.panes.state.selection}
					onclose={() => ui.panes.set({ ...ui.panes.state, open: false })}
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
									onreplaceimage={policy.capabilities.localMedia
										? inserts.beginReplaceImage
										: undefined}
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
		{#if ui.menu.current}<ActionMenu
				items={ui.menu.current.items}
				x={ui.menu.current.x}
				y={ui.menu.current.y}
				label={ui.menu.current.label}
				onclose={(restore) => ui.menu.close(restore)}
			/>{/if}
		<StatusBar />
	</div>
{/if}

{#snippet slideActions()}
	{#if presentation}
		<button
			type="button"
			class={button}
			aria-label="Add slide"
			title="Add slide"
			onclick={() => actions.run('slide.add')}
			><Plus size={16} aria-hidden="true" /><span class="ribbon-label">Add slide</span></button
		>
		<BuiltinLayoutDialog
			theme={presentation.theme}
			disabled={inserts.inserting}
			oninsert={addBuiltinLayout}
		/>
		<button
			type="button"
			class={button}
			aria-label="Duplicate active slide"
			title="Duplicate active slide"
			onclick={() => actions.run('slide.duplicate')}
			><Copy size={16} aria-hidden="true" /><span class="ribbon-label">Duplicate</span></button
		>
	{/if}
{/snippet}

{#snippet textButtons()}
	<button type="button" class={button} onclick={() => inserts.addTextBox('heading')}
		>Add heading</button
	>
	<button type="button" class={button} onclick={() => inserts.addTextBox('subheading')}
		>Add subheading</button
	>
	<button type="button" class={button} onclick={() => inserts.addTextBox('body')}
		>Add body text</button
	>
	<button type="button" class={button} onclick={() => inserts.addTextBox()}
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
				if (kind) inserts.addShape(kind);
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
				onclick={() => actions.run('slide.add')}
				><Plus size={16} aria-hidden="true" /><span class="ribbon-label">Add slide</span></button
			>
			{#if catalogRepository && policy.capabilities.templateSlides}<InsertTemplateDialog
					repository={catalogRepository}
					disabled={inserts.inserting}
					oninsert={inserts.insertTemplateLayout}
				/>{/if}
		</RibbonGroup>
		<RibbonGroup label="Text">{@render textButtons()}</RibbonGroup>
		<RibbonGroup label="Images">
			{#if policy.capabilities.localMedia}
				<button
					type="button"
					class={button}
					disabled={inserts.inserting}
					onclick={() => inserts.pickImage()}
					><ImagePlus size={16} aria-hidden="true" />
					{inserts.inserting ? 'Adding image…' : 'Add image'}</button
				>
			{/if}
			{#if stickerRepository && policy.capabilities.stickers}<StickerPickerDialog
					repository={stickerRepository}
					disabled={inserts.inserting}
					onpick={(projectId) => void inserts.addSticker(projectId)}
				/>{/if}
			{#if catalogRepository}<CatalogPickerDialog
					repository={catalogRepository}
					disabled={inserts.inserting}
					oninsert={inserts.addCatalogImage}
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
			<ActionButton id="arrange.bringToFront" />
			<ActionButton id="arrange.sendToBack" />
		</RibbonGroup>
		<RibbonGroup label="Rotate">
			<ActionButton id="element.rotateLeft" />
			<ActionButton id="element.rotateRight" />
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
				onreplace={policy.capabilities.localMedia ? inserts.beginReplaceImage : undefined}
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
	.presentation-inspector .muted {
		margin-block-start: var(--space-5);
		font-size: 12px;
	}
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
		.presentation-workspace :global(.task-pane) {
			display: none;
		}
	}
</style>
