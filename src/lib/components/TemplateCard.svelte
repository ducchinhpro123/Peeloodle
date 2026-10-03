<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import { asset } from '$app/paths';
	import Modal from './Modal.svelte';
	/** @typedef {import('#lib/domain/domain.js').Template} Template */

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
					class="template-preview-image [height:100%] [min-height:0] [width:100%] [object-fit:contain]"
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
		<div class="template-preview-body [display:grid] [gap:var(--space-4)]">
			<div class="detail-cover template-preview-art">
				{#if template.previewImage}
					<img
						class="template-preview-image [height:100%] [min-height:0] [width:100%] [object-fit:contain]"
						src={asset(template.previewImage)}
						alt={template.title}
					/>
				{:else}
					{template.preview}
				{/if}
			</div>
			{#if template.previewImage}
				<p class="muted [color:var(--muted)]">
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
			<button type="button" class={button} onclick={() => (open = false)}>Keep browsing</button>
			<button type="button" class={buttonPrimary} disabled={creating} onclick={use}>
				Use Template
			</button>
		{/snippet}
	</Modal>
</article>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.template-card small {
		color: var(--muted);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.35;
	}
	.template-card {
		min-width: 168px;
		flex: 1;
		padding: 8px 8px 16px;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
		scroll-snap-align: start;
		box-shadow: var(--shadow);
	}
	.template-card:nth-child(3n + 2) .template-art {
		background: radial-gradient(circle at 30% 20%, #fff9e2, #e9defa);
	}
	.template-card:nth-child(3n) .template-art {
		background: radial-gradient(circle at 30% 20%, #fff5ca, #ffdfd6);
	}
	:global(.template-card > b) {
		display: block;
		margin-top: 6px;
		padding: 0 9px;
	}
	.template-card > small {
		display: block;
		margin-top: 6px;
		padding: 0 9px;
	}
	.template-art {
		position: relative;
		display: grid;
		height: 128px;
		place-items: center;
		border-radius: var(--radius-sm);
		background: radial-gradient(circle at 30% 20%, #fff1f7, #d8f3e7);
		font-size: 63px;
	}
	.template-art .favorite-button {
		position: absolute;
		top: 4px;
		right: 4px;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: #ffffffe6;
		color: #c62c66;
		font-size: 22px;
	}
	.template-preview-trigger {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		padding: 0;
		border: 0;
		border-radius: inherit;
		background: transparent;
		color: inherit;
		font-size: inherit;
	}
	.template-preview-trigger:hover {
		box-shadow: inset 0 0 0 2px #00875e40;
	}
	.template-preview-trigger:focus-visible {
		outline-offset: -3px;
	}
	.template-title-btn {
		display: block;
		width: 100%;
		padding: 0 9px;
		margin-top: 6px;
		background: transparent;
		border: 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
		font: inherit;
	}
	.detail-cover.template-preview-art {
		height: 240px;
		font-size: 80px;
	}
	.detail-cover {
		display: grid;
		height: 155px;
		place-items: center;
		border-radius: 12px;
		background: linear-gradient(135deg, #dff7ee, #f5e7ff);
		font-size: 72px;
	}
	@media (max-width: 720px) {
		.template-card {
			min-width: 152px;
		}
	}
</style>
