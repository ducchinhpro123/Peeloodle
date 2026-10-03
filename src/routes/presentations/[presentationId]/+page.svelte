<script>
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppShell from '#lib/components/AppShell.svelte';
	import PresentationEditorPage from '#lib/components/presentation/PresentationEditorPage.svelte';
	import { getAppContext } from '#lib/app/context.js';
	import { getCatalogRepository } from '#lib/catalog/client.js';

	/** @type {import('./$types').PageProps} */
	let { params } = $props();

	const { presentationRepository, presentationStore, repository } = getAppContext();

	/**
	 * The route owns history, the page owns the write. The page publishes this
	 * guard for as long as it is mounted, so any in-app navigation away from a
	 * dirty presentation is held until its work is committed.
	 *
	 * @type {{
	 *   hasUnsavedWork: () => boolean,
	 *   saveBeforeLeave: () => Promise<boolean>,
	 *   reportFailure: () => void
	 * } | null}
	 */
	let leaveguard = $state(null);
	let bypass = false;

	/**
	 * The optional catalog read path (P62). Without cloud configuration there is no
	 * repository and the editor simply has no catalog button; when it is configured,
	 * the picker still shows only published items.
	 * @type {import('#lib/catalog/remote.js').SupabaseCatalog | null}
	 */
	let catalogRepository = $state.raw(null);
	/**
	 * The admin write path (P65), separate from the public read path: the editor
	 * only offers “Save as template” when the account is actually an
	 * administrator. The backend RPC re-checks membership; this is only messaging.
	 * @type {import('#lib/catalog/repository.js').CatalogAdminRepository | null}
	 */
	let catalogAdminRepository = $state.raw(null);

	$effect(() => {
		let live = true;
		void getCatalogRepository()
			.then(async (value) => {
				if (!live || !value) return;
				catalogRepository = value;
				const isAdmin = await value.isAdmin();
				if (live) catalogAdminRepository = isAdmin ? value : null;
			})
			.catch(() => {
				if (live) {
					catalogRepository = null;
					catalogAdminRepository = null;
				}
			});
		return () => {
			live = false;
		};
	});

	beforeNavigate(async (navigation) => {
		if (navigation.shallow) return;
		if (bypass || !leaveguard?.hasUnsavedWork()) return;
		// Cancel first: the save is asynchronous, and the editor must not be torn
		// down while it is still writing. SvelteKit counteracts a cancelled Back/
		// Forward navigation with a second popstate; wait for that restoration before
		// following the original history delta, or a racing goto can be undone by it.
		const restored =
			navigation.type === 'popstate'
				? new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
				: null;
		navigation.cancel();
		const target = navigation.to?.url;
		const guard = leaveguard;
		if (!target || !guard) return;
		if (await guard.saveBeforeLeave()) {
			if (navigation.type === 'popstate') {
				await restored;
				history.go(navigation.delta);
			} else {
				bypass = true;
				try {
					await goto(target.pathname + target.search + target.hash);
				} finally {
					bypass = false;
				}
			}
		} else {
			await restored;
			guard.reportFailure();
		}
	});
</script>

<svelte:head><title>Presentation — StickerLab</title></svelte:head>

<AppShell editor pathname={page.url.pathname} search={page.url.search}>
	{#key params.presentationId}
		<PresentationEditorPage
			presentationId={params.presentationId}
			repository={presentationRepository}
			stickerRepository={repository}
			{catalogRepository}
			{catalogAdminRepository}
			store={presentationStore}
			backhref={resolve('presentations')}
			onback={() => goto(resolve('presentations'))}
			bind:leaveguard
		/>
	{/key}
</AppShell>
