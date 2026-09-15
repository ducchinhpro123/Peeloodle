<script>
	import { button } from '$lib/ui/styles.js';
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
	import { TEMPLATE_CATEGORIES, templateData } from '$lib/editor/templates';

	/**
	 * @type {{
	 *   repository: import('$lib/persistence/repository').StickerLabRepository,
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
		class="pills [margin:var(--space-5)_0] [display:flex] [scrollbar-width:thin] [gap:var(--space-2)] [overflow:auto] [padding:4px_2px]"
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
		<label class="filter-search [margin-left:auto]">
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
		<div class="empty [margin-top:20px] [min-height:250px]">
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
		padding: 8px 14px;
		border-radius: 999px;
		background: #f3f5f8;
		color: #52627e;
	}
	.filter-search input {
		min-width: 220px;
		border: 0;
		outline: 0;
		background: transparent;
	}
	.empty {
		display: flex;
		min-height: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed #abd3c3;
		border-radius: var(--radius);
		background: radial-gradient(ellipse at bottom, #eaf8ef, #fff 75%);
		color: #55708c;
		text-align: center;
	}
	.empty h2 {
		color: var(--ink);
	}
	:global(.empty p) {
		max-width: 480px;
		font-size: 14px;
	}
	:global(.empty > svg) {
		padding: 12px;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: #00875e;
		transform: rotate(-8deg);
	}
	.pills button {
		padding: 10px 16px;
		border: 1px solid #e6eaf2;
		border-radius: 999px;
		background: #f5f7ff;
		color: #273a5c;
		white-space: nowrap;
	}
	.pills button[aria-pressed='true'] {
		border-color: #00875e;
		background: #00875e;
		color: #fff;
	}
	.pills button {
		min-height: 44px;
		font-size: 13px;
	}
	.pills button:hover:not([aria-pressed='true']) {
		background: var(--lav);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
		margin: var(--space-5) 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
		font-size: 13px;
	}
	.filters label {
		color: #3e506d;
		font-size: 13px;
	}
	:global(.filters select) {
		margin-left: 7px;
		padding: 7px;
		border: 1px solid #e2e9f1;
		border-radius: 8px;
		background: #fff;
	}
	.filter-search input {
		min-width: 145px;
	}
	@media (max-width: 720px) {
		.filters {
			flex-wrap: wrap;
			align-items: stretch;
		}
		.filter-search {
			width: 100%;
			margin-left: 0;
		}
		.filter-search input {
			width: 100%;
		}
		.filters label {
			flex: 1;
		}
		.pills {
			margin: 12px 0;
		}
	}
</style>
