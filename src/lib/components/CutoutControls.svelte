<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import { cutoutControllerFor } from '#lib/cutout/cutoutController.svelte.js';
	/**
	 * "Remove background" for the selected image layer. The root carries the
	 * test contract: `data-state`, the last run's backend and timings, and
	 * `data-dropped`, the count of abandoned runs whose late output was discarded.
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
	let busy = $derived(cutout.state === 'downloading' || cutout.state === 'running');
</script>

<div
	class="cutout [display:grid] [gap:6px]"
	data-testid="cutout"
	data-state={cutout.state}
	data-backend={cutout.last?.backend}
	data-download-ms={cutout.last?.downloadMs}
	data-inference-ms={cutout.last?.inferenceMs}
	data-kept={cutout.last?.keptFraction}
	data-dropped={cutout.dropped}
>
	<div class="button-row">
		<button
			type="button"
			class={buttonPrimary}
			disabled={image.locked || busy}
			onclick={() => cutout.start(image.id)}>Remove background</button
		>
		{#if busy}
			<button type="button" class={button} onclick={() => cutout.cancel()}>Cancel</button>
		{:else if cutout.state === 'error'}
			<button type="button" class={button} onclick={() => cutout.retry()}>Retry</button>
		{/if}
	</div>
	{#if busy}
		{#if cutout.state === 'downloading' && cutout.progress !== null}
			<progress max="100" value={cutout.progress} aria-label="Model download"></progress>
		{:else}
			<progress aria-label="Removing background"></progress>
		{/if}
	{/if}
	<p class="muted [margin:0] [font-size:12px]" role="status">{cutout.message}</p>
</div>
