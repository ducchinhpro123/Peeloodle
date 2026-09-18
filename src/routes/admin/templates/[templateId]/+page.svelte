<script>
	import { resolve } from '$app/paths';
	import AdminTemplateDetailPage from '$lib/components/catalog/AdminTemplateDetailPage.svelte';
	import { getCatalogRepository } from '$lib/catalog/client';

	/**
	 * `/admin/templates/<id>` — one template's metadata and immutable version
	 * facts (P66). The gate in the admin layout has already confirmed membership.
	 */
	/** @type {import('./$types').PageProps} */
	let { params } = $props();

	/** @type {import('$lib/catalog/repository').CatalogAdminRepository | null} */
	let repository = $state.raw(null);
	/** @type {string | null} */
	let error = $state(null);

	$effect(() => {
		let live = true;
		void getCatalogRepository()
			.then((value) => {
				if (!live) return;
				if (!value) error = 'Catalog is not configured for this site.';
				else repository = value;
			})
			.catch((cause) => {
				if (live)
					error = cause instanceof Error ? cause.message : 'The catalog could not be opened.';
			});
		return () => {
			live = false;
		};
	});

	const listHref = resolve('/admin/templates');
	const editHref = $derived(`${listHref}/${encodeURIComponent(params.templateId)}/edit`);
</script>

<svelte:head><title>Template — StickerLab admin</title></svelte:head>

{#if error}
	<p role="alert">{error}</p>
{:else if repository}
	<AdminTemplateDetailPage templateId={params.templateId} {repository} {listHref} {editHref} />
{:else}
	<p role="status">Loading template…</p>
{/if}
