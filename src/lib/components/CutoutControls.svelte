<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import { Scissors } from 'lucide-svelte';
	import { cutoutControllerFor } from '#lib/cutout/cutoutController.svelte.js';
	/**
	 * "Remove background" for the selected image layer. The root carries the
	 * test contract: `data-state`, the last run's backend and timings, and
	 * `data-dropped`, the count of abandoned runs whose late output was discarded,
	 * and `data-deferred` while a finished result waits for an open gesture to end.
	 * The consent dialog is `CutoutConsent.svelte`, mounted once by the workspace.
	 */

	/**
	 * @type {{
	 *   editor: import('#lib/editor/editorState.svelte.js').EditorState,
	 *   image: import('#lib/domain/domain.js').ImageLayer,
	 * }}
	 */
	let { editor, image } = $props();

	let cutout = $derived(cutoutControllerFor(editor));
	/** One job runs at a time, whichever layer it is on. */
	let busy = $derived(cutout.state === 'downloading' || cutout.state === 'running');
	/** The run's status is this layer's; any other layer shows idle. */
	let mine = $derived(cutout.layerId === image.id);
	let state = $derived(mine ? cutout.state : 'idle');
	let last = $derived(mine ? cutout.last : null);
</script>

<div
	class="cutout [display:grid] [gap:6px]"
	data-testid="cutout"
	data-state={state}
	data-backend={last?.backend}
	data-download-ms={last?.downloadMs}
	data-inference-ms={last?.inferenceMs}
	data-kept={last?.keptFraction}
	data-dropped={cutout.dropped}
	data-deferred={mine && cutout.deferred ? 'true' : undefined}
>
	{#if mine && busy}
		<div class="cutout-progress">
			<div class="cutout-progress-head">
				<span role="status">{cutout.message}</span>
				<button type="button" class="cutout-progress-cancel" onclick={() => cutout.cancel()}
					>Cancel</button
				>
			</div>
			{#if state === 'downloading' && cutout.progress !== null}
				<progress max="100" value={cutout.progress} aria-label="Model download"></progress>
			{:else}
				<progress aria-label="Removing background"></progress>
			{/if}
		</div>
	{:else}
		<div class="button-row">
			<button
				type="button"
				class={buttonPrimary}
				disabled={image.locked || busy}
				title={busy
					? "Another layer's background is being removed. One removal runs at a time."
					: undefined}
				onclick={() => cutout.start(image.id)}><Scissors size={16} />Remove background</button
			>
			{#if state === 'error'}
				<button type="button" class={button} onclick={() => cutout.retry()}>Retry</button>
			{/if}
		</div>
		<p class="muted [margin:0] [font-size:12px]" role="status">{mine ? cutout.message : ''}</p>
	{/if}
</div>

<style>
	.cutout-progress {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid color-mix(in oklch, var(--ink) 8%, transparent);
		border-radius: 12px;
		background: color-mix(in oklch, var(--primary) 6%, oklch(1 0 none));
	}
	.cutout-progress-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: var(--ink);
		font-size: 14px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.cutout-progress-cancel {
		padding: 4px 8px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.cutout-progress-cancel:hover {
		background: color-mix(in oklch, var(--ink) 6%, transparent);
		color: var(--ink);
	}
	.cutout-progress-cancel:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	.cutout-progress progress {
		inline-size: 100%;
		block-size: 4px;
		border: 0;
		border-radius: 4px;
		overflow: hidden;
		appearance: none;
		background: color-mix(in oklch, var(--primary) 16%, transparent);
		color: var(--primary);
	}
	.cutout-progress progress::-webkit-progress-bar {
		background: color-mix(in oklch, var(--primary) 16%, transparent);
	}
	.cutout-progress progress::-webkit-progress-value {
		background: var(--primary);
		border-radius: 4px;
	}
	.cutout-progress progress::-moz-progress-bar {
		background: var(--primary);
		border-radius: 4px;
	}
	/* Indeterminate: a short segment sliding along the track instead of a full bar. */
	.cutout-progress progress:indeterminate {
		background:
			linear-gradient(90deg, transparent, var(--primary), transparent) 0 0 / 40% 100% no-repeat,
			color-mix(in oklch, var(--primary) 16%, transparent);
	}
	.cutout-progress progress:indeterminate::-webkit-progress-bar {
		background: transparent;
	}
	.cutout-progress progress:indeterminate::-moz-progress-bar {
		background: transparent;
	}
	@media (prefers-reduced-motion: no-preference) {
		.cutout-progress progress:indeterminate {
			animation: cutout-indeterminate 1.2s ease-in-out infinite;
		}
	}
	@keyframes cutout-indeterminate {
		from {
			background-position:
				-40% 0,
				0 0;
		}
		to {
			background-position:
				140% 0,
				0 0;
		}
	}
</style>
