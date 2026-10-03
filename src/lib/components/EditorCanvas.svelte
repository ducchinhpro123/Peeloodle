<script>
	/**
	 * Client-only canvas seam.
	 *
	 * Konva needs a browser (and its own canvas), so the artboard is loaded
	 * dynamically on the client.
	 */
	import { browser } from '$app/environment';
	/** @typedef {import('$lib/editor/editorState.svelte').EditorState} EditorState */

	/** @type {{ editor: EditorState, urls: Record<string, string> }} */
	let { editor, urls } = $props();

	/** @type {any} */
	let Artboard = $state(null);

	$effect(() => {
		if (!browser || Artboard) return;
		void import('./KonvaArtboard.svelte').then((module) => {
			Artboard = module.default;
		});
	});
</script>

{#if Artboard}
	<Artboard {editor} {urls} />
{:else}
	<div class="canvas-placeholder" data-testid="editor-canvas">
		<strong>Loading canvas…</strong>
		<small>The editor starts as soon as the browser canvas is ready.</small>
	</div>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.canvas-placeholder {
		position: relative;
		padding: 30px;
		border-radius: 20px;
		background: #ffffffc9;
		box-shadow: 0 5px 16px #5774a133;
		text-align: center;
	}
	:global(.canvas-placeholder .sticker) {
		display: inline-block;
	}
	.canvas-placeholder strong {
		display: block;
	}
	.canvas-placeholder small {
		display: block;
	}
	.canvas-placeholder small {
		margin-top: 7px;
		color: var(--muted);
	}
</style>
