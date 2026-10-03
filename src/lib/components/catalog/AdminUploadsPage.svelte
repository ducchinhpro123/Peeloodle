<script>
	import { Upload, RefreshCw, RotateCcw, X, Check, Trash2 } from 'lucide-svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import { SvelteMap } from 'svelte/reactivity';
	import { isCatalogError } from '#lib/catalog/repository.js';

	/**
	 * Bulk upload queue (P58) with abandoned-upload cleanup (P61).
	 *
	 * The browser uploads each file straight into the private bucket under the path
	 * the batch reserved, then asks the server to validate and derive it. Progress
	 * is per file and comes from the database (`stored`, `stage`, `attempts`), not
	 * from a synthetic byte counter: closing the tab leaves the queued jobs queued,
	 * and reopening this screen reports exactly that.
	 *
	 * At most two processing requests run at a time, one file each, matching the
	 * architecture's initial concurrency limit.
	 *
	 * @type {{
	 *   repository: import('#lib/catalog/repository.js').CatalogAdminRepository,
	 *   onNotice?: (message: string) => void
	 * }}
	 */
	let { repository, onNotice } = $props();

	const MAX_FILES = 100;
	const MAX_PARALLEL = 2;
	const MAX_BYTES = 15 * 1024 * 1024;

	/** @type {import('#lib/catalog/types.js').CatalogUploadStatus | null} */
	let status = $state.raw(null);
	/** @type {{ items: import('#lib/catalog/types.js').CatalogUploadBatchSummary[], nextCursor: string | null }} */
	let batches = $state.raw({ items: [], nextCursor: null });
	/** @type {'loading' | 'ready' | 'error'} */
	let listStatus = $state('loading');
	/** @type {string | null} */
	let listError = $state(null);
	/** @type {string | null} */
	let notice = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	/** @type {File[]} */
	let files = $state.raw([]);
	/** @type {string} */
	let collectionId = $state('');
	/** @type {import('#lib/catalog/types.js').CatalogCollection[]} */
	let collections = $state.raw([]);
	/** @type {SvelteMap<string, string>} */
	const uploadState = new SvelteMap();
	/** @type {string | null} */
	let activeJobId = $state(null);
	let busy = $state(false);
	let running = $state(false);

	/** @type {import('#lib/catalog/types.js').CatalogOrphanMedia | null} */
	let orphans = $state.raw(null);
	let cleanupBusy = $state(false);

	let confirmCancel = $state(false);

	/** @param {unknown} cause */
	function errorText(cause) {
		if (isCatalogError(cause)) {
			if (cause.code === 'permission') return 'Your account is no longer a catalog administrator.';
			if (cause.code === 'unavailable') return cause.message;
		}
		return cause instanceof Error ? cause.message : 'The request failed. Please retry.';
	}

	async function loadBatches() {
		listStatus = 'loading';
		try {
			const page = await repository.listUploadBatches();
			batches = page;
			listStatus = 'ready';
			const recent = page.items[0];
			if (recent && !status) await openBatch(recent.id);
		} catch (cause) {
			listStatus = 'error';
			listError = errorText(cause);
		}
	}

	/** @param {string} batchId */
	async function openBatch(batchId) {
		try {
			status = await repository.uploadStatus(batchId);
			error = null;
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function loadCollections() {
		try {
			const page = await repository.listCollectionsForAdmin({ limit: 100 });
			collections = page.items.filter((collection) => collection.state !== 'archived');
		} catch {
			collections = [];
		}
	}

	$effect(() => {
		void loadBatches();
		void loadCollections();
	});

	/** @param {Event} event */
	function pickFiles(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		files = Array.from(input.files ?? []).slice(0, MAX_FILES);
		error = null;
	}

	function removeFile(/** @type {number} */ index) {
		files = files.filter((_, position) => position !== index);
	}

	/** Files the batch can accept right now, before any request is sent. */
	const fileProblem = $derived.by(() => {
		if (files.length === 0) return 'Choose at least one image';
		if (files.length > MAX_FILES) return `At most ${MAX_FILES} files per batch`;
		for (const file of files) {
			if (!/(image\/png|image\/webp|image\/svg\+xml|image\/jpeg)/.test(file.type))
				return `${file.name} is not a PNG, static WebP or SVG`;
			if (file.size > MAX_BYTES) return `${file.name} is larger than 15 MB`;
			if (file.size === 0) return `${file.name} is empty`;
		}
		return null;
	});

	async function startBatch() {
		if (fileProblem) return;
		busy = true;
		error = null;
		notice = null;
		try {
			const created = await repository.createUploadBatch({
				collectionId: collectionId || null,
				files: files.map((file) => ({
					name: file.name,
					mime: file.type || 'image/png',
					bytes: file.size
				}))
			});
			if (!created.ok) {
				error =
					created.reason === 'too_many_files'
						? `At most ${MAX_FILES} files per batch`
						: `The batch was refused (${created.reason})`;
				return;
			}
			status = created.item;
			uploadState.clear();
			const selected = files;
			files = [];
			await uploadSources(created.item, selected);
			await loadBatches();
			await processQueue();
		} catch (cause) {
			error = errorText(cause);
		} finally {
			busy = false;
		}
	}

	/**
	 * Uploads the source objects for a fresh batch in file order. A failure stops
	 * at that file: later files are left untouched so a retry does not restart the
	 * uploads that already succeeded.
	 *
	 * @param {import('#lib/catalog/types.js').CatalogUploadStatus} batchStatus
	 * @param {File[]} selected
	 */
	async function uploadSources(batchStatus, selected) {
		for (const job of batchStatus.jobs) {
			const file = selected[job.position];
			if (!file) continue;
			uploadState.set(job.id, 'uploading');
			activeJobId = job.id;
			try {
				await repository.uploadSource(job.sourcePath, file, job.claimedMime);
				uploadState.set(job.id, 'stored');
			} catch (cause) {
				uploadState.set(job.id, 'failed');
				error = `${file.name} could not be uploaded: ${errorText(cause)}`;
				break;
			}
		}
		activeJobId = null;
	}

	/** Runs up to MAX_PARALLEL validation requests for whatever is queued. */
	async function processQueue() {
		if (!status || running) return;
		const batchId = status.batch.id;
		running = true;
		try {
			for (;;) {
				const fresh = await repository.uploadStatus(batchId);
				status = fresh;
				const queued = fresh.jobs.filter((job) => job.stage === 'queued' && job.stored);
				if (queued.length === 0) break;
				const slice = queued.slice(0, MAX_PARALLEL);
				const outcomes = await Promise.all(
					slice.map(async (job) => {
						activeJobId = job.id;
						try {
							return await repository.processUploadJob(job.id);
						} catch (cause) {
							return {
								status: 'failed',
								jobId: job.id,
								code: 'transport',
								message: errorText(cause)
							};
						} finally {
							activeJobId = null;
						}
					})
				);
				const refused =
					/** @type {import('#lib/catalog/processing/runJob.js').ProcessingOutcome | undefined} */ (
						outcomes.find((outcome) => outcome.status === 'refused')
					);
				if (refused && refused.status === 'refused') {
					error =
						refused.reason === 'none_pending'
							? 'The queue is empty.'
							: `Processing was refused (${refused.reason}).`;
					break;
				}
				// A file that failed keeps its own row and reason, so the loop stops once a
				// whole slice fails to make progress. Whether the batch as a whole is a
				// failure is decided from the refreshed counts below, not from one slice.
				if (outcomes.every((outcome) => outcome.status === 'failed')) break;
			}
			status = await repository.uploadStatus(batchId);
			if (
				status.batch.counts.total > 0 &&
				status.batch.counts.ready === 0 &&
				status.batch.counts.failed + status.batch.counts.cancelled === status.batch.counts.total
			) {
				error = 'No file in this batch could be validated; each row shows why.';
			}
			// The batch list carries its own counts, so it is refreshed too: a stale
			// "0 ready" next to a finished queue would be dishonest.
			await loadBatches();
		} catch (cause) {
			error = errorText(cause);
		} finally {
			running = false;
			activeJobId = null;
		}
	}

	/** @param {string} jobId */
	async function retry(jobId) {
		try {
			const result = await repository.retryUploadJob(jobId);
			if (!result.ok) {
				error =
					result.reason === 'attempts_exhausted'
						? 'This file has used all of its attempts; upload it again as a new batch.'
						: `The retry was refused (${result.reason})`;
				return;
			}
			await openBatch(result.item.batchId);
			await processQueue();
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function cancelBatch() {
		if (!status) return;
		try {
			const result = await repository.cancelUploadBatch(status.batch.id);
			if (!result.ok) {
				error = `The batch could not be cancelled (${result.reason})`;
				return;
			}
			status = result.item;
			confirmCancel = false;
			await loadBatches();
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function closeBatch() {
		if (!status) return;
		try {
			const result = await repository.closeUploadBatch(status.batch.id);
			if (!result.ok) {
				error = `The batch could not be closed (${result.reason})`;
				return;
			}
			await openBatch(status.batch.id);
			await loadBatches();
		} catch (cause) {
			error = errorText(cause);
		}
	}

	/** Refresh from the database, then validate whatever is queued. */
	async function refreshAndProcess() {
		if (!status) return;
		await openBatch(status.batch.id);
		await processQueue();
	}

	async function findOrphans() {
		if (!status) return;
		cleanupBusy = true;
		try {
			orphans = await repository.listOrphanMedia(status.batch.id);
		} catch (cause) {
			error = errorText(cause);
		} finally {
			cleanupBusy = false;
		}
	}

	async function removeOrphans() {
		if (!status || !orphans) return;
		cleanupBusy = true;
		const batchId = status.batch.id;
		try {
			const sources = orphans.sources.map((object) => object.path);
			const derivatives = orphans.derivatives.map((object) => object.path);
			const paths = [...sources, ...derivatives];
			if (sources.length > 0) await repository.removeObjects('catalog-sources', sources);
			if (derivatives.length > 0)
				await repository.removeObjects('catalog-derivatives', derivatives);
			const removed = await repository.recordUploadCleanup(batchId, paths);
			orphans = null;
			notice = `Removed ${removed} abandoned object${removed === 1 ? '' : 's'}.`;
			onNotice?.(notice);
			await openBatch(batchId);
		} catch (cause) {
			error = errorText(cause);
		} finally {
			cleanupBusy = false;
		}
	}

	/** @param {import('#lib/catalog/types.js').CatalogUploadJobStatus} job */
	function jobLabel(job) {
		const local = uploadState.get(job.id);
		if (job.stage === 'ready') return 'Ready to review';
		if (job.stage === 'failed') return 'Failed';
		if (job.stage === 'cancelled') return 'Cancelled';
		if (job.stage === 'claimed') return 'Validating…';
		if (local === 'uploading') return 'Uploading…';
		if (local === 'stored' || job.stored) return 'Queued for validation';
		return 'Waiting for upload';
	}

	function formatBytes(/** @type {number} */ bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<section class="uploads [display:grid] [gap:var(--space-4)]">
	{#if notice}
		<p class="[margin:0] [font-size:13px] [color:var(--ink)]" role="status">{notice}</p>
	{/if}
	{#if error}
		<p
			class="[margin:0] [border-radius:var(--radius-sm)] [padding:8px_10px] [font-size:13px] [color:#8d1d3f] [background:#fdecef]"
			role="alert"
		>
			{error}
		</p>
	{/if}

	<div
		class="[display:grid] [gap:var(--space-3)] [border-radius:var(--radius)] [padding:var(--space-4)] [border:1px_solid_var(--line)]"
	>
		<h2 class="[margin:0] [font-size:16px]">New batch</h2>
		<p class="[margin:0] [font-size:13px] [color:var(--muted)]">
			Up to {MAX_FILES} PNG, static WebP or SVG files, 15 MB each. Files upload straight into the private
			bucket; validation happens on the server and a file that fails is reported per file.
		</p>
		<div class="[display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)]">
			<label class="[display:grid] [min-width:0] [gap:4px] [font-size:13px]">
				Collection
				<select
					bind:value={collectionId}
					class="[max-width:100%] [min-width:0] [border-radius:var(--radius-sm)] [padding:8px]"
				>
					<option value="">Ungrouped</option>
					{#each collections as collection (collection.id)}
						<option value={collection.id}>{collection.name}</option>
					{/each}
				</select>
			</label>
			<label class="[display:grid] [gap:4px] [font-size:13px]">
				Files
				<input
					type="file"
					multiple
					accept="image/png,image/webp,image/svg+xml"
					onchange={pickFiles}
				/>
			</label>
		</div>
		{#if files.length > 0}
			<ul class="[margin:0] [display:grid] [gap:4px] [padding:0] [list-style:none]">
				{#each files as file, index (file.name + index)}
					<li class="[display:flex] [align-items:center] [gap:var(--space-2)] [font-size:13px]">
						<span class="[flex:1]">{file.name}</span>
						<span class="[color:var(--muted)]">{formatBytes(file.size)}</span>
						<button
							type="button"
							class={button}
							aria-label={`Remove ${file.name}`}
							onclick={() => removeFile(index)}
						>
							<X size={14} />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="[display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-2)]">
			<button
				type="button"
				class={buttonPrimary}
				disabled={busy || !!fileProblem}
				onclick={startBatch}
			>
				<Upload size={16} />Start upload
			</button>
			{#if fileProblem}
				<span class="[font-size:12px] [color:var(--muted)]">{fileProblem}</span>
			{/if}
		</div>
	</div>

	{#if status}
		<div
			class="[display:grid] [gap:var(--space-3)] [border-radius:var(--radius)] [padding:var(--space-4)] [border:1px_solid_var(--line)]"
		>
			<div class="[display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)]">
				<h2 class="[margin:0] [font-size:16px]">
					Batch {status.batch.state === 'open' ? 'in progress' : status.batch.state}
				</h2>
				<span class="[font-size:12px] [color:var(--muted)]">
					{status.batch.counts.total} files · {status.batch.counts.ready} ready ·
					{status.batch.counts.queued} queued · {status.batch.counts.failed} failed
				</span>
				<span class="[flex:1]"></span>
				<button type="button" class={button} disabled={running} onclick={refreshAndProcess}>
					<RefreshCw size={14} />{running ? 'Validating…' : 'Refresh and validate'}
				</button>
				{#if status.batch.state === 'open'}
					<button type="button" class={button} onclick={closeBatch}>Close batch</button>
					<button type="button" class={button} onclick={() => (confirmCancel = true)}>
						Cancel batch
					</button>
				{:else}
					<button type="button" class={button} disabled={cleanupBusy} onclick={findOrphans}>
						<Trash2 size={14} />Check abandoned uploads
					</button>
				{/if}
			</div>

			<ul class="[margin:0] [display:grid] [gap:8px] [padding:0] [list-style:none]">
				{#each status.jobs as job (job.id)}
					<li
						class="job [display:grid] [grid-template-columns:1fr_auto] [align-items:center] [gap:var(--space-3)] [padding-top:8px] [border-top:1px_solid_var(--line)]"
					>
						<div class="[display:grid] [min-width:0] [gap:2px]">
							<span class="[font-size:13px] [font-weight:600] [overflow-wrap:anywhere]"
								>{job.originalName}</span
							>
							<span class="[font-size:12px] [color:var(--muted)]">
								{formatBytes(job.claimedBytes)} · {job.claimedMime} · {jobLabel(job)}
								{#if job.attempts > 0}· attempt {job.attempts}{/if}
							</span>
							{#if job.errorMessage}
								<span class="[font-size:12px] [color:#8d1d3f]"
									>{job.errorCode}: {job.errorMessage}</span
								>
							{/if}
						</div>
						<div class="[display:flex] [align-items:center] [gap:6px]">
							{#if job.stage === 'ready'}
								<Check size={16} aria-hidden="true" />
							{/if}
							{#if job.stage === 'failed' || job.stage === 'cancelled'}
								<button
									type="button"
									class={button}
									onclick={() => retry(job.id)}
									aria-label={`Retry ${job.originalName}`}
								>
									<RotateCcw size={14} />Retry
								</button>
							{/if}
							{#if activeJobId === job.id}
								<span class="[font-size:12px] [color:var(--muted)]">working…</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>

			{#if orphans}
				<div class="[display:grid] [gap:6px] [font-size:13px]">
					<p class="[margin:0]">
						Abandoned objects nothing references: {orphans.sourceTotal} source{orphans.sourceTotal ===
						1
							? ''
							: 's'} and {orphans.derivativeTotal} derivative{orphans.derivativeTotal === 1
							? ''
							: 's'}.
					</p>
					{#if orphans.truncated}
						<p class="[margin:0] [color:var(--muted)]">
							Only the first 200 are shown; remove these and check again.
						</p>
					{/if}
					{#if orphans.sourceTotal + orphans.derivativeTotal === 0}
						<p class="[margin:0] [color:var(--muted)]">Nothing to clean up.</p>
					{:else}
						<button type="button" class={button} disabled={cleanupBusy} onclick={removeOrphans}>
							<Trash2 size={14} />Remove {orphans.sourceTotal + orphans.derivativeTotal} objects
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<div class="[display:grid] [gap:var(--space-2)]">
		<h2 class="[margin:0] [font-size:16px]">Recent batches</h2>
		{#if listStatus === 'loading'}
			<p class="[margin:0] [font-size:13px] [color:var(--muted)]" role="status">Loading batches…</p>
		{:else if listStatus === 'error'}
			<p role="alert" class="[margin:0] [font-size:13px]">{listError}</p>
		{:else if batches.items.length === 0}
			<p class="[margin:0] [font-size:13px] [color:var(--muted)]">No upload batches yet.</p>
		{:else}
			<ul class="[margin:0] [display:grid] [gap:6px] [padding:0] [list-style:none]">
				{#each batches.items as batch (batch.id)}
					<li class="[display:flex] [align-items:center] [gap:var(--space-3)] [font-size:13px]">
						<button type="button" class={button} onclick={() => openBatch(batch.id)}>Open</button>
						<span class="[color:var(--muted)]">
							{batch.state} · {batch.counts.total} files · {batch.counts.ready} ready ·
							{batch.counts.failed} failed · {new Date(batch.createdAt).toLocaleString()}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<Modal
	open={confirmCancel}
	title="Cancel this batch?"
	description="Queued and running files are cancelled. Files that are already ready stay in the catalog."
	onclose={() => (confirmCancel = false)}
>
	<p class="[margin:0] [font-size:13px]">
		Cancelling clears the leases, so a validation that is still running cannot publish a version
		afterwards.
	</p>
	{#snippet footer()}
		<button type="button" class={button} onclick={() => (confirmCancel = false)}
			>Keep uploading</button
		>
		<button type="button" class={buttonPrimary} onclick={cancelBatch}>Cancel batch</button>
	{/snippet}
</Modal>
