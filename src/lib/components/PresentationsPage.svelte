<script>
	import { button, buttonDanger, buttonIcon, buttonPrimary } from '$lib/ui/styles.js';
	import { asset } from '$app/paths';
	import {
		ArrowRight,
		Clock3,
		Copy,
		FilePlus2,
		MonitorUp,
		Pencil,
		Presentation,
		Search,
		Sparkles,
		Trash2,
		Upload
	} from 'lucide-svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PresentationThumb from '$lib/components/PresentationThumb.svelte';
	import PresentationStarterGallery from '$lib/components/PresentationStarterGallery.svelte';
	import { blobToArrayBuffer } from '$lib/blob';
	import { createPresentationDocument } from '$lib/presentations/model/factories';
	import { PRESENTATION_LIMITS } from '$lib/presentations/model/limits';
	import {
		RENAME_EMPTY_TITLE_MESSAGE,
		describeLibraryFailure,
		renamedDocument
	} from '$lib/presentations/library/libraryActions';
	import { restoreBackupArchive } from '$lib/presentations/library/restoreBackup';
	import { offlineReadinessLabel } from '$lib/presentations/offlineReadiness';
	import { usePresentationOfflineReadiness } from '$lib/presentations/presentationOffline.svelte';

	/** @type {{
	 *   repository: import('$lib/presentations/persistence/repository').PresentationRepository,
	 *   pathname: string,
	 *   search: string,
	 *   onopen: (documentId: string) => void | Promise<void>,
	 *   openhref: (documentId: string) => string
	 * }} */
	let { repository, pathname, search, onopen, openhref } = $props();

	let items = $state.raw(
		/** @type {import('$lib/presentations/model/types').PresentationSummary[]} */ ([])
	);
	let loading = $state(true);
	let creatingBlank = $state(false);
	let error = $state(/** @type {string | null} */ (null));
	let query = $state('');
	let renaming = $state(
		/** @type {import('$lib/presentations/model/types').PresentationSummary | null} */ (null)
	);
	let renameTitle = $state('');
	let renameError = $state(/** @type {string | null} */ (null));
	let pendingDelete = $state(
		/** @type {import('$lib/presentations/model/types').PresentationSummary | null} */ (null)
	);
	let deleteError = $state(/** @type {string | null} */ (null));
	let actionError = $state(/** @type {string | null} */ (null));
	let restoring = $state(false);
	let restoreNote = $state(/** @type {string | null} */ (null));
	let busyId = $state(/** @type {string | null} */ (null));
	/** @type {HTMLButtonElement | null} */
	let renameOpener = null;
	/** @type {HTMLButtonElement | null} */
	let deleteOpener = null;
	let creating = false;

	// Opening the library starts (and shows) the offline warm-up for this session.
	const offline = usePresentationOfflineReadiness();

	let normalizedQuery = $derived(query.trim().toLocaleLowerCase());
	let visibleItems = $derived(
		normalizedQuery
			? items.filter((item) => item.title.toLocaleLowerCase().includes(normalizedQuery))
			: items
	);

	$effect(() => {
		void load();
	});

	async function load() {
		error = null;
		try {
			items = await repository.listPresentations();
		} catch {
			error = 'Could not load presentations saved in this browser. Please retry.';
		} finally {
			loading = false;
		}
	}

	async function createBlank() {
		if (creating) return;
		creating = true;
		creatingBlank = true;
		error = null;
		const document = createPresentationDocument();
		try {
			await repository.savePresentation(document);
			await onopen(document.id);
		} catch {
			error = 'Could not create a presentation. No incomplete file was saved; please retry.';
		} finally {
			creating = false;
			creatingBlank = false;
		}
	}

	/** @param {File} file */
	async function restoreBackup(file) {
		restoring = true;
		actionError = null;
		restoreNote = null;
		try {
			const bytes = new Uint8Array(await blobToArrayBuffer(file));
			const outcome = await restoreBackupArchive(repository, bytes);
			if (!outcome.ok) {
				actionError = outcome.message;
				return;
			}
			restoreNote = `Restored “${outcome.document.title}” as a new presentation.`;
			await load();
		} catch {
			actionError = 'This backup could not be read on this device.';
		} finally {
			restoring = false;
		}
	}

	/**
	 * @param {import('$lib/presentations/model/types').PresentationSummary} item
	 * @param {HTMLButtonElement} opener
	 */
	function openRename(item, opener) {
		renameOpener = opener;
		renameTitle = item.title;
		renameError = null;
		renaming = item;
	}

	/** @param {SubmitEvent} event */
	async function submitRename(event) {
		event.preventDefault();
		if (!renaming) return;
		renameError = null;
		busyId = renaming.id;
		try {
			const stored = await repository.getPresentation(renaming.id);
			const renamed = renamedDocument(stored, renameTitle);
			if (!renamed) {
				renameError = RENAME_EMPTY_TITLE_MESSAGE;
				return;
			}
			await repository.savePresentation(renamed, undefined, { baseRevision: stored.revision });
			renaming = null;
		} catch (cause) {
			renameError = describeLibraryFailure(cause, 'rename');
		} finally {
			busyId = null;
			await load();
		}
	}

	/** @param {import('$lib/presentations/model/types').PresentationSummary} item */
	async function duplicate(item) {
		busyId = item.id;
		actionError = null;
		try {
			await repository.duplicatePresentation(item.id, { title: `${item.title} copy` });
		} catch (cause) {
			actionError = describeLibraryFailure(cause, 'duplicate');
		} finally {
			busyId = null;
			await load();
		}
	}

	async function confirmDelete() {
		if (!pendingDelete) return;
		busyId = pendingDelete.id;
		deleteError = null;
		try {
			await repository.deletePresentation(pendingDelete.id);
			await load();
			pendingDelete = null;
		} catch (cause) {
			deleteError = describeLibraryFailure(cause, 'delete');
		} finally {
			busyId = null;
		}
	}

	/** @param {string} value */
	function formattedDate(value) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'Unknown date';
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
	}

	/** @param {HTMLButtonElement | null} opener */
	function focusAfterLibraryChange(opener) {
		const target =
			(opener?.isConnected ? opener : null) ??
			/** @type {HTMLButtonElement | null} */ (
				document.querySelector('.presentation-card-actions button')
			) ??
			document.getElementById('presentation-library-search');
		target?.focus();
	}
</script>

<AppShell {pathname} {search}>
	<div class="presentations-library">
		<section class="presentations-hero">
			<div class="presentation-hero-copy [position:relative] [z-index:2] [max-width:680px]">
				<p class="hero-kicker"><Presentation size={15} /> YOUR IDEAS, ON THE BIG SCREEN</p>
				<h1>Tell your story.<br /><em>Make it stick.</em></h1>
				<p>
					Turn a blank 16:9 slide into something clear, colorful, and completely yours. Your work
					stays private in this browser.
				</p>
				<div
					class="presentation-hero-actions [margin-top:var(--space-5)] [display:flex] [flex-wrap:wrap] [gap:var(--space-3)]"
				>
					<button class={buttonPrimary} onclick={createBlank} disabled={creatingBlank}
						><FilePlus2 size={18} />{creatingBlank
							? 'Creating…'
							: 'Start a blank presentation'}</button
					>
					{#if items[0]}<a class={button} href={openhref(items[0].id)}
							>Open latest <ArrowRight size={16} /></a
						>{/if}
				</div>
				<ul class="presentation-hero-points" aria-label="Presentation features">
					<li>16:9 slide canvas</li>
					<li>Saved in this browser</li>
					<li>No account needed</li>
				</ul>
			</div>
			<div
				class="presentation-hero-art [position:relative] [z-index:1] [min-height:330px] [min-width:0] [align-self:stretch]"
				aria-hidden="true"
			>
				<span class="presentation-art-note">big idea energy ✦</span>
				<img src={asset('/art/presentation-cat-hero.webp')} alt="" width="1200" height="744" />
				<span class="presentation-art-tape"></span><span class="presentation-art-caption"
					>Made to explain.<br />Styled to remember.</span
				>
			</div>
		</section>

		<section class="library-safety-note" aria-label="Where your work is saved">
			<strong>Saved in this browser. Not automatically synced.</strong>
			<p>
				Clearing browser data can remove your presentations. Use <strong>Back up my work</strong> in
				the editor to download a portable .stickerlab.zip. Use <strong>Restore backup</strong> here to
				open it on another device.
			</p>
		</section>
		<PresentationStarterGallery
			{repository}
			{onopen}
			onblank={createBlank}
			{creatingBlank}
			task={new URLSearchParams(search).get('task')}
		/>

		<div class="presentation-library-controls">
			<div>
				<p
					class="presentation-library-eyebrow [margin:0] [display:flex] [align-items:center] [gap:var(--space-2)] [font-size:10px] [font-weight:800] [letter-spacing:0.12em] [color:var(--scrapbook-green)]"
				>
					<Sparkles size={15} /> YOUR CREATIVE DESK
				</p>
				<h2>Your presentations</h2>
				<p>
					{items.length === 0
						? 'Start fresh with a blank page.'
						: `${items.length} saved ${items.length === 1 ? 'presentation' : 'presentations'} in this browser`}
				</p>
			</div>
			<div
				class="presentation-library-tools [display:flex] [align-items:center] [justify-content:flex-end] [gap:var(--space-4)]"
			>
				<label class="presentation-library-search"
					><Search size={17} aria-hidden="true" /><span class="sr-only">Search presentations</span
					><input
						id="presentation-library-search"
						type="search"
						bind:value={query}
						placeholder="Search your presentations…"
					/></label
				>
				<p
					class="presentation-device-note [margin:0] [display:flex] [align-items:center] [gap:var(--space-2)] [font-size:12px] [white-space:nowrap] [color:var(--muted)]"
				>
					<MonitorUp size={16} /> Best edited on a larger screen
				</p>
				<label class={button} aria-disabled={restoring}>
					<Upload size={16} aria-hidden="true" />
					{restoring ? 'Restoring…' : 'Restore backup'}
					<input
						class="sr-only"
						type="file"
						accept=".zip,application/zip"
						aria-label="Choose backup file"
						data-testid="presentation-restore-input"
						disabled={restoring}
						onchange={(event) => {
							const input = event.currentTarget;
							const file = input.files?.[0];
							input.value = '';
							if (file) void restoreBackup(file);
						}}
					/>
				</label>
			</div>
		</div>

		{#if actionError}<p role="alert">{actionError}</p>{/if}
		{#if restoreNote}<p role="status">{restoreNote}</p>{/if}
		<!-- Only a completed warm-up says the session is offline-ready. The library
		     holds no unwritten work, so the safe reload wording always applies. -->
		<p role="status">{offlineReadinessLabel(offline.snapshot)}</p>

		{#if error}
			<section class="card presentation-library-state">
				<div role="alert" class="presentation-library-alert">
					<h2>Presentations are unavailable</h2>
					<p>{error}</p>
					<button class={button} onclick={load}>Try again</button>
				</div>
			</section>
		{:else if loading}
			<section class="card presentation-library-state">
				<p role="status">Loading local presentations…</p>
			</section>
		{:else if items.length === 0}
			<section class="presentation-library-empty" aria-labelledby="presentation-empty-title">
				<div class="presentation-empty-art" aria-hidden="true">
					<div class="presentation-empty-slide">
						<span class="presentation-empty-slide-label">YOUR FIRST SLIDE</span>
						<span class="presentation-empty-slide-title">Big ideas<br />start small.</span>
						<span class="presentation-empty-slide-line"></span>
					</div>
					<img
						class="presentation-empty-cat"
						src={asset('/art/presentation-stickers/cat-presenter.png')}
						alt=""
						width="728"
						height="1014"
					/>
					<span class="presentation-empty-tape"></span>
					<span class="presentation-empty-spark">✳</span>
				</div>
				<div class="presentation-empty-copy">
					<p class="presentation-empty-kicker">A little space for a big idea</p>
					<h2 id="presentation-empty-title">No presentations yet</h2>
					<p class="presentation-empty-description">
						Start with a blank slide. Add your words, images, and a little personality as you go.
					</p>
					<button class={buttonPrimary} onclick={createBlank} disabled={creatingBlank}
						><FilePlus2 size={18} />{creatingBlank
							? 'Creating…'
							: 'Create your first presentation'}</button
					>
					<p class="presentation-empty-restore">
						Already have a .stickerlab.zip? Use <strong>Restore backup</strong> above.
					</p>
				</div>
			</section>
		{:else if visibleItems.length === 0}
			<section class="card presentation-library-state presentation-library-no-results">
				<Search size={32} aria-hidden="true" />
				<h2>No presentation found</h2>
				<p>Nothing matches “{query.trim()}”. Try another title or clear the search.</p>
				<button class={button} onclick={() => (query = '')}>Clear search</button>
			</section>
		{:else}
			<ul class="presentation-grid">
				{#each visibleItems as item (item.id)}
					<li>
						<article class="presentation-card">
							<a
								class="presentation-card-link"
								href={openhref(item.id)}
								aria-label={`Open ${item.title}`}
							>
								<span class="presentation-card-preview" aria-hidden="true"
									><span class="presentation-card-paper"
										><Presentation size={17} /><b>{item.title}</b><em></em></span
									><PresentationThumb
										{repository}
										documentId={item.id}
										revision={item.revision}
									/><i>16:9 SLIDES</i></span
								>
								<span
									class="presentation-card-body [display:grid] [gap:var(--space-2)] [padding:var(--space-4)_var(--space-2)_var(--space-2)]"
									><span
										class="presentation-card-title [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-3)]"
										><strong title={item.title}>{item.title}</strong><ArrowRight size={17} /></span
									><small><Clock3 size={13} /> Updated {formattedDate(item.updatedAt)}</small><small
										>{item.slideCount} {item.slideCount === 1 ? 'slide' : 'slides'} · Local</small
									></span
								>
							</a>
							<div
								class="presentation-card-actions [margin-top:auto] [display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:var(--space-1)] [padding:var(--space-2)_var(--space-2)_0]"
							>
								<button
									class={buttonIcon}
									aria-label={`Rename ${item.title}`}
									disabled={busyId === item.id}
									onclick={(event) => openRename(item, event.currentTarget)}
									><Pencil size={16} /></button
								>
								<button
									class={buttonIcon}
									aria-label={`Duplicate ${item.title}`}
									disabled={busyId === item.id}
									onclick={() => duplicate(item)}><Copy size={16} /></button
								>
								<button
									class={buttonIcon}
									aria-label={`Delete ${item.title}`}
									disabled={busyId === item.id}
									onclick={(event) => {
										deleteOpener = event.currentTarget;
										deleteError = null;
										pendingDelete = item;
									}}><Trash2 size={16} /></button
								>
							</div>
						</article>
					</li>
				{/each}
			</ul>
		{/if}

		<Modal
			open={renaming !== null}
			title="Rename this presentation"
			description={`Give “${renaming?.title ?? ''}” a new name. Its slides and artwork are not changed.`}
			onclose={() => {
				renaming = null;
				renameError = null;
			}}
			onclosed={() => focusAfterLibraryChange(renameOpener)}
			focusOnOpen={() => document.getElementById('rename-presentation-title')}
		>
			<form id="rename-presentation-form" onsubmit={submitRename}>
				<div class="dialog-field [display:grid] [gap:var(--space-2)]">
					<label for="rename-presentation-title">Presentation name</label><input
						id="rename-presentation-title"
						bind:value={renameTitle}
						maxlength={PRESENTATION_LIMITS.maxTitleLength}
						autocomplete="off"
					/>
				</div>
				{#if renameError}<p role="alert">{renameError}</p>{/if}
			</form>
			{#snippet footer()}<button
					class={button}
					type="button"
					onclick={() => {
						renaming = null;
						renameError = null;
					}}>Keep the current name</button
				><button
					class={buttonPrimary}
					type="submit"
					form="rename-presentation-form"
					disabled={busyId === renaming?.id}>Save name</button
				>{/snippet}
		</Modal>

		<Modal
			open={pendingDelete !== null}
			title="Delete this presentation?"
			description={`“${pendingDelete?.title ?? ''}” and its slides will be removed from this browser. Your stickers and sticker packs are not affected.`}
			onclose={() => (pendingDelete = null)}
			onclosed={() => focusAfterLibraryChange(deleteOpener)}
			focusOnOpen={() => document.getElementById('cancel-delete-presentation')}
		>
			{#if deleteError}<p role="alert">{deleteError}</p>{/if}
			{#snippet footer()}<button
					id="cancel-delete-presentation"
					class={button}
					type="button"
					onclick={() => (pendingDelete = null)}>Keep presentation</button
				><button
					class={buttonDanger}
					disabled={busyId === pendingDelete?.id}
					onclick={confirmDelete}>Delete presentation</button
				>{/snippet}
		</Modal>
	</div>
</AppShell>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.card {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
	}

	.library-safety-note {
		padding: 18px 22px;
		border-left: 4px solid var(--scrapbook-green);
		background: var(--pale);
		border-radius: 10px;
		font-size: 13px;
		line-height: 1.6;
	}
	.library-safety-note p {
		margin: 8px 0 0;
	}
	.presentations-library {
		display: grid;
		gap: var(--space-6);
		width: 100%;
		container-type: inline-size;
	}
	.presentations-hero {
		position: relative;
		display: grid;
		grid-template-columns: minmax(360px, 0.88fr) minmax(430px, 1.12fr);
		min-height: 380px;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-7) 4.6%;
		overflow: hidden;
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--cream) url('/art/scrapbook-paper.svg') center / 100% 100% no-repeat;
		isolation: isolate;
	}
	.presentations-hero::before {
		position: absolute;
		z-index: -1;
		right: -2%;
		bottom: -23%;
		width: 61%;
		height: 82%;
		background: #e6dafa;
		clip-path: polygon(
			4% 5%,
			30% 0,
			55% 7%,
			78% 1%,
			100% 12%,
			97% 90%,
			70% 100%,
			43% 91%,
			18% 98%,
			0 84%
		);
		transform: rotate(-2deg);
		content: '';
	}
	.presentations-hero::after {
		position: absolute;
		z-index: -1;
		top: -23%;
		right: 30%;
		width: 31%;
		height: 72%;
		background: #fbe787;
		clip-path: polygon(5% 0, 92% 5%, 100% 86%, 68% 100%, 3% 90%);
		opacity: 0.82;
		transform: rotate(7deg);
		content: '';
	}
	.presentations-hero .hero-kicker {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-4);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
		padding: var(--space-2) var(--space-3);
		background: #ffffffb8;
		box-shadow: var(--shadow);
		color: var(--scrapbook-green);
		transform: rotate(-2deg);
	}
	.presentations-hero h1 {
		margin: 0 0 var(--space-4);
		font-size: clamp(2.45rem, 5.1cqw, 5.8rem);
		line-height: 0.98;
		letter-spacing: -0.06em;
	}
	.presentations-hero h1 em {
		display: inline-block;
		padding: 0 var(--space-2) var(--space-1);
		background: var(--scrapbook-yellow);
		color: var(--scrapbook-green);
		font-family: Chewy, cursive;
		font-weight: 400;
		transform: rotate(-2deg);
	}
	.presentation-hero-copy > p:not(.hero-kicker) {
		max-width: 58ch;
		margin: 0;
		color: #344960;
		font-size: clamp(14px, 1.15cqw, 18px);
	}
	.presentation-hero-actions .button {
		min-height: 48px;
		padding-inline: var(--space-5);
		box-shadow: var(--shadow);
	}
	.presentation-hero-points {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: var(--space-4) 0 0;
		padding: 0;
		color: #36584e;
		font-size: 11px;
		font-weight: 800;
		list-style: none;
	}
	.presentation-hero-points li::before {
		margin-right: 6px;
		color: var(--mint);
		content: '✦';
	}
	.presentation-hero-art img {
		position: absolute;
		z-index: 2;
		inset: 50% -2% auto auto;
		width: min(100%, 720px);
		height: auto;
		object-fit: contain;
		filter: drop-shadow(0 14px 11px #08152f1c);
		transform: translateY(-48%) rotate(1deg);
	}
	.presentation-art-note {
		position: absolute;
		z-index: 4;
		box-shadow: var(--shadow-hover);
		color: var(--ink);
		font-family: Chewy, cursive;
		line-height: 1.2;
	}
	.presentation-art-caption {
		position: absolute;
		z-index: 4;
		box-shadow: var(--shadow-hover);
		color: var(--ink);
		font-family: Chewy, cursive;
		line-height: 1.2;
	}
	.presentation-art-note {
		top: 3%;
		right: 3%;
		padding: var(--space-2) var(--space-3);
		background: #fffdf3;
		font-size: clamp(12px, 1.2cqw, 19px);
		transform: rotate(7deg);
	}
	.presentation-art-caption {
		right: 0;
		bottom: 0;
		padding: var(--space-3) var(--space-4);
		background: var(--blush);
		font-size: clamp(12px, 1.35cqw, 21px);
		transform: rotate(-6deg);
	}
	.presentation-art-tape {
		position: absolute;
		z-index: 3;
		top: 1%;
		left: 39%;
		width: 18%;
		height: 28px;
		background: repeating-linear-gradient(90deg, #00875e5c 0 7px, transparent 7px 14px), #e8f4d9cc;
		transform: rotate(-8deg);
	}
	.presentation-library-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--line);
		border-radius: 28px;
		background: var(--surface);
	}
	.presentation-library-controls h2 {
		margin: var(--space-1) 0 0;
		font-size: clamp(21px, 2cqw, 28px);
	}
	.presentation-library-controls > div > p:not(.presentation-library-eyebrow) {
		margin: var(--space-1) 0 0;
		color: var(--muted);
		font-size: 13px;
	}
	.presentation-library-search {
		display: flex;
		min-height: 46px;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-4);
		border: 1px solid #e0e8ef;
		border-radius: 999px;
		background: #f4f6f9;
		color: var(--muted);
	}
	.presentation-library-search:focus-within {
		border-color: var(--mint);
		box-shadow: 0 0 0 3px #08b8791f;
	}
	.presentation-library-search input {
		width: min(22vw, 250px);
		min-width: 160px;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ink);
		font-size: 13px;
	}
	.presentation-library-state {
		display: grid;
		min-height: 300px;
		place-content: center;
		justify-items: center;
		gap: var(--space-3);
		padding: var(--space-7);
		border-style: dashed;
		border-color: #a9d8c5;
		background: radial-gradient(ellipse at bottom, #eaf8ef, #fff 72%);
		text-align: center;
	}
	.presentation-library-state h2 {
		margin: 0;
	}
	.presentation-library-state p {
		margin: 0;
	}
	.presentation-library-state p {
		max-width: 58ch;
		color: var(--muted);
	}
	.presentation-library-alert {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
	}
	.presentation-library-empty {
		display: grid;
		grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr);
		min-height: 410px;
		overflow: hidden;
		border: 1px solid #e4ebe3;
		border-radius: var(--radius);
		background: var(--surface-warm);
	}
	.presentation-empty-art {
		position: relative;
		min-height: 410px;
		overflow: hidden;
		background: #dff2e9;
		isolation: isolate;
	}
	.presentation-empty-art::before {
		position: absolute;
		top: -115px;
		left: -100px;
		width: 350px;
		height: 350px;
		border: 1px solid #b5decf;
		border-radius: 50%;
		box-shadow:
			0 0 0 65px #ffffff35,
			0 0 0 130px #ffffff25;
		content: '';
	}
	.presentation-empty-slide {
		position: absolute;
		top: 15%;
		left: 11%;
		display: flex;
		width: 73%;
		aspect-ratio: 16 / 10;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 20px;
		padding: clamp(20px, 3.2cqw, 48px);
		border: 9px solid white;
		background: #fff3cd;
		box-shadow: 0 20px 32px #245c4830;
		transform: rotate(-7deg);
	}
	.presentation-empty-slide-label {
		color: var(--scrapbook-green);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.13em;
	}
	.presentation-empty-slide-title {
		color: var(--ink);
		font:
			400 clamp(23px, 3.25cqw, 48px)/0.98 Chewy,
			cursive;
	}
	.presentation-empty-slide-line {
		width: 38%;
		height: 8px;
		background: var(--mint);
		transform: rotate(-3deg);
	}
	.presentation-empty-cat {
		position: absolute;
		z-index: 2;
		right: 2%;
		bottom: -16%;
		width: min(52%, 285px);
		height: auto;
		filter: drop-shadow(0 12px 10px #245c4826);
		transform: rotate(8deg);
	}
	.presentation-empty-tape {
		position: absolute;
		z-index: 3;
		top: 9%;
		left: 34%;
		width: 85px;
		height: 26px;
		background: #f4a9b4c9;
		transform: rotate(-5deg);
	}
	.presentation-empty-spark {
		position: absolute;
		top: 12%;
		right: 8%;
		color: #db9f00;
		font-size: 46px;
		line-height: 1;
	}
	.presentation-empty-copy {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		padding: clamp(32px, 5cqw, 76px);
	}
	.presentation-empty-copy h2 {
		margin: 18px 0 14px;
		color: var(--ink);
		font:
			700 clamp(32px, 3.7cqw, 52px)/1.04 Fredoka,
			sans-serif;
		letter-spacing: -0.045em;
		text-wrap: balance;
	}
	.presentation-empty-kicker {
		margin: 0;
		color: var(--scrapbook-green);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.presentation-empty-description {
		max-width: 35ch;
		margin: 0 0 25px;
		color: #43576c;
		font-size: clamp(15px, 1.35cqw, 18px);
		line-height: 1.6;
	}
	.presentation-empty-copy .button {
		min-height: 50px;
		padding-inline: 22px;
	}
	.presentation-empty-restore {
		max-width: 42ch;
		margin: 24px 0 0;
		color: var(--muted);
		font-size: 12px;
		line-height: 1.55;
	}
	.presentation-empty-restore strong {
		color: var(--scrapbook-green);
	}
	:global(.presentation-library-no-results > svg) {
		width: 58px;
		height: 58px;
		padding: 14px;
		border-radius: 18px;
		background: var(--pale);
		color: var(--scrapbook-green);
		transform: rotate(-7deg);
	}
	.presentation-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 245px), 1fr));
		gap: var(--space-5);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.presentation-grid li {
		min-width: 0;
	}
	.presentation-card {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
		color: var(--ink);
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
	}
	.presentation-card:hover {
		border-color: #9ddaca;
		box-shadow: var(--shadow-hover);
		transform: translateY(-3px);
	}
	.presentation-card-preview {
		position: relative;
		display: grid;
		aspect-ratio: 16 / 9;
		place-items: center;
		overflow: hidden;
		padding: var(--space-5);
		border-radius: var(--radius-sm);
		background: linear-gradient(145deg, #d9f4e9, #fff0b9);
	}
	.presentation-grid li:nth-child(3n + 2) .presentation-card-preview {
		background: linear-gradient(145deg, #e9defa, #ffdbe9);
	}
	.presentation-grid li:nth-child(3n) .presentation-card-preview {
		background: linear-gradient(145deg, #d9eeff, #f7e4ba);
	}
	.presentation-card-preview::before {
		position: absolute;
		top: 8%;
		right: 7%;
		width: 28%;
		height: 16px;
		background: #f4a9b4a3;
		box-shadow: var(--shadow);
		transform: rotate(8deg);
		content: '';
	}
	.presentation-card-paper {
		position: relative;
		display: grid;
		z-index: 1;
		width: 74%;
		height: 68%;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		overflow: hidden;
		padding: var(--space-3);
		border: 6px solid #fff;
		background: #fffdf5;
		box-shadow: var(--shadow-hover);
		color: var(--scrapbook-green);
		text-align: center;
		transform: rotate(-3deg);
	}
	.presentation-card-paper::after {
		position: absolute;
		right: -8%;
		bottom: -30%;
		width: 52%;
		height: 58%;
		border-radius: 50%;
		background: var(--mint);
		opacity: 0.18;
		content: '';
	}
	.presentation-card-paper b {
		position: relative;
		z-index: 1;
		display: -webkit-box;
		max-width: 100%;
		overflow: hidden;
		font:
			400 17px/1.05 Chewy,
			cursive;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		line-clamp: 2;
		-webkit-line-clamp: 2;
	}
	.presentation-card-paper em {
		width: 54%;
		height: 7px;
		background: var(--scrapbook-yellow);
		transform: rotate(-4deg);
	}
	.presentation-card-preview > i {
		position: absolute;
		z-index: 3;
		right: var(--space-2);
		bottom: var(--space-2);
		padding: 4px 8px;
		border-radius: 999px;
		background: #ffffffdc;
		color: var(--muted);
		font-size: 9px;
		font-style: normal;
		font-weight: 800;
		letter-spacing: 0.05em;
	}
	.presentation-card-link {
		display: block;
		border-radius: var(--radius-sm);
		color: inherit;
		text-decoration: none;
	}
	/* Always visible, never hover-only, and big enough to tap at 390px. */
	.presentation-card-actions .button.icon {
		width: 44px;
		min-height: 44px;
	}
	.presentation-card-title strong {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	:global(.presentation-card-title svg) {
		color: var(--scrapbook-green);
		transition: transform 160ms ease;
	}
	.presentation-card:hover :global(.presentation-card-title svg) {
		transform: translateX(3px);
	}
	.presentation-card-body small {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--muted);
	}
	.presentation-card-body small:last-child {
		color: #007b55;
		font-weight: 800;
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
	@media (max-width: 1150px) {
		.presentations-hero {
			grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
			min-height: 340px;
			padding: var(--space-6);
		}
		.presentations-hero h1 {
			font-size: clamp(2.2rem, 5cqw, 3.7rem);
		}
		.presentation-hero-art {
			min-height: 270px;
		}
		.presentation-library-controls {
			align-items: flex-start;
		}
		.presentation-library-tools {
			align-items: flex-end;
			flex-direction: column;
		}
	}
	@media (max-width: 720px) {
		.presentations-library {
			gap: var(--space-5);
		}
		.presentations-hero {
			grid-template-columns: 1fr;
			gap: var(--space-3);
			min-height: 0;
			padding: var(--space-5);
			background-size: auto 100%;
		}
		.presentations-hero::before {
			right: -22%;
			bottom: -12%;
			width: 112%;
			height: 48%;
		}
		.presentations-hero::after {
			top: -8%;
			right: -22%;
			width: 70%;
			height: 40%;
		}
		.presentations-hero h1 {
			font-size: clamp(2.25rem, 12cqw, 3.2rem);
		}
		.presentation-hero-copy > p:not(.hero-kicker) {
			font-size: 14px;
		}
		.presentation-hero-actions .button {
			flex: 1 1 100%;
			justify-content: center;
			width: 100%;
		}
		.presentation-hero-points {
			gap: var(--space-2) var(--space-3);
			font-size: 10px;
		}
		.presentation-hero-art {
			width: 100%;
			min-height: 220px;
		}
		.presentation-hero-art img {
			right: -7%;
			width: 112%;
		}
		.presentation-art-note {
			top: 0;
			right: 0;
		}
		.presentation-art-caption {
			right: -2%;
			bottom: 0;
			padding: var(--space-2) var(--space-3);
			font-size: 12px;
		}
		.presentation-art-tape {
			left: 38%;
			height: 18px;
		}
		.presentation-library-controls {
			align-items: stretch;
			flex-direction: column;
			gap: var(--space-4);
			padding: var(--space-4);
			border-radius: var(--radius);
		}
		.presentation-library-tools {
			align-items: stretch;
			flex-direction: column;
			gap: var(--space-3);
		}
		.presentation-library-search {
			width: 100%;
		}
		.presentation-library-search input {
			width: 100%;
			min-width: 0;
		}
		.presentation-device-note {
			margin: 0;
			white-space: normal;
		}
		.presentation-library-state {
			min-height: 240px;
			padding: var(--space-5);
		}
		.presentation-library-empty {
			grid-template-columns: 1fr;
		}
		.presentation-empty-art {
			min-height: 250px;
		}
		.presentation-empty-slide {
			top: 12%;
			left: 10%;
			width: min(68%, 320px);
			gap: 10px;
			padding: 22px;
			border-width: 6px;
		}
		.presentation-empty-slide-title {
			font-size: clamp(24px, 7cqw, 36px);
		}
		.presentation-empty-cat {
			right: 10%;
			bottom: -22%;
			width: min(40%, 170px);
		}
		.presentation-empty-copy {
			padding: 32px 26px 36px;
		}
		.presentation-empty-copy h2 {
			margin: 14px 0 10px;
		}
		.presentation-empty-description {
			margin-bottom: 22px;
		}
		.presentation-empty-restore {
			margin-top: 20px;
		}
		.presentation-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
