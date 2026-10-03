<script>
	import { resolve } from '$app/paths';
	import AdminTemplatesPage from '#lib/components/catalog/AdminTemplatesPage.svelte';
	import { getCatalogRepository } from '#lib/catalog/client.js';

	/**
	 * `/admin/templates` — the template administration list (P66). The gate in the
	 * admin layout has already confirmed membership; this route supplies the
	 * repository and the base-aware detail link.
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

	/** @param {string} id */
	function detailHref(id) {
		return `${resolve('admin/templates')}/${encodeURIComponent(id)}`;
	}
</script>

<svelte:head><title>Templates — StickerLab admin</title></svelte:head>

{#if error}
	<p role="alert">{error}</p>
{:else if repository}
	<AdminTemplatesPage {repository} {detailHref} presentationsHref={resolve('presentations')} />
{:else}
	<p role="status">Loading templates…</p>
{/if}
