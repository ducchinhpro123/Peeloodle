<script>
	/**
	 * Transparent PNG export dialog, ported from the source `ExportDialog`.
	 * Export waits for the mask stroke, re-checks the open document, renders with
	 * `bounds: 'artwork'` (tight artwork, no checkerboard, selection or zoom) and
	 * reports honestly that this is a PNG download, not a messenger pack.
	 */
	import { Download } from 'lucide-svelte';
	import Modal from './Modal.svelte';
	import { downloadBlob } from '$lib/exports/download';
	import { renderDocument } from '$lib/exports/renderDocument';
	/** @typedef {import('$lib/exports/renderDocument').ExportSize} ExportSize */
	/** @typedef {import('$lib/editor/editorState.svelte').EditorState} EditorState */
	/** @typedef {import('$lib/domain/domain').ProjectDocument} ProjectDocument */

	/** @type {{ editor: EditorState, document: ProjectDocument, open: boolean, onopenchange: (open: boolean) => void }} */
	let { editor, document, open, onopenchange } = $props();

	let size = $state(/** @type {ExportSize} */ (1024));
	let message = $state(/** @type {string | null} */ (null));
	let busy = $state(false);
	let canShare = $derived(
		typeof navigator !== 'undefined' && typeof navigator.share === 'function'
	);

	/** @param {boolean} share */
	async function exportPng(share) {
		busy = true;
		message = 'Exporting…';
		try {
			await editor.commitMaskStroke();
			if (editor.document?.id !== document.id) {
				throw new Error('The open project changed. Reopen export to continue.');
			}
			const epoch = editor.workspaceEpoch;
			const blob = await renderDocument(editor.document, editor.assets, {
				size,
				masks: editor.masks,
				bounds: 'artwork'
			});
			if (editor.workspaceEpoch !== epoch)
				throw new Error('Export canceled because the workspace changed.');
			const safeTitle = document.title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'sticker';
			const filename = `${safeTitle}-${size}.png`;
			if (share && typeof navigator.share === 'function') {
				try {
					const file = new File([blob], filename, { type: 'image/png' });
					const payload = {
						files: [file],
						title: document.title,
						text: 'StickerLab PNG. This is not a WhatsApp or Telegram sticker pack.'
					};
					if (!navigator.canShare || navigator.canShare(payload)) {
						await navigator.share(payload);
						message =
							'Share sheet opened. This is not a WhatsApp or Telegram install. You can still download a PNG if you cancel.';
						return;
					}
				} catch (error) {
					if (error instanceof Error && error.name === 'AbortError') {
						message = 'Share cancelled. Download a PNG if you still want the file.';
						return;
					}
				}
			}
			downloadBlob(blob, filename);
			message = `Download started for ${filename}. Check your browser downloads to confirm. This is not a WhatsApp or Telegram sticker pack.`;
		} catch (error) {
			message = error instanceof Error ? error.message : 'Export failed';
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	{open}
	title="Export sticker"
	description="Download a transparent PNG cropped to the outermost visible artwork, including outlines. The selected size caps the longest edge; aspect ratio is preserved. Hidden layers, checkerboard, selection handles, and zoom are not included. This is not a WhatsApp or Telegram sticker pack."
	onclose={() => onopenchange(false)}
>
	<div class="export-sizes">
		<label>
			<input
				type="radio"
				name="export-size"
				checked={size === 512}
				onchange={() => (size = 512)}
			/>Up to 512 px longest edge
		</label>
		<label>
			<input
				type="radio"
				name="export-size"
				checked={size === 1024}
				onchange={() => (size = 1024)}
			/>Up to 1024 px longest edge
		</label>
	</div>
	{#if message}
		<p role="status">{message}</p>
	{/if}
	{#snippet footer()}
		<button type="button" class="button" disabled={busy} onclick={() => exportPng(false)}>
			<Download size={16} />Download PNG
		</button>
		{#if canShare}
			<button type="button" class="button" disabled={busy} onclick={() => exportPng(true)}
				>Share PNG</button
			>
		{/if}
		<button type="button" class="button" onclick={() => onopenchange(false)}>Close</button>
	{/snippet}
</Modal>
