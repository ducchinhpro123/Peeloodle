<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import Modal from '#lib/components/Modal.svelte';
	import { cutoutControllerFor } from '#lib/cutout/cutoutController.svelte.js';
	/**
	 * The one-time model download consent for "Remove background". Mounted once by
	 * the workspace, outside both inspectors (the inline one stays mounted while
	 * hidden at narrow widths, and the "Sticker properties" sheet mounts another),
	 * so a single `<dialog>` opens whichever inspector asked.
	 */

	/** @type {{ editor: import('#lib/editor/editorState.svelte.js').EditorState }} */
	let { editor } = $props();

	let cutout = $derived(cutoutControllerFor(editor));
</script>

<Modal
	open={cutout.state === 'consent'}
	title="Download background remover?"
	description="One-time download of about 45 MB, saved in your browser so it works offline afterwards. Photos stay on your device."
	onclose={() => cutout.cancel()}
>
	{#snippet footer()}
		<button type="button" class={button} onclick={() => cutout.cancel()}>Cancel</button>
		<button type="button" class={buttonPrimary} onclick={() => cutout.confirm()}
			>Download &amp; remove</button
		>
	{/snippet}
</Modal>
