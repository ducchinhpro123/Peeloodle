<script>
	/**
	 * The floating "Remove background" button below the selected photo, so the
	 * feature is found where the photo is. It shares the controller (consent,
	 * guards, one job at a time) with the Background tab. While the job runs it is
	 * a progress pill with Cancel; when it finishes it offers "Refine edges" for a
	 * few seconds, which opens the Background tab, then hides (the photo now has
	 * a mask, and refining lives in the rail).
	 */
	import { untrack } from 'svelte';
	import { Loader, Scissors, X } from 'lucide-svelte';
	import { cutoutControllerFor } from '#lib/cutout/cutoutController.svelte.js';

	/** How long "Refine edges" stays after a finished run. */
	const REFINE_MS = 3000;
	/**
	 * Room the chip needs below the photo before it moves inside the bottom edge.
	 * It sits below, centred: the Transformer's rotate handle owns the top centre
	 * and its resize handles own the corners.
	 */
	const BELOW_MIN = 52;

	/**
	 * @type {{
	 *   editor: import('#lib/editor/editorState.svelte.js').EditorState,
	 *   image: import('#lib/domain/domain.js').ImageLayer,
	 *   box: import('#lib/editor/layerScreenBox.js').ScreenBox,
	 *   hostWidth: number,
	 *   hostHeight: number,
	 *   onrefine?: () => void,
	 * }}
	 */
	let { editor, image, box, hostWidth, hostHeight, onrefine } = $props();

	let cutout = $derived(cutoutControllerFor(editor));
	let mine = $derived(cutout.layerId === image.id);
	let busy = $derived(cutout.state === 'downloading' || cutout.state === 'running');
	let running = $derived(mine && busy);
	/** The layer id whose run just finished; "Refine edges" shows while it is set. */
	let refineFor = $state(/** @type {string | null} */ (null));

	$effect(() => {
		const done = mine && cutout.state === 'done';
		const id = image.id;
		if (!done) return;
		untrack(() => (refineFor = id));
		const timer = setTimeout(() => {
			if (refineFor === id) refineFor = null;
		}, REFINE_MS);
		return () => clearTimeout(timer);
	});

	let refining = $derived(refineFor === image.id && mine && cutout.state === 'done');
	let offer = $derived(
		!image.maskKey &&
			!image.locked &&
			editor.activeTool === 'select' &&
			!editor.gestureActive &&
			!busy &&
			cutout.state !== 'consent'
	);
	let visible = $derived(running || refining || offer);

	let bottom = $derived(box.bounds.y + box.bounds.height);
	let below = $derived(hostHeight - bottom >= BELOW_MIN);
	let centerX = $derived(
		Math.min(Math.max(box.bounds.x + box.bounds.width / 2, 96), Math.max(96, hostWidth - 96))
	);
	let top = $derived(below ? bottom + 10 : bottom - 10);
</script>

{#if visible}
	<div
		class={['cutout-canvas-action', { 'inside-edge': !below }]}
		role="group"
		aria-label="Background removal"
		data-testid="cutout-canvas-action"
		data-mode={running ? 'running' : refining ? 'refine' : 'offer'}
		style:left="{centerX}px"
		style:top="{top}px"
		onpointerdown={(event) => event.stopPropagation()}
	>
		{#if running}
			<span class="cutout-canvas-status" role="status">
				<Loader size={16} aria-hidden="true" />{cutout.message}
			</span>
			<button
				type="button"
				class="cutout-canvas-icon"
				aria-label="Cancel background removal"
				onclick={() => cutout.cancel()}><X size={16} aria-hidden="true" /></button
			>
		{:else if refining}
			<button
				type="button"
				class="cutout-canvas-button"
				onclick={() => {
					refineFor = null;
					onrefine?.();
				}}><Scissors size={16} aria-hidden="true" />Refine edges</button
			>
		{:else}
			<button type="button" class="cutout-canvas-button" onclick={() => cutout.start(image.id)}
				><Scissors size={16} aria-hidden="true" />Remove background</button
			>
		{/if}
	</div>
{/if}

<style>
	.cutout-canvas-action {
		position: absolute;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px;
		border: 1px solid color-mix(in oklch, var(--ink) 8%, transparent);
		border-radius: 999px;
		background: oklch(1 0 none);
		box-shadow: 0 8px 24px color-mix(in oklch, oklch(0.201186 0.055198 262.3998) 14%, transparent);
		translate: -50% 0;
		white-space: nowrap;
	}
	.cutout-canvas-action.inside-edge {
		translate: -50% -100%;
	}
	.cutout-canvas-button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-block-size: 36px;
		padding-inline: 14px;
		border: 0;
		border-radius: 999px;
		background: var(--primary);
		color: oklch(1 0 none);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background-color var(--dur-fast, 120ms) var(--ease-out, ease-out);
	}
	.cutout-canvas-button:hover {
		background: var(--primary-hover);
	}
	.cutout-canvas-button:focus-visible,
	.cutout-canvas-icon:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	.cutout-canvas-status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding-inline: 10px 2px;
		color: var(--ink);
		font-size: 14px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.cutout-canvas-icon {
		display: inline-grid;
		place-items: center;
		inline-size: 32px;
		block-size: 32px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.cutout-canvas-icon:hover {
		background: color-mix(in oklch, var(--ink) 6%, transparent);
		color: var(--ink);
	}
	@media (prefers-reduced-motion: no-preference) {
		.cutout-canvas-status :global(svg) {
			animation: cutout-spin 1s linear infinite;
		}
		.cutout-canvas-action {
			animation: cutout-chip-in 180ms var(--ease-out, ease-out) both;
		}
	}
	@keyframes cutout-spin {
		to {
			rotate: 1turn;
		}
	}
	@keyframes cutout-chip-in {
		from {
			opacity: 0;
		}
	}
</style>
