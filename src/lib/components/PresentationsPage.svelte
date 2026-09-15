<script>
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
			<div class="presentation-hero-copy">
				<p class="hero-kicker"><Presentation size={15} /> YOUR IDEAS, ON THE BIG SCREEN</p>
				<h1>Tell your story.<br /><em>Make it stick.</em></h1>
				<p>
					Turn a blank 16:9 slide into something clear, colorful, and completely yours. Your work
					stays private in this browser.
				</p>
				<div class="presentation-hero-actions">
					<button class="button primary" onclick={createBlank} disabled={creatingBlank}
						><FilePlus2 size={18} />{creatingBlank
							? 'Creating…'
							: 'Start a blank presentation'}</button
					>
					{#if items[0]}<a class="button" href={openhref(items[0].id)}
							>Open latest <ArrowRight size={16} /></a
						>{/if}
				</div>
				<ul class="presentation-hero-points" aria-label="Presentation features">
					<li>16:9 slide canvas</li>
					<li>Saved on your device</li>
					<li>No account needed</li>
				</ul>
			</div>
			<div class="presentation-hero-art" aria-hidden="true">
				<span class="presentation-art-note">big idea energy ✦</span>
				<img src={asset('/art/presentation-cat-hero.webp')} alt="" width="1200" height="744" />
				<span class="presentation-art-tape"></span><span class="presentation-art-caption"
					>Made to explain.<br />Styled to remember.</span
				>
			</div>
		</section>

		<div class="presentation-library-controls">
			<div>
				<p class="presentation-library-eyebrow"><Sparkles size={15} /> YOUR CREATIVE DESK</p>
				<h2>Your presentations</h2>
				<p>
					{items.length === 0
						? 'Start fresh with a blank page.'
						: `${items.length} saved ${items.length === 1 ? 'presentation' : 'presentations'} in this browser`}
				</p>
			</div>
			<div class="presentation-library-tools">
				<label class="presentation-library-search"
					><Search size={17} aria-hidden="true" /><span class="sr-only">Search presentations</span
					><input
						id="presentation-library-search"
						type="search"
						bind:value={query}
						placeholder="Search your presentations…"
					/></label
				>
				<p class="presentation-device-note">
					<MonitorUp size={16} /> Best edited on a larger screen
				</p>
				<label class="button" aria-disabled={restoring}>
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
					<button class="button" onclick={load}>Try again</button>
				</div>
			</section>
		{:else if loading}
			<section class="card presentation-library-state">
				<p role="status">Loading local presentations…</p>
			</section>
		{:else if items.length === 0}
			<section class="card presentation-library-state presentation-library-empty">
				<div class="presentation-empty-art" aria-hidden="true">
					<span class="presentation-empty-slide"><i></i><b>YOUR<br />STORY</b><i></i></span><span
						class="presentation-empty-spark">✦</span
					>
				</div>
				<div class="presentation-empty-copy">
					<p class="presentation-empty-kicker">A fresh canvas is waiting</p>
					<h2>No presentations yet</h2>
					<p>
						Create a blank presentation and shape it one idea at a time. Templates arrive in a later
						increment; use <strong>Restore backup</strong> to bring back a downloaded .stickerlab.zip.
					</p>
					<button class="button primary" onclick={createBlank} disabled={creatingBlank}
						><FilePlus2 size={18} />{creatingBlank
							? 'Creating…'
							: 'Create your first presentation'}</button
					>
				</div>
			</section>
		{:else if visibleItems.length === 0}
			<section class="card presentation-library-state presentation-library-no-results">
				<Search size={32} aria-hidden="true" />
				<h2>No presentation found</h2>
				<p>Nothing matches “{query.trim()}”. Try another title or clear the search.</p>
				<button class="button" onclick={() => (query = '')}>Clear search</button>
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
								<span class="presentation-card-body"
									><span class="presentation-card-title"
										><strong title={item.title}>{item.title}</strong><ArrowRight size={17} /></span
									><small><Clock3 size={13} /> Updated {formattedDate(item.updatedAt)}</small><small
										>{item.slideCount} {item.slideCount === 1 ? 'slide' : 'slides'} · Local</small
									></span
								>
							</a>
							<div class="presentation-card-actions">
								<button
									class="button icon"
									aria-label={`Rename ${item.title}`}
									disabled={busyId === item.id}
									onclick={(event) => openRename(item, event.currentTarget)}
									><Pencil size={16} /></button
								>
								<button
									class="button icon"
									aria-label={`Duplicate ${item.title}`}
									disabled={busyId === item.id}
									onclick={() => duplicate(item)}><Copy size={16} /></button
								>
								<button
									class="button icon"
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
				<div class="dialog-field">
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
					class="button"
					type="button"
					onclick={() => {
						renaming = null;
						renameError = null;
					}}>Keep the current name</button
				><button
					class="button primary"
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
					class="button"
					type="button"
					onclick={() => (pendingDelete = null)}>Keep presentation</button
				><button
					class="button danger"
					disabled={busyId === pendingDelete?.id}
					onclick={confirmDelete}>Delete presentation</button
				>{/snippet}
		</Modal>
	</div>
</AppShell>
