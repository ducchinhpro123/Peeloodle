<script>
	/**
	 * `/my-stickers` — the real sticker library (source `/my-stickers` → `PacksPage`).
	 *
	 * The URL owns the view (`/my-stickers?view=favorites` is shareable and
	 * reloadable, unknown values fall back to All Packs) and the optional
	 * `?pack=<id>` deep link; `#local-stickers` scrolls the sticker drawer into
	 * view. View picks push a history entry that replaces the whole query — the
	 * source called `setSearchParams(packViewParams(view))` — so selecting a view
	 * also clears a `pack` parameter, exactly like the source.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PacksPage from '#lib/components/PacksPage.svelte';
	import { getAppContext } from '#lib/app/context.js';
	import { packViewFromParams, packViewParams } from '#lib/packs/packActions.js';

	const { repository } = getAppContext();

	let view = $derived(packViewFromParams(page.url.searchParams));
	let requestedPackId = $derived(page.url.searchParams.get('pack'));

	/** @param {ReturnType<typeof packViewFromParams>} next */
	function selectView(next) {
		const url = new URL(page.url);
		const params = packViewParams(next);
		// Replacing the query through `searchParams` (it is live on the URL) keeps the
		// source's "the patch *is* the new query" semantics: selecting All Packs clears
		// the parameter, and any other view pick clears a `pack` deep link.
		for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		// A client-side navigation that keeps the caret and scroll position (only the
		// query changes) and, unlike the source's controlled input, still pushes a
		// history entry so Back returns to the previous view.
		void goto(url, { keepFocus: true, noScroll: true });
	}
</script>

<PacksPage
	{repository}
	pathname={page.url.pathname}
	search={page.url.search}
	hash={page.url.hash}
	{view}
	{requestedPackId}
	onselectview={selectView}
	onopen={(projectId) => goto(resolve(`editor/${projectId}`))}
/>
