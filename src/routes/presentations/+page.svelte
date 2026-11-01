<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getAppContext } from '#lib/app/context.js';
	import PresentationsPage from '#lib/components/PresentationsPage.svelte';
	import { galleryCategoryFromSearch } from '#lib/presentations/tasks.js';

	const { presentationRepository } = getAppContext();
	/** @param {string} documentId */
	const openhref = (documentId) => `${resolve('presentations')}/${encodeURIComponent(documentId)}`;
	const category = $derived(galleryCategoryFromSearch(page.url.search));

	/** @param {import('#lib/presentations/tasks.js').GalleryCategory} slug */
	function updateCategory(slug) {
		const url = new URL(page.url.href);
		url.searchParams.set('category', slug);
		void goto(url, { replace: true, reset: false });
	}
</script>

<svelte:head><title>Presentations — StickerLab</title></svelte:head>

<PresentationsPage
	repository={presentationRepository}
	pathname={page.url.pathname}
	search={page.url.search}
	{openhref}
	{category}
	oncategory={updateCategory}
	onopen={(documentId) => goto(openhref(documentId))}
/>
