<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	/**
	 * Export dialog (P40). The page owns the export controller; this shows the two
	 * formats plus the backup, live progress, cancellation while work is running, and
	 * any preflight warnings that should be read before relying on the file.
	 */
	import { Download } from 'lucide-svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { offlineReadinessLabel } from '#lib/presentations/offlineReadiness.js';

	/** @type {{
	 *   exportState: import('#lib/presentations/editor/exportController.js').PresentationExportState,
	 *   offline: import('#lib/presentations/offlineReadiness.js').PresentationOfflineSnapshot,
	 *   reloadSafety: import('#lib/presentations/offlineReadiness.js').ReloadSafety,
	 *   onexport: (format: import('#lib/presentations/editor/exportController.js').PresentationExportFormat) => void,
	 *   oncancel: () => void
	 * }} */
	let { exportState, offline, reloadSafety, onexport, oncancel } = $props();

	// Direct backup failures appear next to the backup action on the page.
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

<button type="button" class={button} bind:this={opener} onclick={() => (open = true)}
	><Download size={16} aria-hidden="true" /> Export</button
>
<Modal
	{open}
	title="Export presentation"
	description="Choose the file for what you want to do. Every format includes all your slides in order."
	onclose={() => (open = false)}
	onclosed={() => opener?.focus()}
>
	<dl class="format-guide">
		<div>
			<dt>PDF · For handing in</dt>
			<dd>Fixed slide pages that keep your visuals. Not editable slides.</dd>
		</div>
		<div>
			<dt>PPTX · For editing elsewhere</dt>
			<dd>
				Editable text, shapes and pictures. Check the file in your presentation app before your
				deadline.
			</dd>
		</div>
		<div>
			<dt>Backup · For reopening here</dt>
			<dd>
				Your editable deck and images in a .stickerlab.zip. Restore it from the presentation
				library, including on another device.
			</dd>
		</div>
	</dl>
	<div
		class="presentation-export-actions [margin-top:var(--space-4)] [display:flex] [flex-wrap:wrap] [gap:var(--space-2)]"
	>
		<button type="button" class={buttonPrimary} disabled={busy} onclick={() => onexport('pdf')}
			>Export PDF</button
		>
		<button type="button" class={button} disabled={busy} onclick={() => onexport('pptx')}
			>Export PPTX</button
		>
		<button type="button" class={button} disabled={busy} onclick={() => onexport('backup')}
			>Download backup (.zip)</button
		>
		{#if busy}<button type="button" class={button} onclick={oncancel}>Cancel export</button>{/if}
	</div>
	<!-- The same status the library shows: exporting offline only works once the
	     warm-up finished, and a failed warm-up says how to recover — never by
	     reloading over the editor's unwritten work. Not a second live region — the
	     library's status announces the change, and this line is only read while
	     the dialog is open. -->
	<p>{offlineReadinessLabel(offline, reloadSafety)}</p>
	<p class="muted [color:var(--muted)]">
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

<style>
	.format-guide {
		display: grid;
		gap: 14px;
		font-size: 13px;
		line-height: 1.5;
	}
	.format-guide dt {
		font-weight: 700;
	}
	.format-guide dd {
		margin: 4px 0 0;
		color: var(--muted);
	}
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-export-warnings {
		margin-top: var(--space-4);
		padding: var(--space-3);
		border: 1px solid var(--warning-line);
		border-radius: var(--radius-sm);
		background: var(--warning-bg);
		color: var(--warning-ink);
		font-size: 12px;
		font-weight: 600;
	}
	.presentation-export-warnings p {
		margin: 0 0 var(--space-2);
	}
	.presentation-export-warnings ul {
		margin: 0;
		padding-left: 1.1em;
	}
</style>
