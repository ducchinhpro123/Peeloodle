<script>
	/**
	 * Client-only canvas seam.
	 *
	 * Konva needs a browser (and its own canvas), so the real artboard is loaded
	 * dynamically on the client; component tests get the deterministic DOM artboard
	 * instead, sharing the same document state and commands.
	 */
	import { browser } from '$app/environment';
	import DomCanvas from './DomCanvas.svelte';
	/** @typedef {import('$lib/editor/editorState.svelte').EditorState} EditorState */

	/** @type {{ editor: EditorState, urls: Record<string, string>, domFallback?: boolean }} */
	let { editor, urls, domFallback = import.meta.env.MODE === 'test' } = $props();

	/** @type {any} */
	let Artboard = $state(null);

	$effect(() => {
		if (domFallback || !browser || Artboard) return;
		void import('./KonvaArtboard.svelte').then((module) => {
			Artboard = module.default;
		});
	});
</script>

{#if domFallback}
	<DomCanvas {editor} {urls} />
{:else if Artboard}
	<Artboard {editor} {urls} />
{:else}
	<div class="canvas-placeholder" data-testid="editor-canvas">
		<strong>Loading canvas…</strong>
		<small>The editor starts as soon as the browser canvas is ready.</small>
	</div>
{/if}
