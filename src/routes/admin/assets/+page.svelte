<script>
	import AdminAssetsPage from '#lib/components/catalog/AdminAssetsPage.svelte';
	import { getCatalogRepository } from '#lib/catalog/client.js';

	/**
	 * `/admin/assets` — the assets screen. The gate in the admin layout has already
	 * confirmed membership; this route supplies the repository.
	 */
	/** @type {import('#lib/catalog/repository.js').CatalogAdminRepository | null} */
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
</script>

<svelte:head><title>Assets — StickerLab admin</title></svelte:head>

{#if error}
	<p role="alert">{error}</p>
{:else if repository}
	<AdminAssetsPage {repository} />
{:else}
	<p role="status">Loading assets…</p>
{/if}
