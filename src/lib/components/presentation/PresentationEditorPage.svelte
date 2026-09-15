<script>
	import {
		ArrowDown,
		ArrowLeft,
		ArrowUp,
		Copy,
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
	import { createTextElement } from '$lib/presentations/model/factories';
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
	import PresentationCanvas from './PresentationCanvas.svelte';
	import ElementLayerList from './ElementLayerList.svelte';
	import ElementGeometryInspector from './ElementGeometryInspector.svelte';
	import TextFormatToolbar from './TextFormatToolbar.svelte';
	import ThemeControls from './ThemeControls.svelte';
	import StickerPickerDialog from './StickerPickerDialog.svelte';
	import ExportDialog from './ExportDialog.svelte';

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
	 *   store: import('$lib/presentations/editor/store.svelte').PresentationStore,
	 *   backhref: string,
	 *   onback: () => void | Promise<void>,
	 *   leaveguard?: {
	 *     hasUnsavedWork: () => boolean,
	 *     saveBeforeLeave: () => Promise<boolean>,
	 *     reportFailure: () => void
	 *   } | null
	 * }} */
	let {
		presentationId,
		repository,
		stickerRepository = null,
		store,
		backhref,
		onback,
		// `$bindable` compiles to a prop getter/setter, so this component only ever
		// publishes the guard; the route reads it back through the binding, which
		// leaves the initial value unread here.
		// eslint-disable-next-line no-useless-assignment
		leaveguard = $bindable(null)
	} = $props();

	/** The editor that opens a text session owns it; save flushes through it. */
	const textSession = createTextEditSession();

	// The route keys this page on the presentation id, so a different document
	// remounts the component instead of reassigning these props.
	// svelte-ignore state_referenced_locally
	const saving = createPresentationSaving({
		repository,
		documentId: presentationId,
		flushText: () => textSession.flush(),
		store
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
					? 'Saving…'
					: editorState.dirty
						? 'Unsaved changes'
						: 'Saved locally'
	);
	// A failure is shown in words, not only in a tooltip: what happened and that
	// the edit is still here with a way to retry it.
	const saveStatus = $derived(
		saveReported && saveState.message ? `${saveLabel} — ${saveState.message}` : saveLabel
	);

	$effect(() => {
		const unsubscribe = saving.subscribeStatus(() => (saveState = saving.getStatus()));
		const autosave = saving.attachAutosave();
		return () => {
			unsubscribe();
			autosave.detach();
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
			saveBeforeLeave: saving.saveBeforeLeave,
			reportFailure: () =>
				(editorNote =
					'This presentation could not be saved, so it is still open. Press Save to try again — or press Keep my copy if another tab or window has a newer version.')
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

	function addTextBox() {
		const state = store.getState();
		if (!state.document || !activeSlide) return;
		const textCount = activeSlide.elements.filter((element) => element.kind === 'text').length;
		const id = state.addElement(
			createTextElement({
				name: textCount === 0 ? 'Text' : `Text ${textCount + 1}`,
				x: 140 + (textCount % 4) * 24,
				y: 240 + (textCount % 4) * 24,
				width: 1000,
				height: 160,
				paragraphs: [{ runs: [], alignment: 'left', bullet: 'none', bulletLevel: 0 }]
			})
		);
		// Open the editor straight away so the new box can be typed into immediately.
		if (id) store.getState().startTextEdit(id);
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
			if (error instanceof PrepareImageError) insertError = error.message;
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

	function requestSave() {
		editorNote = null;
		void saving.save();
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
		if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
		const key = event.key.toLowerCase();
		if (key !== 'z' && key !== 'y') return;
		event.preventDefault();
		const state = store.getState();
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
	onpagehide={() => void saving.save()}
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
		{#if loadState === 'error' && loadFailure}<p class="muted">{loadFailure.message}</p>{/if}
		<div class="button-row">
			<a class="button primary" href={backhref}>Back to presentations</a>
			{#if loadState !== 'missing' && loadState !== 'unsupported'}<button
					type="button"
					class="button"
					onclick={() => (attempt += 1)}>Try again</button
				>{/if}
		</div>
	</section>
{:else}
	<div class="presentation-editor">
		<header class="presentation-editor-bar">
			<a class="button icon" aria-label="Back to presentations" href={backhref} onclick={leave}
				><ArrowLeft size={19} /></a
			>
			<div class="presentation-editor-title">
				<p>Presentation</p>
				<h1 title={presentation.title}>{presentation.title}</h1>
			</div>
			<div class="presentation-editor-actions">
				<button
					type="button"
					class="button icon"
					aria-label="Undo"
					title="Undo (Ctrl+Z)"
					disabled={!canUndo}
					onclick={() => store.getState().undo()}><Undo2 size={17} aria-hidden="true" /></button
				>
				<button
					type="button"
					class="button icon"
					aria-label="Redo"
					title="Redo (Ctrl+Shift+Z)"
					disabled={!canRedo}
					onclick={() => store.getState().redo()}><Redo2 size={17} aria-hidden="true" /></button
				>
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
				<button type="button" class="button" onclick={addTextBox}
					><Type size={16} aria-hidden="true" /> Add text</button
				>
				<button
					type="button"
					class="button"
					disabled={inserting}
					onclick={() => {
						replaceTargetId = null;
						imageInput?.click();
					}}
					><ImagePlus size={16} aria-hidden="true" />
					{inserting ? 'Adding image…' : 'Add image'}</button
				>
				{#if stickerRepository}<StickerPickerDialog
						repository={stickerRepository}
						disabled={inserting}
						onpick={(projectId) => void addSticker(projectId)}
					/>{/if}
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
				{#if selectedText}<button
						type="button"
						class="button"
						aria-label="Edit text: {selectedText.name}"
						onclick={() => store.getState().startTextEdit(selectedText.id)}
						><PenLine size={16} aria-hidden="true" /> Edit text</button
					>{/if}
				{#if selectedElement}
					<!-- The wide pane is hidden from 1150px down, so the same numeric fields
					     stay reachable through the shared dialog at tablet and phone widths. -->
					<button
						type="button"
						class="button properties-toggle"
						bind:this={propertiesOpener}
						onclick={() => (propertiesOpen = true)}>Element properties</button
					>
				{/if}
				<button
					type="button"
					class="button"
					bind:this={themeOpener}
					onclick={() => (themeOpen = true)}>Theme</button
				>
				<ExportDialog
					{exportState}
					offline={offline.snapshot}
					reloadSafety={{ unsavedWork: editorState.dirty, saveFailed: saveReported }}
					onexport={(format) => void exportController.exportDeck(format)}
					oncancel={() => exportController.cancel()}
				/>
				<button type="button" class="button" onclick={requestSave}
					><Save size={16} aria-hidden="true" /> Save</button
				>
				{#if saveState.status === 'conflict'}<button
						type="button"
						class="button"
						disabled={recovering}
						onclick={() => void recoverFromConflict()}
						>{recovering ? 'Keeping your copy…' : 'Keep my copy'}</button
					>{/if}
				{#if saveReported}
					<!-- Recovery guidance: if the local write fails, the work can still leave
					     the browser as a backup archive. -->
					<button
						type="button"
						class="button"
						onclick={() => void exportController.exportDeck('backup')}>Download backup</button
					>
				{/if}
				<p class="presentation-local-status" role="status" title={saveState.message ?? undefined}>
					{editorNote ?? saveStatus}
				</p>
			</div>
		</header>
		{#if editorState.view.editingElementId}<TextFormatToolbar session={textSession} />{/if}
		{#if insertError}<p class="asset-error" role="alert">{insertError}</p>{/if}
		<div class="presentation-mobile-note">
			<MonitorUp size={18} aria-hidden="true" />
			<span
				>Presentation authoring is designed for a laptop or desktop. This preview remains available
				on your phone.</span
			>
		</div>
		<div class="presentation-workspace">
			<aside class="presentation-slide-rail" aria-label="Slides">
				<p>Slides</p>
				<div class="presentation-slide-rail-actions">
					<button
						type="button"
						class="button"
						aria-label="Add slide"
						title="Add slide"
						onclick={addSlide}><Plus size={16} aria-hidden="true" /><span>Add slide</span></button
					>
					<button
						type="button"
						class="button"
						aria-label="Duplicate active slide"
						title="Duplicate active slide"
						onclick={duplicateActiveSlide}
						><Copy size={16} aria-hidden="true" /><span>Duplicate</span></button
					>
				</div>
				<div class="presentation-slide-list">
					{#each presentation.slides as slide, index (slide.id)}
						<div class="presentation-slide-item">
							<button
								type="button"
								class="presentation-slide-card"
								aria-current={slide.id === activeSlide?.id ? 'true' : undefined}
								aria-label="Show slide {index + 1}: {slide.name}"
								onclick={() => store.getState().selectSlide(slide.id)}
								{@attach registerSlideButton(slide.id)}
							>
								<span aria-hidden="true">{index + 1}</span>
								<b>{slide.name}</b>
							</button>
							<div class="presentation-slide-item-actions">
								<button
									type="button"
									class="button presentation-slide-action"
									aria-label="Move slide {index + 1} up"
									title="Move slide {index + 1} up"
									disabled={index === 0}
									onclick={() => moveSlide(slide.id, index - 1)}
									><ArrowUp size={15} aria-hidden="true" /></button
								>
								<button
									type="button"
									class="button presentation-slide-action"
									aria-label="Move slide {index + 1} down"
									title="Move slide {index + 1} down"
									disabled={index === presentation.slides.length - 1}
									onclick={() => moveSlide(slide.id, index + 1)}
									><ArrowDown size={15} aria-hidden="true" /></button
								>
								<button
									type="button"
									class="button presentation-slide-action presentation-slide-delete"
									aria-label="Delete slide {index + 1}"
									title="Delete slide {index + 1}"
									disabled={presentation.slides.length <= 1}
									onclick={() => deleteSlide(slide.id)}
									><Trash2 size={15} aria-hidden="true" /></button
								>
							</div>
						</div>
					{/each}
				</div>
				<p>Elements</p>
				<ElementLayerList {store} />
			</aside>
			<PresentationCanvas {store} {images} session={textSession} />
			<aside class="presentation-inspector" aria-label="Presentation details">
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
					<label class="presentation-slide-background">
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
						onreplaceimage={beginReplaceImage}
					/>
				{/if}
				<p class="muted">
					Drag an element on the slide to move it, use a corner handle to resize, and the round
					handle to rotate. These values are the same document units — type one to place an element
					exactly.
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
				onreplaceimage={beginReplaceImage}
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
