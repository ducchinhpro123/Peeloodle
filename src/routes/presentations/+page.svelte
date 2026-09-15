<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getAppContext } from '$lib/app/context';
	import PresentationsPage from '$lib/components/PresentationsPage.svelte';

	const { presentationRepository } = getAppContext();
	/** @param {string} documentId */
	const openhref = (documentId) => `${resolve('/presentations')}/${encodeURIComponent(documentId)}`;
</script>

<svelte:head><title>Presentations — StickerLab</title></svelte:head>

<PresentationsPage
	repository={presentationRepository}
	pathname={page.url.pathname}
	search={page.url.search}
	{openhref}
	onopen={(documentId) => goto(openhref(documentId))}
/>
