<script>
	import { button, buttonDanger, buttonPrimary } from '#lib/ui/styles.js';
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
	import { shellHref } from '#lib/app/navigation.js';
	import { getCloudWorkspace } from '#lib/cloud/workspace.svelte.js';
	import { downloadBlob } from '#lib/exports/download.js';
	import { getFavoriteTemplateIds, templateData } from '#lib/editor/templates.js';
	import {
		PACK_VIEWS,
		buildPackRecord,
		duplicatePackRecord,
		reorderProjectInPack,
		setProjectInPack,
		visiblePacks
	} from '#lib/packs/packActions.js';
	/** @typedef {import('#lib/domain/domain.js').PackRecord} PackRecord */

	/**
	 * @type {{
	 *   repository: import('#lib/persistence/repository.js').StickerLabRepository,
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
	let projects = $state(/** @type {import('#lib/domain/domain.js').ProjectDocument[]} */ ([]));
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
	let packSort = $state(/** @type {import('#lib/packs/packActions.js').PackSort} */ ('recent'));
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
			const { exportPackZip } = await import('#lib/exports/zipExport.js');
			const zipBlob = await exportPackZip(pack, repository);
			const safe = pack.title.replace(/[^\w.-]+/g, '_').toLowerCase() || 'pack';
			if (live) downloadBlob(zipBlob, `${safe}.zip`);
		} finally {
			if (live) exportingZip = false;
		}
	}

	/** @param {PackRecord} pack */
	function previews(pack) {
		/** @type {import('#lib/domain/domain.js').ProjectDocument[]} */
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
				class="actions [margin-block-start:var(--space-5)] [display:flex] [flex-wrap:wrap] [gap:var(--space-3)]"
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
			class="pills [margin-inline-start:0] [margin-inline-end:0] [margin-block-start:var(--space-5)] [margin-block-end:var(--space-5)] [display:flex] [scrollbar-width:thin] [gap:var(--space-2)] [overflow:auto] [padding-inline-start:2px] [padding-inline-end:2px] [padding-block-start:4px] [padding-block-end:4px]"
		>
			{#each PACK_VIEWS as item (item)}
				<button type="button" aria-pressed={view === item} onclick={() => selectView(item)}
					>{item}</button
				>
			{/each}
		</div>
		<div class="pack-library-tools [display:flex] [align-items:center] [gap:var(--space-3)]">
			<label
				class="pack-search [padding-inline-start:var(--space-4)] [padding-inline-end:var(--space-4)] [padding-block-start:0] [padding-block-end:0] [min-inline-size:min(240px,_24vw)]"
			>
				<Search size={17} aria-hidden="true" />
				<span class="sr-only">Search packs</span>
				<input
					type="search"
					value={packQuery}
					oninput={(event) => (packQuery = event.currentTarget.value)}
					placeholder="Search packs…"
				/>
			</label>
			<label
				class="pack-sort [padding-inline-start:var(--space-3)] [padding-inline-end:var(--space-2)] [padding-block-start:0] [padding-block-end:0]"
			>
				<ArrowUpDown size={16} aria-hidden="true" />
				<span>Sort</span>
				<select
					value={packSort}
					onchange={(event) =>
						(packSort = /** @type {import('#lib/packs/packActions.js').PackSort} */ (
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
				class="pack-privacy-note [grid-column:1_/_-1] [margin:0] [display:flex] [align-items:center] [gap:var(--space-2)] [padding-inline-start:var(--space-2)] [padding-inline-end:var(--space-2)] [padding-block-start:0] [padding-block-end:0] [font-size:12px] [color:oklch(0.519935_0.036349_170.9202)]"
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
				class="packs-empty-art [position:relative] [display:grid] [place-items:center] [color:var(--scrapbook-green)] [block-size:82px] [inline-size:92px]"
				><Layers3 size={38} /><i>♡</i><b>✦</b></span
			>
			<p class="packs-empty-kicker">A space for future collaborations</p>
			<h2>Sharing is not available yet</h2>
			<p>{emptyDetail}</p>
		</section>
	{:else if view === 'Export History'}
		<section class="empty packs-empty">
			<span
				class="packs-empty-art [position:relative] [display:grid] [place-items:center] [color:var(--scrapbook-green)] [block-size:82px] [inline-size:92px]"
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
				class="packs-empty-art [position:relative] [display:grid] [place-items:center] [color:var(--scrapbook-green)] [block-size:82px] [inline-size:92px]"
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
				class="packs-empty-art [position:relative] [display:grid] [place-items:center] [color:var(--scrapbook-green)] [block-size:82px] [inline-size:92px]"
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
									class="pack-card-meta [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-2)] [font-size:11px] [font-weight:700] [color:oklch(0.503769_0.028988_177.3921)]"
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
						class="pack-detail-heading [margin-block-start:var(--space-4)] [display:flex] [align-items:end] [justify-content:space-between] [gap:var(--space-4)]"
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
						class="pack-detail-primary-actions [margin-block-start:var(--space-3)] [display:grid] [grid-template-columns:1fr_1fr] [gap:var(--space-2)]"
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
							class="pack-sticker-gallery [margin-block-start:var(--space-3)] [display:grid] [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:var(--space-2)]"
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
			class="section-title [margin-inline-start:0] [margin-inline-end:0] [margin-block-start:var(--space-5)] [margin-block-end:var(--space-4)] [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-3)]"
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
				class="dialog-footer [display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:var(--space-3)] [padding-block-start:var(--space-5)] [border-block-start:1px_solid_var(--line)]"
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
				class="pack-stickers-list [margin-inline-start:0] [margin-inline-end:0] [margin-block-start:12px] [margin-block-end:12px] [display:grid] [gap:8px] [overflow-y:auto] [max-block-size:240px]"
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
		color: oklch(0.612815 0.139235 239.516);
		font-size: 13px;
		font-weight: 600;
	}
	.empty {
		display: flex;
		min-block-size: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed oklch(0.833566 0.047737 168.8711);
		border-radius: var(--radius);
		background: radial-gradient(
			ellipse at bottom,
			oklch(0.966239 0.018933 157.8754),
			oklch(1 0 none) 75%
		);
		color: oklch(0.535034 0.054407 249.7873);
		text-align: center;
	}
	.empty h2 {
		color: var(--ink);
	}
	.empty p {
		max-inline-size: 480px;
		font-size: 14px;
	}
	:global(.empty > svg) {
		padding: 12px;
		inline-size: 56px;
		block-size: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: oklch(0.551582 0.11869 163.307);
		transform: rotate(-8deg);
	}
	.pills button {
		padding-block-start: 10px;
		padding-block-end: 10px;
		padding-inline-start: 16px;
		padding-inline-end: 16px;
		border: 1px solid oklch(0.936316 0.011619 264.5091);
		border-radius: 999px;
		background: oklch(0.976909 0.010856 274.8971);
		color: oklch(0.349519 0.064628 261.4121);
		white-space: nowrap;
	}
	.pills button[aria-pressed='true'] {
		border-color: oklch(0.551582 0.11869 163.307);
		background: oklch(0.551582 0.11869 163.307);
		color: oklch(1 0 none);
	}
	.pills button {
		min-block-size: 44px;
		font-size: 13px;
	}
	@media (hover: hover) and (pointer: fine) {
		.pills button:hover:not([aria-pressed='true']) {
			background: var(--lav);
		}
	}
	.packs-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		margin-block-start: var(--space-6);
		margin-block-end: var(--space-6);
		margin-inline-start: 0;
		margin-inline-end: 0;
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		border: 1px solid oklch(0.920546 0.014436 169.2206);
		border-radius: 26px;
		background: var(--surface-warm);
		box-shadow: 0 10px 30px
			color-mix(in oklch, oklch(0.379745 0.043709 172.9733) 6.2745%, transparent);
	}
	.packs-controls .pills {
		min-inline-size: 0;
		max-inline-size: 100%;
		margin: 0;
	}
	.packs-controls .pills button {
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		font-size: 13px;
		font-weight: 700;
	}
	.pack-search {
		display: flex;
		min-block-size: 44px;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid oklch(0.921653 0.012143 247.9586);
		border-radius: 999px;
		background: oklch(0.975185 0.00342 247.858);
		color: var(--muted);
	}
	.pack-sort {
		display: flex;
		min-block-size: 44px;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid oklch(0.921653 0.012143 247.9586);
		border-radius: 999px;
		background: oklch(0.975185 0.00342 247.858);
		color: var(--muted);
	}
	.pack-search:focus-within {
		border-color: var(--mint);
		box-shadow: 0 0 0 3px
			color-mix(in oklch, oklch(0.690943 0.155538 159.8206) 12.1569%, transparent);
	}
	.pack-sort:focus-within {
		border-color: var(--mint);
		box-shadow: 0 0 0 3px
			color-mix(in oklch, oklch(0.690943 0.155538 159.8206) 12.1569%, transparent);
	}
	.pack-search input {
		inline-size: 100%;
		min-inline-size: 0;
		border: 0;
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
		min-block-size: 36px;
		border: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-weight: 700;
	}
	.empty {
		min-block-size: 250px;
		margin-block-start: 20px;
	}
	.layer-action-btn {
		display: inline-flex;
		inline-size: 26px;
		block-size: 26px;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: oklch(0.559805 0.044328 261.3837);
		cursor: pointer;
	}
	@media (hover: hover) and (pointer: fine) {
		.layer-action-btn:hover:not(:disabled) {
			background: oklch(0.961511 0.00758 241.6639);
			color: var(--ink);
		}
	}
	.layer-action-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.layer-action-btn.active {
		color: oklch(0.551582 0.11869 163.307);
	}

	.packs-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(350px, 410px);
		gap: var(--space-6);
		align-items: start;
	}
	.packs-empty {
		display: grid;
		min-block-size: 360px;
		place-content: center;
		justify-items: center;
		gap: var(--space-3);
		overflow: clip;
		padding: var(--space-7);
		border: 1px dashed var(--mint-line);
		border-radius: var(--radius);
		background:
			radial-gradient(circle at 16% 18%, var(--blush-strong) 0 6%, transparent 6.5%),
			radial-gradient(circle at 86% 78%, oklch(0.910756 0.041556 299.2678) 0 8%, transparent 8.5%),
			linear-gradient(145deg, oklch(0.974506 0.014893 164.7371), oklch(0.993124 0.012015 96.4173));
		text-align: center;
	}
	.packs-empty > h2 {
		margin: 0;
	}
	.packs-empty > p {
		margin: 0;
	}
	.packs-empty > p:not(.packs-empty-kicker) {
		max-inline-size: 56ch;
		color: var(--muted);
	}
	.packs-empty-art::before {
		position: absolute;
		inset-block-start: 4px;
		inset-block-end: 2px;
		inset-inline-start: 8px;
		inset-inline-end: 8px;
		border: 6px solid oklch(1 0 none);
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
		color: oklch(0.694297 0.165915 7.4434);
		font:
			400 24px/1 Chewy,
			cursive;
	}
	.packs-empty-art b {
		position: absolute;
		z-index: 2;
		color: oklch(0.694297 0.165915 7.4434);
		font:
			400 24px/1 Chewy,
			cursive;
	}
	.packs-empty-art i {
		inset-inline-end: -7px;
		inset-block-start: -3px;
		transform: rotate(12deg);
	}
	.packs-empty-art b {
		inset-inline-start: -10px;
		inset-block-end: 2px;
		color: oklch(0.79302 0.162184 87.0618);
		transform: rotate(-14deg);
	}
	.packs-empty-kicker {
		padding-block-start: 5px;
		padding-block-end: 5px;
		padding-inline-start: 10px;
		padding-inline-end: 10px;
		background: oklch(0.950685 0.091931 97.8146);
		color: var(--scrapbook-green);
		font:
			400 14px/1.2 Chewy,
			cursive;
		transform: rotate(-2deg);
	}
	.pack-library {
		min-inline-size: 0;
	}
	.pack-library-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-block-end: var(--space-4);
	}
	.pack-library-heading p {
		margin-block-start: 0;
		margin-block-end: 3px;
		margin-inline-start: 0;
		margin-inline-end: 0;
		color: var(--scrapbook-green);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.pack-detail-heading p {
		margin-block-start: 0;
		margin-block-end: 3px;
		margin-inline-start: 0;
		margin-inline-end: 0;
		color: var(--scrapbook-green);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.pack-detail-section-heading p {
		margin-block-start: 0;
		margin-block-end: 3px;
		margin-inline-start: 0;
		margin-inline-end: 0;
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
		padding-block-start: 5px;
		padding-block-end: 5px;
		padding-inline-start: 10px;
		padding-inline-end: 10px;
		border-radius: 999px;
		background: var(--pale);
		color: oklch(0.43929 0.053128 172.1746);
		font-size: 12px;
		font-weight: 800;
	}
	.pack-card {
		display: block;
		min-inline-size: 0;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: oklch(1 0 none);
		box-shadow: var(--shadow);
		color: var(--ink);
		cursor: pointer;
		text-align: start;
	}
	@media (prefers-reduced-motion: no-preference) {
		.pack-card {
			transition:
				border-color 160ms ease-out,
				box-shadow 160ms ease-out,
				transform 160ms ease-out;
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.pack-card:hover {
			border-color: var(--mint-strong);
			box-shadow: var(--shadow-hover);
			transform: translateY(-3px);
		}
	}
	.pack-card.active {
		border-color: oklch(0.690943 0.155538 159.8206);
		box-shadow:
			0 0 0 2px color-mix(in oklch, oklch(0.690943 0.155538 159.8206) 20%, transparent),
			var(--shadow-hover);
	}
	.pack-cover {
		position: relative;
		min-inline-size: 0;
		block-size: 158px;
		overflow: clip;
		border-radius: var(--radius-sm);
		background: oklch(0.950641 0.032228 164.2229);
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
		inset-block-start: -38%;
		inset-inline-end: -11%;
		inline-size: 62%;
		block-size: 92%;
		background: oklch(0.930981 0.083314 88.577);
	}
	.pack-cover::after {
		inset-block-end: -42%;
		inset-inline-start: -12%;
		inline-size: 75%;
		block-size: 90%;
		background: oklch(0.892209 0.047849 356.5975);
	}
	.pack-cover-tone-1 {
		background: oklch(0.916976 0.039104 301.8593);
	}
	.pack-cover-tone-1::before {
		background: oklch(0.918499 0.044396 238.9108);
	}
	.pack-cover-tone-1::after {
		background: oklch(0.951773 0.085044 96.8609);
	}
	.pack-cover-tone-2 {
		background: oklch(0.941371 0.025058 232.9735);
	}
	.pack-cover-tone-2::before {
		background: oklch(0.939211 0.040072 149.8013);
	}
	.pack-cover-tone-2::after {
		background: oklch(0.92079 0.047096 314.9886);
	}
	.pack-cover-large {
		block-size: 220px;
	}
	.pack-cover-tape {
		position: absolute;
		z-index: 4;
		inset-block-start: 7px;
		inset-inline-start: 38%;
		inline-size: 28%;
		block-size: 18px;
		background:
			repeating-linear-gradient(
				90deg,
				color-mix(in oklch, oklch(0.668055 0.109625 158.3261) 33.3333%, transparent) 0 6px,
				transparent 6px 12px
			),
			color-mix(in oklch, oklch(0.948863 0.05742 100.9692) 85.098%, transparent);
		transform: rotate(-5deg);
	}
	.pack-cover-spark {
		position: absolute;
		z-index: 3;
		color: oklch(0.694297 0.165915 7.4434);
		font:
			400 26px/1 Chewy,
			cursive;
	}
	.pack-cover-spark-left {
		inset-inline-start: 7%;
		inset-block-start: 10%;
		color: oklch(0.771298 0.158353 83.8399);
		transform: rotate(-14deg);
	}
	.pack-cover-spark-right {
		inset-inline-end: 6%;
		inset-block-start: 26%;
		transform: rotate(12deg);
	}
	.pack-cover-stack {
		position: absolute;
		inset-block-start: 10px;
		inset-block-end: 20px;
		inset-inline-start: 10px;
		inset-inline-end: 10px;
	}
	/* StickerLab stickers are photo/text artwork, so a pack cover presents them as white-
   bordered polaroid cards (the same read as the sticker library) rather than loose
   artwork: frameless tiles turn text stickers into floating words. */
	.pack-cover-sticker {
		position: absolute;
		display: block;
		inline-size: 44%;
		aspect-ratio: 1;
		padding: 5px;
		border: 4px solid oklch(1 0 none);
		border-radius: 13px;
		background: oklch(1 0 none);
		box-shadow: 0 9px 18px
			color-mix(in oklch, oklch(0.325691 0.046324 173.103) 16.0784%, transparent);
	}
	.pack-cover-sticker .project-thumb {
		inline-size: 100%;
		block-size: 100%;
		border-radius: 8px;
		background-color: oklch(1 0 none);
		background-image: none;
	}
	.pack-cover-sticker-1 {
		inset-inline-start: 5%;
		inset-block-end: 3%;
		transform: rotate(-8deg);
	}
	.pack-cover-sticker-2 {
		inset-inline-end: 4%;
		inset-block-start: 5%;
		transform: rotate(8deg);
	}
	.pack-cover-sticker-3 {
		inset-inline-start: 32%;
		inset-block-start: 7%;
		z-index: 2;
		transform: rotate(-1deg);
	}
	.pack-cover-stack-1 .pack-cover-sticker-1 {
		inset-inline-start: 25%;
		inset-block-end: 5%;
		inline-size: 50%;
		transform: rotate(-4deg);
	}
	.pack-cover-stack-2 .pack-cover-sticker {
		inline-size: 48%;
	}
	.pack-cover-stack-4 .pack-cover-sticker {
		inline-size: 36%;
	}
	.pack-cover-stack-5 .pack-cover-sticker {
		inline-size: 36%;
	}
	.pack-cover-sticker-4 {
		inset-inline-end: 6%;
		inset-block-end: 5%;
		transform: rotate(7deg);
	}
	.pack-cover-sticker-5 {
		inset-inline-start: 3%;
		inset-block-start: 5%;
		z-index: 1;
		transform: rotate(-11deg);
	}
	/* The pack's name, lettered onto the cover the way the reference does - the count
   lives in the meta row below rather than competing with it here. */
	.pack-cover-title {
		position: absolute;
		z-index: 6;
		inset-block-end: 8px;
		inset-inline-start: 8px;
		display: -webkit-box;
		max-inline-size: calc(100% - 16px);
		overflow: hidden;
		padding-block-start: 4px;
		padding-block-end: 4px;
		padding-inline-start: 10px;
		padding-inline-end: 10px;
		border-radius: 999px;
		background: color-mix(in oklch, oklch(0.992071 0.017174 99.5912) 90.9804%, transparent);
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
		padding-block-start: 6px;
		padding-block-end: 6px;
		padding-inline-start: 16px;
		padding-inline-end: 16px;
		font-size: 34px;
	}
	.pack-cover-empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		color: oklch(0.43929 0.053128 172.1746);
	}
	:global(.pack-cover-empty svg) {
		padding: 7px;
		border-radius: 12px;
		background: color-mix(in oklch, oklch(1 0 none) 72.1569%, transparent);
		box-shadow: var(--shadow);
	}
	.pack-cover-empty b {
		padding-block-start: 4px;
		padding-block-end: 4px;
		padding-inline-start: 8px;
		padding-inline-end: 8px;
		background: oklch(0.992071 0.017174 99.5912);
		font:
			400 13px/1.15 Chewy,
			cursive;
		transform: rotate(-2deg);
	}
	.pack-card-copy {
		display: grid;
		gap: 7px;
		padding-block-start: var(--space-4);
		padding-block-end: var(--space-2);
		padding-inline-start: var(--space-2);
		padding-inline-end: var(--space-2);
	}
	.pack-card-title b {
		min-inline-size: 0;
		overflow-wrap: anywhere;
		font-size: 16px;
	}
	:global(.pack-card-title svg) {
		flex: none;
		color: var(--scrapbook-green);
	}
	@media (prefers-reduced-motion: no-preference) {
		:global(.pack-card-title svg) {
			transition: transform 160ms ease-out;
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.pack-card:hover :global(.pack-card-title svg) {
			transform: translateX(3px);
		}
	}
	.pack-card-copy > small {
		display: -webkit-box;
		min-block-size: 34px;
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
		inline-size: max-content;
		padding-block-start: 4px;
		padding-block-end: 4px;
		padding-inline-start: 9px;
		padding-inline-end: 9px;
		border-radius: 999px;
		background: oklch(0.951313 0.035524 165.0096);
		color: oklch(0.501063 0.107847 161.8772);
		font-size: 11px;
		font-weight: 800;
	}
	.pack-sticker-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding-block-start: 6px;
		padding-block-end: 6px;
		padding-inline-start: 10px;
		padding-inline-end: 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: oklch(1 0 none);
	}
	.pack-sticker-row span {
		flex: 1;
		min-inline-size: 0;
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
		inline-size: 100%;
		min-block-size: 48px;
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		border: 1px solid oklch(0.895183 0.011489 176.2807);
		border-radius: var(--radius-sm);
		background: oklch(0.992736 0.002826 128.4918);
		font: inherit;
	}
	:global(.dialog-field textarea) {
		inline-size: 100%;
		min-block-size: 48px;
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		border: 1px solid oklch(0.895183 0.011489 176.2807);
		border-radius: var(--radius-sm);
		background: oklch(0.992736 0.002826 128.4918);
		font: inherit;
	}
	.pack-detail {
		position: sticky;
		inset-block-start: calc(var(--header-height) + var(--space-4));
		min-inline-size: 0;
		padding: var(--space-4);
		border: 1px solid oklch(0.920546 0.014436 169.2206);
		border-radius: var(--radius);
		background: oklch(0.99447 0.005693 84.5658);
		box-shadow: var(--shadow-hover);
		overflow-wrap: anywhere;
	}
	.pack-detail-close {
		position: absolute;
		z-index: 3;
		inset-block-start: 10px;
		inset-inline-end: 10px;
		display: grid;
		inline-size: 34px;
		block-size: 34px;
		place-items: center;
		border: 1px solid oklch(0.920546 0.014436 169.2206);
		border-radius: 999px;
		background: color-mix(in oklch, oklch(1 0 none) 94.902%, transparent);
		color: oklch(0.43929 0.053128 172.1746);
		box-shadow: var(--shadow);
	}
	@media (hover: hover) and (pointer: fine) {
		.pack-detail-close:hover {
			background: oklch(1 0 none);
			color: var(--scrapbook-green);
		}
	}
	.pack-detail-heading h2 {
		font-size: 24px;
	}
	.pack-detail > p {
		margin-block-start: var(--space-2);
		margin-block-end: var(--space-4);
		margin-inline-start: 0;
		margin-inline-end: 0;
		font-size: 14px;
		line-height: 1.55;
	}
	.detail-cover {
		display: grid;
		block-size: 155px;
		place-items: center;
		border-radius: 12px;
		background: linear-gradient(
			135deg,
			oklch(0.956132 0.027801 171.2158),
			oklch(0.946118 0.035177 311.4254)
		);
		font-size: 72px;
	}
	.pack-detail p {
		color: var(--muted);
		font-size: 13px;
	}
	.pack-detail-secondary-actions {
		display: grid;
		gap: var(--space-2);
		margin-block-start: var(--space-3);
	}
	.pack-detail-primary-actions .button {
		justify-content: center;
		min-inline-size: 0;
	}
	.pack-detail-secondary-actions {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.pack-detail-secondary-actions .button {
		justify-content: center;
		min-inline-size: 0;
		padding-inline: var(--space-2);
		font-size: 12px;
	}
	.pack-detail-section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--space-3);
		margin-block-start: var(--space-6);
		padding-block-start: var(--space-4);
		border-block-start: 1px dashed oklch(0.877978 0.023063 168.6618);
	}
	.pack-detail-section-heading h3 {
		font-size: 17px;
	}
	.pack-detail-add-shortcut {
		min-block-size: 36px;
		padding-block-start: 6px;
		padding-block-end: 6px;
		padding-inline-start: 10px;
		padding-inline-end: 10px;
		font-size: 12px;
	}
	.pack-detail-empty {
		display: grid;
		min-block-size: 120px;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		margin-block-start: var(--space-3);
		border: 1px dashed oklch(0.847733 0.049348 169.9302);
		border-radius: var(--radius-sm);
		background: var(--pale);
		color: var(--scrapbook-green);
		text-align: center;
	}
	.pack-detail-empty p {
		max-inline-size: 28ch;
		margin: 0;
	}
	.pack-sticker-tile {
		position: relative;
		display: grid;
		min-inline-size: 0;
		gap: 5px;
		padding: 6px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: oklch(1 0 none);
	}
	.pack-sticker-tile .project-thumb {
		block-size: 82px;
		border-radius: 8px;
	}
	.pack-sticker-tile strong {
		overflow: hidden;
		padding-block-start: 0;
		padding-block-end: 0;
		padding-inline-start: 2px;
		padding-inline-end: 2px;
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
		inline-size: 100%;
		block-size: 30px;
		min-block-size: 30px;
		border-radius: 7px;
	}
	.pack-add-sticker-tile {
		display: grid;
		min-block-size: 130px;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		border: 1px dashed oklch(0.76661 0.085618 167.2914);
		border-radius: 12px;
		background: oklch(0.975236 0.014016 162.481);
		color: var(--scrapbook-green);
		font-size: 11px;
		font-weight: 800;
	}
	@media (hover: hover) and (pointer: fine) {
		.pack-add-sticker-tile:hover {
			background: oklch(0.948325 0.031387 163.2398);
		}
	}
	.local-stickers-section {
		margin-block-start: var(--space-7);
		padding: var(--space-5);
		border: 1px solid oklch(0.925579 0.007562 164.9279);
		border-radius: var(--radius);
		background: oklch(0.99447 0.005693 84.5658);
	}
	.local-stickers-section .section-title {
		margin-block-start: 0;
	}
	.local-stickers-section .section-title h2 {
		margin-block-start: 2px;
		margin-block-end: 0;
		margin-inline-start: 0;
		margin-inline-end: 0;
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
			inline-size: 100%;
			margin: 0;
		}
		.packs-controls .pills button {
			padding-block-start: var(--space-3);
			padding-block-end: var(--space-3);
			padding-inline-start: var(--space-4);
			padding-inline-end: var(--space-4);
		}
		.pack-library-tools {
			align-items: stretch;
			flex-direction: column;
		}
		.pack-search {
			inline-size: 100%;
			min-inline-size: 0;
		}
		.pack-sort {
			inline-size: 100%;
		}
		.pack-sort select {
			flex: 1;
		}
		.pack-privacy-note {
			padding: var(--space-1);
		}
		.pills {
			margin-block-start: 12px;
			margin-block-end: 12px;
			margin-inline-start: 0;
			margin-inline-end: 0;
		}
		.packs-layout {
			display: grid;
			gap: var(--space-5);
		}
		.pack-grid {
			grid-template-columns: 1fr;
		}
		.pack-cover {
			block-size: 180px;
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
			inline-size: 36px;
			block-size: 36px;
		}
	}
</style>
