<script>
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
	<Hero>
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

	<div class="pills" role="group" aria-label="Template category filters">
		{#each TEMPLATE_CATEGORIES as item (item)}
			<button
				type="button"
				aria-pressed={pickedCategory === item}
				onclick={() => pickCategory(item)}>{item}</button
			>
		{/each}
	</div>

	<div class="filters">
		<span class="muted">{result.length} editable templates · free to make your own</span>
		<label class="filter-search">
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
		<div class="empty">
			<h2>No sample templates found</h2>
			<button type="button" class="button" onclick={resetFilters}>Reset filters</button>
		</div>
	{/if}
</AppShell>
