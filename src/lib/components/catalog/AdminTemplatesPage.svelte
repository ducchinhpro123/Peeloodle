<script>
	import { Search, Presentation } from 'lucide-svelte';
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import { isCatalogError } from '#lib/catalog/repository.js';

	/**
	 * Admin template list (P66): paged search plus use-case and status filters,
	 * showing the real stable-template metadata. The detail screen owns versions,
	 * draft editing and (P68) the lifecycle; this screen only points there.
	 *
	 * @type {{
	 *   repository: import('#lib/catalog/repository.js').CatalogAdminRepository,
	 *   detailHref: (id: string) => string,
	 *   presentationsHref: string
	 * }}
	 */
	let { repository, detailHref, presentationsHref } = $props();

	const PAGE_SIZE = 12;
	const USE_CASES = ['class', 'research-defense', 'club-pitch'];
	const STATES = ['draft', 'published', 'archived'];

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
	let stateFilter = $state('');
	let reloadKey = $state(0);
	let loadSequence = 0;

	/** The select keeps an empty option; the repository takes a typed state only. */
	const appliedState = $derived(
		stateFilter === 'draft' || stateFilter === 'published' || stateFilter === 'archived'
			? stateFilter
			: undefined
	);

	/** @param {unknown} cause */
	function errorText(cause) {
		if (isCatalogError(cause) && cause.code === 'permission')
			return 'Your account is no longer a catalog administrator.';
		if (cause instanceof Error) return cause.message;
		return 'The request failed. Please retry.';
	}

	/** @param {boolean} reset */
	async function load(reset) {
		const sequence = ++loadSequence;
		if (reset) {
			listStatus = 'loading';
			listError = null;
		} else {
			loadingMore = true;
		}
		try {
			const page = await repository.listTemplatesForAdmin({
				query: appliedQuery,
				useCase: useCase || undefined,
				state: appliedState,
				limit: PAGE_SIZE,
				cursor: reset ? null : nextCursor
			});
			if (sequence !== loadSequence) return;
			rows = reset ? page.items : [...rows, ...page.items];
			nextCursor = page.nextCursor;
			listStatus = 'ready';
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

	// The list reloads when an applied filter changes or the screen asks for it.
	$effect(() => {
		void appliedQuery;
		void useCase;
		void stateFilter;
		void reloadKey;
		void load(true);
	});

	function clearFilters() {
		query = '';
		appliedQuery = '';
		useCase = '';
		stateFilter = '';
	}

	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	/** @param {string} value */
	function date(value) {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
	}
</script>

<section class="admin-templates [display:grid] [gap:var(--space-4)]">
	<div
		class="admin-templates-bar [display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)]"
	>
		<form
			class="admin-search [display:flex] [flex:1_1_18rem] [gap:var(--space-2)]"
			onsubmit={(event) => {
				event.preventDefault();
				appliedQuery = query.trim();
			}}
		>
			<label class="sr-only" for="catalog-template-search">Search templates</label>
			<input
				id="catalog-template-search"
				type="search"
				placeholder="Search templates"
				bind:value={query}
				class="[flex:1] [border-radius:var(--radius-sm)] [padding-inline-start:12px] [padding-inline-end:12px] [padding-block-start:8px] [padding-block-end:8px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)] [min-block-size:38px] [min-inline-size:0]"
			/>
			<button type="submit" class={button}><Search size={16} aria-hidden="true" /> Search</button>
		</form>
		<label class="[display:grid] [gap:2px] [font-size:12px] [font-weight:700]">
			Use case
			<select
				bind:value={useCase}
				class="[border-radius:var(--radius-sm)] [padding-inline-start:10px] [padding-inline-end:10px] [padding-block-start:6px] [padding-block-end:6px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)] [min-block-size:38px]"
			>
				<option value="">All use cases</option>
				{#each USE_CASES as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
		<label class="[display:grid] [gap:2px] [font-size:12px] [font-weight:700]">
			Status
			<select
				bind:value={stateFilter}
				class="[border-radius:var(--radius-sm)] [padding-inline-start:10px] [padding-inline-end:10px] [padding-block-start:6px] [padding-block-end:6px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)] [min-block-size:38px]"
			>
				<option value="">All statuses</option>
				{#each STATES as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if listStatus === 'loading'}
		<p role="status">Loading templates…</p>
	{:else if listStatus === 'error'}
		<div class="[display:grid] [justify-items:start] [gap:var(--space-3)]">
			<p role="alert">{listError}</p>
			<button type="button" class={buttonPrimary} onclick={() => (reloadKey += 1)}>Try again</button
			>
		</div>
	{:else if rows.length === 0}
		<div
			class="[display:grid] [place-items:center] [gap:var(--space-3)] [border-radius:var(--radius)] [padding:var(--space-7)] [text-align:center] [border:1px_dashed_oklch(0.833566_0.047737_168.8711)]"
		>
			<Presentation size={28} aria-hidden="true" />
			<p>
				{appliedQuery || useCase || stateFilter
					? 'No templates match these filters.'
					: 'No templates yet. Open a presentation as an administrator and choose “Save as template”.'}
			</p>
			{#if appliedQuery || useCase || stateFilter}
				<button type="button" class={button} onclick={clearFilters}>Clear filters</button>
			{:else}
				<a class={button} href={presentationsHref}>Open presentations</a>
			{/if}
		</div>
	{:else}
		<ul
			class="admin-template-list [margin:0] [display:grid] [gap:var(--space-3)] [padding:0] [list-style:none]"
		>
			{#each rows as row (row.id)}
				<li
					class="admin-template [display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)] [border-radius:var(--radius-sm)] [padding:var(--space-4)] [background:var(--surface)] [border:1px_solid_var(--line)]"
				>
					<a
						class="admin-template-main [flex:1_1_18rem] [color:inherit] [min-inline-size:12rem] [text-decoration:none]"
						href={detailHref(row.id)}
					>
						<h2 class="[margin:0] [font-size:16px] [overflow-wrap:anywhere]">{row.title}</h2>
						<p
							class="[margin-inline-start:0] [margin-inline-end:0] [margin-block-start:2px] [margin-block-end:0] [font-size:12px] [color:var(--muted)]"
						>
							{row.useCase}
							{#if row.tags.length}· tags: {row.tags.join(', ')}{/if}
							· order {row.sortOrder} · revision {row.revision} · updated {date(row.updatedAt)}
						</p>
						{#if row.description}<p
								class="[margin-inline-start:0] [margin-inline-end:0] [margin-block-start:4px] [margin-block-end:0]"
							>
								{row.description}
							</p>{/if}
					</a>
					<span
						class="admin-state [border-radius:999px] [padding-inline-start:10px] [padding-inline-end:10px] [padding-block-start:2px] [padding-block-end:2px] [font-size:11px] [font-weight:800]"
						class:is-draft={row.state === 'draft'}
						class:is-published={row.state === 'published'}
						class:is-archived={row.state === 'archived'}>{row.state}</span
					>
					<span class="[font-size:12px] [color:var(--muted)]">
						{row.publishedVersionId ? 'has a published version' : 'not published'}
					</span>
					<a class={button} href={detailHref(row.id)}>Open</a>
				</li>
			{/each}
		</ul>
		{#if nextCursor}
			<button
				type="button"
				class={[button, 'admin-load-more']}
				disabled={loadingMore}
				onclick={() => load(false)}>{loadingMore ? 'Loading…' : 'Load more'}</button
			>
		{/if}
	{/if}

	{#if listStatus === 'ready' && listError}
		<p role="alert" class="[margin:0] [font-weight:700]">{listError}</p>
	{/if}
</section>

<style>
	@media (hover: hover) and (pointer: fine) {
		.admin-template-main:hover h2 {
			text-decoration: underline;
		}
	}
	.admin-state.is-draft {
		background: var(--pale);
		color: oklch(0.436246 0.052317 171.7714);
	}
	.admin-state.is-published {
		background: oklch(0.951787 0.022294 160.2249);
		color: oklch(0.461264 0.097571 164.5432);
	}
	.admin-state.is-archived {
		background: var(--cream);
		color: var(--muted);
	}
</style>
