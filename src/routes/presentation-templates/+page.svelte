<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import PresentationTemplatesPage from '$lib/components/PresentationTemplatesPage.svelte';
	import { getAppContext } from '$lib/app/context';
	import { getCatalogRepository } from '$lib/catalog/client';

	/**
	 * `/presentation-templates` — the public deck-template browser (P69/P70). The
	 * catalog read path is optional configuration; without it the page explains
	 * that templates need the catalog and local presentation work is unaffected.
	 */
	const { presentationRepository } = getAppContext();
	/** @type {import('$lib/catalog/remote').SupabaseCatalog | null} */
	let catalogRepository = $state.raw(null);

	$effect(() => {
		let live = true;
		void getCatalogRepository()
			.then((value) => {
				if (live) catalogRepository = value;
			})
			.catch(() => {
				if (live) catalogRepository = null;
			});
		return () => {
			live = false;
		};
	});

	/** @param {string} id */
	function openClone(id) {
		void goto(resolve('/presentations/[presentationId]', { presentationId: id }));
	}
</script>

<svelte:head><title>Deck templates — StickerLab</title></svelte:head>

<AppShell pathname={page.url.pathname} search={page.url.search}>
	<header class="[display:grid] [gap:4px]">
		<h1 class="[margin:0]">Deck templates</h1>
		<p class="[margin:0] [max-width:65ch] [color:var(--muted)]">
			Published class, research-defense and club-pitch decks. “Use template” copies every slide and
			artwork into a new presentation that is yours to edit; the template stays unchanged.
		</p>
	</header>
	<PresentationTemplatesPage {catalogRepository} {presentationRepository} onused={openClone} />
</AppShell>
