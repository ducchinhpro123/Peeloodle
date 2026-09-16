<script>
	import { Archive, Search, Send, ImageOff } from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { button, buttonPrimary } from '$lib/ui/styles.js';
	import { isCatalogError } from '$lib/catalog/repository';

	/**
	 * Asset grid and inspector (P59) with publication and archiving (P60).
	 *
	 * Only what the server actually has is shown: a draft without a validated
	 * version cannot be published, an asset with a version shows that version's
	 * real dimensions and hashes, and archive explains a pinned template instead of
	 * failing silently. Previews are signed URLs for the stored derivative, so a
	 * draft preview never leaves the private bucket.
	 *
	 * @type {{ repository: import('$lib/catalog/repository').CatalogAdminRepository }}
	 */
	let { repository } = $props();

	const PAGE_SIZE = 12;

	/** @type {import('$lib/catalog/types').CatalogAsset[]} */
	let rows = $state.raw([]);
	/** @type {string | null} */
	let nextCursor = $state.raw(null);
	/** @type {'loading' | 'ready' | 'error'} */
	let listStatus = $state('loading');
	/** @type {string | null} */
	let listError = $state(null);
	let loadingMore = $state(false);
	let query = $state('');
	let appliedQuery = $state('');
	let kindFilter = $state('');
	let collectionFilter = $state('');
	/** @type {string | null} */
	let notice = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	/** @type {import('$lib/catalog/types').CatalogCollection[]} */
	let collections = $state.raw([]);

	/** @type {import('$lib/catalog/types').CatalogAsset | null} */
	let selected = $state.raw(null);
	/**
	 * The revision a save or publish is expected to replace. It follows the
	 * inspector's row and, after a conflict, adopts the server's revision so the
	 * second save really does replace the other edit instead of conflicting again.
	 */
	let expectedRevision = $state(0);
	/** @type {import('$lib/catalog/types').CatalogAssetVersion | null} */
	let version = $state.raw(null);
	/** @type {string | null} */
	let previewUrl = $state.raw(null);
	let detailStatus = $state('idle');
	let form = $state({ name: '', description: '', tags: '', sortOrder: 0, collectionId: '' });
	let saving = $state(false);
	/** @type {string | null} */
	let formError = $state(null);
	/** @type {import('$lib/catalog/types').CatalogAsset | null} */
	let conflict = $state.raw(null);
	let publishing = $state(false);
	/** @type {import('$lib/catalog/types').CatalogAsset | null} */
	let archiveTarget = $state.raw(null);
	let archiveBusy = $state(false);
	/** @type {string | null} */
	let archiveError = $state(null);

	let reloadKey = $state(0);
	let loadSequence = 0;

	/** @param {unknown} cause */
	function errorText(cause) {
		if (isCatalogError(cause) && cause.code === 'permission')
			return 'Your account is no longer a catalog administrator.';
		if (cause instanceof Error) return cause.message;
		return 'The request failed. Please retry.';
	}

	/** @param {import('$lib/catalog/repository').CatalogRefusal} reason */
	function refusalText(reason) {
		if (reason === 'not_found') return 'This asset no longer exists.';
		if (reason === 'archived') return 'This asset is archived and cannot be changed.';
		if (reason === 'revision_conflict') return 'Another change happened first.';
		if (reason === 'version_not_validated')
			return 'That version has not passed validation yet, so it cannot be published.';
		if (reason === 'version_not_found') return 'That version no longer exists.';
		if (reason === 'collection_not_published')
			return 'Publish the asset’s collection first: a published asset cannot sit in a draft collection.';
		if (reason === 'pinned_by_template')
			return 'A published template uses this asset. Archive or replace that template first.';
		return `The operation was refused (${reason}).`;
	}

	/** @param {boolean} reset */
	async function load(reset) {
		const sequence = ++loadSequence;
		if (reset) {
			listStatus = 'loading';
			listError = null;
		} else {
			loadingMore = true;
		}
		try {
			const page = await repository.listAssetsForAdmin({
				query: appliedQuery,
				kind: kindFilter ? /** @type {'raster' | 'svg'} */ (kindFilter) : undefined,
				collectionId: collectionFilter || undefined,
				limit: PAGE_SIZE,
				cursor: reset ? null : nextCursor
			});
			if (sequence !== loadSequence) return;
			rows = reset ? page.items : [...rows, ...page.items];
			nextCursor = page.nextCursor;
			listStatus = 'ready';
		} catch (cause) {
			if (sequence !== loadSequence) return;
			if (reset || rows.length === 0) {
				listStatus = 'error';
				listError = errorText(cause);
			} else notice = errorText(cause);
		} finally {
			if (sequence === loadSequence) loadingMore = false;
		}
	}

	$effect(() => {
		void appliedQuery;
		void kindFilter;
		void collectionFilter;
		void reloadKey;
		void load(true);
	});

	$effect(() => {
		let live = true;
		void repository
			.listCollectionsForAdmin({ limit: 100 })
			.then((page) => {
				if (live) collections = page.items;
			})
			.catch(() => {
				/* the filter simply stays empty */
			});
		return () => {
			live = false;
		};
	});

	/** @param {import('$lib/catalog/types').CatalogAsset} asset */
	async function inspect(asset) {
		selected = asset;
		expectedRevision = asset.revision;
		version = null;
		previewUrl = null;
		conflict = null;
		formError = null;
		detailStatus = 'loading';
		form = {
			name: asset.name,
			description: asset.description,
			tags: asset.tags.join(', '),
			sortOrder: asset.sortOrder,
			collectionId: asset.collectionId ?? ''
		};
		try {
			const latest = await repository.getLatestVersion(asset.id);
			if (selected?.id !== asset.id) return;
			version = latest;
			detailStatus = 'ready';
			if (latest) {
				const url = await repository.signedDerivativeUrl(latest.derivativePath, 300);
				if (selected?.id === asset.id) previewUrl = url;
			}
		} catch (cause) {
			if (selected?.id === asset.id) {
				detailStatus = 'error';
				error = errorText(cause);
			}
		}
	}

	/** @param {string} text */
	function tagsFrom(text) {
		return text
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	async function save() {
		if (!selected) return;
		saving = true;
		formError = null;
		const target = selected;
		try {
			const result = await repository.updateAsset(target.id, expectedRevision, {
				collectionId: form.collectionId || null,
				name: form.name.trim(),
				description: form.description,
				tags: tagsFrom(form.tags),
				kind: target.kind,
				provenance: target.provenance,
				sortOrder: form.sortOrder
			});
			if (!result.ok) {
				if (result.reason === 'revision_conflict') {
					conflict = result.detail.item ?? null;
					expectedRevision = conflict?.revision ?? expectedRevision;
					formError = refusalText(result.reason);
				} else formError = refusalText(result.reason);
				return;
			}
			conflict = null;
			await inspect(result.item);
			reloadKey += 1;
			notice = `Saved ${result.item.name}.`;
		} catch (cause) {
			formError = errorText(cause);
		} finally {
			saving = false;
		}
	}

	async function publish() {
		if (!selected || !version) return;
		publishing = true;
		formError = null;
		try {
			const result = await repository.publishAsset(selected.id, version.id, expectedRevision);
			if (!result.ok) {
				formError = refusalText(result.reason);
				if (result.reason === 'revision_conflict' && result.detail.item) {
					conflict = result.detail.item;
					expectedRevision = conflict.revision;
				}
				return;
			}
			await inspect(result.item);
			reloadKey += 1;
			notice = `${result.item.name} is published.`;
		} catch (cause) {
			formError = errorText(cause);
		} finally {
			publishing = false;
		}
	}

	async function archive() {
		if (!archiveTarget) return;
		archiveBusy = true;
		archiveError = null;
		try {
			const result = await repository.archiveAsset(archiveTarget.id, archiveTarget.revision);
			if (!result.ok) {
				archiveError = refusalText(result.reason);
				return;
			}
			if (selected?.id === result.item.id) {
				selected = null;
				version = null;
				previewUrl = null;
			}
			archiveTarget = null;
			reloadKey += 1;
			notice = `${result.item.name} left the catalog.`;
		} catch (cause) {
			archiveError = errorText(cause);
		} finally {
			archiveBusy = false;
		}
	}

	/** @param {string} hash */
	function shortHash(hash) {
		return hash.slice(0, 12);
	}
</script>

<section class="[display:grid] [gap:var(--space-4)]">
	{#if notice}
		<p class="[margin:0] [font-size:13px]" role="status">{notice}</p>
	{/if}
	{#if error}
		<p
			class="[margin:0] [border-radius:var(--radius-sm)] [padding:8px_10px] [font-size:13px] [color:#8d1d3f] [background:#fdecef]"
			role="alert"
		>
			{error}
		</p>
	{/if}

	<form
		class="[display:flex] [flex-wrap:wrap] [align-items:end] [gap:var(--space-3)]"
		onsubmit={(event) => {
			event.preventDefault();
			appliedQuery = query.trim();
		}}
	>
		<label class="[display:grid] [gap:4px] [font-size:13px]">
			Search
			<input
				type="search"
				bind:value={query}
				placeholder="Name or description"
				class="[border-radius:var(--radius-sm)] [padding:8px]"
			/>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:13px]">
			Collection
			<select bind:value={collectionFilter} class="[border-radius:var(--radius-sm)] [padding:8px]">
				<option value="">Any</option>
				{#each collections as collection (collection.id)}
					<option value={collection.id}>{collection.name}</option>
				{/each}
			</select>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:13px]">
			Type
			<select bind:value={kindFilter} class="[border-radius:var(--radius-sm)] [padding:8px]">
				<option value="">Any</option>
				<option value="raster">Raster</option>
				<option value="svg">SVG</option>
			</select>
		</label>
		<button type="submit" class={button}><Search size={14} />Apply</button>
	</form>

	{#if listStatus === 'loading'}
		<p role="status" class="[margin:0] [font-size:13px] [color:var(--muted)]">Loading assets…</p>
	{:else if listStatus === 'error'}
		<p role="alert" class="[margin:0] [font-size:13px]">{listError}</p>
	{:else if rows.length === 0}
		<p class="[margin:0] [font-size:13px] [color:var(--muted)]">
			No assets match. Upload files on the Uploads screen to add drafts.
		</p>
	{:else}
		<ul
			class="asset-grid [margin:0] [display:grid] [grid-template-columns:repeat(auto-fill,_minmax(180px,_1fr))] [gap:var(--space-3)] [padding:0] [list-style:none]"
		>
			{#each rows as asset (asset.id)}
				<li>
					<button
						type="button"
						class="asset-card"
						aria-pressed={selected?.id === asset.id}
						onclick={() => inspect(asset)}
					>
						<strong class="[font-size:13px] [overflow-wrap:anywhere]">{asset.name}</strong>
						<span class="[font-size:12px] [color:var(--muted)]">
							{asset.kind} · {asset.state}
							{#if asset.tags.length}· {asset.tags.slice(0, 3).join(', ')}{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
		{#if nextCursor}
			<button type="button" class={button} disabled={loadingMore} onclick={() => load(false)}>
				{loadingMore ? 'Loading…' : 'Load more'}
			</button>
		{/if}
	{/if}

	{#if selected}
		<section
			class="inspector [display:grid] [gap:var(--space-3)] [border-radius:var(--radius)] [padding:var(--space-4)] [border:1px_solid_var(--line)]"
			aria-label={`Asset ${selected.name}`}
		>
			<div class="[display:flex] [align-items:start] [gap:var(--space-3)]">
				<div class="[display:grid] [min-width:0] [flex:1] [gap:6px]">
					<h2 class="[margin:0] [font-size:16px]">{selected.name}</h2>
					<p class="[margin:0] [font-size:12px] [color:var(--muted)]">
						{selected.state} · revision {selected.revision}
						{#if selected.publishedAt}· published {new Date(
								selected.publishedAt
							).toLocaleString()}{/if}
					</p>
					{#if Object.keys(selected.provenance).length > 0}
						<p class="[margin:0] [font-size:12px] [overflow-wrap:anywhere] [color:var(--muted)]">
							Provenance: {JSON.stringify(selected.provenance)}
						</p>
					{/if}
				</div>
				{#if previewUrl}
					<img
						class="preview [width:140px] [border-radius:var(--radius-sm)] [background:var(--surface)]"
						src={previewUrl}
						alt={`Preview of ${selected.name}`}
					/>
				{:else}
					<span
						class="[display:grid] [height:96px] [width:140px] [place-items:center] [border-radius:var(--radius-sm)] [color:var(--muted)] [background:var(--surface)]"
					>
						<ImageOff size={20} aria-hidden="true" />
					</span>
				{/if}
			</div>

			{#if detailStatus === 'loading'}
				<p role="status" class="[margin:0] [font-size:13px] [color:var(--muted)]">
					Loading version…
				</p>
			{:else if version}
				<p class="[margin:0] [font-size:13px]">
					Version {version.versionNumber}: {version.derivativeWidth}×{version.derivativeHeight}
					{version.derivativeMime}, {Math.round(version.derivativeBytes / 1024)} KB ·
					{version.validationState} · sha256 {shortHash(version.derivativeSha256)}…
				</p>
			{:else}
				<p class="[margin:0] [font-size:13px] [color:var(--muted)]">
					No processed version yet. Upload the file and let the server validate it before
					publishing.
				</p>
			{/if}

			<form
				class="[display:grid] [gap:var(--space-3)]"
				onsubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<label class="[display:grid] [gap:4px] [font-size:13px]">
					Name
					<input
						type="text"
						bind:value={form.name}
						class="[border-radius:var(--radius-sm)] [padding:8px]"
					/>
				</label>
				<label class="[display:grid] [gap:4px] [font-size:13px]">
					Description
					<textarea bind:value={form.description} rows="3" class="[padding:8px]"></textarea>
				</label>
				<div class="[display:flex] [flex-wrap:wrap] [gap:var(--space-3)]">
					<label class="[display:grid] [flex:1] [gap:4px] [font-size:13px]">
						Tags (comma separated)
						<input bind:value={form.tags} class="[border-radius:var(--radius-sm)] [padding:8px]" />
					</label>
					<label class="[display:grid] [width:110px] [gap:4px] [font-size:13px]">
						Order
						<input
							type="number"
							bind:value={form.sortOrder}
							class="[border-radius:var(--radius-sm)] [padding:8px]"
						/>
					</label>
					<label class="[display:grid] [flex:1] [gap:4px] [font-size:13px]">
						Collection
						<select
							bind:value={form.collectionId}
							class="[border-radius:var(--radius-sm)] [padding:8px]"
						>
							<option value="">Ungrouped</option>
							{#each collections as collection (collection.id)}
								<option value={collection.id}>{collection.name}</option>
							{/each}
						</select>
					</label>
				</div>
				{#if formError}
					<p
						class="[margin:0] [border-radius:var(--radius-sm)] [padding:8px_10px] [font-size:13px] [color:#8d1d3f] [background:#fdecef]"
						role="alert"
					>
						{formError}
					</p>
				{/if}
				{#if conflict}
					<p class="[margin:0] [font-size:12px] [color:var(--muted)]">
						The server has revision {conflict.revision}: “{conflict.name}”. Saving again replaces
						that change.
					</p>
				{/if}
				<div class="[display:flex] [flex-wrap:wrap] [gap:var(--space-2)]">
					<button
						type="submit"
						class={buttonPrimary}
						disabled={saving || form.name.trim().length === 0}
					>
						{saving ? 'Saving…' : conflict ? 'Save and replace the other edit' : 'Save metadata'}
					</button>
					<button
						type="button"
						class={button}
						disabled={publishing || !version || selected.state === 'archived'}
						onclick={publish}
					>
						<Send size={14} />{selected.state === 'published'
							? 'Republish this version'
							: 'Publish'}
					</button>
					<button
						type="button"
						class={button}
						disabled={selected.state === 'archived'}
						onclick={() => {
							archiveTarget = selected;
							archiveError = null;
						}}
					>
						<Archive size={14} />Archive
					</button>
				</div>
			</form>
		</section>
	{/if}
</section>

<Modal
	open={archiveTarget !== null}
	title="Archive this asset?"
	description="Archiving removes it from the public catalog. Already downloaded copies are not recalled."
	onclose={() => (archiveTarget = null)}
>
	{#if archiveError}
		<p
			class="[margin:0] [border-radius:var(--radius-sm)] [padding:8px_10px] [font-size:13px] [color:#8d1d3f] [background:#fdecef]"
			role="alert"
		>
			{archiveError}
		</p>
	{/if}
	{#snippet footer()}
		<button type="button" class={button} onclick={() => (archiveTarget = null)}>Keep it</button>
		<button type="button" class={buttonPrimary} disabled={archiveBusy} onclick={archive}>
			{archiveBusy ? 'Archiving…' : 'Archive asset'}
		</button>
	{/snippet}
</Modal>

<style>
	.asset-card {
		display: grid;
		gap: 4px;
		width: 100%;
		min-height: 84px;
		align-content: start;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		text-align: left;
		cursor: pointer;
	}
	.asset-card[aria-pressed='true'] {
		border-color: var(--mint);
		background: var(--pale);
	}
</style>
