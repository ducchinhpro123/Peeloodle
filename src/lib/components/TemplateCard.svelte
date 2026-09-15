<script>
	import { asset } from '$app/paths';
	import Modal from './Modal.svelte';
	/** @typedef {import('$lib/domain/domain').Template} Template */

	/**
	 * @type {{
	 *   template: Template,
	 *   isFavorite: boolean,
	 *   onToggleFavorite: (id: string) => void,
	 *   onUse: (template: Template) => Promise<void>,
	 * }}
	 */
	let { template, isFavorite, onToggleFavorite, onUse } = $props();

	let open = $state(false);
	let error = $state(/** @type {string | null} */ (null));
	let creating = $state(false);

	async function use() {
		creating = true;
		error = null;
		try {
			await onUse(template);
			open = false;
		} catch {
			error = 'Could not save the template. Please retry; the original is unchanged.';
		} finally {
			creating = false;
		}
	}
</script>

<article class="template-card">
	<div class="template-art">
		<button
			type="button"
			class="template-preview-trigger"
			aria-label={`Preview ${template.title}`}
			onclick={() => (open = true)}
		>
			{#if template.previewImage}
				<img
					class="template-preview-image"
					src={asset(template.previewImage)}
					alt=""
					loading="lazy"
				/>
			{:else}
				{template.preview}
			{/if}
		</button>
		<button
			type="button"
			class="favorite-button"
			aria-label={isFavorite
				? `Remove ${template.title} from favorites`
				: `Add ${template.title} to favorites`}
			onclick={() => onToggleFavorite(template.id)}
		>
			{isFavorite ? '❤️' : '♡'}
		</button>
	</div>
	<button type="button" class="template-title-btn" onclick={() => (open = true)}>
		<b>{template.title}</b>
	</button>
	<small
		>{template.category} · {template.document.layers.length}
		{template.document.layers.length === 1 ? 'layer' : 'layers'}</small
	>

	<Modal
		{open}
		title={template.title}
		description="Clone this template into an independent editable sticker."
		onclose={() => (open = false)}
	>
		<div class="template-preview-body">
			<div class="detail-cover template-preview-art">
				{#if template.previewImage}
					<img
						class="template-preview-image"
						src={asset(template.previewImage)}
						alt={template.title}
					/>
				{:else}
					{template.preview}
				{/if}
			</div>
			{#if template.previewImage}
				<p class="muted">
					Replace the sample cat with your own photo, edit the caption, and move each decoration
					independently. In the editor, select your photo layer and use <strong
						>Replace photo</strong
					> at the top of the Sticker Properties panel — it sits above the Adjust / Effects / Position
					/ Layers tabs (open “Sticker properties” first on a narrow screen). Photo backgrounds are not
					removed automatically.
				</p>
			{/if}
			<p><strong>Category:</strong> {template.category}</p>
			<p>
				<strong>Layers:</strong>
				{template.document.layers.map((layer) => layer.name).join(', ') || 'Starter artwork'}
			</p>
			{#if error}
				<p role="alert">{error}</p>
			{/if}
		</div>
		{#snippet footer()}
			<button type="button" class="button" onclick={() => (open = false)}>Keep browsing</button>
			<button type="button" class="button primary" disabled={creating} onclick={use}>
				Use Template
			</button>
		{/snippet}
	</Modal>
</article>
