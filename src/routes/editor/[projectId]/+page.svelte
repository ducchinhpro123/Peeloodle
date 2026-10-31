<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import AppShell from '#lib/components/AppShell.svelte';
	import EditorWorkspace from '#lib/components/EditorWorkspace.svelte';
	import { parseToolIntent } from '#lib/editor/toolIntent.js';
	import { disposeCutout } from '#lib/cutout/removeBackground.js';

	/** @type {import('./$types').PageProps} */
	let { params } = $props();

	let intent = $derived(parseToolIntent(page.url.searchParams.get('tool')));

	// Leaving the editor frees the background-removal worker and its ORT session.
	onDestroy(disposeCutout);
</script>

<AppShell editor pathname={page.url.pathname} search={page.url.search}>
	<EditorWorkspace
		projectId={params.projectId}
		{intent}
		onnavigate={(href) => goto(resolve(/** @type {`editor/${string}`} */ (href.slice(1))))}
	/>
</AppShell>
