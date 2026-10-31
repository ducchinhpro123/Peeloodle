<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
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
	<div class="button-row">
		<button
			type="button"
			class={buttonPrimary}
			disabled={image.locked || busy}
			title={busy && !mine
				? "Another layer's background is being removed. One removal runs at a time."
				: undefined}
			onclick={() => cutout.start(image.id)}>Remove background</button
		>
		{#if mine && busy}
			<button type="button" class={button} onclick={() => cutout.cancel()}>Cancel</button>
		{:else if state === 'error'}
			<button type="button" class={button} onclick={() => cutout.retry()}>Retry</button>
		{/if}
	</div>
	{#if mine && busy}
		{#if state === 'downloading' && cutout.progress !== null}
			<progress max="100" value={cutout.progress} aria-label="Model download"></progress>
		{:else}
			<progress aria-label="Removing background"></progress>
		{/if}
	{/if}
	<p class="muted [margin:0] [font-size:12px]" role="status">{mine ? cutout.message : ''}</p>
</div>
