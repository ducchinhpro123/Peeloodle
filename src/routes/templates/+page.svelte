<script>
	/**
	 * `/templates` — the real catalog route.
	 *
	 * The search query lives in the URL (`/templates?q=cat` is shareable and
	 * reloadable) and every keystroke replaces the current history entry instead of
	 * stacking one — the source's `useSearchParams(..., { replace: true })`.
	 * Everything else about the page is in `TemplatesPage.svelte`.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import TemplatesPage from '#lib/components/TemplatesPage.svelte';
	import { getAppContext } from '#lib/app/context.js';

	const { repository } = getAppContext();

	let query = $derived(page.url.searchParams.get('q') ?? '');

	/** @param {string} value */
	function updateQuery(value) {
		const url = new URL(page.url);
		if (value) url.searchParams.set('q', value);
		else url.searchParams.delete('q');
		// A client-side navigation that replaces the history entry. `replaceState` from
		// `$app/navigation` would rewrite the address bar but leave `page.url` at its
		// previous value, so the filtered rails would never see the new query;
		// `keepFocus` keeps the caret in the search field while typing.
		void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<TemplatesPage
	{repository}
	pathname={page.url.pathname}
	search={page.url.search}
	{query}
	onquery={updateQuery}
	onopen={(projectId) => goto(resolve(`editor/${projectId}`))}
/>
