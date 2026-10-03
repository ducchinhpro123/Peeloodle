<script>
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppShell from '#lib/components/AppShell.svelte';
	import AdminGuard from '#lib/components/catalog/AdminGuard.svelte';
	import PresentationEditorPage from '#lib/components/presentation/PresentationEditorPage.svelte';
	import { getAppContext } from '#lib/app/context.js';
	import { getCatalogRepository } from '#lib/catalog/client.js';
	import { getCloudWorkspace } from '#lib/cloud/workspace.svelte.js';
	import { TemplateDraftRepository } from '#lib/presentations/templates/templateDraftRepository.js';

	/**
	 * `/admin/templates/<id>/edit` — the shared presentation editor in template
	 * mode (P66). The only differences from `/presentations/<id>` are the
	 * repository (catalog versions instead of IndexedDB), the explicit save, and
	 * the surrounding actions; the editor component and document model are the
	 * same one.
	 */
	/** @type {import('./$types').PageProps} */
	let { params } = $props();

	const { presentationStore } = getAppContext();
	const workspace = getCloudWorkspace();

	/** @type {import('#lib/catalog/remote.js').SupabaseCatalog | null} */
	let repository = $state.raw(null);
	/** Remounts the editor to reload a newer server draft after a conflict. */
	let reloadKey = $state(0);

	$effect(() => {
		let live = true;
		void getCatalogRepository()
			.then((value) => {
				if (live) repository = value;
			})
			.catch(() => {
				if (live) repository = null;
			});
		return () => {
			live = false;
		};
	});

	/**
	 * The catalog adapter is created once the repository exists; `invalidate`
	 * makes the remount read the newest version instead of the cached one.
	 * @type {TemplateDraftRepository | null}
	 */
	const draftRepository = $derived(
		repository
			? new TemplateDraftRepository({ catalog: repository, templateId: params.templateId })
			: null
	);

	/**
	 * The route owns history, the page owns the write: the editor publishes this
	 * guard so in-app navigation is held until the draft is committed.
	 *
	 * @type {{
	 *   hasUnsavedWork: () => boolean,
	 *   saveBeforeLeave: () => Promise<boolean>,
	 *   reportFailure: () => void
	 * } | null}
	 */
	let leaveguard = $state(null);

	let bypass = false;
	const listHref = resolve('admin/templates');
	const backhref = $derived(`${listHref}/${encodeURIComponent(params.templateId)}`);

	function reloadDraft() {
		draftRepository?.invalidate();
		reloadKey += 1;
	}

	beforeNavigate(async (navigation) => {
		if (navigation.shallow) return;
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

<svelte:head><title>Edit template draft — StickerLab</title></svelte:head>

<AppShell editor pathname={page.url.pathname} search={page.url.search}>
	<AdminGuard
		configured={workspace.configured}
		sessionEmail={workspace.session?.user.email ?? null}
		{repository}
		homeHref={resolve('/')}
	>
		{#if draftRepository}
			{#key `${params.templateId}:${reloadKey}`}
				<PresentationEditorPage
					presentationId={params.templateId}
					repository={draftRepository}
					catalogRepository={repository}
					store={presentationStore}
					mode="template"
					{backhref}
					onback={() => goto(backhref)}
					onreload={reloadDraft}
					bind:leaveguard
				/>
			{/key}
		{/if}
	</AdminGuard>
</AppShell>
