<script>
	/**
	 * Port of `src/features/packs/PacksPage.tsx` (React main `54eae61c`): the real
	 * `/my-stickers` library — saved-sticker packs with search/sort, the five source
	 * views, pack covers built from saved sticker thumbnails, membership
	 * add/reorder/remove, duplicate/delete with the source's keep-the-stickers
	 * semantics, ordered PNG ZIP export and the local sticker drawer below.
	 *
	 * URL wiring stays in `src/routes/my-stickers/+page.svelte` (view parameter,
	 * `?pack=` deep link and `#local-stickers`), so this component renders in a
	 * browser test without `$app` mocks — the same seam `TemplatesPage.svelte` and
	 * `DashboardPage.svelte` use. Cloud-ness is read from the workspace context, so
	 * badges and headings follow the signed-in account and refresh with its status.
	 */
	import {
		ArrowUpDown,
		ChevronRight,
		Copy,
		Download,
		ImagePlus,
		Layers3,
		LockKeyhole,
		PackageOpen,
		Pencil,
		Plus,
		Search,
		Trash2,
		X
	} from 'lucide-svelte';
	import AppShell from './AppShell.svelte';
	import Hero from './Hero.svelte';
	import StickerCollage from './StickerCollage.svelte';
	import Modal from './Modal.svelte';
	import LocalProjectList from './LocalProjectList.svelte';
	import ProjectThumb from './ProjectThumb.svelte';
	import TemplateRail from './TemplateRail.svelte';
	import { shellHref } from '$lib/app/navigation';
	import { getCloudWorkspace } from '$lib/cloud/workspace.svelte';
	import { downloadBlob } from '$lib/exports/download';
	import { getFavoriteTemplateIds, templateData } from '$lib/editor/templates';
	import {
		PACK_VIEWS,
		buildPackRecord,
		duplicatePackRecord,
		reorderProjectInPack,
		setProjectInPack,
		visiblePacks
	} from '$lib/packs/packActions';
	/** @typedef {import('$lib/domain/domain').PackRecord} PackRecord */

	/**
	 * @type {{
	 *   repository: import('$lib/persistence/repository').StickerLabRepository,
	 *   pathname?: string,
	 *   search?: string,
	 *   hash?: string,
	 *   view?: (typeof PACK_VIEWS)[number],
	 *   requestedPackId?: string | null,
	 *   onselectview?: (view: (typeof PACK_VIEWS)[number]) => void,
	 *   onopen?: (projectId: string) => void,
	 * }}
	 */
	let {
		repository,
		pathname = '/my-stickers',
		search = '',
		hash = '',
		view = 'All Packs',
		requestedPackId = null,
		onselectview = () => {},
		onopen = () => {}
	} = $props();

	let packs = $state(/** @type {PackRecord[]} */ ([]));
	let projects = $state(/** @type {import('$lib/domain/domain').ProjectDocument[]} */ ([]));
	let selectedPackId = $state(/** @type {string | null} */ (null));
	let detailClosed = $state(false);
	let createOpen = $state(false);
	let editingPack = $state(/** @type {PackRecord | null} */ (null));
	let deletePack = $state(/** @type {PackRecord | null} */ (null));
	let newTitle = $state('');
	let newDesc = $state('');
	let addStickerOpen = $state(false);
	let noticeOpen = $state(false);
	let packQuery = $state('');
	let packSort = $state(/** @type {import('$lib/packs/packActions').PackSort} */ ('recent'));
	let exportingZip = $state(false);
	let busy = $state(false);
	let error = $state(/** @type {string | null} */ (null));

	/** Element handles for the source's focus restoration; plain locals, never UI state. */
	let newPackButton = /** @type {HTMLButtonElement | undefined} */ (undefined);
	let createOpener = /** @type {HTMLButtonElement | undefined} */ (undefined);
	let deleteOpener = /** @type {HTMLButtonElement | undefined} */ (undefined);
	let addOpener = /** @type {HTMLButtonElement | undefined} */ (undefined);
	let noticeOpener = /** @type {HTMLButtonElement | undefined} */ (undefined);

	/** The source's `useRef(true)` liveness flag, set by the mount effect below. */
	let live = false;
	/** Serializes pack writes the way the source's `operationActive` ref does. */
	let operationActive = false;

	let projectById = $derived(new Map(projects.map((project) => [project.id, project])));
	let visible = $derived(visiblePacks(packs, packQuery, packSort));
	let selectedPack = $derived(
		detailClosed ? null : visible.find((pack) => pack.id === selectedPackId) || visible[0] || null
	);
	/**
	 * Read once per load, exactly like the source's `getFavoriteTemplateIds()` call
	 * in the render body: the rail follows the favorites stored when the library
	 * last loaded, not a live subscription the source never had.
	 */
	let favoriteTemplateIds = $state(getFavoriteTemplateIds());
	let favoriteTemplates = $derived(
		templateData.filter((template) => favoriteTemplateIds.includes(template.id))
	);
	let emptyHeading = $derived(
		view === 'Favorites'
			? 'No favorite local packs yet'
			: view === 'Shared with Me'
				? 'Sharing is not available yet'
				: 'No local packs yet'
	);
	let emptyDetail = $derived(
		view === 'Shared with Me'
			? 'Cloud sharing is not set up. Local stickers stay on this device.'
			: 'Packs group stickers into collections and export them as ZIP archives.'
	);

	const workspace = getCloudWorkspace();
	const cloud = $derived(workspace.cloud !== null);

	async function reload() {
		const [list, savedProjects] = await Promise.all([
			repository.listPacks(),
			repository.listProjects()
		]);
		if (!live) return;
		packs = list;
		projects = savedProjects;
		favoriteTemplateIds = getFavoriteTemplateIds();
		selectedPackId =
			selectedPackId && list.some((pack) => pack.id === selectedPackId)
				? selectedPackId
				: (list[0]?.id ?? null);
	}

	$effect(() => {
		// One load per repository (and per cloud status update: another device,
		// a retry, a conflict copy), guarded so a departed page cannot write state.
		void repository;
		void workspace.cloudStatus.version;
		live = true;
		void reload().catch(() => {
			if (live) error = 'Could not load local packs. Please retry.';
		});
		return () => {
			live = false;
		};
	});

	$effect(() => {
		// Source: `useEffect(() => { if (requestedPack) setSelectedPackId(requestedPack) }, [requestedPack])`.
		if (requestedPackId) selectedPackId = requestedPackId;
	});

	$effect(() => {
		// Source: scroll the sticker drawer into view for `#local-stickers`, re-running
		// when the library loads (`[location.hash, packs]`).
		if (hash !== '#local-stickers') return;
		void packs;
		document.getElementById('local-stickers')?.scrollIntoView({ block: 'start' });
	});

	/** @param {() => Promise<void>} action */
	async function runPackAction(action) {
		if (operationActive) return;
		operationActive = true;
		busy = true;
		error = null;
		try {
			await action();
			await reload();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Pack operation failed. Please retry.';
		} finally {
			operationActive = false;
			busy = false;
		}
	}

	async function handleCreatePack() {
		const newPack = buildPackRecord({
			existing: editingPack,
			title: newTitle,
			description: newDesc,
			id: crypto.randomUUID(),
			now: new Date().toISOString()
		});
		if (!newPack) return;
		await repository.savePack(newPack);
		newTitle = '';
		newDesc = '';
		createOpen = false;
		selectedPackId = newPack.id;
	}

	/** @param {PackRecord} pack */
	async function handleDuplicatePack(pack) {
		const dup = duplicatePackRecord(pack, {
			id: crypto.randomUUID(),
			now: new Date().toISOString()
		});
		await repository.savePack(dup);
		selectedPackId = dup.id;
	}

	/** @param {string} packId */
	async function handleDeletePack(packId) {
		await repository.deletePack(packId);
		deleteOpener = undefined;
		deletePack = null;
		selectedPackId = null;
	}

	/** @param {string} projectId */
	async function handleToggleStickerInPack(projectId) {
		if (!selectedPack) return;
		await repository.savePack(setProjectInPack(selectedPack, projectId, new Date().toISOString()));
	}

	/**
	 * @param {number} index
	 * @param {'up' | 'down'} direction
	 */
	async function handleReorderStickerInPack(index, direction) {
		if (!selectedPack) return;
		const updated = reorderProjectInPack(selectedPack, index, direction, new Date().toISOString());
		if (!updated) return;
		await repository.savePack(updated);
	}

	/** @param {PackRecord} pack */
	async function handleExportZip(pack) {
		exportingZip = true;
		try {
			// Lazy like the source (`await import('@/features/exports/zipExport')`).
			const { exportPackZip } = await import('$lib/exports/zipExport');
			const zipBlob = await exportPackZip(pack, repository);
			const safe = pack.title.replace(/[^\w.-]+/g, '_').toLowerCase() || 'pack';
			if (live) downloadBlob(zipBlob, `${safe}.zip`);
		} finally {
			if (live) exportingZip = false;
		}
	}

	/** @param {PackRecord} pack */
	function previews(pack) {
		/** @type {import('$lib/domain/domain').ProjectDocument[]} */
		const found = [];
		for (const projectId of pack.projectIds) {
			const project = projectById.get(projectId);
			if (project) found.push(project);
			if (found.length === 5) break;
		}
		return found;
	}

	/** @param {(typeof PACK_VIEWS)[number]} next */
	function selectView(next) {
		onselectview(next);
	}
</script>

<AppShell {pathname} {search}>
	<Hero class="hero-packs">
		{#snippet kicker()}
			<p class="hero-kicker"><Layers3 size={14} /> COLLECT THE GOOD STUFF</p>
		{/snippet}
		{#snippet title()}
			<span>Your little world.</span><br /><em>In sticker packs.</em>
		{/snippet}
		{#snippet art()}
			<StickerCollage variant="packs" />
		{/snippet}
		{#snippet action()}
			<div class="actions">
				<button
					type="button"
					class="button primary"
					bind:this={newPackButton}
					onclick={(event) => {
						createOpener = event.currentTarget;
						editingPack = null;
						newTitle = '';
						newDesc = '';
						createOpen = true;
					}}
				>
					<Plus size={16} />New Pack
				</button>
				<a class="button" href={shellHref('/create')}>
					<ImagePlus size={16} />Import Photos
				</a>
			</div>
		{/snippet}
		{#snippet points()}
			<ul class="hero-points">
				<li>Private by default</li>
				<li>ZIP ready</li>
				<li>Made from your stickers</li>
			</ul>
		{/snippet}
		Organize saved stickers into packs and export transparent PNG ZIP bundles.
	</Hero>

	{#if error}
		<p role="alert">{error}</p>
	{/if}

	<section class="packs-controls" aria-label="Pack library controls">
		<div class="pills">
			{#each PACK_VIEWS as item (item)}
				<button type="button" aria-pressed={view === item} onclick={() => selectView(item)}
					>{item}</button
				>
			{/each}
		</div>
		<div class="pack-library-tools">
			<label class="pack-search">
				<Search size={17} aria-hidden="true" />
				<span class="sr-only">Search packs</span>
				<input
					type="search"
					value={packQuery}
					oninput={(event) => (packQuery = event.currentTarget.value)}
					placeholder="Search packs…"
				/>
			</label>
			<label class="pack-sort">
				<ArrowUpDown size={16} aria-hidden="true" />
				<span>Sort</span>
				<select
					value={packSort}
					onchange={(event) =>
						(packSort = /** @type {import('$lib/packs/packActions').PackSort} */ (
							event.currentTarget.value
						))}
					aria-label="Sort packs"
				>
					<option value="recent">Recent</option>
					<option value="name">Name</option>
				</select>
			</label>
		</div>
		{#if cloud}
			<p class="pack-privacy-note">
				<LockKeyhole size={15} aria-hidden="true" />Private account · local-first cloud saving
			</p>
		{/if}
	</section>

	{#if view === 'Favorites' && favoriteTemplates.length > 0}
		<TemplateRail {repository} {onopen} title="Favorite Templates" items={favoriteTemplates} />
	{/if}

	{#if view === 'Shared with Me'}
		<section class="empty packs-empty">
			<span class="packs-empty-art"><Layers3 size={38} /><i>♡</i><b>✦</b></span>
			<p class="packs-empty-kicker">A space for future collaborations</p>
			<h2>Sharing is not available yet</h2>
			<p>{emptyDetail}</p>
		</section>
	{:else if view === 'Export History'}
		<section class="empty packs-empty">
			<span class="packs-empty-art"><Download size={38} /><i>↓</i><b>✦</b></span>
			<p class="packs-empty-kicker">Downloads stay in your browser</p>
			<h2>Export History</h2>
			<p>
				Export history is not recorded yet. PNG and ZIP exports start a browser download; your
				browser controls where files are saved.
			</p>
		</section>
	{:else if packs.length === 0}
		<section class="empty packs-empty">
			<span class="packs-empty-art"><PackageOpen size={42} /><i>♡</i><b>✦</b></span>
			<p class="packs-empty-kicker">Your first collection starts here</p>
			<h2>{emptyHeading}</h2>
			<p>{emptyDetail}</p>
			<button
				type="button"
				class="button primary"
				onclick={(event) => {
					createOpener = event.currentTarget;
					editingPack = null;
					newTitle = '';
					newDesc = '';
					createOpen = true;
				}}
			>
				<Plus size={16} />Create a Pack
			</button>
		</section>
	{:else if visible.length === 0}
		<section class="empty packs-empty packs-no-results">
			<span class="packs-empty-art"><Search size={38} /><i>?</i><b>✦</b></span>
			<p class="packs-empty-kicker">That title is playing hide-and-seek</p>
			<h2>No packs found</h2>
			<p>Nothing matches “{packQuery.trim()}”. Try another name or description.</p>
			<button type="button" class="button" onclick={() => (packQuery = '')}>Clear search</button>
		</section>
	{:else}
		<div class="packs-layout">
			<section class="pack-library" aria-labelledby="pack-library-title">
				<div class="pack-library-heading">
					<div>
						<p>YOUR COLLECTION SHELF</p>
						<h2 id="pack-library-title">{view === 'Favorites' ? 'Your packs' : view}</h2>
					</div>
					<span>{visible.length} {visible.length === 1 ? 'pack' : 'packs'}</span>
				</div>
				<div class="pack-grid">
					{#each visible as pack, index (pack.id)}
						<button
							type="button"
							class={`pack-card ${selectedPack?.id === pack.id ? 'active' : ''}`}
							aria-pressed={selectedPack?.id === pack.id}
							onclick={() => {
								selectedPackId = pack.id;
								detailClosed = false;
							}}
						>
							{@render packArtwork(pack, index, false)}
							<span class="pack-card-copy">
								<span class="pack-card-title"
									><b>{pack.title}</b><ChevronRight size={17} aria-hidden="true" /></span
								>
								<small>{pack.description || 'A fresh pack ready for your favorite stickers.'}</small
								>
								<span class="pack-card-meta">
									<span
										><PackageOpen size={13} aria-hidden="true" />{pack.projectIds.length}
										{pack.projectIds.length === 1 ? 'sticker' : 'stickers'}</span
									>
									<span class="pack-badge">{cloud ? 'Private' : 'Local'}</span>
								</span>
							</span>
						</button>
					{/each}
				</div>
			</section>
			{#if selectedPack}
				<aside class="pack-detail" aria-label={`${selectedPack.title} pack details`}>
					<button
						type="button"
						class="pack-detail-close"
						aria-label="Close pack details"
						onclick={() => (detailClosed = true)}><X size={16} aria-hidden="true" /></button
					>
					{@render packArtwork(selectedPack, visible.indexOf(selectedPack), true)}
					<div class="pack-detail-heading">
						<div>
							<p>SELECTED PACK</p>
							<h2>{selectedPack.title}</h2>
						</div>
						<span class="pack-badge">{cloud ? 'Private' : 'Local'}</span>
					</div>
					<p class="muted">
						{selectedPack.description || 'A fresh pack ready for your favorite stickers.'}
					</p>

					<div class="pack-detail-primary-actions">
						<button
							type="button"
							class="button primary"
							disabled={busy || exportingZip || selectedPack.projectIds.length === 0}
							onclick={() => void runPackAction(() => handleExportZip(selectedPack))}
						>
							<Download size={16} />{exportingZip ? 'Exporting…' : 'Download ZIP'}
						</button>
						<button
							type="button"
							class="button"
							onclick={(event) => {
								addOpener = event.currentTarget;
								addStickerOpen = true;
							}}
						>
							<Plus size={16} />Add Stickers
						</button>
					</div>
					<div class="pack-detail-secondary-actions">
						<button
							type="button"
							class="button"
							disabled={busy}
							onclick={(event) => {
								createOpener = event.currentTarget;
								editingPack = selectedPack;
								newTitle = selectedPack.title;
								newDesc = selectedPack.description;
								createOpen = true;
							}}><Pencil size={15} />Edit pack</button
						>
						<button
							type="button"
							class="button"
							disabled={busy}
							title="Duplicate pack"
							onclick={() => void runPackAction(() => handleDuplicatePack(selectedPack))}
						>
							<Copy size={16} />Duplicate
						</button>
						<button
							type="button"
							class="button"
							disabled={busy}
							title="Delete pack"
							onclick={(event) => {
								deleteOpener = event.currentTarget;
								error = null;
								deletePack = selectedPack;
							}}><Trash2 size={16} />Delete</button
						>
						<button
							type="button"
							class="button"
							onclick={(event) => {
								noticeOpener = event.currentTarget;
								noticeOpen = true;
							}}>WhatsApp / Telegram</button
						>
					</div>

					<div class="pack-detail-section-heading">
						<div>
							<p>PACK CONTENTS</p>
							<h3>Stickers ({selectedPack.projectIds.length})</h3>
						</div>
						<button
							type="button"
							class="button pack-detail-add-shortcut"
							onclick={(event) => {
								addOpener = event.currentTarget;
								addStickerOpen = true;
							}}><Plus size={15} />Add</button
						>
					</div>
					{#if selectedPack.projectIds.length === 0}
						<div class="pack-detail-empty">
							<PackageOpen size={30} />
							<p>No stickers here yet. Add a saved sticker to start the collage.</p>
						</div>
					{:else}
						<div class="pack-sticker-gallery">
							{#each selectedPack.projectIds as projectId, index (projectId)}
								{@const project = projectById.get(projectId)}
								{@const title = project?.title || `Sticker (${projectId.slice(0, 6)})`}
								<article class="pack-sticker-tile">
									{#if project}
										<ProjectThumb {project} {repository} />
									{:else}
										<div class="project-thumb">
											<span class="project-preview-placeholder">Preview unavailable</span>
										</div>
									{/if}
									<strong {title}>{title}</strong>
									<div class="layer-actions" aria-label={`Arrange ${title}`}>
										<button
											type="button"
											class="layer-action-btn"
											disabled={busy || index === 0}
											aria-label={`Move ${title} up`}
											onclick={() =>
												void runPackAction(() => handleReorderStickerInPack(index, 'up'))}
										>
											↑
										</button>
										<button
											type="button"
											class="layer-action-btn"
											disabled={busy || index === selectedPack.projectIds.length - 1}
											aria-label={`Move ${title} down`}
											onclick={() =>
												void runPackAction(() => handleReorderStickerInPack(index, 'down'))}
										>
											↓
										</button>
										<button
											type="button"
											class="layer-action-btn"
											aria-label={`Remove ${title} from pack`}
											disabled={busy}
											onclick={() => void runPackAction(() => handleToggleStickerInPack(projectId))}
										>
											<X size={14} />
										</button>
									</div>
								</article>
							{/each}
							<button
								type="button"
								class="pack-add-sticker-tile"
								onclick={(event) => {
									addOpener = event.currentTarget;
									addStickerOpen = true;
								}}
							>
								<Plus size={22} /><span>Add sticker</span>
							</button>
						</div>
					{/if}
				</aside>
			{:else}
				<aside class="pack-detail">
					<h2>Pack details</h2>
					<div class="detail-cover">✦</div>
					<p class="muted">Select a pack to inspect its stickers or export as ZIP.</p>
				</aside>
			{/if}
		</div>
	{/if}

	<section class="local-stickers-section" id="local-stickers">
		<div class="section-title">
			<div>
				<p class="section-eyebrow">YOUR STICKER DRAWER</p>
				<h2>{cloud ? 'All Private Stickers' : 'All Local Stickers'}</h2>
			</div>
			<a href={shellHref('/create')}>Create a sticker <ChevronRight size={15} /></a>
		</div>
		<LocalProjectList
			{repository}
			emptyTitle="No local stickers yet"
			emptyDetail="Save a sticker from the editor to reopen it here."
		/>
	</section>

	<Modal
		open={deletePack !== null}
		title="Delete this pack?"
		description={`“${deletePack?.title ?? ''}” will be removed. Your stickers will be kept, so you can use them in another pack.`}
		focusOnOpen={() => document.getElementById('cancel-delete-pack')}
		onclose={() => (deletePack = null)}
		onclosed={() => (deleteOpener?.isConnected ? deleteOpener : newPackButton)?.focus()}
	>
		{#if error}
			<p role="alert">{error}</p>
		{/if}
		{#snippet footer()}
			<button
				type="button"
				id="cancel-delete-pack"
				class="button"
				onclick={() => (deletePack = null)}>Keep Pack</button
			>
			<button
				type="button"
				class="button danger"
				disabled={busy}
				onclick={() => {
					const pack = deletePack;
					if (pack) void runPackAction(() => handleDeletePack(pack.id));
				}}>Delete Pack</button
			>
		{/snippet}
	</Modal>

	<Modal
		open={createOpen}
		title={editingPack ? 'Edit Pack' : 'Create New Pack'}
		description="Group your stickers into a named pack."
		onclose={() => (createOpen = false)}
		onclosed={() => (createOpener?.isConnected ? createOpener : newPackButton)?.focus()}
	>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void runPackAction(handleCreatePack);
			}}
		>
			<div class="dialog-field">
				<label for="pack-title">Pack Name</label>
				<input
					id="pack-title"
					required
					placeholder="e.g. My Favorite Cats"
					value={newTitle}
					oninput={(event) => (newTitle = event.currentTarget.value)}
				/>
			</div>
			<div class="dialog-field">
				<label for="pack-desc">Description (optional)</label>
				<input
					id="pack-desc"
					placeholder="e.g. Playful reactions for chats"
					value={newDesc}
					oninput={(event) => (newDesc = event.currentTarget.value)}
				/>
			</div>
			{#if error}
				<p role="alert">{error}</p>
			{/if}
			<div class="dialog-footer">
				<button type="button" class="button" onclick={() => (createOpen = false)}>Cancel</button>
				<button type="submit" class="button primary" disabled={busy}
					>{editingPack ? 'Save Pack' : 'Create Pack'}</button
				>
			</div>
		</form>
	</Modal>

	<Modal
		open={addStickerOpen}
		title={`Add stickers to ${selectedPack?.title ?? ''}`}
		description="Check saved local stickers to include them in this pack."
		onclose={() => {
			addStickerOpen = false;
			addOpener?.focus();
		}}
	>
		{#if error}
			<p role="alert">{error}</p>
		{/if}
		{#if projects.length === 0}
			<p class="muted">No saved stickers yet. Create and save stickers in the editor first.</p>
		{:else}
			<div class="pack-stickers-list">
				{#each projects as project (project.id)}
					{@const inPack = selectedPack?.projectIds.includes(project.id) ?? false}
					<div class="pack-sticker-row">
						<span>{project.title}</span>
						<input
							type="checkbox"
							aria-label={`Include ${project.title}`}
							checked={inPack}
							disabled={busy}
							onchange={() => void runPackAction(() => handleToggleStickerInPack(project.id))}
						/>
					</div>
				{/each}
			</div>
		{/if}
		{#snippet footer()}
			<button
				type="button"
				class="button primary"
				onclick={() => {
					addStickerOpen = false;
					addOpener?.focus();
				}}>Done</button
			>
		{/snippet}
	</Modal>

	<Modal
		open={noticeOpen}
		title="Messenger packs are unavailable"
		onclose={() => (noticeOpen = false)}
		onclosed={() => noticeOpener?.focus()}
	>
		<p class="muted">
			Native WhatsApp and Telegram installation is not implemented. Download the pack ZIP and add
			stickers manually.
		</p>
		{#snippet footer()}
			<button type="button" class="button primary" onclick={() => (noticeOpen = false)}
				>Got it</button
			>
		{/snippet}
	</Modal>
</AppShell>

{#snippet packArtwork(
	/** @type {PackRecord} */ pack,
	/** @type {number} */ tone,
	/** @type {boolean} */ large
)}
	{@const previews_ = previews(pack)}
	<div
		class={`pack-cover pack-cover-tone-${tone % 3}${large ? ' pack-cover-large' : ''}`}
		aria-hidden="true"
	>
		<span class="pack-cover-tape"></span>
		<span class="pack-cover-spark pack-cover-spark-left">✦</span>
		<span class="pack-cover-spark pack-cover-spark-right">♡</span>
		{#if previews_.length > 0}
			<div class={`pack-cover-stack pack-cover-stack-${previews_.length}`}>
				{#each previews_ as project, index (project.id)}
					<span class={`pack-cover-sticker pack-cover-sticker-${index + 1}`}>
						<ProjectThumb {project} {repository} />
					</span>
				{/each}
			</div>
		{:else}
			<span class="pack-cover-empty">
				<PackageOpen size={large ? 46 : 34} />
				<b>{pack.projectIds.length === 0 ? 'Ready for stickers' : 'Preview unavailable'}</b>
			</span>
		{/if}
		<span class="pack-cover-title">{pack.title}</span>
	</div>
{/snippet}
