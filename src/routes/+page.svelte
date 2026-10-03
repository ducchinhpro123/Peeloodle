<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getAppContext } from '$lib/app/context';
	import DashboardPage from '$lib/components/DashboardPage.svelte';

	const { repository, presentationRepository } = getAppContext();
</script>

<DashboardPage
	{repository}
	{presentationRepository}
	pathname={page.url.pathname}
	search={page.url.search}
	onopen={(projectId) => goto(resolve(`/editor/${projectId}`))}
/>
