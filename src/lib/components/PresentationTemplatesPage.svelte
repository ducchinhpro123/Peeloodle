<script>
	import { Search, Sparkles } from 'lucide-svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import Modal from '#lib/components/Modal.svelte';
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import { isCatalogError } from '#lib/catalog/repository.js';
	import { cloneTemplate, CloneTemplateError } from '#lib/presentations/templates/cloneTemplate.js';

	/**
	 * Public presentation-template browser (P69/P70): published templates only,
	 * search/use-case filters, cover cards, an all-slide preview, and one-click
	 * cloning into an independent local presentation. Editing a clone never
	 * touches the template or another clone.
	 *
	 * @type {{
	 *   catalogRepository: import('#lib/catalog/repository.js').CatalogRepository | null,
	 *   presentationRepository: import('#lib/presentations/persistence/repository.js').PresentationRepository,
	 *   onused: (presentationId: string) => void
	 * }}
	 */
	let { catalogRepository, presentationRepository, onused } = $props();

	const PAGE_SIZE = 12;
	const USE_CASES = ['class', 'research-defense', 'club-pitch'];

	/** @type {import('#lib/catalog/types.js').CatalogTemplate[]} */
	let rows = $state.raw([]);
	/** @type {string | null} */
	let nextCursor = $state.raw(null);
	/** @type {'loading' | 'ready' | 'error'} */
	let listStatus = $state('loading');
	/** @type {string | null} */
	let listError = $state(null);
	let loadingMore = $state(false);
	let query = $state('');
	let appliedQuery = $state('');
	let useCase = $state('');
	let reloadKey = $state(0);
	let loadSequence = 0;

	/** template id → signed cover URL. A `SvelteMap` keeps per-card updates granular. */
	const coverUrls = new SvelteMap();
	/** @type {string | null} */
	let cloningId = $state.raw(null);
	/** @type {string | null} */
	let cloneError = $state(null);

	let previewOpen = $state(false);
	/** @type {import('#lib/catalog/types.js').CatalogTemplate | null} */
	let previewTemplate = $state.raw(null);
	/** @type {string[]} */
	let previewUrls = $state.raw([]);
	let previewLoading = $state(false);
	/** @type {string | null} */
	let previewError = $state(null);

	/** @param {unknown} cause */
	function errorText(cause) {
		if (isCatalogError(cause) && cause.code === 'unavailable')
			return 'The template catalog could not be reached. Check the connection and try again.';
		if (cause instanceof Error) return cause.message;
		return 'The request failed. Please retry.';
	}

	/** @param {boolean} reset */
	async function load(reset) {
		if (!catalogRepository) return;
		const sequence = ++loadSequence;
		if (reset) {
			listStatus = 'loading';
			listError = null;
		} else {
			loadingMore = true;
		}
		try {
			const page = await catalogRepository.listTemplates({
				query: appliedQuery,
				useCase: useCase || undefined,
				limit: PAGE_SIZE,
				cursor: reset ? null : nextCursor
			});
			if (sequence !== loadSequence) return;
			rows = reset ? page.items : [...rows, ...page.items];
			nextCursor = page.nextCursor;
			listStatus = 'ready';

			// Covers are loaded after the cards, one published version per template.
			const loaded = await Promise.all(
				page.items.map(async (row) => {
					try {
						const version = await catalogRepository.getTemplateVersion(row.id);
						if (!version.coverPath) return null;
						const url = await catalogRepository.signedDerivativeUrl(version.coverPath, 300);
						return [row.id, url];
					} catch {
						return null;
					}
				})
			);
			if (sequence !== loadSequence) return;
			for (const entry of loaded) {
				if (entry) coverUrls.set(entry[0], entry[1]);
			}
		} catch (cause) {
			if (sequence !== loadSequence) return;
			if (reset || rows.length === 0) {
				listStatus = 'error';
				listError = errorText(cause);
			} else {
				listError = errorText(cause);
			}
		} finally {
			if (sequence === loadSequence) loadingMore = false;
		}
	}

	$effect(() => {
		void appliedQuery;
		void useCase;
		void reloadKey;
		void load(true);
	});

	/** @param {import('#lib/catalog/types.js').CatalogTemplate} row */
	async function openPreview(row) {
		previewTemplate = row;
		previewOpen = true;
		previewUrls = [];
		previewError = null;
		const catalog = catalogRepository;
		if (!catalog) {
			previewError = 'The template catalog is not configured for this site.';
			return;
		}
		previewLoading = true;
		try {
			const version = await catalog.getTemplateVersion(row.id);
			const urls = await Promise.all(
				version.slidePreviews
					.slice()
					.sort((left, right) => left.ordinal - right.ordinal)
					.map((preview) => catalog.signedDerivativeUrl(preview.path, 300))
			);
			previewUrls = urls;
		} catch (cause) {
			previewError = errorText(cause);
		} finally {
			previewLoading = false;
		}
	}

	/** @param {import('#lib/catalog/types.js').CatalogTemplate} row */
	async function useTemplate(row) {
		const catalog = catalogRepository;
		if (!catalog || cloningId) return;
		cloningId = row.id;
		cloneError = null;
		try {
			const clone = await cloneTemplate({
				catalogRepository: catalog,
				presentationRepository,
				templateId: row.id
			});
			previewOpen = false;
			onused(clone.id);
		} catch (cause) {
			cloneError =
				cause instanceof CloneTemplateError
					? cause.message
					: 'This template could not be copied. Your other work is unchanged.';
		} finally {
			cloningId = null;
		}
	}
</script>

<section class="presentation-templates [display:grid] [gap:var(--space-4)]">
	<div class="[display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)]">
		<form
			class="[display:flex] [flex:1_1_18rem] [gap:var(--space-2)]"
			onsubmit={(event) => {
				event.preventDefault();
				appliedQuery = query.trim();
			}}
		>
			<label class="sr-only" for="deck-template-search">Search deck templates</label>
			<input
				id="deck-template-search"
				type="search"
				placeholder="Search deck templates"
				bind:value={query}
				class="[min-height:38px] [min-width:0] [flex:1] [border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			/>
			<button type="submit" class={button}><Search size={16} aria-hidden="true" /> Search</button>
		</form>
		<label class="[display:grid] [gap:2px] [font-size:12px] [font-weight:700]">
			Use case
			<select
				bind:value={useCase}
				class="[min-height:38px] [border-radius:var(--radius-sm)] [padding:6px_10px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			>
				<option value="">All use cases</option>
				{#each USE_CASES as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if cloneError}<p role="alert" class="[margin:0] [font-weight:700]">{cloneError}</p>{/if}

	{#if !catalogRepository}
		<p class="[display:grid] [justify-items:start] [gap:var(--space-3)]">
			Deck templates need the catalog, which is not configured for this site. You can still create
			and edit your own presentations.
		</p>
	{:else if listStatus === 'loading'}
		<p role="status">Loading deck templates…</p>
	{:else if listStatus === 'error'}
		<div class="[display:grid] [justify-items:start] [gap:var(--space-3)]">
			<p role="alert">{listError}</p>
			<button type="button" class={buttonPrimary} onclick={() => (reloadKey += 1)}>Try again</button
			>
		</div>
	{:else if rows.length === 0}
		<div
			class="[display:grid] [place-items:center] [gap:var(--space-3)] [border-radius:var(--radius)] [padding:var(--space-7)] [text-align:center] [border:1px_dashed_#abd3c3]"
		>
			<Sparkles size={28} aria-hidden="true" />
			<p>
				{appliedQuery || useCase
					? 'No deck templates match these filters.'
					: 'No deck templates are published yet.'}
			</p>
			{#if appliedQuery || useCase}
				<button
					type="button"
					class={button}
					onclick={() => {
						query = '';
						appliedQuery = '';
						useCase = '';
					}}>Clear filters</button
				>
			{/if}
		</div>
	{:else}
		<ul
			class="presentation-template-grid [margin:0] [display:grid] [grid-template-columns:repeat(auto-fill,_minmax(230px,_1fr))] [gap:var(--space-4)] [padding:0] [list-style:none]"
		>
			{#each rows as row (row.id)}
				<li
					class="presentation-template-card [display:grid] [gap:var(--space-2)] [border-radius:var(--radius-sm)] [padding:var(--space-3)] [background:var(--surface)] [border:1px_solid_var(--line)]"
				>
					<button
						type="button"
						class="presentation-template-cover [overflow:hidden] [border-radius:6px] [padding:0] [background:var(--cream)] [border:0]"
						aria-label="Preview {row.title}"
						onclick={() => void openPreview(row)}
					>
						{#if coverUrls.get(row.id)}
							<img
								src={coverUrls.get(row.id)}
								alt=""
								class="[display:block] [aspect-ratio:16/9] [width:100%] [object-fit:cover]"
							/>
						{:else}
							<span
								class="[display:grid] [aspect-ratio:16/9] [place-items:center] [font-size:12px] [color:var(--muted)]"
								>Preview</span
							>
						{/if}
					</button>
					<div>
						<h2 class="[margin:0] [font-size:16px]">{row.title}</h2>
						<p class="[margin:2px_0_0] [font-size:12px] [color:var(--muted)]">
							{row.useCase}
							{#if row.tags.length}· tags: {row.tags.join(', ')}{/if}
						</p>
						{#if row.description}<p class="[margin:6px_0_0] [font-size:13px]">
								{row.description}
							</p>{/if}
					</div>
					<div class="[display:flex] [flex-wrap:wrap] [gap:var(--space-2)]">
						<button type="button" class={button} onclick={() => void openPreview(row)}
							>Preview slides</button
						>
						<button
							type="button"
							class={buttonPrimary}
							disabled={cloningId !== null}
							onclick={() => void useTemplate(row)}
							>{cloningId === row.id ? 'Copying…' : 'Use template'}</button
						>
					</div>
				</li>
			{/each}
		</ul>
		{#if nextCursor}
			<button type="button" class={button} disabled={loadingMore} onclick={() => load(false)}
				>{loadingMore ? 'Loading…' : 'Load more'}</button
			>
		{/if}
		{#if listError}
			<p role="alert" class="[margin:0] [font-weight:700]">{listError}</p>
		{/if}
	{/if}
</section>

<Modal
	open={previewOpen}
	title={previewTemplate ? `${previewTemplate.title} — all slides` : 'All slides'}
	description="Previews are rendered from the exact published template version. Choosing “Use template” copies all slides and artwork into a new presentation you own."
	onclose={() => (previewOpen = false)}
>
	<div class="[display:grid] [gap:var(--space-3)]">
		{#if previewLoading}<p role="status">Loading slides…</p>{/if}
		{#if previewError}<p role="alert">{previewError}</p>{/if}
		{#if previewUrls.length > 0}
			<div class="[display:grid] [gap:var(--space-3)]">
				{#each previewUrls as url, index (url)}
					<figure class="[margin:0]">
						<img
							class="[display:block] [width:100%] [border-radius:6px] [border:1px_solid_var(--line)]"
							src={url}
							alt="Slide {index + 1}"
						/>
						<figcaption class="[margin-top:4px] [font-size:12px] [color:var(--muted)]">
							Slide {index + 1}
						</figcaption>
					</figure>
				{/each}
			</div>
		{:else if !previewLoading && !previewError}
			<p>This template has no slide previews yet.</p>
		{/if}
		<div class="[display:flex] [justify-content:flex-end] [gap:var(--space-2)]">
			<button type="button" class={button} onclick={() => (previewOpen = false)}>Close</button>
			{#if previewTemplate}
				<button
					type="button"
					class={buttonPrimary}
					disabled={cloningId !== null}
					onclick={() => previewTemplate && void useTemplate(previewTemplate)}
					>{cloningId === previewTemplate.id ? 'Copying…' : 'Use template'}</button
				>
			{/if}
		</div>
	</div>
</Modal>

<style>
	.presentation-template-cover {
		cursor: pointer;
	}
	.presentation-template-cover:hover {
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
</style>
