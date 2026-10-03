<script>
	import { Plus, Pencil, Search, Upload, Archive } from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { button, buttonPrimary } from '$lib/ui/styles.js';
	import { isCatalogError } from '$lib/catalog/repository';

	/**
	 * Admin collection management (P52): paged search, create, edit with
	 * compare-and-set revisions, publish and archive.
	 *
	 * The repository is supplied through props. A revision conflict
	 * keeps the form's values and shows the server's current revision; saving again
	 * explicitly replaces the other edit. Every other refusal is explained in the
	 * place the action was taken.
	 *
	 * @type {{ repository: import('$lib/catalog/repository').CatalogAdminRepository }}
	 */
	let { repository } = $props();

	const PAGE_SIZE = 12;

	/** @type {import('$lib/catalog/types').CatalogCollection[]} */
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
	/** @type {string | null} */
	let notice = $state(null);

	let editorOpen = $state(false);
	/** @type {string | null} */
	let editingId = $state(null);
	let editingRevision = $state(0);
	let form = $state({ name: '', description: '', tags: '', sortOrder: 0 });
	let formBusy = $state(false);
	/** @type {string | null} */
	let formError = $state(null);
	/** @type {import('$lib/catalog/types').CatalogCollection | null} */
	let conflict = $state.raw(null);

	/** @type {import('$lib/catalog/types').CatalogCollection | null} */
	let archiveTarget = $state.raw(null);
	let archiveItems = $state(false);
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
		if (reason === 'not_found') return 'This collection no longer exists.';
		if (reason === 'archived') return 'This collection is archived and cannot be changed.';
		if (reason === 'revision_conflict')
			return 'Another change happened first. Reload to see the current version.';
		return 'The operation was refused.';
	}

	/**
	 * @param {boolean} reset
	 */
	async function load(reset) {
		const sequence = ++loadSequence;
		if (reset) {
			listStatus = 'loading';
			listError = null;
		} else {
			loadingMore = true;
		}
		try {
			const page = await repository.listCollectionsForAdmin({
				query: appliedQuery,
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
			} else {
				notice = errorText(cause);
			}
		} finally {
			if (sequence === loadSequence) loadingMore = false;
		}
	}

	// The list reloads when the applied search changes or a mutation asks for it.
	$effect(() => {
		void appliedQuery;
		void reloadKey;
		void load(true);
	});

	/** @param {string} text */
	function tagsFrom(text) {
		return text
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	function openCreate() {
		editingId = null;
		editingRevision = 0;
		const order = rows.length ? Math.max(...rows.map((row) => row.sortOrder)) + 1 : 1;
		form = { name: '', description: '', tags: '', sortOrder: order };
		conflict = null;
		formError = null;
		editorOpen = true;
	}

	/** @param {import('$lib/catalog/types').CatalogCollection} row */
	function openEdit(row) {
		editingId = row.id;
		editingRevision = row.revision;
		form = {
			name: row.name,
			description: row.description,
			tags: row.tags.join(', '),
			sortOrder: row.sortOrder
		};
		conflict = null;
		formError = null;
		editorOpen = true;
	}

	async function submitEditor() {
		formBusy = true;
		formError = null;
		const input = {
			name: form.name.trim(),
			description: form.description.trim(),
			tags: tagsFrom(form.tags),
			sortOrder: Number(form.sortOrder) || 0
		};
		try {
			const result = editingId
				? await repository.updateCollection(editingId, editingRevision, input)
				: await repository.createCollection(input);
			if (!result.ok) {
				if (result.reason === 'revision_conflict' && result.detail.item) {
					// Keep the form as-is; the next save deliberately replaces the other edit.
					conflict = result.detail.item;
					editingRevision = conflict.revision;
					formError = `Another change made this revision ${conflict.revision}. Saving again replaces it; your current values are kept here.`;
					return;
				}
				formError = refusalText(result.reason);
				if (result.reason === 'not_found' || result.reason === 'archived') {
					editorOpen = false;
					notice = formError;
					await load(true);
				}
				return;
			}
			notice = editingId
				? `Saved “${result.item.name}”.`
				: `Created “${result.item.name}” as a draft.`;
			editorOpen = false;
			await load(true);
		} catch (cause) {
			formError = errorText(cause);
		} finally {
			formBusy = false;
		}
	}

	/** @param {import('$lib/catalog/types').CatalogCollection} row */
	async function publish(row) {
		notice = null;
		try {
			const result = await repository.publishCollection(row.id, row.revision);
			if (!result.ok) {
				notice =
					result.reason === 'revision_conflict'
						? `“${row.name}” changed before it could be published. The list was refreshed.`
						: refusalText(result.reason);
				await load(true);
				return;
			}
			notice = `Published “${result.item.name}”.`;
			await load(true);
		} catch (cause) {
			notice = errorText(cause);
		}
	}

	/** @param {import('$lib/catalog/types').CatalogCollection} row */
	function openArchive(row) {
		archiveTarget = row;
		archiveItems = false;
		archiveError = null;
	}

	async function confirmArchive() {
		if (!archiveTarget) return;
		archiveBusy = true;
		archiveError = null;
		try {
			const result = await repository.archiveCollection(
				archiveTarget.id,
				archiveTarget.revision,
				archiveItems
			);
			if (result.ok) {
				notice = `Archived “${result.item.name}”.`;
				archiveTarget = null;
				await load(true);
				return;
			}
			if (result.reason === 'contains_items') {
				const count = typeof result.detail.count === 'number' ? result.detail.count : 0;
				archiveError = `This collection still contains ${count} item${count === 1 ? '' : 's'}. Archive its items too, or move them first.`;
				return;
			}
			if (result.reason === 'pinned_by_template') {
				const titles = (result.detail.templates ?? []).map((template) => template.title);
				archiveError = `A published template still uses an item here${titles.length ? ` (${titles.join(', ')})` : ''}. Archive or replace that template first.`;
				return;
			}
			archiveError = refusalText(result.reason);
		} catch (cause) {
			archiveError = errorText(cause);
		} finally {
			archiveBusy = false;
		}
	}

	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	/** @param {string} value */
	function date(value) {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
	}
</script>

<section class="admin-collections [display:grid] [gap:var(--space-4)]">
	<div
		class="admin-collections-bar [display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)]"
	>
		<form
			class="admin-search [display:flex] [flex:1_1_18rem] [gap:var(--space-2)]"
			onsubmit={(event) => {
				event.preventDefault();
				appliedQuery = query.trim();
			}}
		>
			<label class="sr-only" for="catalog-collection-search">Search collections</label>
			<input
				id="catalog-collection-search"
				type="search"
				placeholder="Search collections"
				bind:value={query}
				class="[min-height:38px] [min-width:0] [flex:1] [border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			/>
			<button type="submit" class={button}><Search size={16} aria-hidden="true" /> Search</button>
			{#if appliedQuery}
				<button
					type="button"
					class={button}
					onclick={() => {
						query = '';
						appliedQuery = '';
					}}>Clear</button
				>
			{/if}
		</form>
		<button type="button" class={buttonPrimary} onclick={openCreate}
			><Plus size={16} aria-hidden="true" /> New collection</button
		>
	</div>

	{#if notice}<p role="status" class="admin-notice [margin:0] [font-weight:700] [color:#007b55]">
			{notice}
		</p>{/if}

	{#if listStatus === 'loading'}
		<p role="status">Loading collections…</p>
	{:else if listStatus === 'error'}
		<div class="[display:grid] [justify-items:start] [gap:var(--space-3)]">
			<p role="alert">{listError}</p>
			<button type="button" class={buttonPrimary} onclick={() => (reloadKey += 1)}>Try again</button
			>
		</div>
	{:else if rows.length === 0}
		<div
			class="[display:grid] [place-items:center] [gap:var(--space-3)] [border-radius:var(--radius)] [padding:var(--space-7)] [text-align:center] [border:1px_dashed_#abd3c3]"
		>
			<Upload size={28} aria-hidden="true" />
			<p>
				{appliedQuery
					? `No collections match “${appliedQuery}”.`
					: 'No collections yet. Create one to group assets for template building.'}
			</p>
			{#if appliedQuery}
				<button
					type="button"
					class={button}
					onclick={() => {
						query = '';
						appliedQuery = '';
					}}>Show all</button
				>
			{:else}
				<button type="button" class={buttonPrimary} onclick={openCreate}
					>Create the first collection</button
				>
			{/if}
		</div>
	{:else}
		<ul
			class="admin-collection-list [margin:0] [display:grid] [gap:var(--space-3)] [padding:0] [list-style:none]"
		>
			{#each rows as row (row.id)}
				<li
					class="admin-collection [display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)] [border-radius:var(--radius-sm)] [padding:var(--space-4)] [background:var(--surface)] [border:1px_solid_var(--line)]"
				>
					<div class="admin-collection-main [min-width:12rem] [flex:1_1_16rem]">
						<h2 class="[margin:0] [font-size:16px] [overflow-wrap:anywhere]">{row.name}</h2>
						<p
							class="[margin:2px_0_0] [font-size:12px] [overflow-wrap:anywhere] [color:var(--muted)]"
						>
							{#if row.tags.length}tags: {row.tags.join(', ')} ·
							{/if}order {row.sortOrder} · revision
							{row.revision} · updated {date(row.updatedAt)}
						</p>
						{#if row.description}<p class="[margin:4px_0_0] [overflow-wrap:anywhere]">
								{row.description}
							</p>{/if}
					</div>
					<span
						class="admin-state [border-radius:999px] [padding:2px_10px] [font-size:11px] [font-weight:800]"
						class:is-draft={row.state === 'draft'}
						class:is-published={row.state === 'published'}
						class:is-archived={row.state === 'archived'}>{row.state}</span
					>
					<div class="admin-collection-actions [display:flex] [gap:var(--space-2)]">
						{#if row.state !== 'archived'}
							<button type="button" class={button} onclick={() => openEdit(row)}
								><Pencil size={15} aria-hidden="true" /> Edit</button
							>
						{/if}
						{#if row.state === 'draft'}
							<button type="button" class={button} onclick={() => publish(row)}>Publish</button>
						{/if}
						{#if row.state !== 'archived'}
							<button
								type="button"
								class={[button, 'admin-archive-button']}
								onclick={() => openArchive(row)}
								><Archive size={15} aria-hidden="true" /> Archive</button
							>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if nextCursor}
			<button
				type="button"
				class={[button, 'admin-load-more']}
				disabled={loadingMore}
				onclick={() => load(false)}>{loadingMore ? 'Loading…' : 'Load more'}</button
			>
		{/if}
	{/if}
</section>

<Modal
	open={editorOpen}
	title={editingId ? 'Edit collection' : 'New collection'}
	description={editingId
		? 'Names, tags and order are drafts until the collection is published. Saving uses compare-and-set; a conflicting edit is never overwritten silently.'
		: 'A collection is a draft until it is published. Assets are added in the uploads workspace.'}
	onclose={() => (editorOpen = false)}
>
	<form
		class="[display:grid] [gap:var(--space-3)]"
		onsubmit={(event) => {
			event.preventDefault();
			void submitEditor();
		}}
	>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Name
			<input
				id="catalog-collection-name"
				required
				maxlength="200"
				bind:value={form.name}
				class="[min-height:38px] [border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			/>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Description
			<textarea
				id="catalog-collection-description"
				rows="3"
				maxlength="10000"
				bind:value={form.description}
				class="[border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			></textarea>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Tags (comma separated)
			<input
				id="catalog-collection-tags"
				bind:value={form.tags}
				class="[min-height:38px] [border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			/>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Order
			<input
				id="catalog-collection-order"
				type="number"
				bind:value={form.sortOrder}
				class="[min-height:38px] [border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			/>
		</label>
		{#if formError}<p role="alert" class="[margin:0] [font-weight:700]">{formError}</p>{/if}
		{#if conflict}
			<button
				type="button"
				class={button}
				onclick={() => {
					if (conflict) openEdit(conflict);
				}}>Reload the server version (discards these values)</button
			>
		{/if}
		<div class="[display:flex] [justify-content:flex-end] [gap:var(--space-2)]">
			<button type="button" class={button} onclick={() => (editorOpen = false)}>Cancel</button>
			<button type="submit" class={buttonPrimary} disabled={formBusy}
				>{formBusy ? 'Saving…' : editingId ? 'Save changes' : 'Create draft'}</button
			>
		</div>
	</form>
</Modal>

<Modal
	open={archiveTarget !== null}
	title="Archive collection"
	description="Archiving removes the collection from the catalog. It does not delete asset versions or student copies that already exist."
	onclose={() => (archiveTarget = null)}
>
	<div class="[display:grid] [gap:var(--space-3)]">
		<p class="[margin:0]">
			Archive “{archiveTarget?.name}”? Collected items stay archived with it.
		</p>
		<label class="[display:flex] [align-items:center] [gap:var(--space-2)] [font-size:13px]">
			<input type="checkbox" bind:checked={archiveItems} />
			Archive its items too
		</label>
		{#if archiveError}<p role="alert" class="[margin:0] [font-weight:700]">{archiveError}</p>{/if}
		<div class="[display:flex] [justify-content:flex-end] [gap:var(--space-2)]">
			<button type="button" class={button} onclick={() => (archiveTarget = null)}>Cancel</button>
			<button type="button" class={buttonPrimary} disabled={archiveBusy} onclick={confirmArchive}
				>{archiveBusy ? 'Archiving…' : 'Archive collection'}</button
			>
		</div>
	</div>
</Modal>

<style>
	.admin-state.is-draft {
		background: var(--pale);
		color: #315b4e;
	}
	.admin-state.is-published {
		background: #e3f4ea;
		color: #00694a;
	}
	.admin-state.is-archived {
		background: var(--cream);
		color: var(--muted);
	}
	.admin-archive-button {
		color: var(--danger);
	}
</style>
