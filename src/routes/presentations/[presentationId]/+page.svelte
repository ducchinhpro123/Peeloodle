<script>
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import PresentationEditorPage from '$lib/components/presentation/PresentationEditorPage.svelte';
	import { getAppContext } from '$lib/app/context';
	import { getCatalogRepository } from '$lib/catalog/client';

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
	 * @type {import('$lib/catalog/remote').SupabaseCatalog | null}
	 */
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

	beforeNavigate(async (navigation) => {
		if (bypass || !leaveguard?.hasUnsavedWork()) return;
		// Cancel first: the save is asynchronous, and the editor must not be torn
		// down while it is still writing. On success the same URL is re-entered.
		navigation.cancel();
		const target = navigation.to?.url;
		const guard = leaveguard;
		if (!target || !guard) return;
		if (await guard.saveBeforeLeave()) {
			bypass = true;
			await goto(target.pathname + target.search + target.hash);
			bypass = false;
		} else {
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
			store={presentationStore}
			backhref={resolve('/presentations')}
			onback={() => goto(resolve('/presentations'))}
			bind:leaveguard
		/>
	{/key}
</AppShell>
