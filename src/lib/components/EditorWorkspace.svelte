<script>
	import { button, buttonPrimary } from '$lib/ui/styles.js';
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
	<section class="empty [margin-top:20px] [min-height:250px]" style="margin-top: 24px">
		<h1>Sticker not found</h1>
		<p>{editor.loadError}</p>
		<a class={buttonPrimary} href={resolve('/create')}>Create a sticker</a>
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
			<div class="tool-history [margin:6px_0_0] [display:flex] [gap:4px]">
				<button type="button" disabled={!editor.canUndo || maskBusy} onclick={() => editor.undo()}>
					<Undo2 size={16} />Undo
				</button>
				<button type="button" disabled={!editor.canRedo || maskBusy} onclick={() => editor.redo()}>
					<Redo2 size={16} />Redo
				</button>
			</div>
			<div class="tool-rail-footer [margin-top:auto] [display:grid] [gap:8px] [padding-top:8px]">
				{#if tipOpen}
					<div class="tool-tip-card">
						<strong><Lightbulb size={14} aria-hidden="true" /> Pro Tip</strong>
						<p>Use the brush tool to fine-tune edges for a cleaner sticker!</p>
						<button type="button" onclick={() => (tipOpen = false)}>Got it!</button>
					</div>
				{/if}
				<div
					class="tool-mascot [display:grid] [grid-template-columns:44px_1fr] [align-items:center] [gap:8px] [padding:0_6px_4px]"
					aria-hidden="true"
				>
					<img src={asset('/art/stickers/04-winking-smiley.webp')} alt="" width="52" height="52" />
					<p>Good stickers make a brighter day!</p>
				</div>
			</div>
		</aside>

		<div
			class="editor-stage [display:grid] [min-height:0] [min-width:0] [grid-template-rows:auto_minmax(0,_1fr)_auto] [gap:8px] [padding:6px_12px_8px_8px]"
			bind:this={stage}
		>
			<section
				class="editor-top [display:flex] [min-width:0] [align-items:center] [gap:12px] [padding:0_2px]"
			>
				<div
					class="editor-identity [display:flex] [min-width:0] [flex:1] [align-items:center] [gap:10px]"
				>
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
				<div class="editor-actions [display:flex] [flex:none] [gap:8px]">
					<button type="button" class={button} onclick={() => void saving.save(repository)}>
						<CloudUpload size={16} />Save to My Stickers
					</button>
					<button
						type="button"
						class={buttonPrimary}
						aria-label="Export and share"
						onclick={openExport}
					>
						<Download size={16} />Export &amp; Share
					</button>
					<button
						type="button"
						class={[button, 'properties-toggle']}
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
									class={buttonPrimary}
									onclick={() => document.getElementById('photo-file-input')?.click()}
									><Upload size={16} />Upload a photo</button
								>
								<button
									type="button"
									class={button}
									onclick={() => void onAddSample('/samples/cat-in-console.png', 'Sample cat')}
									><Sparkles size={16} />Try a sample photo</button
								>
								{#if intent === 'text'}
									<button
										type="button"
										class={button}
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

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.empty {
		display: flex;
		min-height: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed #abd3c3;
		border-radius: var(--radius);
		background: radial-gradient(ellipse at bottom, #eaf8ef, #fff 75%);
		color: #55708c;
		text-align: center;
	}
	:global(.empty h2) {
		color: var(--ink);
	}
	.empty p {
		max-width: 480px;
		font-size: 14px;
	}
	:global(.empty > svg) {
		padding: 12px;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: #00875e;
		transform: rotate(-8deg);
	}

	.editor-workspace {
		display: grid;
		grid-template-columns: 188px minmax(0, 1fr);
		flex: 1;
		min-height: 0;
		height: 100%;
		background: #f4faf7;
	}
	.editor-top .save-status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		white-space: nowrap;
		font-size: 12px;
		font-weight: 600;
	}
	.editor-top h1 {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		min-width: 0;
		font-size: 18px;
	}
	:global(.editor-top h1 svg) {
		flex: none;
		color: var(--muted);
		cursor: pointer;
	}
	.editor-top small {
		color: var(--muted);
	}
	.muted {
		color: var(--muted);
	}
	.editor-actions .button {
		min-height: 36px;
		padding: 6px 12px;
		font-size: 13px;
		white-space: nowrap;
		border-radius: 10px;
	}
	.editor {
		display: grid;
		min-height: 0;
		grid-template-columns: minmax(0, 1fr) 272px;
		gap: 10px;
	}
	.tool-rail {
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
	}
	.tool-rail {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 10px 8px 8px;
		overflow: auto;
		border: 0;
		border-right: 1px solid #e8eef3;
		border-radius: 0;
		background: #fff;
	}
	.back-home {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 32px;
		margin: 0 4px 8px;
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #f7faf8;
		color: var(--ink);
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	:global(.tool-rail > b) {
		padding: 0 8px 4px;
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #8996aa;
	}
	.tool-rail button {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		padding: 6px 8px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--ink);
		text-align: left;
		font-size: 13px;
		white-space: nowrap;
	}
	.tool-rail button:hover:not(:disabled) {
		background: #f1f7f3;
	}
	.tool-rail button[aria-pressed='true'] {
		background: var(--pale);
		color: #008c62;
		font-weight: 700;
	}
	:global(.tool-rail button.active) {
		background: var(--pale);
		color: #008c62;
		font-weight: 700;
	}
	.tool-history button {
		flex: 1;
		justify-content: center;
		min-height: 32px;
		font-size: 12px;
	}
	.tool-tip-card {
		padding: 10px;
		border-radius: 14px;
		background: #fff6e8;
		color: var(--ink);
	}
	.tool-tip-card strong {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
	}
	.tool-tip-card p {
		margin: 4px 0 6px;
		color: #6b5a3e;
		font-size: 11px;
		line-height: 1.4;
	}
	.tool-tip-card button {
		min-height: 24px;
		padding: 0;
		color: #00875e;
		font-size: 12px;
		font-weight: 800;
	}
	.tool-mascot img {
		width: 44px;
		height: 44px;
		transform: rotate(-8deg);
	}
	.tool-mascot p {
		margin: 0;
		color: #1f3d4d;
		font-family: Chewy, cursive;
		font-size: 13px;
		font-weight: 400;
		line-height: 1.25;
	}
	.canvas-area {
		display: flex;
		min-width: 0;
		min-height: 0;
		padding: 0;
		border-radius: 16px;
		background: #effbf7;
	}
	.canvas-controls {
		display: flex;
		flex: none;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
	}
	.canvas-controls b {
		min-width: 40px;
		text-align: center;
		font-size: 12px;
	}
	.canvas-controls button {
		display: grid;
		width: 26px;
		height: 26px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
	}
	.canvas-controls button[aria-label='Reset view'] {
		width: auto;
		min-width: 40px;
		padding: 0 4px;
	}
	.canvas-controls button[aria-pressed='true'] {
		background: var(--pale);
		color: #008c62;
	}
	.editor-stage:fullscreen {
		width: 100%;
		height: 100%;
		padding: 8px;
		background: #effbf7;
	}
	.editor-stage:fullscreen .editor {
		grid-template-columns: minmax(0, 1fr);
		height: 100%;
	}
	.editor-stage:fullscreen .inspector {
		display: none;
	}
	.editor-stage:fullscreen .asset-tray {
		display: none;
	}
	.editor-stage:fullscreen .canvas-area {
		height: 100%;
		min-height: 0;
		border-radius: 0;
	}
	.editor-stage:fullscreen .canvas-workspace {
		height: 100%;
		min-height: 0;
		border-radius: 0;
	}
	.canvas-workspace {
		position: relative;
		display: grid;
		flex: 1;
		min-height: 0;
		height: auto;
		place-items: center;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: conic-gradient(
				var(--line) 25%,
				var(--surface) 0 50%,
				var(--line) 0 75%,
				var(--surface) 0
			)
			0 0 / 24px 24px;
	}
	:global(.artboard-host.space-pan :is(.konvajs-content, canvas)) {
		cursor: grab !important;
	}
	:global(.artboard-host.is-panning :is(.konvajs-content, canvas)) {
		cursor: grabbing !important;
	}
	.title-input {
		width: auto;
		min-width: 8ch;
		max-width: min(28ch, 32vw);
		field-sizing: content;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 18px;
		font-weight: 750;
	}
	.save-status[data-state='saving'] {
		color: #8a6d00;
	}
	.save-status[data-state='saved-locally'] {
		color: #00875e;
	}
	.save-status[data-state='save-failed'] {
		color: #b42318;
	}
	.project-thumb {
		display: grid;
		height: 88px;
		place-items: center;
		overflow: hidden;
		border-radius: 10px;
		background-color: #fff;
		background-image:
			linear-gradient(45deg, #e4e7eb 25%, transparent 25%),
			linear-gradient(-45deg, #e4e7eb 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #e4e7eb 75%),
			linear-gradient(-45deg, transparent 75%, #e4e7eb 75%);
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
		background-size: 16px 16px;
		font-size: 28px;
		font-weight: 800;
	}
	:global(.project-thumb img) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.editor-welcome {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		width: min(360px, calc(100% - 32px));
		padding: var(--space-5);
		border: 1px solid #fff;
		border-radius: 24px;
		background: #fffffff5;
		box-shadow: var(--shadow-hover);
		text-align: center;
	}
	.editor-welcome img {
		transform: rotate(-12deg);
	}
	.editor-welcome h2 {
		font-size: 20px;
		line-height: 1.3;
		letter-spacing: -0.04em;
	}
	.editor-welcome p {
		color: var(--muted);
		font-size: 12px;
	}
	.editor-welcome small {
		color: var(--muted);
		font-size: 12px;
	}
	.editor-welcome small {
		font-size: 10px;
	}
	:global(.inspector-hue-picker .react-colorful__hue) {
		height: 14px;
		border-radius: 8px;
	}
	:global(.inspector-hue-picker .react-colorful__alpha) {
		height: 14px;
		border-radius: 8px;
	}
	.properties-toggle {
		display: none;
	}
	@media (max-width: 1150px) {
		.editor-workspace {
			grid-template-columns: 172px minmax(0, 1fr);
		}
		.editor {
			grid-template-columns: minmax(0, 1fr);
		}
		:global(.editor > .inspector) {
			display: none;
		}
		.properties-toggle {
			display: flex;
		}
		/* Only the sticker editor keeps its floating corner toggle; the presentation
   * editor's own toggle is a normal button in its action bar. */
		.editor-workspace .properties-toggle {
			position: fixed;
			right: 15px;
			bottom: 15px;
			z-index: 4;
		}
		.tool-tip-card {
			display: none;
		}
		.tool-mascot {
			display: none;
		}
		.editor-top {
			flex-wrap: wrap;
		}
		.title-input {
			max-width: min(28ch, 70vw);
		}
	}
	@media (max-width: 720px) {
		.editor-workspace {
			display: flex;
			flex-direction: column;
			height: auto;
		}
		.editor-stage {
			padding: 8px 12px 16px;
		}
		.editor-top {
			align-items: flex-start;
			gap: var(--space-3);
			padding: 0;
			flex-wrap: wrap;
		}
		.editor-identity {
			flex: none;
			width: 100%;
		}
		.editor-top h1 {
			flex: 1;
			min-width: 0;
			max-width: 100%;
		}
		.title-input {
			max-width: min(22ch, calc(100vw - 140px));
			font-size: 18px;
		}
		.editor-actions {
			flex-direction: row;
			width: 100%;
		}
		.editor-actions .button {
			flex: 1;
		}
		.editor-actions .button {
			padding: 10px;
			font-size: 12px;
		}
		:global(.editor-actions svg) {
			width: 18px;
			height: 18px;
		}
		.editor {
			display: block;
		}
		.tool-rail {
			display: flex;
			flex-direction: row;
			flex-wrap: nowrap;
			width: 100%;
			padding: 8px;
			overflow: auto;
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
		.back-home {
			margin: 0 8px 0 0;
			white-space: nowrap;
		}
		:global(.tool-rail > b) {
			display: none;
		}
		.tool-tip-card {
			display: none;
		}
		.tool-mascot {
			display: none;
		}
		.tool-rail-footer {
			display: none;
		}
		.tool-rail button {
			white-space: nowrap;
		}
		.canvas-area {
			height: min(68dvh, 620px);
		}
		.canvas-workspace {
			min-height: 420px;
		}
		.editor-welcome {
			padding: var(--space-5);
		}
		.editor-welcome img {
			width: 56px;
			height: 56px;
		}
	}
</style>
