<script>
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import AdminGuard from '$lib/components/catalog/AdminGuard.svelte';
	import AdminShell from '$lib/components/catalog/AdminShell.svelte';
	import { getCatalogRepository } from '$lib/catalog/client';
	import { getCloudWorkspace } from '$lib/cloud/workspace.svelte';

	/**
	 * `/admin` — the catalog's route-wide session and membership gate (P51). The
	 * workspace owns session state; this layout only resolves the repository and
	 * hands the facts to `AdminGuard`. Child routes mount the real screens.
	 */
	const workspace = getCloudWorkspace();
	/** @type {import('$lib/catalog/remote').SupabaseCatalog | null} */
	let repository = $state.raw(null);

	$effect(() => {
		let live = true;
		void getCatalogRepository().then((value) => {
			if (live) repository = value;
		});
		return () => {
			live = false;
		};
	});

	/** @type {{ children: import('svelte').Snippet }} */
	const { children } = $props();
</script>

<svelte:head><title>Admin catalog — StickerLab</title></svelte:head>

<AppShell pathname={page.url.pathname} search={page.url.search}>
	<AdminGuard
		configured={workspace.configured}
		sessionEmail={workspace.session?.user.email ?? null}
		{repository}
		homeHref={resolve('/')}
	>
		<AdminShell collectionsHref={resolve('/admin/collections')} pathname={page.url.pathname}>
			{@render children()}
		</AdminShell>
	</AdminGuard>
</AppShell>
