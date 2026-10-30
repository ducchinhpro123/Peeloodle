<script>
	import { untrack } from 'svelte';
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import { MonitorUp, ShieldAlert } from 'lucide-svelte';
	import { isPersistenceError } from '#lib/persistence/repository.js';
	import { isPresentationParseError } from '#lib/presentations/model/parse.js';
	import { ensurePresentationFonts } from '#lib/presentations/rendering/fonts.js';
	import { createSlideEditor } from '#lib/presentations/editor/createSlideEditor.svelte.js';
	import { setSlideEditor } from '#lib/presentations/editor/context.js';
	import { attachKeymap } from '#lib/presentations/editor/actions/keymap.js';
	import {
		attachEditorInteractions,
		configureClipboardPaste,
		openCanvasMenu,
		SHORTCUT_EXEMPT
	} from '#lib/presentations/editor/interactions.js';
	import ActionMenu from './shell/ActionMenu.svelte';
	import StatusBar from './shell/StatusBar.svelte';
	import Ribbon from './shell/Ribbon.svelte';
	import TaskPane from './panes/TaskPane.svelte';
	import SlidePanel from './slides/SlidePanel.svelte';
	import TitleBar from './shell/TitleBar.svelte';
	import FormatPane from './panes/FormatPane.svelte';
	import HomeTab from './shell/tabs/HomeTab.svelte';
	import InsertTab from './shell/tabs/InsertTab.svelte';
	import DesignTab from './shell/tabs/DesignTab.svelte';
	import ArrangeTab from './shell/tabs/ArrangeTab.svelte';
	import ViewTab from './shell/tabs/ViewTab.svelte';
	import ShapeFormatTab from './shell/tabs/ShapeFormatTab.svelte';
	import PictureFormatTab from './shell/tabs/PictureFormatTab.svelte';
	import MessageBar from './shell/MessageBar.svelte';
	import { usePresentationOfflineReadiness } from '#lib/presentations/presentationOffline.svelte.js';
	import ElementLayerList from './ElementLayerList.svelte';
	import { localPolicy } from '#lib/presentations/editor/persistence/policies.js';

	/**
	 * @typedef {(
	 *   kind: 'move' | 'resize' | 'rotate',
	 *   handle: import('#lib/presentations/editor/transformGeometry.js').ResizeHandle | null,
	 *   event: PointerEvent
	 * ) => void} GestureStarter
	 */

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
		policy,
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
	configureClipboardPaste(editor);

	const { ui, artwork, inserts } = editor;
	const {
		doc,
		selection,
		persistence: saving,
		exports: exportController,
		text: textSession
	} = editor;

	// Text formatting lives on Home, so starting a text edit brings Home forward.
	$effect(() => {
		if (selection.editingId) ui.ribbon.select('home');
	});

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
	<div class="presentation-editor" {@attach (node) => attachEditorInteractions(node, editor)}>
		<TitleBar
			{backhref}
			onleave={leave}
			{saveLabel}
			saveMessage={saveState.message}
			saveStatus={saveState.status}
			{saveReported}
			onsave={requestSave}
			{exportState}
			offline={offline.snapshot}
			{recovering}
			onreloaddraft={reloadDraft}
			onkeepcopy={() => void recoverFromConflict()}
		/>
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
					oncontextrequest={(x, y, trigger) => openCanvasMenu(editor, x, y, trigger)}
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
						<FormatPane />
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

{#snippet ribbonPanel(/** @type {string} */ tab)}
	{#if tab === 'home'}<HomeTab />
	{:else if tab === 'insert'}<InsertTab />
	{:else if tab === 'design'}<DesignTab />
	{:else if tab === 'arrange'}<ArrangeTab />
	{:else if tab === 'view'}<ViewTab />
	{:else if tab === 'shapeFormat'}<ShapeFormatTab />
	{:else if tab === 'pictureFormat'}<PictureFormatTab />
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
	.presentation-workspace {
		position: relative;
		grid-template-columns: 200px minmax(0, 1fr);
	}
	.presentation-workspace.has-task-pane {
		grid-template-columns: 200px minmax(0, 1fr) 300px;
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
		.presentation-editor-actions {
			padding-inline: var(--space-3);
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
