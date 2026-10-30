<script>
	/**
	 * The editor's title bar: the ways out (Back, Home), the deck title, save
	 * status and Save, Export and Save as template, and the recovery actions a
	 * failed or conflicting save needs.
	 *
	 * @type {{
	 *   backhref: string,
	 *   onleave: (event: MouseEvent) => void,
	 *   saveLabel: string,
	 *   saveMessage: string | null,
	 *   saveStatus: import('#lib/presentations/editor/persistence/persistence.svelte.js').PresentationSaveStatus,
	 *   saveReported: boolean,
	 *   onsave: () => void,
	 *   exportState: import('#lib/presentations/editor/exportController.js').PresentationExportState,
	 *   offline: import('#lib/presentations/offlineReadiness.js').PresentationOfflineSnapshot,
	 *   recovering: boolean,
	 *   onreloaddraft: () => void,
	 *   onkeepcopy: () => void
	 * }}
	 */
	let {
		backhref,
		onleave,
		saveLabel,
		saveMessage,
		saveStatus,
		saveReported,
		onsave,
		exportState,
		offline,
		recovering,
		onreloaddraft,
		onkeepcopy
	} = $props();

	import { ArrowLeft, Home, Save } from 'lucide-svelte';
	import { button, buttonIcon } from '#lib/ui/styles.js';
	import { shellHref } from '#lib/app/navigation.js';
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import ExportDialog from '../ExportDialog.svelte';
	import SaveAsTemplateDialog from '../SaveAsTemplateDialog.svelte';

	const { doc, policy, services, inserts, exports } = getSlideEditor();
	const presentation = $derived(doc.document);
</script>

{#if presentation}
	<div class="presentation-editor-bar" role="banner" aria-label="Presentation title bar">
		<div class="presentation-editor-heading">
			<a class={buttonIcon} aria-label="Back to presentations" href={backhref} onclick={onleave}
				><ArrowLeft size={19} /></a
			>
			<a class={buttonIcon} aria-label="Home" title="StickerLab home" href={shellHref('/')}
				><Home size={18} aria-hidden="true" /></a
			>
			<div class="presentation-editor-title">
				<p>{policy.labels.heading}</p>
				<h1 title={presentation.title}>{presentation.title}</h1>
			</div>
			<p class="presentation-local-status" role="status" title={saveMessage ?? undefined}>
				{saveLabel}
			</p>
			<button type="button" class={button} onclick={onsave}
				><Save size={16} aria-hidden="true" /> {policy.labels.save}</button
			>
			{#if policy.capabilities.export}
				<ExportDialog
					{exportState}
					{offline}
					reloadSafety={{ unsavedWork: doc.dirty, saveFailed: saveReported }}
					onexport={(format) => void exports.exportDeck(format)}
					oncancel={() => exports.cancel()}
				/>
			{/if}
			{#if services.catalogAdmin && policy.capabilities.saveAsTemplate}<SaveAsTemplateDialog
					repository={services.catalogAdmin}
					needsCollection={presentation.assets.some(
						(asset) => asset.provenance.source !== 'catalog'
					)}
					defaultTitle={presentation.title}
					onsave={(input) => inserts.saveAsTemplate(input)}
				/>{/if}
			{#if saveStatus === 'conflict' && policy.conflictRecovery === 'reload-draft'}
				<button
					type="button"
					class={button}
					title="Discard your changes and load the newest saved draft"
					onclick={onreloaddraft}>Reload draft (discards my changes)</button
				>
			{:else if saveStatus === 'conflict'}
				<button type="button" class={button} disabled={recovering} onclick={onkeepcopy}
					>{recovering ? 'Keeping your copy…' : 'Keep my copy'}</button
				>
			{/if}
			{#if saveReported && policy.capabilities.export}
				<!-- Recovery guidance: if the local write fails, the work can still leave
				     the browser as a backup archive. -->
				<button type="button" class={button} onclick={() => void exports.exportDeck('backup')}
					>Download backup</button
				>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Keep the deck title and Save fixed. Tools have their own single scrollable
	 * row so selecting an element or changing the save status never shifts the slide. */
	.presentation-editor-bar {
		display: flex;
		min-inline-size: 0;
		flex-direction: column;
		border-block-end: 1px solid var(--line);
		background: var(--surface);
	}
	.presentation-editor-heading {
		display: flex;
		min-inline-size: 0;
		min-block-size: 44px;
		align-items: center;
		gap: var(--space-2);
		padding-block: 4px;
		padding-inline: var(--space-2) var(--space-3);
		background: oklch(0.968 0.003 264);
	}
	.presentation-editor-heading :global(.button) {
		min-block-size: 32px;
		padding-inline: 12px;
		padding-block: 4px;
		border-radius: 5px;
		font-size: 13px;
		box-shadow: none;
	}
	.presentation-editor-heading :global(.button.icon) {
		inline-size: 32px;
		padding: 0;
	}
	.presentation-editor-heading > .button {
		flex: none;
	}
	.presentation-editor-title {
		flex: 1 1 auto;
		min-inline-size: 0;
	}
	.presentation-editor-title p {
		margin: 0;
	}
	.presentation-editor-title h1 {
		margin: 0;
	}
	.presentation-editor-title p {
		color: var(--muted);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.presentation-editor-title h1 {
		max-inline-size: 100%;
		overflow: hidden;
		font-size: 15px;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-local-status {
		flex: 0 1 30ch;
		min-inline-size: 0;
		margin: 0;
		overflow: hidden;
		color: oklch(0.515677 0.11125 163.1262);
		font-size: 12px;
		font-weight: 800;
		text-align: end;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 720px) {
		.presentation-editor-heading {
			display: grid;
			grid-template-columns: 40px 40px minmax(0, 1fr) auto auto;
			gap: 4px;
			padding-inline: var(--space-2);
		}
		.presentation-editor-heading > a:nth-child(1) {
			grid-column: 1;
			grid-row: 1;
		}
		.presentation-editor-heading > a:nth-child(2) {
			grid-column: 2;
			grid-row: 1;
		}
		.presentation-editor-title {
			grid-column: 3 / -1;
			grid-row: 1;
		}
		.presentation-editor-title p {
			display: none;
		}
		.presentation-local-status {
			grid-column: 1 / 4;
			grid-row: 2;
			text-align: start;
		}
		.presentation-editor-heading > :global(button) {
			grid-row: 2;
		}
		.presentation-editor-heading > .button {
			min-block-size: 40px;
			padding-inline: var(--space-2);
		}
		.presentation-local-status {
			flex-basis: 7ch;
			font-size: 10px;
		}
		.presentation-editor-title h1 {
			display: block;
			white-space: nowrap;
		}
	}
</style>
