<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import CreateRedirect from '$lib/components/CreateRedirect.svelte';
	import { parseToolIntent } from '$lib/editor/toolIntent';

	let intent = $derived(parseToolIntent(page.url.searchParams.get('tool')));
</script>

<AppShell editor pathname={page.url.pathname} search={page.url.search}>
	<CreateRedirect {intent} onnavigate={(href) => goto(resolve(href), { replaceState: false })} />
</AppShell>
