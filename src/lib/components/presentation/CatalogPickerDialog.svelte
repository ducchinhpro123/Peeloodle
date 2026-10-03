<script>
	import { Search, Library } from 'lucide-svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { button } from '#lib/ui/styles.js';
	import { SvelteMap } from 'svelte/reactivity';
	import { isCatalogError } from '#lib/catalog/repository.js';
	import CatalogAssetPreview from './CatalogAssetPreview.svelte';

	/**
	 * Student-facing catalog picker (P62).
	 *
	 * Only published items exist on this path — the queries filter on `published`
	 * and RLS enforces it — and a refused or unreachable catalog says so instead of
	 * showing an empty shelf. Previews are lazy thumbnails; inserting fetches the
	 * full derivative through the page (P63), which stores the bytes before the
	 * element is committed.
	 *
	 * Every item is a button, so Tab/Enter inserts without a pointer.
	 *
	 * @type {{
	 *   repository: import('#lib/catalog/repository.js').CatalogRepository | null,
	 *   disabled?: boolean,
	 *   oninsert: (source: import('#lib/presentations/editor/insertCatalogAsset.js').CatalogInsertSource) => void
	 * }}
	 */
	let { repository, disabled = false, oninsert } = $props();

	const PAGE_SIZE = 12;

	let open = $state(false);
	/** @type {import('#lib/catalog/types.js').CatalogCollection[]} */
	let collections = $state.raw([]);
	/** @type {import('#lib/catalog/types.js').CatalogAsset[]} */
	let assets = $state.raw([]);
	/** @type {string | null} */
	let nextCursor = $state.raw(null);
	/** @type {'idle' | 'loading' | 'ready' | 'error'} */
	let status = $state('idle');
	/** @type {string | null} */
	let error = $state(null);
	let loadingMore = $state(false);
	let query = $state('');
	let appliedQuery = $state('');
	let collectionId = $state('');
	/** @type {'' | 'raster' | 'svg'} */
	let kind = $state('');
	/** @type {HTMLButtonElement | null} */
	let opener = null;
	/** Non-null view of the configured read path; `null` means the site is local-only. */
	const catalog = $derived(repository);
	// SvelteMap, not a plain Map: mutations of a plain Map inside `$state` are not
	// tracked, so the tiles would never learn that their version arrived.
	/** @type {SvelteMap<string, import('#lib/catalog/types.js').CatalogAssetVersion>} */
	const versions = new SvelteMap();
	let versionsLoading = $state(false);

	async function loadFirstPage() {
		if (!repository) {
			status = 'error';
			error = 'The catalog is not configured for this site.';
			return;
		}
		status = 'loading';
		error = null;
		const sequence = ++loadSequence;
		try {
			const page = await repository.listAssets({
				query: appliedQuery,
				collectionId: collectionId || undefined,
				kind: kind || undefined,
				limit: PAGE_SIZE
			});
			if (sequence !== loadSequence) return;
			assets = page.items;
			nextCursor = page.nextCursor;
			status = 'ready';
		} catch (cause) {
			if (sequence !== loadSequence) return;
			status = 'error';
			error = errorText(cause);
		}
	}

	let loadSequence = 0;

	/** @param {unknown} cause */
	function errorText(cause) {
		if (isCatalogError(cause)) {
			if (cause.code === 'permission') return 'The catalog cannot be read with this account.';
			if (cause.code === 'unavailable') return cause.message;
		}
		return 'The catalog could not be reached. Check the connection and try again.';
	}

	async function loadMore() {
		if (!repository || !nextCursor) return;
		loadingMore = true;
		try {
			const page = await repository.listAssets({
				query: appliedQuery,
				collectionId: collectionId || undefined,
				kind: kind || undefined,
				limit: PAGE_SIZE,
				cursor: nextCursor
			});
			assets = [...assets, ...page.items];
			nextCursor = page.nextCursor;
		} catch (cause) {
			error = errorText(cause);
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		if (!open) return;
		let live = true;
		void repository
			?.listCollections({ limit: 100 })
			.then((page) => {
				if (live) collections = page.items;
			})
			.catch(() => {
				if (live) collections = [];
			});
		void loadFirstPage();
		return () => {
			live = false;
		};
	});

	/**
	 * Published versions for the assets currently shown, fetched once per asset so
	 * Insert can pass the exact immutable version.
	 */
	$effect(() => {
		const active = catalog;
		if (!open || status !== 'ready' || !active) return;
		const missing = assets.filter((asset) => !versions.has(asset.id));
		if (missing.length === 0) return;
		let live = true;
		versionsLoading = true;
		void (async () => {
			const results = await Promise.all(
				missing.map(async (asset) => {
					try {
						return { id: asset.id, version: await active.getPublishedVersion(asset.id) };
					} catch {
						return { id: asset.id, version: null };
					}
				})
			);
			if (!live) return;
			for (const result of results) {
				if (result.version) versions.set(result.id, result.version);
			}
			versionsLoading = false;
		})();
		return () => {
			live = false;
		};
	});

	/** @param {import('#lib/catalog/types.js').CatalogAsset} asset */
	function insert(asset) {
		const version = versions.get(asset.id);
		if (!version) {
			error = `${asset.name} has no published version to copy.`;
			return;
		}
		oninsert({
			assetId: asset.id,
			assetName: asset.name,
			collectionId: asset.collectionId,
			derivativePath: version.derivativePath,
			derivativeSha256: version.derivativeSha256,
			versionId: version.id
		});
		open = false;
	}
</script>

<button
	type="button"
	class={button}
	bind:this={opener}
	{disabled}
	onclick={() => (open = true)}
	aria-label="Add a catalog image"
>
	<Library size={16} aria-hidden="true" /> Catalog
</button>

<Modal
	{open}
	title="Add a catalog image"
	description="Published catalog images only. The image is saved into this presentation, so later catalog changes do not alter it."
	onclose={() => (open = false)}
	onclosed={() => opener?.focus()}
>
	<div class="[display:grid] [gap:var(--space-3)]">
		<form
			class="[display:flex] [flex-wrap:wrap] [align-items:end] [gap:var(--space-2)]"
			onsubmit={(event) => {
				event.preventDefault();
				appliedQuery = query.trim();
				void loadFirstPage();
			}}
		>
			<label class="[display:grid] [gap:4px] [font-size:12px]">
				Search
				<input type="search" bind:value={query} placeholder="Name" />
			</label>
			<label class="[display:grid] [gap:4px] [font-size:12px]">
				Collection
				<select bind:value={collectionId} onchange={() => void loadFirstPage()}>
					<option value="">All collections</option>
					{#each collections as collection (collection.id)}
						<option value={collection.id}>{collection.name}</option>
					{/each}
				</select>
			</label>
			<label class="[display:grid] [gap:4px] [font-size:12px]">
				Type
				<select bind:value={kind} onchange={() => void loadFirstPage()}>
					<option value="">Any type</option>
					<option value="raster">Raster</option>
					<option value="svg">SVG</option>
				</select>
			</label>
			<button type="submit" class={button}><Search size={14} />Apply</button>
		</form>

		{#if status === 'loading'}<p role="status">Loading catalog images…</p>{/if}
		{#if status === 'error'}<p role="alert">{error}</p>{/if}
		{#if error && status === 'ready'}<p role="alert">{error}</p>{/if}
		{#if status === 'ready' && assets.length === 0}
			<p>No published catalog images match yet.</p>
		{/if}

		{#if assets.length > 0}
			<ul
				class="catalog-grid [margin:0] [display:grid] [grid-template-columns:repeat(auto-fill,_minmax(150px,_1fr))] [gap:var(--space-3)] [padding:0] [list-style:none]"
			>
				{#each assets as asset (asset.id)}
					{@const version = versions.get(asset.id)}
					<li>
						<button
							type="button"
							class="catalog-item"
							disabled={!version}
							onclick={() => insert(asset)}
						>
							{#if version && catalog}
								<CatalogAssetPreview
									repository={catalog}
									path={version.thumbnailPath ?? version.derivativePath}
									alt={asset.name}
								/>
							{:else}
								<span class="catalog-item-note">…</span>
							{/if}
							<span class="catalog-item-name">{asset.name}</span>
							<span class="catalog-item-meta">
								{asset.kind}
								{#if version}· {version.derivativeWidth}×{version.derivativeHeight}{/if}
								{#if !version}· {versionsLoading
										? 'checking version…'
										: 'no published version'}{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if nextCursor}
				<button type="button" class={button} disabled={loadingMore} onclick={loadMore}>
					{loadingMore ? 'Loading…' : 'Load more'}
				</button>
			{/if}
		{/if}
	</div>
</Modal>

<style>
	.catalog-item {
		display: grid;
		width: 100%;
		gap: 4px;
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		text-align: left;
		cursor: pointer;
	}
	.catalog-item:disabled {
		cursor: progress;
		opacity: 0.7;
	}
	.catalog-item-name {
		font-size: 13px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.catalog-item-meta {
		color: var(--muted);
		font-size: 11px;
	}
	.catalog-item-note {
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--muted);
	}
</style>
