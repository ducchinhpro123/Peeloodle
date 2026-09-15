<script>
	import { button, buttonDanger, buttonPrimary } from '$lib/ui/styles.js';
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
	<Hero variant="packs">
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
			<div
				class="actions [margin-top:var(--space-5)] [display:flex] [flex-wrap:wrap] [gap:var(--space-3)]"
			>
				<button
					type="button"
					class={buttonPrimary}
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
				<a class={button} href={shellHref('/create')}>
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
		<div
			class="pills [margin:var(--space-5)_0] [display:flex] [scrollbar-width:thin] [gap:var(--space-2)] [overflow:auto] [padding:4px_2px]"
		>
			{#each PACK_VIEWS as item (item)}
				<button type="button" aria-pressed={view === item} onclick={() => selectView(item)}
					>{item}</button
				>
			{/each}
		</div>
		<div class="pack-library-tools [display:flex] [align-items:center] [gap:var(--space-3)]">
			<label class="pack-search [min-width:min(240px,_24vw)] [padding:0_var(--space-4)]">
				<Search size={17} aria-hidden="true" />
				<span class="sr-only">Search packs</span>
				<input
					type="search"
					value={packQuery}
					oninput={(event) => (packQuery = event.currentTarget.value)}
					placeholder="Search packs…"
				/>
			</label>
			<label class="pack-sort [padding:0_var(--space-2)_0_var(--space-3)]">
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
			<p
				class="pack-privacy-note [grid-column:1_/_-1] [margin:0] [display:flex] [align-items:center] [gap:var(--space-2)] [padding:0_var(--space-2)] [font-size:12px] [color:#547066]"
			>
				<LockKeyhole size={15} aria-hidden="true" />Private account · local-first cloud saving
			</p>
		{/if}
	</section>

	{#if view === 'Favorites' && favoriteTemplates.length > 0}
		<TemplateRail {repository} {onopen} title="Favorite Templates" items={favoriteTemplates} />
	{/if}

	{#if view === 'Shared with Me'}
		<section class="empty packs-empty">
			<span
				class="packs-empty-art [position:relative] [display:grid] [height:82px] [width:92px] [place-items:center] [color:var(--scrapbook-green)]"
				><Layers3 size={38} /><i>♡</i><b>✦</b></span
			>
			<p class="packs-empty-kicker">A space for future collaborations</p>
			<h2>Sharing is not available yet</h2>
			<p>{emptyDetail}</p>
		</section>
	{:else if view === 'Export History'}
		<section class="empty packs-empty">
			<span
				class="packs-empty-art [position:relative] [display:grid] [height:82px] [width:92px] [place-items:center] [color:var(--scrapbook-green)]"
				><Download size={38} /><i>↓</i><b>✦</b></span
			>
			<p class="packs-empty-kicker">Downloads stay in your browser</p>
			<h2>Export History</h2>
			<p>
				Export history is not recorded yet. PNG and ZIP exports start a browser download; your
				browser controls where files are saved.
			</p>
		</section>
	{:else if packs.length === 0}
		<section class="empty packs-empty">
			<span
				class="packs-empty-art [position:relative] [display:grid] [height:82px] [width:92px] [place-items:center] [color:var(--scrapbook-green)]"
				><PackageOpen size={42} /><i>♡</i><b>✦</b></span
			>
			<p class="packs-empty-kicker">Your first collection starts here</p>
			<h2>{emptyHeading}</h2>
			<p>{emptyDetail}</p>
			<button
				type="button"
				class={buttonPrimary}
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
			<span
				class="packs-empty-art [position:relative] [display:grid] [height:82px] [width:92px] [place-items:center] [color:var(--scrapbook-green)]"
				><Search size={38} /><i>?</i><b>✦</b></span
			>
			<p class="packs-empty-kicker">That title is playing hide-and-seek</p>
			<h2>No packs found</h2>
			<p>Nothing matches “{packQuery.trim()}”. Try another name or description.</p>
			<button type="button" class={button} onclick={() => (packQuery = '')}>Clear search</button>
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
				<div
					class="pack-grid [display:grid] [grid-template-columns:repeat(auto-fill,_minmax(min(100%,_208px),_1fr))] [gap:var(--space-4)]"
				>
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
								<span
									class="pack-card-title [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-2)]"
									><b>{pack.title}</b><ChevronRight size={17} aria-hidden="true" /></span
								>
								<small>{pack.description || 'A fresh pack ready for your favorite stickers.'}</small
								>
								<span
									class="pack-card-meta [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-2)] [font-size:11px] [font-weight:700] [color:#536a64]"
								>
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
					<div
						class="pack-detail-heading [margin-top:var(--space-4)] [display:flex] [align-items:end] [justify-content:space-between] [gap:var(--space-4)]"
					>
						<div>
							<p>SELECTED PACK</p>
							<h2>{selectedPack.title}</h2>
						</div>
						<span class="pack-badge">{cloud ? 'Private' : 'Local'}</span>
					</div>
					<p class="muted [color:var(--muted)]">
						{selectedPack.description || 'A fresh pack ready for your favorite stickers.'}
					</p>

					<div
						class="pack-detail-primary-actions [margin-top:var(--space-3)] [display:grid] [grid-template-columns:1fr_1fr] [gap:var(--space-2)]"
					>
						<button
							type="button"
							class={buttonPrimary}
							disabled={busy || exportingZip || selectedPack.projectIds.length === 0}
							onclick={() => void runPackAction(() => handleExportZip(selectedPack))}
						>
							<Download size={16} />{exportingZip ? 'Exporting…' : 'Download ZIP'}
						</button>
						<button
							type="button"
							class={button}
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
							class={button}
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
							class={button}
							disabled={busy}
							title="Duplicate pack"
							onclick={() => void runPackAction(() => handleDuplicatePack(selectedPack))}
						>
							<Copy size={16} />Duplicate
						</button>
						<button
							type="button"
							class={button}
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
							class={button}
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
							class={[button, 'pack-detail-add-shortcut']}
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
						<div
							class="pack-sticker-gallery [margin-top:var(--space-3)] [display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:var(--space-2)]"
						>
							{#each selectedPack.projectIds as projectId, index (projectId)}
								{@const project = projectById.get(projectId)}
								{@const title = project?.title || `Sticker (${projectId.slice(0, 6)})`}
								<article class="pack-sticker-tile">
									{#if project}
										<ProjectThumb {project} {repository} />
									{:else}
										<div class="project-thumb">
											<span
												class="project-preview-placeholder [padding:var(--space-2)] [text-align:center] [font-size:12px] [color:var(--muted)]"
												>Preview unavailable</span
											>
										</div>
									{/if}
									<strong {title}>{title}</strong>
									<div
										class="layer-actions [display:flex] [align-items:center] [gap:2px]"
										aria-label={`Arrange ${title}`}
									>
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
					<p class="muted [color:var(--muted)]">
						Select a pack to inspect its stickers or export as ZIP.
					</p>
				</aside>
			{/if}
		</div>
	{/if}

	<section class="local-stickers-section" id="local-stickers">
		<div
			class="section-title [margin:var(--space-5)_0_var(--space-4)] [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-3)]"
		>
			<div>
				<p
					class="section-eyebrow [margin:0] [font-size:10px] [font-weight:800] [letter-spacing:0.12em] [color:var(--scrapbook-green)]"
				>
					YOUR STICKER DRAWER
				</p>
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
				class={button}
				onclick={() => (deletePack = null)}>Keep Pack</button
			>
			<button
				type="button"
				class={buttonDanger}
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
			<div class="dialog-field [display:grid] [gap:var(--space-2)]">
				<label for="pack-title">Pack Name</label>
				<input
					id="pack-title"
					required
					placeholder="e.g. My Favorite Cats"
					value={newTitle}
					oninput={(event) => (newTitle = event.currentTarget.value)}
				/>
			</div>
			<div class="dialog-field [display:grid] [gap:var(--space-2)]">
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
			<div
				class="dialog-footer [display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:var(--space-3)] [padding-top:var(--space-5)] [border-top:1px_solid_var(--line)]"
			>
				<button type="button" class={button} onclick={() => (createOpen = false)}>Cancel</button>
				<button type="submit" class={buttonPrimary} disabled={busy}
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
			<p class="muted [color:var(--muted)]">
				No saved stickers yet. Create and save stickers in the editor first.
			</p>
		{:else}
			<div
				class="pack-stickers-list [margin:12px_0] [display:grid] [max-height:240px] [gap:8px] [overflow-y:auto]"
			>
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
				class={buttonPrimary}
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
		<p class="muted [color:var(--muted)]">
			Native WhatsApp and Telegram installation is not implemented. Download the pack ZIP and add
			stickers manually.
		</p>
		{#snippet footer()}
			<button type="button" class={buttonPrimary} onclick={() => (noticeOpen = false)}
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

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.section-title h2 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 16px;
	}
	.section-title a {
		color: #008dce;
		font-size: 13px;
		font-weight: 600;
	}
	.empty {
		display: flex;
		min-height: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed #abd3c3;
		border-radius: var(--radius);
		background: radial-gradient(ellipse at bottom, #eaf8ef, #fff 75%);
		color: #55708c;
		text-align: center;
	}
	.empty h2 {
		color: var(--ink);
	}
	.empty p {
		max-width: 480px;
		font-size: 14px;
	}
	:global(.empty > svg) {
		padding: 12px;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: #00875e;
		transform: rotate(-8deg);
	}
	.pills button {
		padding: 10px 16px;
		border: 1px solid #e6eaf2;
		border-radius: 999px;
		background: #f5f7ff;
		color: #273a5c;
		white-space: nowrap;
	}
	.pills button[aria-pressed='true'] {
		border-color: #00875e;
		background: #00875e;
		color: #fff;
	}
	.pills button {
		min-height: 44px;
		font-size: 13px;
	}
	.pills button:hover:not([aria-pressed='true']) {
		background: var(--lav);
	}
	.packs-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		margin: var(--space-6) 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid #dce8e3;
		border-radius: 26px;
		background: var(--surface-warm);
		box-shadow: 0 10px 30px #284a4010;
	}
	.packs-controls .pills {
		min-width: 0;
		max-width: 100%;
		margin: 0;
	}
	.packs-controls .pills button {
		padding: var(--space-3) var(--space-4);
		font-size: 13px;
		font-weight: 700;
	}
	.pack-search {
		display: flex;
		min-height: 44px;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid #dfe6ed;
		border-radius: 999px;
		background: #f5f7f9;
		color: var(--muted);
	}
	.pack-sort {
		display: flex;
		min-height: 44px;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid #dfe6ed;
		border-radius: 999px;
		background: #f5f7f9;
		color: var(--muted);
	}
	.pack-search:focus-within {
		border-color: var(--mint);
		box-shadow: 0 0 0 3px #08b8791f;
	}
	.pack-sort:focus-within {
		border-color: var(--mint);
		box-shadow: 0 0 0 3px #08b8791f;
	}
	.pack-search input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
	}
	.pack-sort > span {
		color: var(--muted);
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.pack-sort select {
		min-height: 36px;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-weight: 700;
	}
	.empty {
		min-height: 250px;
		margin-top: 20px;
	}
	.layer-action-btn {
		display: inline-flex;
		width: 26px;
		height: 26px;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #66758f;
		cursor: pointer;
	}
	.layer-action-btn:hover:not(:disabled) {
		background: #eef3f7;
		color: var(--ink);
	}
	.layer-action-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.layer-action-btn.active {
		color: #00875e;
	}

	.packs-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(350px, 410px);
		gap: var(--space-6);
		align-items: start;
	}
	.packs-empty {
		display: grid;
		min-height: 360px;
		place-content: center;
		justify-items: center;
		gap: var(--space-3);
		overflow: hidden;
		padding: var(--space-7);
		border: 1px dashed var(--mint-line);
		border-radius: var(--radius);
		background:
			radial-gradient(circle at 16% 18%, var(--blush-strong) 0 6%, transparent 6.5%),
			radial-gradient(circle at 86% 78%, #e5dcfa 0 8%, transparent 8.5%),
			linear-gradient(145deg, #eefaf4, #fffdf4);
		text-align: center;
	}
	.packs-empty > h2 {
		margin: 0;
	}
	.packs-empty > p {
		margin: 0;
	}
	.packs-empty > p:not(.packs-empty-kicker) {
		max-width: 56ch;
		color: var(--muted);
	}
	.packs-empty-art::before {
		position: absolute;
		inset: 4px 8px 2px;
		border: 6px solid #fff;
		background: var(--scrapbook-yellow);
		box-shadow: var(--shadow-hover);
		content: '';
		transform: rotate(-7deg);
	}
	:global(.packs-empty-art svg) {
		position: relative;
		z-index: 1;
	}
	.packs-empty-art i {
		position: absolute;
		z-index: 2;
		color: #ef6a8a;
		font:
			400 24px/1 Chewy,
			cursive;
	}
	.packs-empty-art b {
		position: absolute;
		z-index: 2;
		color: #ef6a8a;
		font:
			400 24px/1 Chewy,
			cursive;
	}
	.packs-empty-art i {
		right: -7px;
		top: -3px;
		transform: rotate(12deg);
	}
	.packs-empty-art b {
		left: -10px;
		bottom: 2px;
		color: #e8b300;
		transform: rotate(-14deg);
	}
	.packs-empty-kicker {
		padding: 5px 10px;
		background: #fff0a8;
		color: var(--scrapbook-green);
		font:
			400 14px/1.2 Chewy,
			cursive;
		transform: rotate(-2deg);
	}
	.pack-library {
		min-width: 0;
	}
	.pack-library-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	.pack-library-heading p {
		margin: 0 0 3px;
		color: var(--scrapbook-green);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.pack-detail-heading p {
		margin: 0 0 3px;
		color: var(--scrapbook-green);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.pack-detail-section-heading p {
		margin: 0 0 3px;
		color: var(--scrapbook-green);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.pack-library-heading h2 {
		margin: 0;
	}
	.pack-detail-heading h2 {
		margin: 0;
	}
	.pack-detail-section-heading h3 {
		margin: 0;
	}
	.pack-library-heading > span {
		padding: 5px 10px;
		border-radius: 999px;
		background: var(--pale);
		color: #315c4f;
		font-size: 12px;
		font-weight: 800;
	}
	.pack-card {
		display: block;
		min-width: 0;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
		box-shadow: var(--shadow);
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
	}
	.pack-card:hover {
		border-color: var(--mint-strong);
		box-shadow: var(--shadow-hover);
		transform: translateY(-3px);
	}
	.pack-card.active {
		border-color: #08b879;
		box-shadow:
			0 0 0 2px #08b87933,
			var(--shadow-hover);
	}
	.pack-cover {
		position: relative;
		min-width: 0;
		height: 158px;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: #dcf6e9;
		isolation: isolate;
	}
	.pack-cover::before {
		position: absolute;
		z-index: -1;
		border-radius: 50%;
		content: '';
	}
	.pack-cover::after {
		position: absolute;
		z-index: -1;
		border-radius: 50%;
		content: '';
	}
	.pack-cover::before {
		top: -38%;
		right: -11%;
		width: 62%;
		height: 92%;
		background: #ffe6a8;
	}
	.pack-cover::after {
		bottom: -42%;
		left: -12%;
		width: 75%;
		height: 90%;
		background: #f7cfdc;
	}
	.pack-cover-tone-1 {
		background: #e8defa;
	}
	.pack-cover-tone-1::before {
		background: #cae9ff;
	}
	.pack-cover-tone-1::after {
		background: #fff0ae;
	}
	.pack-cover-tone-2 {
		background: #dceffa;
	}
	.pack-cover-tone-2::before {
		background: #d9f3dd;
	}
	.pack-cover-tone-2::after {
		background: #f1dcfb;
	}
	.pack-cover-large {
		height: 220px;
	}
	.pack-cover-tape {
		position: absolute;
		z-index: 4;
		top: 7px;
		left: 38%;
		width: 28%;
		height: 18px;
		background: repeating-linear-gradient(90deg, #52a97b55 0 6px, transparent 6px 12px), #f6f0c4d9;
		transform: rotate(-5deg);
	}
	.pack-cover-spark {
		position: absolute;
		z-index: 3;
		color: #ef6a8a;
		font:
			400 26px/1 Chewy,
			cursive;
	}
	.pack-cover-spark-left {
		left: 7%;
		top: 10%;
		color: #e4aa00;
		transform: rotate(-14deg);
	}
	.pack-cover-spark-right {
		right: 6%;
		top: 26%;
		transform: rotate(12deg);
	}
	.pack-cover-stack {
		position: absolute;
		inset: 10px 10px 20px;
	}
	/* StickerLab stickers are photo/text artwork, so a pack cover presents them as white-
   bordered polaroid cards (the same read as the sticker library) rather than loose
   artwork: frameless tiles turn text stickers into floating words. */
	.pack-cover-sticker {
		position: absolute;
		display: block;
		width: 44%;
		aspect-ratio: 1;
		padding: 5px;
		border: 4px solid #fff;
		border-radius: 13px;
		background: #fff;
		box-shadow: 0 9px 18px #173c3229;
	}
	.pack-cover-sticker .project-thumb {
		width: 100%;
		height: 100%;
		border-radius: 8px;
		background-color: #fff;
		background-image: none;
	}
	.pack-cover-sticker-1 {
		left: 5%;
		bottom: 3%;
		transform: rotate(-8deg);
	}
	.pack-cover-sticker-2 {
		right: 4%;
		top: 5%;
		transform: rotate(8deg);
	}
	.pack-cover-sticker-3 {
		left: 32%;
		top: 7%;
		z-index: 2;
		transform: rotate(-1deg);
	}
	.pack-cover-stack-1 .pack-cover-sticker-1 {
		left: 25%;
		bottom: 5%;
		width: 50%;
		transform: rotate(-4deg);
	}
	.pack-cover-stack-2 .pack-cover-sticker {
		width: 48%;
	}
	.pack-cover-stack-4 .pack-cover-sticker {
		width: 36%;
	}
	.pack-cover-stack-5 .pack-cover-sticker {
		width: 36%;
	}
	.pack-cover-sticker-4 {
		right: 6%;
		bottom: 5%;
		transform: rotate(7deg);
	}
	.pack-cover-sticker-5 {
		left: 3%;
		top: 5%;
		z-index: 1;
		transform: rotate(-11deg);
	}
	/* The pack's name, lettered onto the cover the way the reference does - the count
   lives in the meta row below rather than competing with it here. */
	.pack-cover-title {
		position: absolute;
		z-index: 6;
		bottom: 8px;
		left: 8px;
		display: -webkit-box;
		max-width: calc(100% - 16px);
		overflow: hidden;
		padding: 4px 10px;
		border-radius: 999px;
		background: #fffdf0e8;
		box-shadow: var(--shadow-mint);
		color: var(--scrapbook-green);
		font:
			400 28px/1.1 Chewy,
			cursive;
		overflow-wrap: anywhere;
		transform: rotate(-2deg);
		-webkit-box-orient: vertical;
		line-clamp: 2;
		-webkit-line-clamp: 2;
	}
	.pack-cover-large .pack-cover-title {
		padding: 6px 16px;
		font-size: 34px;
	}
	.pack-cover-empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		color: #315c4f;
	}
	:global(.pack-cover-empty svg) {
		padding: 7px;
		border-radius: 12px;
		background: #ffffffb8;
		box-shadow: var(--shadow);
	}
	.pack-cover-empty b {
		padding: 4px 8px;
		background: #fffdf0;
		font:
			400 13px/1.15 Chewy,
			cursive;
		transform: rotate(-2deg);
	}
	.pack-card-copy {
		display: grid;
		gap: 7px;
		padding: var(--space-4) var(--space-2) var(--space-2);
	}
	.pack-card-title b {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 16px;
	}
	:global(.pack-card-title svg) {
		flex: none;
		color: var(--scrapbook-green);
		transition: transform 160ms ease;
	}
	.pack-card:hover :global(.pack-card-title svg) {
		transform: translateX(3px);
	}
	.pack-card-copy > small {
		display: -webkit-box;
		min-height: 34px;
		overflow: hidden;
		color: var(--muted);
		font-size: 12px;
		line-height: 1.45;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		line-clamp: 2;
		-webkit-line-clamp: 2;
	}
	.pack-badge {
		display: inline-flex;
		align-items: center;
		width: max-content;
		padding: 4px 9px;
		border-radius: 999px;
		background: #daf7e9;
		color: #087650;
		font-size: 11px;
		font-weight: 800;
	}
	.pack-sticker-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
	}
	.pack-sticker-row span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 600;
	}
	.dialog-field label {
		font-size: 13px;
		font-weight: 700;
	}
	.dialog-field input {
		width: 100%;
		min-height: 48px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid #d5dfdc;
		border-radius: var(--radius-sm);
		background: #fcfdfb;
		font: inherit;
	}
	:global(.dialog-field textarea) {
		width: 100%;
		min-height: 48px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid #d5dfdc;
		border-radius: var(--radius-sm);
		background: #fcfdfb;
		font: inherit;
	}
	.pack-detail {
		position: sticky;
		top: calc(var(--header-height) + var(--space-4));
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid #dce8e3;
		border-radius: var(--radius);
		background: #fffdf9;
		box-shadow: var(--shadow-hover);
		overflow-wrap: anywhere;
	}
	.pack-detail-close {
		position: absolute;
		z-index: 3;
		top: 10px;
		right: 10px;
		display: grid;
		width: 34px;
		height: 34px;
		place-items: center;
		border: 1px solid #dce8e3;
		border-radius: 999px;
		background: #fffffff2;
		color: #315c4f;
		box-shadow: var(--shadow);
	}
	.pack-detail-close:hover {
		background: #fff;
		color: var(--scrapbook-green);
	}
	.pack-detail-heading h2 {
		font-size: 24px;
	}
	.pack-detail > p {
		margin: var(--space-2) 0 var(--space-4);
		font-size: 14px;
		line-height: 1.55;
	}
	.detail-cover {
		display: grid;
		height: 155px;
		place-items: center;
		border-radius: 12px;
		background: linear-gradient(135deg, #dff7ee, #f5e7ff);
		font-size: 72px;
	}
	.pack-detail p {
		color: var(--muted);
		font-size: 13px;
	}
	.pack-detail-secondary-actions {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.pack-detail-primary-actions .button {
		justify-content: center;
		min-width: 0;
	}
	.pack-detail-secondary-actions {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.pack-detail-secondary-actions .button {
		justify-content: center;
		min-width: 0;
		padding-inline: var(--space-2);
		font-size: 12px;
	}
	.pack-detail-section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-6);
		padding-top: var(--space-4);
		border-top: 1px dashed #c9dcd4;
	}
	.pack-detail-section-heading h3 {
		font-size: 17px;
	}
	.pack-detail-add-shortcut {
		min-height: 36px;
		padding: 6px 10px;
		font-size: 12px;
	}
	.pack-detail-empty {
		display: grid;
		min-height: 120px;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
		border: 1px dashed #aed8c8;
		border-radius: var(--radius-sm);
		background: var(--pale);
		color: var(--scrapbook-green);
		text-align: center;
	}
	.pack-detail-empty p {
		max-width: 28ch;
		margin: 0;
	}
	.pack-sticker-tile {
		position: relative;
		display: grid;
		min-width: 0;
		gap: 5px;
		padding: 6px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
	}
	.pack-sticker-tile .project-thumb {
		height: 82px;
		border-radius: 8px;
	}
	.pack-sticker-tile strong {
		overflow: hidden;
		padding: 0 2px;
		font-size: 10px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pack-sticker-tile .layer-actions {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 3px;
	}
	.pack-sticker-tile .layer-action-btn {
		width: 100%;
		height: 30px;
		min-height: 30px;
		border-radius: 7px;
	}
	.pack-add-sticker-tile {
		display: grid;
		min-height: 130px;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		border: 1px dashed #7bc5a8;
		border-radius: 12px;
		background: #effaf4;
		color: var(--scrapbook-green);
		font-size: 11px;
		font-weight: 800;
	}
	.pack-add-sticker-tile:hover {
		background: #dcf5e8;
	}
	.local-stickers-section {
		margin-top: var(--space-7);
		padding: var(--space-5);
		border: 1px solid #e2e8e5;
		border-radius: var(--radius);
		background: #fffdf9;
	}
	.local-stickers-section .section-title {
		margin-top: 0;
	}
	.local-stickers-section .section-title h2 {
		margin: 2px 0 0;
	}
	.local-stickers-section .section-title a {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	@media (max-width: 1150px) {
		.packs-controls {
			grid-template-columns: 1fr;
		}
		.pack-library-tools {
			justify-content: flex-end;
		}
		.packs-layout {
			grid-template-columns: 1fr;
		}
		.pack-detail {
			position: static;
		}
		.pack-sticker-gallery {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	@media (max-width: 720px) {
		.packs-controls {
			grid-template-columns: 1fr;
			gap: var(--space-3);
			padding: var(--space-3);
			border-radius: var(--radius);
		}
		.packs-controls .pills {
			width: 100%;
			margin: 0;
		}
		.packs-controls .pills button {
			padding: var(--space-3) var(--space-4);
		}
		.pack-library-tools {
			align-items: stretch;
			flex-direction: column;
		}
		.pack-search {
			width: 100%;
			min-width: 0;
		}
		.pack-sort {
			width: 100%;
		}
		.pack-sort select {
			flex: 1;
		}
		.pack-privacy-note {
			padding: var(--space-1);
		}
		.pills {
			margin: 12px 0;
		}
		.packs-layout {
			display: grid;
			gap: var(--space-5);
		}
		.pack-grid {
			grid-template-columns: 1fr;
		}
		.pack-cover {
			height: 180px;
		}
		.pack-detail {
			padding: var(--space-3);
		}
		.pack-detail-primary-actions {
			grid-template-columns: 1fr;
		}
		.pack-sticker-gallery {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.local-stickers-section {
			padding: var(--space-4);
		}
		.dialog-footer .button {
			flex: 1 1 auto;
		}
		.layer-actions {
			flex-wrap: wrap;
		}
		.layer-action-btn {
			width: 36px;
			height: 36px;
		}
	}
</style>
