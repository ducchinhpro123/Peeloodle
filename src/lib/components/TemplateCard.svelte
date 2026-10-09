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
					class="template-preview-image [object-fit:contain] [block-size:100%] [inline-size:100%] [min-block-size:0]"
					src={asset(
						/** @type {import('$app/types').AssetPath} */ (template.previewImage.replace(/^\//, ''))
					)}
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
						class="template-preview-image [object-fit:contain] [block-size:100%] [inline-size:100%] [min-block-size:0]"
						src={asset(
							/** @type {import('$app/types').AssetPath} */ (
								template.previewImage.replace(/^\//, '')
							)
						)}
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
		min-inline-size: 168px;
		flex: 1;
		padding-block-start: 8px;
		padding-block-end: 16px;
		padding-inline-start: 8px;
		padding-inline-end: 8px;
		overflow: clip;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: oklch(1 0 none);
		scroll-snap-align: start;
		box-shadow: var(--shadow);
	}
	.template-card:nth-child(3n + 2) .template-art {
		background: radial-gradient(
			circle at 30% 20%,
			oklch(0.980714 0.030736 94.8832),
			oklch(0.917772 0.039377 303.4203)
		);
	}
	.template-card:nth-child(3n) .template-art {
		background: radial-gradient(
			circle at 30% 20%,
			oklch(0.967293 0.056544 96.4162),
			oklch(0.927662 0.037658 36.2254)
		);
	}
	:global(.template-card > b) {
		display: block;
		margin-block-start: 6px;
		padding-block-start: 0;
		padding-block-end: 0;
		padding-inline-start: 9px;
		padding-inline-end: 9px;
	}
	.template-card > small {
		display: block;
		margin-block-start: 6px;
		padding-block-start: 0;
		padding-block-end: 0;
		padding-inline-start: 9px;
		padding-inline-end: 9px;
	}
	.template-art {
		position: relative;
		display: grid;
		block-size: 128px;
		place-items: center;
		border-radius: var(--radius-sm);
		background: radial-gradient(
			circle at 30% 20%,
			oklch(0.970809 0.016943 349.4803),
			oklch(0.94119 0.032488 167.1257)
		);
		font-size: 63px;
	}
	.template-art .favorite-button {
		position: absolute;
		inset-block-start: 4px;
		inset-inline-end: 4px;
		display: grid;
		place-items: center;
		inline-size: 44px;
		block-size: 44px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: color-mix(in oklch, oklch(1 0 none) 90.1961%, transparent);
		color: oklch(0.553692 0.192534 3.7887);
		font-size: 22px;
	}
	.template-preview-trigger {
		display: grid;
		place-items: center;
		inline-size: 100%;
		block-size: 100%;
		min-block-size: 0;
		overflow: clip;
		padding: 0;
		border: 0;
		border-radius: inherit;
		background: transparent;
		color: inherit;
		font-size: inherit;
	}
	@media (hover: hover) and (pointer: fine) {
		.template-preview-trigger:hover {
			box-shadow: inset 0 0 0 2px
				color-mix(in oklch, oklch(0.551582 0.11869 163.307) 25.098%, transparent);
		}
	}
	.template-preview-trigger:focus-visible {
		outline-offset: -3px;
	}
	.template-title-btn {
		display: block;
		inline-size: 100%;
		padding-block-start: 0;
		padding-block-end: 0;
		padding-inline-start: 9px;
		padding-inline-end: 9px;
		margin-block-start: 6px;
		background: transparent;
		border: 0;
		text-align: start;
		cursor: pointer;
		color: inherit;
		font: inherit;
	}
	.detail-cover.template-preview-art {
		block-size: 240px;
		font-size: 80px;
	}
	.detail-cover {
		display: grid;
		block-size: 155px;
		place-items: center;
		border-radius: 12px;
		background: linear-gradient(
			135deg,
			oklch(0.956132 0.027801 171.2158),
			oklch(0.946118 0.035177 311.4254)
		);
		font-size: 72px;
	}
	@media (max-width: 720px) {
		.template-card {
			min-inline-size: 152px;
		}
	}
</style>
