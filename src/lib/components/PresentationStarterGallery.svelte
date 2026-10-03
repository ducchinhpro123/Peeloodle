<script>
	import { onMount } from 'svelte';
	import { Search, Plus, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { SHIPPED_TEMPLATES } from '#lib/presentations/templates/shippedTemplates.js';
	import { ensurePresentationFonts } from '#lib/presentations/rendering/fonts.js';
	import { rasterizeSlidePage } from '#lib/presentations/rendering/rasterizeSlide.js';
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import Modal from './Modal.svelte';
	import { resolve } from '$app/paths';

	/** @type {{ repository: import('#lib/presentations/persistence/repository.js').PresentationRepository, onopen: (id: string) => void | Promise<void>, onblank: () => void, creatingBlank: boolean, task?: string | null }} */
	let { repository, onopen, onblank, creatingBlank, task = null } = $props();
	let query = $state('');
	let category = $derived(
		task === 'class'
			? 'Class'
			: task === 'research-defense'
				? 'Research'
				: task === 'club-pitch'
					? 'Pitch'
					: 'All templates'
	);
	const categories = ['All templates', 'Class', 'Research', 'Pitch', 'Business'];
	const labels = ['Class', 'Research', 'Pitch', 'Business'];
	/** @type {Array<{ key: string, title: string, description: string, category: string, document: import('#lib/presentations/model/types.js').PresentationDocument, previews: string[] }>} */
	let decks = $state.raw([]);
	let loading = $state(true);
	let previewError = $state(false);
	let selectedKey = $state('');
	let slideIndex = $state(0);
	let creating = $state(false);
	let error = $state('');
	let retry = $state(0);
	let mounted = $state(false);
	const selected = $derived(decks.find((deck) => deck.key === selectedKey));
	const filtered = $derived(
		decks.filter(
			(deck) =>
				(category === 'All templates' || deck.category === category) &&
				`${deck.title} ${deck.description}`.toLowerCase().includes(query.trim().toLowerCase())
		)
	);
	onMount(() => {
		mounted = true;
	});
	$effect(() => {
		if (!mounted) return;
		retry;
		let live = true;
		loading = true;
		previewError = false;
		const built = SHIPPED_TEMPLATES.map((template, index) => ({
			key: template.key,
			title: template.title,
			description: template.description,
			category: labels[index],
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
	});

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
			<Search size={18} aria-hidden="true" />
			<span class="sr-only">Search presentation templates</span>

			<input type="search" bind:value={query} placeholder="Find your starting point…" />
		</label>

		<div class="categories" role="group" aria-label="Template category">
			{#each categories as item (item)}
				<button
					class:active={category === item}
					aria-pressed={category === item}
					onclick={() => (category = item)}>{item}</button
				>
			{/each}
		</div>
	</div>
	<div class="template-grid">
		<button class="blank-template" onclick={onblank} disabled={creatingBlank}>
			<span class="blank-art"><Plus size={30} /></span>
			<strong>{creatingBlank ? 'Creating…' : 'Start from scratch'}</strong>
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
				<span class="card-caption"><strong>{deck.title}</strong><ArrowRight size={17} /></span
				><small
					>{deck.category} · {deck.document.assets.length
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
					category = 'All templates';
				}}>Clear filters</button
			>
		</div>{/if}
	{#if previewError}<p role="status">
			Slide previews couldn’t load. You can still use a template. <button
				class={button}
				onclick={() => retry++}>Retry previews</button
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
		margin: 8px 0 0;
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
		margin: 26px 0;
	}
	.template-search {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1 1 240px;
		padding: 0 16px;
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
		width: 100%;
		min-width: 0;
		min-height: 48px;
		border: 0;
		background: transparent;
		outline: none;
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
		min-height: 44px;
		padding: 10px 16px;
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
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 22px;
	}
	.template-card,
	.blank-template {
		min-width: 0;
		padding: 0;
		text-align: left;
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
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--canvas);
		place-items: center;
	}
	.template-cover img {
		display: block;
		width: 100%;
		height: auto;
	}
	.slide-count {
		position: absolute;
		right: 8px;
		bottom: 8px;
		padding: 4px 7px;
		background: var(--surface);
		border-radius: 5px;
		font-size: 11px;
		box-shadow: var(--shadow);
	}
	.blank-art {
		border-style: dashed;
		color: var(--scrapbook-green);
		background: #f0f8f4;
	}
	.card-caption {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
	}
	strong {
		font-size: 14px;
	}
	.blank-template > strong {
		display: block;
		margin-top: 14px;
	}
	small {
		display: block;
		margin-top: 5px;
		font-size: 12px;
		color: var(--muted);
	}
	.cover-placeholder {
		text-align: center;
		padding: 20px;
	}
	.template-card:hover .template-cover,
	.blank-template:hover .blank-art {
		border-color: var(--primary);
	}
	.no-results {
		padding: 24px 0 0;
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
		width: 100%;
		height: auto;
	}
	.preview-controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin: 16px 0;
		font-size: 13px;
	}
	.preview-note {
		font-size: 13px;
		color: var(--muted);
	}
	@media (max-width: 1150px) {
		.template-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
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
		.template-grid {
			grid-template-columns: 1fr;
		}
		.gallery-toolbar {
			gap: 14px;
		}
		.categories button {
			padding-inline: 12px;
		}
	}
</style>
