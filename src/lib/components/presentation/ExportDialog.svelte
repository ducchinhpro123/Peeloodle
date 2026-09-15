<script>
	/**
	 * Export dialog (P40). The page owns the export controller; this shows the two
	 * formats plus the backup, live progress, cancellation while work is running, and
	 * any preflight warnings that should be read before relying on the file.
	 */
	import { Download } from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { offlineReadinessLabel } from '$lib/presentations/offlineReadiness';

	/** @type {{
	 *   exportState: import('$lib/presentations/editor/exportController').PresentationExportState,
	 *   offline: import('$lib/presentations/offlineReadiness').PresentationOfflineSnapshot,
	 *   reloadSafety: import('$lib/presentations/offlineReadiness').ReloadSafety,
	 *   onexport: (format: import('$lib/presentations/editor/exportController').PresentationExportFormat) => void,
	 *   oncancel: () => void
	 * }} */
	let { exportState, offline, reloadSafety, onexport, oncancel } = $props();

	let open = $state(false);
	/** @type {HTMLButtonElement | null} */
	let opener = $state(null);
	const busy = $derived(exportState.phase === 'preparing' || exportState.phase === 'rendering');
	// The labels are built here, not in the markup: Svelte's template parser reads the
	// `{` of a template literal's `${…}` as the end of the mustache expression.
	const progressLabel = $derived(
		exportState.phase === 'preparing'
			? 'Preparing artwork and fonts…'
			: `Rendering slides… ${exportState.completed}/${exportState.total}`
	);
</script>

<button type="button" class="button" bind:this={opener} onclick={() => (open = true)}
	><Download size={16} aria-hidden="true" /> Export</button
>
<Modal
	{open}
	title="Export presentation"
	description="PDF keeps the exact slide visuals as fixed pages; PPTX keeps text, shapes and pictures editable. Both include every slide in order."
	onclose={() => (open = false)}
	onclosed={() => opener?.focus()}
>
	<div class="presentation-export-actions">
		<button type="button" class="button primary" disabled={busy} onclick={() => onexport('pdf')}
			>Export PDF</button
		>
		<button type="button" class="button" disabled={busy} onclick={() => onexport('pptx')}
			>Export PPTX</button
		>
		<button type="button" class="button" disabled={busy} onclick={() => onexport('backup')}
			>Download backup (.zip)</button
		>
		{#if busy}<button type="button" class="button" onclick={oncancel}>Cancel export</button>{/if}
	</div>
	<!-- The same status the library shows: exporting offline only works once the
	     warm-up finished, and a failed warm-up says how to recover — never by
	     reloading over the editor's unwritten work. Not a second live region — the
	     library's status announces the change, and this line is only read while
	     the dialog is open. -->
	<p>{offlineReadinessLabel(offline, reloadSafety)}</p>
	<p class="muted">
		The backup is a .stickerlab.zip with the document and every image, restorable from the
		presentation library on any device.
	</p>
	{#if busy}
		<p role="status">{progressLabel}</p>
	{/if}
	{#if exportState.phase === 'done'}<p role="status">
			Export ready. Check your browser’s downloads for the file.
		</p>{/if}
	{#if exportState.phase === 'cancelled'}<p role="status">
			The export was cancelled. No file was produced.
		</p>{/if}
	{#if exportState.phase === 'failed' && exportState.message}<p role="alert">
			{exportState.message}
		</p>{/if}
	{#if exportState.warnings.length > 0}
		<div class="presentation-export-warnings">
			<p>Before you rely on this export:</p>
			<ul>
				{#each exportState.warnings as warning (warning.code + '-' + warning.elementId)}
					<li>{warning.message}</li>
				{/each}
			</ul>
		</div>
	{/if}
</Modal>
