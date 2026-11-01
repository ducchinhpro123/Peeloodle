<script>
	import { onMount } from 'svelte';
	import { Search, Plus, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { SHIPPED_TEMPLATES } from '#lib/presentations/templates/shippedTemplates.js';
	import { categoryForUseCase, GALLERY_CATEGORIES } from '#lib/presentations/tasks.js';
	import { ensurePresentationFonts } from '#lib/presentations/rendering/fonts.js';
	import { rasterizeSlidePage } from '#lib/presentations/rendering/rasterizeSlide.js';
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import Modal from './Modal.svelte';
	import { resolve } from '$app/paths';

	/** @type {{ repository: import('#lib/presentations/persistence/repository.js').PresentationRepository, onopen: (id: string) => void | Promise<void>, onblank: () => void, creatingBlank: boolean, category: import('#lib/presentations/tasks.js').GalleryCategory, oncategory: (slug: import('#lib/presentations/tasks.js').GalleryCategory) => void }} */
	let { repository, onopen, onblank, creatingBlank, category, oncategory } = $props();
	let query = $state('');
	/** @type {Array<{ key: string, title: string, description: string, category: import('#lib/presentations/tasks.js').GalleryCategory | null, document: import('#lib/presentations/model/types.js').PresentationDocument, previews: string[] }>} */
	let decks = $state.raw([]);
	let loading = $state(true);
	let previewError = $state(false);
	let selectedKey = $state('');
	let slideIndex = $state(0);
	let creating = $state(false);
	let error = $state('');
	let mounted = $state(false);
	let cancelPreviews = () => {};
	const selected = $derived(decks.find((deck) => deck.key === selectedKey));
	const filtered = $derived(
		decks.filter(
			(deck) =>
				(category === 'all' || deck.category === category) &&
				`${deck.title} ${deck.description}`.toLowerCase().includes(query.trim().toLowerCase())
		)
	);
	onMount(() => {
		mounted = true;
		refreshPreviews();
		return () => cancelPreviews();
	});

	function refreshPreviews() {
		cancelPreviews();
		cancelPreviews = preparePreviews();
	}

	function preparePreviews() {
		let live = true;
		loading = true;
		previewError = false;
		const built = SHIPPED_TEMPLATES.map((template) => ({
			key: template.key,
			title: template.title,
			description: template.description,
			category: categoryForUseCase(template.useCase),
			document: template.build(),
			previews: /** @type {string[]} */ ([])
		}));
		decks = built;
		void (async () => {
			try {
				await ensurePresentationFonts();
				for (const deck of built) {
					const template = SHIPPED_TEMPLATES.find((item) => item.key === deck.key);
					/** @type {import('#lib/presentations/rendering/decodedArtwork.js').DecodedArtworkSources | null} */
					let artwork = null;
					try {
						if (template?.loadArtwork) {
							const { decodeArtworkBatch } =
								await import('#lib/presentations/rendering/decodedArtwork.js');
							artwork = await decodeArtworkBatch(await template.loadArtwork(deck.document));
						}
						for (const slide of deck.document.slides) {
							if (!live) return;
							const raster = await rasterizeSlidePage({
								slide,
								pageSize: deck.document.pageSize,
								images: artwork?.images ?? new Map(),
								width: 640,
								height: 360
							});
							deck.previews = [...deck.previews, raster.dataUrl];
							if (live) decks = built.map((item) => ({ ...item }));
						}
					} catch {
						if (live) previewError = true;
					} finally {
						artwork?.dispose();
					}
				}
			} finally {
				if (live) loading = false;
			}
		})();
		return () => {
			live = false;
		};
	}

	async function useTemplate() {
		if (!selected || creating) return;
		const template = SHIPPED_TEMPLATES.find((item) => item.key === selected.key);
		if (!template) return;
		creating = true;
		error = '';
		try {
			const document = template.build();
			const media = template.loadArtwork ? await template.loadArtwork(document) : [];
			await repository.savePresentation(document, media);
			await onopen(document.id);
		} catch {
			error =
				'Could not open this template. Your existing presentations are unchanged. Please try again.';
		} finally {
			creating = false;
		}
	}
</script>

<section class="starter-gallery" aria-labelledby="starter-heading">
	<div class="gallery-heading">
		<div>
			<h2 id="starter-heading">Start with a template</h2>
			<p>A head start for your next big idea. Every slide is yours to edit.</p>
		</div>
		<span class="local-note">Built in · No account needed</span>
	</div>
	<p class="catalog-note">
		These starters work without an account.
		<a href={resolve('presentation-templates')}>Browse online deck templates</a>
		for more — internet access required.
	</p>
	<div class="gallery-toolbar">
		<label class="template-search">
			<Search size={16} aria-hidden="true" />
			<span class="sr-only">Search presentation templates</span>

			<input type="search" bind:value={query} placeholder="Find your starting point…" />
		</label>

		<div class="categories" role="group" aria-label="Template category">
			{#each GALLERY_CATEGORIES as item (item.slug)}
				<button
					class={{ active: category === item.slug }}
					aria-pressed={category === item.slug}
					onclick={() => oncategory(item.slug)}>{item.label}</button
				>
			{/each}
		</div>
	</div>
	<div class="template-grid">
		<button
			class="blank-template"
			onclick={onblank}
			disabled={!mounted || creatingBlank}
			aria-busy={!mounted || creatingBlank}
		>
			<span class="blank-art"><Plus size={28} /></span>
			<strong>{!mounted ? 'Loading…' : creatingBlank ? 'Creating…' : 'Start from scratch'}</strong>
			<small>Blank 16:9 presentation</small>
		</button>

		{#each filtered as deck (deck.key)}
			<button
				class="template-card"
				aria-label="Preview {deck.title}"
				onclick={() => {
					selectedKey = deck.key;
					slideIndex = 0;
					error = '';
				}}
			>
				<span class="template-cover"
					>{#if deck.previews[0]}<img
							src={deck.previews[0]}
							alt=""
							width="640"
							height="360"
						/>{:else}<span class="cover-placeholder"
							>{deck.title}<small
								>{previewError ? 'Preview unavailable' : 'Preparing preview…'}</small
							></span
						>{/if}<span class="slide-count">{deck.document.slides.length} slides</span></span
				>
				<span class="card-caption"><strong>{deck.title}</strong><ArrowRight size={16} /></span
				><small
					>{GALLERY_CATEGORIES.find((item) => item.slug === deck.category)?.label ?? 'Template'} · {deck
						.document.assets.length
						? 'Editable text & layout artwork'
						: 'Fully editable'}</small
				>
			</button>
		{/each}
	</div>
	{#if !loading && filtered.length === 0}<div class="no-results">
			<p>No templates match your search.</p>
			<button
				class={button}
				onclick={() => {
					query = '';
					oncategory('all');
				}}>Clear filters</button
			>
		</div>{/if}
	{#if previewError}<p role="status">
			Slide previews couldn’t load. You can still use a template. <button
				class={button}
				onclick={refreshPreviews}>Retry previews</button
			>
		</p>{/if}
</section>

<Modal
	open={!!selected}
	title={selected?.title ?? 'Template preview'}
	description={selected?.description}
	closeDisabled={creating}
	onclose={() => (selectedKey = '')}
>
	{#if selected}
		<div class="slide-preview">
			{#if selected.previews[slideIndex]}<img
					src={selected.previews[slideIndex]}
					alt="Slide {slideIndex + 1} preview"
					width="640"
					height="360"
				/>{:else}<p role="status">
					{previewError ? 'Preview unavailable' : 'Preparing slide preview…'}
				</p>{/if}
		</div>
		<div class="preview-controls">
			<button
				class={button}
				aria-label="Previous slide"
				disabled={slideIndex === 0}
				onclick={() => slideIndex--}><ChevronLeft size={18} /></button
			><span aria-live="polite">Slide {slideIndex + 1} of {selected.document.slides.length}</span
			><button
				class={button}
				aria-label="Next slide"
				disabled={slideIndex === selected.document.slides.length - 1}
				onclick={() => slideIndex++}><ChevronRight size={18} /></button
			>
		</div>
		<p class="preview-note">
			Creates a new presentation saved in this browser. {selected.document.assets.length
				? 'Text is editable. Photos, charts and geometric decorations are in locked image layers; unlock to replace or remove them.'
				: 'Sample text and image placeholders are editable.'}
		</p>
		{#if error}<p role="alert">{error}</p>{/if}
	{/if}
	{#snippet footer()}<button class={buttonPrimary} disabled={creating} onclick={useTemplate}
			>{creating ? 'Creating presentation…' : 'Use template'}<ArrowRight size={16} /></button
		>{/snippet}
</Modal>

<style>
	.starter-gallery {
		padding: 28px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.gallery-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
	}
	h2 {
		margin: 0;
		font-size: clamp(23px, 2.5vw, 32px);
		letter-spacing: -0.04em;
	}
	.gallery-heading p {
		margin-block-start: 8px;
		margin-block-end: 0;
		margin-inline-start: 0;
		margin-inline-end: 0;
		color: var(--muted);
		font-size: 14px;
	}
	.catalog-note {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.5;
	}
	.catalog-note a {
		color: var(--scrapbook-green);
		font-weight: 700;
	}
	.local-note {
		color: var(--scrapbook-green);
		font-size: 12px;
		white-space: nowrap;
	}
	.gallery-toolbar {
		display: flex;
		gap: 20px;
		align-items: center;
		flex-wrap: wrap;
		margin-block-start: 26px;
		margin-block-end: 26px;
		margin-inline-start: 0;
		margin-inline-end: 0;
	}
	.template-search {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1 1 240px;
		padding-block-start: 0;
		padding-block-end: 0;
		padding-inline-start: 16px;
		padding-inline-end: 16px;
		border: 1px solid var(--control-line);
		border-radius: 12px;
		background: var(--canvas);
		color: var(--muted);
	}
	.template-search:focus-within {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	input {
		inline-size: 100%;
		min-inline-size: 0;
		min-block-size: 48px;
		border: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 14px;
	}
	.categories {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.categories button {
		min-block-size: 44px;
		padding-block-start: 10px;
		padding-block-end: 10px;
		padding-inline-start: 16px;
		padding-inline-end: 16px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.categories button.active {
		background: var(--pale);
		border-color: var(--mint-line);
		color: var(--scrapbook-green);
		font-weight: 700;
	}
	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr));
		gap: 22px;
	}
	.template-card,
	.blank-template {
		min-inline-size: 0;
		padding: 0;
		text-align: start;
		border: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	.template-cover,
	.blank-art {
		position: relative;
		display: grid;
		aspect-ratio: 16 / 9;
		overflow: clip;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--canvas);
		place-items: center;
	}
	.template-cover img {
		display: block;
		inline-size: 100%;
		block-size: auto;
	}
	.slide-count {
		position: absolute;
		inset-inline-end: 8px;
		inset-block-end: 8px;
		padding-block-start: 4px;
		padding-block-end: 4px;
		padding-inline-start: 7px;
		padding-inline-end: 7px;
		background: var(--surface);
		border-radius: 5px;
		font-size: 11px;
		box-shadow: var(--shadow);
	}
	.blank-art {
		border-style: dashed;
		color: var(--scrapbook-green);
		background: oklch(0.97201 0.009953 164.8727);
	}
	.card-caption {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		margin-block-start: 14px;
	}
	strong {
		font-size: 14px;
	}
	.blank-template > strong {
		display: block;
		margin-block-start: 14px;
	}
	small {
		display: block;
		margin-block-start: 5px;
		font-size: 12px;
		color: var(--muted);
	}
	.cover-placeholder {
		text-align: center;
		padding: 20px;
	}
	@media (hover: hover) and (pointer: fine) {
		.template-card:hover .template-cover,
		.blank-template:hover .blank-art {
			border-color: var(--primary);
		}
	}
	.no-results {
		padding-block-start: 24px;
		padding-block-end: 0;
		padding-inline-start: 0;
		padding-inline-end: 0;
		color: var(--muted);
	}
	.slide-preview {
		display: grid;
		aspect-ratio: 16 / 9;
		place-items: center;
		background: var(--canvas);
		border: 1px solid var(--line);
	}
	.slide-preview img {
		display: block;
		inline-size: 100%;
		block-size: auto;
	}
	.preview-controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-block-start: 16px;
		margin-block-end: 16px;
		margin-inline-start: 0;
		margin-inline-end: 0;
		font-size: 13px;
	}
	.preview-note {
		font-size: 13px;
		color: var(--muted);
	}
	@media (max-width: 1150px) {
		.gallery-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 12px;
		}
	}
	@media (max-width: 600px) {
		.starter-gallery {
			padding: 20px;
		}
		.gallery-toolbar {
			gap: 14px;
		}
		.categories button {
			padding-inline: 12px;
		}
	}
</style>
