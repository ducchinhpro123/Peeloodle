<script>
	import { button } from '#lib/ui/styles.js';
	/**
	 * Port of `src/features/templates/TemplatesPage.tsx` (React main `54eae61c`):
	 * the source `/templates` catalog — hero, category pills, `q` search, the three
	 * rails and the honest empty state.
	 *
	 * The URL owns the query (`src/routes/templates/+page.svelte` wires `page.url` and
	 * a history-replacing client navigation, the source used `useSearchParams` with
	 * `{ replace: true }`), so this component takes no SvelteKit navigation
	 * dependency and renders in a browser test without mocks — the same seam
	 * `DashboardPage.svelte` uses.
	 */
	import { Search, Sparkles } from 'lucide-svelte';
	import AppShell from './AppShell.svelte';
	import Hero from './Hero.svelte';
	import StickerCollage from './StickerCollage.svelte';
	import TemplateRail from './TemplateRail.svelte';
	import { TEMPLATE_CATEGORIES, templateData } from '#lib/editor/templates.js';

	/**
	 * @type {{
	 *   repository: import('#lib/persistence/repository.js').StickerLabRepository,
	 *   onopen: (projectId: string) => void,
	 *   pathname?: string,
	 *   search?: string,
	 *   query?: string,
	 *   onquery?: (value: string) => void,
	 * }}
	 */
	let {
		repository,
		onopen,
		pathname = '/templates',
		search = '',
		query = '',
		onquery = () => {}
	} = $props();

	/**
	 * The picked category. The source dropped it on every query change
	 * (`useEffect(() => setCategory('All Templates'), [query])`) — typing, clearing the
	 * field again, or a back/forward URL change all reset the pill, so a category is
	 * never combined with a query it was not picked for. Synchronizing local UI state
	 * with the URL-owned query is the documented escape hatch for an effect; deriving
	 * it from the query value alone would wrongly revive the old category when the
	 * query returns to a value it once had.
	 */
	let pickedCategory = $state('All Templates');
	$effect(() => {
		query;
		pickedCategory = 'All Templates';
	});

	let result = $derived(
		templateData.filter(
			(template) =>
				(pickedCategory === 'All Templates' || template.category === pickedCategory) &&
				template.title.toLowerCase().includes(query.toLowerCase())
		)
	);

	/** @param {string} value */
	function pickCategory(value) {
		pickedCategory = value;
	}

	function resetFilters() {
		pickedCategory = 'All Templates';
		onquery('');
	}
</script>

<AppShell {pathname} {search}>
	<Hero variant="templates">
		{#snippet kicker()}
			<p class="hero-kicker"><Sparkles size={14} /> THE INSPIRATION STATION</p>
		{/snippet}
		{#snippet title()}
			<span>Find your vibe.</span><br /><em>Make it yours.</em>
		{/snippet}
		{#snippet art()}
			<StickerCollage variant="templates" />
		{/snippet}
		Start with a spark, add your own twist. Every template becomes your very own editable sticker.
	</Hero>

	<div
		class="pills [margin-inline-start:0] [margin-inline-end:0] [margin-block-start:var(--space-5)] [margin-block-end:var(--space-5)] [display:flex] [scrollbar-width:thin] [gap:var(--space-2)] [overflow:auto] [padding-inline-start:2px] [padding-inline-end:2px] [padding-block-start:4px] [padding-block-end:4px]"
		role="group"
		aria-label="Template category filters"
	>
		{#each TEMPLATE_CATEGORIES as item (item)}
			<button
				type="button"
				aria-pressed={pickedCategory === item}
				onclick={() => pickCategory(item)}>{item}</button
			>
		{/each}
	</div>

	<div class="filters">
		<span class="muted [color:var(--muted)]"
			>{result.length} editable templates · free to make your own</span
		>
		<label class="filter-search [margin-inline-start:auto]">
			<Search size={16} />
			<input
				bind:value={() => query, (value) => onquery(value)}
				aria-label="Search sample templates"
				placeholder="Find your next idea…"
			/>
		</label>
	</div>

	{#if result.length}
		<TemplateRail {repository} {onopen} title="🔥 Trending Templates" items={result} />
		<TemplateRail
			{repository}
			{onopen}
			title="✦ Explore by Category"
			items={result.slice().reverse()}
		/>
		<TemplateRail
			{repository}
			{onopen}
			title="✨ More Templates You'll Love"
			items={result.slice(2)}
		/>
	{:else}
		<div class="empty [margin-block-start:20px] [min-block-size:250px]">
			<h2>No sample templates found</h2>
			<button type="button" class={button} onclick={resetFilters}>Reset filters</button>
		</div>
	{/if}
</AppShell>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.filter-search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-block-start: 8px;
		padding-block-end: 8px;
		padding-inline-start: 14px;
		padding-inline-end: 14px;
		border-radius: 999px;
		background: oklch(0.96948 0.004541 258.3246);
		color: oklch(0.494015 0.049212 261.4769);
	}
	.filter-search input {
		min-inline-size: 220px;
		border: 0;
		background: transparent;
	}
	.empty {
		display: flex;
		min-block-size: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed oklch(0.833566 0.047737 168.8711);
		border-radius: var(--radius);
		background: radial-gradient(
			ellipse at bottom,
			oklch(0.966239 0.018933 157.8754),
			oklch(1 0 none) 75%
		);
		color: oklch(0.535034 0.054407 249.7873);
		text-align: center;
	}
	.empty h2 {
		color: var(--ink);
	}
	:global(.empty p) {
		max-inline-size: 480px;
		font-size: 14px;
	}
	:global(.empty > svg) {
		padding: 12px;
		inline-size: 56px;
		block-size: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: oklch(0.551582 0.11869 163.307);
		transform: rotate(-8deg);
	}
	.pills button {
		padding-block-start: 10px;
		padding-block-end: 10px;
		padding-inline-start: 16px;
		padding-inline-end: 16px;
		border: 1px solid oklch(0.936316 0.011619 264.5091);
		border-radius: 999px;
		background: oklch(0.976909 0.010856 274.8971);
		color: oklch(0.349519 0.064628 261.4121);
		white-space: nowrap;
	}
	.pills button[aria-pressed='true'] {
		border-color: oklch(0.551582 0.11869 163.307);
		background: oklch(0.551582 0.11869 163.307);
		color: oklch(1 0 none);
	}
	.pills button {
		min-block-size: 44px;
		font-size: 13px;
	}
	@media (hover: hover) and (pointer: fine) {
		.pills button:hover:not([aria-pressed='true']) {
			background: var(--lav);
		}
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
		margin-block-start: var(--space-5);
		margin-block-end: var(--space-5);
		margin-inline-start: 0;
		margin-inline-end: 0;
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: oklch(1 0 none);
		font-size: 13px;
	}
	.filters label {
		color: oklch(0.42873 0.053505 259.7499);
		font-size: 13px;
	}
	:global(.filters select) {
		margin-inline-start: 7px;
		padding: 7px;
		border: 1px solid oklch(0.931042 0.013199 251.5632);
		border-radius: 8px;
		background: oklch(1 0 none);
	}
	.filter-search input {
		min-inline-size: 145px;
	}
	@media (max-width: 720px) {
		.filters {
			flex-wrap: wrap;
			align-items: stretch;
		}
		.filter-search {
			inline-size: 100%;
			margin-inline-start: 0;
		}
		.filter-search input {
			inline-size: 100%;
		}
		.filters label {
			flex: 1;
		}
		.pills {
			margin-block-start: 12px;
			margin-block-end: 12px;
			margin-inline-start: 0;
			margin-inline-end: 0;
		}
	}
</style>
