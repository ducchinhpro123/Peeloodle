<script>
	import { asset } from '$app/paths';
	/**
	 * The editor route's chrome, ported from the source `EditorPage.tsx`
	 * (`EditorWorkspace` + `EditorChrome`).
	 *
	 * Lifecycle rules kept from the source: flush before replacing a document,
	 * stay on the current editor when a flush is blocked, autosave on an 800 ms
	 * debounce after the last document change, and attempt the departure flush for
	 * the draft this route shows. `pagehide`/`beforeunload` protection moved to the
	 * app-level guard in `+layout.svelte`, which outlives this route.
	 */
	import { resolve } from '$app/paths';
	import {
		Check,
		ChevronLeft,
		Circle,
		CloudUpload,
		Crop,
		Download,
		Hand,
		Layers,
		Lightbulb,
		Maximize2,
		Minimize2,
		Paintbrush,
		Pencil,
		Scissors,
		Smile,
		Sparkles,
		Type,
		Undo2,
		Redo2,
		Upload
	} from 'lucide-svelte';
	import { untrack } from 'svelte';
	import EditorCanvas from './EditorCanvas.svelte';
	import EditorInspector from './EditorInspector.svelte';
	import AssetTray from './AssetTray.svelte';
	import ExportDialog from './ExportDialog.svelte';
	import Modal from './Modal.svelte';
	import { getAppContext } from '$lib/app/context';
	import {
		AssetObjectUrlCache,
		ingestBundledImage,
		ingestImageFile
	} from '$lib/assets/assetLoader';
	import { UploadValidationError } from '$lib/assets/validateUpload';
	import { isPersistenceError, loadProjectBundle } from '$lib/persistence/repository';
	import { getCloudWorkspace } from '$lib/cloud/workspace.svelte';
	import { saveStatusLabel } from '$lib/editor/editorState.svelte';
	import { applyToolIntent, subscribeToolIntent, toolEmptyCopy } from '$lib/editor/toolIntent';
	/** @typedef {import('$lib/persistence/repository').AssetRecord} AssetRecord */
	/** @typedef {import('$lib/editor/toolIntent').ToolIntent} ToolIntent */

	/**
	 * @type {{
	 *   projectId: string | undefined,
	 *   intent?: ToolIntent | null,
	 *   onnavigate?: (href: `/editor/${string}`) => void,
	 * }}
	 */
	let { projectId, intent = null, onnavigate = () => {} } = $props();

	const { repository, editor, saving } = getAppContext();

	// Query intents seed the initial chrome only; later changes come through applyToolIntent.
	// svelte-ignore state_referenced_locally
	let inspectorTab = $state(intent === 'effects' ? 'effects' : 'adjust');
	// svelte-ignore state_referenced_locally
	let assetTab = $state(intent === 'text' ? 'stickers' : 'uploads');
	// svelte-ignore state_referenced_locally
	let exportOpen = $state(intent === 'export');
	// svelte-ignore state_referenced_locally
	let railFocus = $state(
		/** @type {'erase' | 'rotate' | 'restore' | 'outline' | 'text' | 'stickers' | 'effects' | 'layers' | null} */ (
			intent === 'erase'
				? 'erase'
				: intent === 'text'
					? 'text'
					: intent === 'effects'
						? 'effects'
						: null
		)
	);
	let tipOpen = $state(true);
	let propertiesOpen = $state(false);
	let canvasFullscreen = $state(false);
	let replacing = $state(false);
	/** @type {string | null} */
	let adding = $state(null);
	let stage = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let titleInput = $state(/** @type {HTMLInputElement | undefined} */ (undefined));
	let doc = $derived(editor.document);
	let urls = $state(/** @type {Record<string, string>} */ ({}));

	const toolRail = [
		{ key: 'erase', label: 'Background Eraser', icon: Scissors, action: 'tool' },
		{ key: 'rotate', label: 'Crop & Rotate', icon: Crop, action: 'tool' },
		{ key: 'restore', label: 'Brush / Restore', icon: Paintbrush, action: 'tool' },
		{ key: 'outline', label: 'Outline & Border', icon: Circle, action: 'outline' },
		{ key: 'text', label: 'Text', icon: Type, action: 'text' },
		{ key: 'stickers', label: 'Emoji & Stickers', icon: Smile, action: 'stickers' },
		{ key: 'effects', label: 'Filters & Effects', icon: Sparkles, action: 'effects' },
		{ key: 'layers', label: 'Layers', icon: Layers, action: 'layers' }
	];

	// Object URLs are owned here: one cache per assets revision, revoked on change.
	$effect(() => {
		const assets = editor.assets;
		const cache = new AssetObjectUrlCache();
		/** @type {Record<string, string>} */
		const next = {};
		for (const [id, record] of Object.entries(assets)) {
			try {
				next[id] = cache.urlFor(id, record.blob);
			} catch {
				next[id] = '';
			}
		}
		urls = next;
		return () => {
			try {
				cache.revokeAll();
			} catch {
				// Some test environments do not implement revokeObjectURL.
			}
		};
	});

	// Load (or replace) the open document, flushing pending work first. The same
	// cleanup runs on departure: a draft created here (not loaded from the
	// repository) still needs its queued write attempted, and a blocked flush
	// leaves it in memory where the root guard keeps protecting it.
	//
	// Two rules keep that departure write honest. The effect depends only on the
	// route's project and repository, so editing the draft cannot re-run it (the
	// "already open?" reads and the flush are untracked). And the flush is deferred
	// out of the teardown: when the effect re-runs to replace the route's document,
	// a teardown reads reactive state as of that effect's previous run, which would
	// capture a superseded revision and let an older write land after a newer one.
	$effect(() => {
		const id = projectId;
		const repo = repository;
		if (!id) return;
		let cancelled = false;
		const detach = () => {
			cancelled = true;
			queueMicrotask(() => void saving.flush(repo, { projectId: id }));
		};
		if (untrack(() => editor.document?.id) === id) {
			if (untrack(() => editor.loading)) editor.setLoading(false);
			return detach;
		}
		void (async () => {
			// The flush reads the editor state; keep those reads out of this effect's
			// dependencies so only the route's project/repository can re-run it.
			const outcome = await untrack(() => saving.flush(repo));
			if (cancelled || outcome.kind === 'superseded') return;
			if (outcome.kind === 'blocked') {
				// A blocked flush keeps the current draft: stay on it instead of replacing.
				onnavigate(`/editor/${outcome.projectId}`);
				return;
			}
			editor.setLoading(true);
			try {
				const loaded = await repo.getProject(id);
				const bundle = await loadProjectBundle(repo, loaded);
				if (cancelled) return;
				editor.hydrate(
					loaded,
					[...bundle.assets.values()],
					[...bundle.masks].map(([key, blob]) => ({ key, blob }))
				);
			} catch (error) {
				if (cancelled) return;
				editor.setLoadError(
					isPersistenceError(error)
						? error.code === 'not_found'
							? 'This sticker was not found locally.'
							: error.message
						: error instanceof Error && error.message
							? error.message
							: 'This sticker could not be opened.'
				);
			}
		})();
		return detach;
	});

	// Autosave: the effect reads exactly the fields the source store subscribed to,
	// so view and status changes cannot restart the debounce or retry a failure.
	$effect(() => {
		const repo = repository;
		const id = editor.document?.id;
		const revision = editor.document?.revision;
		const dirty = editor.dirty;
		const gesture = editor.gestureActive;
		const stroke = !!editor.maskStroke;
		void id;
		void revision;
		void dirty;
		void gesture;
		void stroke;
		saving.attach();
		saving.sync(repo);
		return () => saving.detach();
	});

	// Query tool intents activate existing chrome; they never insert layers.
	$effect(() => {
		const activeIntent = intent;
		void doc?.id;
		/** @type {import('$lib/editor/toolIntent').ToolIntentUi} */
		const ui = {
			setInspectorTab: (/** @type {string} */ tab) => (inspectorTab = tab),
			setAssetTab: (/** @type {string} */ tab) => (assetTab = tab),
			setExportOpen: (/** @type {boolean} */ open) => (exportOpen = open),
			setRailFocus: (/** @type {any} */ focus) => (railFocus = focus)
		};
		applyToolIntent(activeIntent, ui, editor);
		const unsubscribe = subscribeToolIntent((requested) => applyToolIntent(requested, ui, editor));
		return unsubscribe;
	});

	$effect(() => {
		const sync = () => (canvasFullscreen = globalThis.document.fullscreenElement === stage);
		globalThis.document.addEventListener('fullscreenchange', sync);
		return () => globalThis.document.removeEventListener('fullscreenchange', sync);
	});

	let hasImage = $derived((doc?.layers ?? []).some((layer) => layer.kind === 'image'));
	let hasText = $derived((doc?.layers ?? []).some((layer) => layer.kind === 'text'));
	let emptyCopy = $derived(toolEmptyCopy(intent, hasImage, hasText));
	let maskBusy = $derived(!!editor.maskStroke);
	let savedOk = $derived(editor.saveStatus === 'saved-locally' && !editor.dirty && !maskBusy);
	const workspace = getCloudWorkspace();
	let saveLabel = $derived(
		maskBusy && editor.saveStatus !== 'save-failed'
			? 'Mask edit pending'
			: workspace.cloud && !editor.dirty && editor.saveStatus === 'saved-locally'
				? workspace.cloudStatus.state === 'synced'
					? 'Saved to cloud'
					: workspace.cloudStatus.state === 'syncing'
						? 'Saved locally · syncing'
						: 'Saved locally · cloud pending'
				: saveStatusLabel(editor.saveStatus, editor.dirty)
	);

	/**
	 * Rail highlight, including the buttons that activate existing chrome rather
	 * than a tool.
	 * @param {{ key: string, action: string }} tool
	 */
	function railPressed(tool) {
		if (tool.action === 'tool') return editor.activeTool === tool.key;
		if (tool.action === 'text') return false;
		if (tool.key === 'stickers') return railFocus === 'stickers';
		if (tool.key === 'outline')
			return railFocus === 'outline' && inspectorTab === 'adjust' && editor.activeTool === 'select';
		return inspectorTab === tool.action;
	}

	/** @param {string} tab */
	function selectTab(tab) {
		if (!editor.maskStroke) editor.commitGesture();
		inspectorTab = tab;
	}

	/** @param {File} file */
	function onUpload(file) {
		void ingestIntoCurrentProject(() => ingestImageFile(file));
	}

	/**
	 * @param {File} file
	 * @param {string} layerId
	 */
	function onUploadReplacement(file, layerId) {
		if (editor.gestureActive) {
			editor.setUploadError('Finish the current edit, then try replacing the photo again.');
			return;
		}
		replacing = true;
		void ingestIntoCurrentProject(() => ingestImageFile(file), undefined, layerId).finally(
			() => (replacing = false)
		);
	}

	/**
	 * @param {string} src
	 * @param {string} name
	 */
	async function onAddSample(src, name) {
		adding = src;
		try {
			await ingestIntoCurrentProject(() => ingestBundledImage(src), name);
		} finally {
			adding = null;
		}
	}

	/**
	 * Drops a late upload that belongs to a document or workspace that is gone.
	 * @param {() => Promise<AssetRecord>} load
	 * @param {string} [name]
	 * @param {string} [replaceLayerId]
	 */
	async function ingestIntoCurrentProject(load, name, replaceLayerId) {
		const originId = editor.document?.id;
		const epoch = editor.workspaceEpoch;
		const stale = () => editor.workspaceEpoch !== epoch || editor.document?.id !== originId;
		try {
			const record = await load();
			if (stale()) return;
			if (replaceLayerId) {
				await editor.commitMaskStroke();
				if (stale()) return;
				editor.replaceImageLayer(replaceLayerId, record);
			} else {
				editor.addImageLayer(record, name);
			}
		} catch (error) {
			if (stale()) return;
			editor.setUploadError(
				error instanceof UploadValidationError ? error.message : 'The image could not be added'
			);
		}
	}

	function toggleFullscreen() {
		if (!stage) return;
		if (globalThis.document.fullscreenElement === stage) void globalThis.document.exitFullscreen();
		else void stage.requestFullscreen();
	}

	function openExport() {
		if (globalThis.document.fullscreenElement === stage) {
			void globalThis.document.exitFullscreen().then(
				() => (exportOpen = true),
				() => (exportOpen = true)
			);
			return;
		}
		exportOpen = true;
	}

	/*
	 * Elements that own the keyboard before the editor shortcuts do. A native
	 * `<dialog>` opened with `showModal()` has an implicit dialog role, so matching
	 * `[role="dialog"]` alone misses it and its buttons entirely: any descendant of
	 * an open dialog, and every interactive control, stands down here instead.
	 */
	const KEYBOARD_OWNED_BY =
		'input, textarea, select, button, a[href], summary, iframe, ' +
		'[contenteditable="true"], [role="slider"], [role="textbox"], [role="button"], ' +
		'[role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], ' +
		'[role="menuitem"], [role="option"], [role="dialog"], dialog[open]';

	/**
	 * True when the key event belongs to a control or an open native dialog.
	 * @param {EventTarget | null} target
	 */
	function ownsKeyEvent(target) {
		if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
		return target.closest(KEYBOARD_OWNED_BY) !== null;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.defaultPrevented) return;
		if (ownsKeyEvent(event.target)) return;
		const meta = event.metaKey || event.ctrlKey;
		if (meta && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) editor.redo();
			else editor.undo();
			return;
		}
		if (meta && event.key.toLowerCase() === 'y') {
			event.preventDefault();
			editor.redo();
			return;
		}
		if (meta && event.key.toLowerCase() === 'd') {
			event.preventDefault();
			editor.duplicateSelected();
			return;
		}
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			editor.removeSelected();
			return;
		}
		if (event.key === 'Escape') {
			editor.selectLayer(null);
			return;
		}
		const step = event.shiftKey ? 10 : 1;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			editor.nudgeSelected(-step, 0);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			editor.nudgeSelected(step, 0);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			editor.nudgeSelected(0, -step);
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			editor.nudgeSelected(0, step);
		}
	}}
/>

{#if editor.loadError && doc?.id !== projectId}
	<section class="empty" style="margin-top: 24px">
		<h1>Sticker not found</h1>
		<p>{editor.loadError}</p>
		<a class="button primary" href={resolve('/create')}>Create a sticker</a>
	</section>
{:else if !doc || editor.loading || (projectId && doc.id !== projectId)}
	<p class="muted" style="padding: 24px">Opening sticker…</p>
{:else}
	<div
		class="editor-workspace"
		data-tool-intent={intent ?? undefined}
		data-active-tool={editor.activeTool}
	>
		<aside class="tool-rail">
			<a class="back-home" href={resolve('/')}><ChevronLeft size={16} />Back to Home</a>
			{#each toolRail as tool (tool.key)}
				<button
					type="button"
					aria-pressed={railPressed(tool)}
					aria-label={tool.key === 'stickers' ? 'Stickers & decorations' : undefined}
					onclick={() => {
						railFocus = /** @type {any} */ (tool.key);
						if (tool.action === 'tool') {
							editor.setTool(/** @type {any} */ (tool.key));
							selectTab('adjust');
							return;
						}
						if (tool.action === 'text') {
							editor.addTextLayer();
							selectTab('adjust');
							return;
						}
						if (tool.action === 'stickers') {
							assetTab = 'stickers';
							return;
						}
						editor.setTool('select');
						selectTab(tool.action);
					}}
				>
					<tool.icon size={18} />{tool.label}
				</button>
			{/each}
			<div class="tool-history">
				<button type="button" disabled={!editor.canUndo || maskBusy} onclick={() => editor.undo()}>
					<Undo2 size={16} />Undo
				</button>
				<button type="button" disabled={!editor.canRedo || maskBusy} onclick={() => editor.redo()}>
					<Redo2 size={16} />Redo
				</button>
			</div>
			<div class="tool-rail-footer">
				{#if tipOpen}
					<div class="tool-tip-card">
						<strong><Lightbulb size={14} aria-hidden="true" /> Pro Tip</strong>
						<p>Use the brush tool to fine-tune edges for a cleaner sticker!</p>
						<button type="button" onclick={() => (tipOpen = false)}>Got it!</button>
					</div>
				{/if}
				<div class="tool-mascot" aria-hidden="true">
					<img src={asset('/art/stickers/04-winking-smiley.webp')} alt="" width="52" height="52" />
					<p>Good stickers make a brighter day!</p>
				</div>
			</div>
		</aside>

		<div class="editor-stage" bind:this={stage}>
			<section class="editor-top">
				<div class="editor-identity">
					<h1>
						<input
							bind:this={titleInput}
							class="title-input"
							aria-label="Sticker title"
							size={Math.max(doc.title.length + 1, 8)}
							value={doc.title}
							onfocus={() => editor.beginGesture()}
							oninput={(event) => editor.updateTitle(event.currentTarget.value)}
							onblur={() => editor.commitGesture()}
						/>
						<Pencil size={16} aria-hidden="true" onclick={() => titleInput?.focus()} />
					</h1>
					<small class="save-status" data-state={editor.saveStatus} role="status">
						{#if savedOk}<Check size={14} aria-hidden="true" />{/if}
						{saveLabel}{editor.saveStatus === 'save-failed' && editor.saveError
							? ` — ${editor.saveError}`
							: ''}
					</small>
				</div>
				<div class="canvas-controls">
					<button
						type="button"
						aria-label="Zoom out"
						onclick={() =>
							editor.setViewport({
								zoom: Math.max(0.25, Math.round((editor.viewport.zoom - 0.1) * 10) / 10)
							})}>−</button
					>
					<button
						type="button"
						aria-label="Reset view"
						onclick={() => editor.setViewport({ zoom: 1, panX: 0, panY: 0 })}
						><b>{Math.round(editor.viewport.zoom * 100)}%</b></button
					>
					<button
						type="button"
						aria-label="Zoom in"
						onclick={() =>
							editor.setViewport({
								zoom: Math.min(4, Math.round((editor.viewport.zoom + 0.1) * 10) / 10)
							})}>+</button
					>
					<button
						type="button"
						aria-pressed={editor.activeTool === 'pan'}
						aria-label="Pan canvas"
						onclick={() => editor.setTool(editor.activeTool === 'pan' ? 'select' : 'pan')}
						><Hand size={16} /></button
					>
					<button
						type="button"
						aria-pressed={canvasFullscreen}
						aria-label={canvasFullscreen ? 'Exit full screen' : 'Enter full screen'}
						onclick={toggleFullscreen}
						>{#if canvasFullscreen}<Minimize2 size={16} />{:else}<Maximize2
								size={16}
							/>{/if}</button
					>
				</div>
				<div class="editor-actions">
					<button type="button" class="button" onclick={() => void saving.save(repository)}>
						<CloudUpload size={16} />Save to My Stickers
					</button>
					<button
						type="button"
						class="button primary"
						aria-label="Export and share"
						onclick={openExport}
					>
						<Download size={16} />Export &amp; Share
					</button>
					<button
						type="button"
						class="button properties-toggle"
						onclick={() => (propertiesOpen = true)}>Sticker properties</button
					>
				</div>
			</section>

			<div class="editor">
				<section class="canvas-area">
					<div class="canvas-workspace">
						<EditorCanvas {editor} {urls} />
						{#if doc.layers.length === 0}
							<div class="editor-welcome">
								<img
									src={asset('/art/stickers/04-winking-smiley.webp')}
									alt=""
									width="72"
									height="72"
								/>
								<h2>{emptyCopy?.title ?? 'A blank canvas. Endless you.'}</h2>
								<p>
									{emptyCopy?.body ??
										'Drop in a little personality. Start with a photo, then make it your own.'}
								</p>
								<button
									type="button"
									class="button primary"
									onclick={() => document.getElementById('photo-file-input')?.click()}
									><Upload size={16} />Upload a photo</button
								>
								{#if intent === 'text'}
									<button
										type="button"
										class="button"
										onclick={() => {
											editor.addTextLayer();
											selectTab('adjust');
										}}><Type size={16} />Add text</button
									>
								{/if}
								<small>PNG, JPEG or WebP · up to 15 MB</small>
							</div>
						{/if}
					</div>
				</section>
				<EditorInspector
					{editor}
					{urls}
					tab={inspectorTab}
					ontabchange={selectTab}
					onuploadreplacement={onUploadReplacement}
					{replacing}
				/>
			</div>
			<AssetTray
				{editor}
				{urls}
				tab={assetTab}
				ontabchange={(tab) => (assetTab = tab)}
				onupload={onUpload}
				onaddsample={onAddSample}
				onaddtext={(style) => {
					editor.addTextLayer(style);
					selectTab('adjust');
				}}
				{adding}
			/>
		</div>
	</div>

	<ExportDialog
		{editor}
		document={doc}
		open={exportOpen}
		onopenchange={(open) => (exportOpen = open)}
	/>

	<Modal
		open={propertiesOpen}
		title="Sticker properties"
		description="Fine-tune your selected layer."
		onclose={() => {
			propertiesOpen = false;
			if (!editor.maskStroke) editor.commitGesture();
		}}
	>
		{#if propertiesOpen}
			<EditorInspector
				{editor}
				{urls}
				tab={inspectorTab}
				ontabchange={selectTab}
				onuploadreplacement={onUploadReplacement}
				{replacing}
				idPrefix="properties"
			/>
		{/if}
	</Modal>
{/if}
