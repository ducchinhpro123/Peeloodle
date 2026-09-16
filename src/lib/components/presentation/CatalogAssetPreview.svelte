<script>
	/**
	 * One lazy catalog preview.
	 *
	 * The signed URL is minted only once the tile is actually near the viewport, so
	 * a page of results does not download previews nobody looked at. A small
	 * thumbnail object is requested (never the full derivative); the derivative is
	 * fetched only when the image is inserted.
	 *
	 * @type {{
	 *   repository: import('$lib/catalog/repository').CatalogRepository,
	 *   path: string,
	 *   alt: string
	 * }}
	 */
	let { repository, path, alt } = $props();

	/** @type {'idle' | 'loading' | 'ready' | 'error'} */
	let status = $state('idle');
	/** @type {string | null} */
	let url = $state.raw(null);
	/** @type {HTMLDivElement | null} */
	let tile = $state.raw(null);
	/** @type {IntersectionObserver | null} */
	let observer = null;

	$effect(() => {
		const element = tile;
		if (!element || status !== 'idle') return;
		if (typeof IntersectionObserver !== 'function') {
			status = 'loading';
			return;
		}
		observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					status = 'loading';
					observer?.disconnect();
					observer = null;
				}
			},
			{ rootMargin: '120px' }
		);
		observer.observe(element);
		return () => {
			observer?.disconnect();
			observer = null;
		};
	});

	$effect(() => {
		if (status !== 'loading') return;
		let live = true;
		void repository
			.signedDerivativeUrl(path, 120)
			.then((value) => {
				if (!live) return;
				url = value;
				status = 'ready';
			})
			.catch(() => {
				if (live) status = 'error';
			});
		return () => {
			live = false;
		};
	});
</script>

<div class="catalog-preview" bind:this={tile}>
	{#if status === 'ready' && url}
		<img src={url} {alt} loading="lazy" />
	{:else if status === 'error'}
		<span class="catalog-preview-note" role="img" aria-label={`${alt} could not be shown`}
			>No preview</span
		>
	{:else}
		<span class="catalog-preview-note" aria-hidden="true">…</span>
	{/if}
</div>

<style>
	.catalog-preview {
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: var(--surface);
	}
	.catalog-preview img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.catalog-preview-note {
		color: var(--muted);
		font-size: 11px;
	}
</style>
