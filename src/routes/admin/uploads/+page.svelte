<script>
	import AdminUploadsPage from '#lib/components/catalog/AdminUploadsPage.svelte';
	import { getCatalogRepository } from '#lib/catalog/client.js';

	/**
	 * `/admin/uploads` — the uploads screen. The gate in the admin layout has already
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

<svelte:head><title>Uploads — StickerLab admin</title></svelte:head>

{#if error}
	<p role="alert">{error}</p>
{:else if repository}
	<AdminUploadsPage {repository} />
{:else}
	<p role="status">Loading uploads…</p>
{/if}
