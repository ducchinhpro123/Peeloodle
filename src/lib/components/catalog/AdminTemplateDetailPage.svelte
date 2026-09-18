<script>
	import { ImagePlus, Pencil, Presentation, ShieldAlert } from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { button, buttonPrimary } from '$lib/ui/styles.js';
	import { isCatalogError } from '$lib/catalog/repository';
	import { createTemplateDraftRepository } from '$lib/presentations/templates/templateDraftRepository';
	import {
		generateTemplatePreviews,
		TemplatePreviewError
	} from '$lib/presentations/templates/templatePreviews';
	import { prepareExportSnapshot } from '$lib/presentations/exports/snapshot';

	/**
	 * Admin template detail (P66/P67): the stable metadata, the immutable version
	 * facts, metadata editing through the compare-and-set RPC, the shared editor
	 * in template mode, and preview generation from the exact pending draft.
	 * Publication/archive validation (P68) extends this screen; nothing here
	 * claims it exists yet.
	 *
	 * @type {{
	 *   templateId: string,
	 *   repository: import('$lib/catalog/repository').CatalogAdminRepository,
	 *   listHref: string,
	 *   editHref: string
	 * }}
	 */
	let { templateId, repository, listHref, editHref } = $props();

	const USE_CASES = ['class', 'research-defense', 'club-pitch'];

	/** @type {import('$lib/catalog/types').CatalogTemplate | null} */
	let template = $state.raw(null);
	/** @type {import('$lib/catalog/types').CatalogTemplateVersionSummary[]} */
	let versions = $state.raw([]);
	/** @type {'loading' | 'ready' | 'missing' | 'error'} */
	let status = $state('loading');
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let notice = $state(null);
	let attempt = $state(0);

	let editorOpen = $state(false);
	let formBusy = $state(false);
	/** @type {string | null} */
	let formError = $state(null);
	let form = $state({ title: '', useCase: 'class', description: '', tags: '', sortOrder: 0 });
	/** @type {import('$lib/catalog/types').CatalogTemplate | null} */
	let conflict = $state.raw(null);

	// ---- P67 preview generation ----
	const draftRepository = $derived(
		repository ? createTemplateDraftRepository({ catalog: repository, templateId }) : null
	);
	/** The newest immutable version; previews always bind to it. */
	const newestVersion = $derived(versions[0] ?? null);
	let previewOpen = $state(false);
	let previewLoading = $state(false);
	let previewBusy = $state(false);
	/** @type {string | null} */
	let previewError = $state(null);
	/** @type {string | null} */
	let previewNotice = $state(null);
	/** @type {string | null} */
	let previewStage = $state(null);
	let previewCover = $state(0);
	/** @type {{ ordinal: number, name: string }[]} */
	let previewSlides = $state.raw([]);
	/** @type {string | null} */
	let previewUrl = $state.raw(null);

	// The cover thumbnail is a short-lived signed URL of the admin-readable
	// derivative; drafts are not public, so it needs the admin session.
	$effect(() => {
		const coverPath = newestVersion?.coverPath ?? null;
		if (!coverPath) {
			previewUrl = null;
			return;
		}
		let live = true;
		void repository
			.signedDerivativeUrl(coverPath, 120)
			.then((url) => {
				if (live) previewUrl = url;
			})
			.catch(() => {
				if (live) previewUrl = null;
			});
		return () => {
			live = false;
		};
	});

	async function openPreviewDialog() {
		previewOpen = true;
		previewError = null;
		previewCover = 0;
		previewSlides = [];
		if (!draftRepository) {
			previewError = 'The catalog is not available.';
			return;
		}
		previewLoading = true;
		try {
			const head = await draftRepository.getDraftHead();
			previewSlides = head.document.slides.map((slide, ordinal) => ({
				ordinal,
				name: slide.name.trim() || `Slide ${ordinal + 1}`
			}));
		} catch (cause) {
			previewError = cause instanceof Error ? cause.message : 'The draft could not be read.';
		} finally {
			previewLoading = false;
		}
	}

	async function confirmPreviews() {
		if (!draftRepository || previewBusy) return;
		previewBusy = true;
		previewError = null;
		previewNotice = null;
		previewStage = 'Preparing the draft…';
		/** @type {Awaited<ReturnType<typeof prepareExportSnapshot>> | null} */
		let snapshot = null;
		try {
			const head = await draftRepository.getDraftHead();
			snapshot = await prepareExportSnapshot(draftRepository, head.document);
			const result = await generateTemplatePreviews({
				templateId,
				versionId: head.version.id,
				expectedRevision: head.template.revision,
				documentSha256: head.version.documentSha256,
				document: snapshot.document,
				images: snapshot.images,
				coverOrdinal: previewCover,
				onProgress: ({ stage, completed, total }) => {
					previewStage =
						stage === 'rendering'
							? `Rendering slide ${completed} of ${total}…`
							: `Uploading preview ${completed} of ${total}…`;
				},
				upload: (path, blob) => repository.uploadDerivative(path, blob, 'image/png'),
				attach: (input) => repository.attachTemplatePreviews(input)
			});
			previewNotice = `Previews attached as version ${result.version.versionNumber}.`;
			previewOpen = false;
			attempt += 1;
		} catch (cause) {
			previewError =
				cause instanceof TemplatePreviewError || cause instanceof Error
					? cause.message
					: 'The previews could not be generated.';
		} finally {
			snapshot?.dispose();
			previewBusy = false;
			previewStage = null;
		}
	}

	/** @param {unknown} cause */
	function errorText(cause) {
		if (isCatalogError(cause) && cause.code === 'permission')
			return 'Your account is no longer a catalog administrator.';
		if (cause instanceof Error) return cause.message;
		return 'The request failed. Please retry.';
	}

	$effect(() => {
		// "Try again" bumps the attempt to re-run this read.
		void attempt;
		let live = true;
		status = 'loading';
		error = null;
		void (async () => {
			try {
				const [loadedTemplate, loadedVersions] = await Promise.all([
					repository.getTemplateForAdmin(templateId),
					repository.listTemplateVersionsForAdmin(templateId, { limit: 50 })
				]);
				if (!live) return;
				template = loadedTemplate;
				versions = loadedVersions;
				status = 'ready';
			} catch (cause) {
				if (!live) return;
				if (isCatalogError(cause) && cause.code === 'not_found') status = 'missing';
				else {
					status = 'error';
					error = errorText(cause);
				}
			}
		})();
		return () => {
			live = false;
		};
	});

	/** @param {string} text */
	function tagsFrom(text) {
		return text
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	function openEditor() {
		if (!template) return;
		form = {
			title: template.title,
			useCase: template.useCase,
			description: template.description,
			tags: template.tags.join(', '),
			sortOrder: template.sortOrder
		};
		conflict = null;
		formError = null;
		editorOpen = true;
	}

	async function submitEditor() {
		if (!template) return;
		formBusy = true;
		formError = null;
		try {
			const result = await repository.updateTemplate(template.id, template.revision, {
				title: form.title.trim(),
				useCase: form.useCase,
				description: form.description.trim(),
				tags: tagsFrom(form.tags),
				sortOrder: Number(form.sortOrder) || 0
			});
			if (!result.ok) {
				if (result.reason === 'revision_conflict' && result.detail.item) {
					// Keep the typed values; the next save deliberately replaces the
					// other edit, exactly like the collections console.
					conflict = result.detail.item;
					template = result.detail.item;
					formError = `Another change made this revision ${result.detail.item.revision}. Saving again replaces it; your current values are kept here.`;
					return;
				}
				formError =
					result.reason === 'archived'
						? 'This template is archived and cannot be changed.'
						: 'The template could not be saved.';
				return;
			}
			template = result.item;
			notice = `Saved “${result.item.title}”.`;
			editorOpen = false;
		} catch (cause) {
			formError = errorText(cause);
		} finally {
			formBusy = false;
		}
	}

	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
	/** @param {string} value */
	function date(value) {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
	}

	/** @param {number} value */
	function bytes(value) {
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
		return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	}

	/** @param {string} value */
	function hashPrefix(value) {
		return `${value.slice(0, 12)}…`;
	}
</script>

<svelte:head
	><title>{template ? `${template.title} — StickerLab admin` : 'Template — StickerLab admin'}</title
	></svelte:head
>

{#if status === 'loading'}
	<p role="status">Loading template…</p>
{:else if status === 'missing'}
	<section class="[display:grid] [max-width:62ch] [justify-items:start] [gap:var(--space-3)]">
		<ShieldAlert size={34} aria-hidden="true" />
		<h1>Template not found</h1>
		<p>It may have been removed or the link may be wrong.</p>
		<a class={buttonPrimary} href={listHref}>Back to templates</a>
	</section>
{:else if status === 'error' || !template}
	<div class="[display:grid] [justify-items:start] [gap:var(--space-3)]">
		<p role="alert">{error}</p>
		<button type="button" class={buttonPrimary} onclick={() => (attempt += 1)}>Try again</button>
	</div>
{:else}
	<div class="admin-template-detail [display:grid] [gap:var(--space-4)]">
		<div class="[display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-3)]">
			<a class={button} href={listHref}
				><Presentation size={16} aria-hidden="true" /> All templates</a
			>
			<span
				class="admin-state [border-radius:999px] [padding:2px_10px] [font-size:11px] [font-weight:800]"
				class:is-draft={template.state === 'draft'}
				class:is-published={template.state === 'published'}
				class:is-archived={template.state === 'archived'}>{template.state}</span
			>
			<span class="[font-size:12px] [color:var(--muted)]">revision {template.revision}</span>
			{#if template.publishedVersionId}
				<span class="[font-size:12px] [color:var(--muted)]">
					published version {versions.find((row) => row.id === template?.publishedVersionId)
						?.versionNumber ?? '—'}
				</span>
			{/if}
		</div>

		<div
			class="[display:grid] [gap:var(--space-3)] [border-radius:var(--radius-sm)] [padding:var(--space-4)] [background:var(--surface)] [border:1px_solid_var(--line)]"
		>
			<div class="[display:flex] [flex-wrap:wrap] [align-items:flex-start] [gap:var(--space-3)]">
				<div class="[min-width:0] [flex:1_1_20rem]">
					<h1 class="[margin:0] [font-size:22px]">{template.title}</h1>
					<p class="[margin:2px_0_0] [font-size:12px] [color:var(--muted)]">
						{template.useCase}
						{#if template.tags.length}· tags: {template.tags.join(', ')}{/if}
						· order {template.sortOrder}
					</p>
					{#if template.description}<p class="[margin:6px_0_0]">{template.description}</p>{/if}
					<p class="[margin:6px_0_0] [font-size:12px] [color:var(--muted)]">
						created {date(template.createdAt)} · updated {date(template.updatedAt)}
					</p>
				</div>
				<div class="[display:flex] [flex-wrap:wrap] [gap:var(--space-2)]">
					{#if template.state !== 'archived'}
						<button type="button" class={button} onclick={openEditor}
							><Pencil size={15} aria-hidden="true" /> Edit metadata</button
						>
					{/if}
					{#if versions.length > 0 && template.state !== 'archived'}
						<a class={buttonPrimary} href={editHref}>Edit draft</a>
					{/if}
				</div>
			</div>
			{#if notice}<p role="status" class="[margin:0] [font-weight:700] [color:#007b55]">
					{notice}
				</p>{/if}
			{#if versions.length === 0}
				<p role="alert" class="[margin:0]">
					This template has no draft version yet, so there is nothing to edit. Create it again with
					“Save as template” from a presentation.
				</p>
			{/if}
			<p class="[margin:0] [font-size:12px] [color:var(--muted)]">
				Slide previews, publication and archive validation arrive with the next steps (P67–P68);
				every save here appends an immutable draft version.
			</p>
		</div>

		<section class="[display:grid] [gap:var(--space-3)]">
			<h2 class="[margin:0] [font-size:16px]">Preview</h2>
			{#if previewNotice}
				<p role="status" class="[margin:0] [font-weight:700] [color:#007b55]">{previewNotice}</p>
			{/if}
			{#if newestVersion?.coverPath}
				<div
					class="[display:flex] [flex-wrap:wrap] [align-items:flex-start] [gap:var(--space-4)] [border-radius:var(--radius-sm)] [padding:var(--space-4)] [background:var(--surface)] [border:1px_solid_var(--line)]"
				>
					{#if previewUrl}
						<img
							class="admin-cover [border-radius:6px] [border:1px_solid_var(--line)]"
							src={previewUrl}
							alt="Current cover preview"
						/>
					{/if}
					<div class="[display:grid] [gap:6px]">
						<p class="[margin:0] [font-weight:700]">
							{newestVersion.slidePreviews.length} slide preview{newestVersion.slidePreviews
								.length === 1
								? ''
								: 's'} from version {newestVersion.versionNumber}
						</p>
						<p class="[margin:0] [font-size:12px] [color:var(--muted)]">
							Cover: slide {newestVersion.slidePreviews.findIndex(
								(preview) => preview.path === newestVersion?.coverPath
							) + 1} · document sha256 {hashPrefix(newestVersion.documentSha256)}
						</p>
						{#if template.state !== 'archived'}
							<button type="button" class={button} onclick={openPreviewDialog}
								><ImagePlus size={15} aria-hidden="true" /> Regenerate previews</button
							>
						{/if}
					</div>
				</div>
			{:else}
				<div
					class="[display:grid] [justify-items:start] [gap:var(--space-3)] [border-radius:var(--radius-sm)] [padding:var(--space-4)] [background:var(--surface)] [border:1px_dashed_#abd3c3]"
				>
					<p class="[margin:0]">
						No previews yet. Generate the cover and slide previews from this exact draft;
						publication requires them (P68).
					</p>
					{#if template.state !== 'archived'}
						<button type="button" class={buttonPrimary} onclick={openPreviewDialog}
							><ImagePlus size={16} aria-hidden="true" /> Generate previews</button
						>
					{/if}
				</div>
			{/if}
		</section>

		<section class="[display:grid] [gap:var(--space-3)]">
			<h2 class="[margin:0] [font-size:16px]">Versions</h2>
			<p class="[margin:0] [font-size:12px] [color:var(--muted)]">
				Newest first. Version rows are immutable; the draft editor appends a new one.
			</p>
			<ul
				class="admin-version-list [margin:0] [display:grid] [gap:var(--space-3)] [padding:0] [list-style:none]"
			>
				{#each versions as version (version.id)}
					<li
						class="[display:grid] [gap:6px] [border-radius:var(--radius-sm)] [padding:var(--space-4)] [background:var(--surface)] [border:1px_solid_var(--line)]"
					>
						<div class="[display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-2)]">
							<strong>Version {version.versionNumber}</strong>
							{#if version.id === template.publishedVersionId}
								<span
									class="[border-radius:999px] [padding:2px_10px] [font-size:11px] [font-weight:800] [color:#00694a] [background:#e3f4ea]"
									>published</span
								>
							{/if}
							<span
								class="admin-state [border-radius:999px] [padding:2px_10px] [font-size:11px] [font-weight:800]"
								class:is-draft={version.validationState === 'pending'}
								class:is-published={version.validationState === 'validated'}
								class:is-archived={version.validationState === 'rejected'}
								>{version.validationState}</span
							>
						</div>
						<p class="[margin:0] [font-size:12px] [color:var(--muted)]">
							created {date(version.createdAt)} · {bytes(version.documentBytes)} · sha256
							{hashPrefix(version.documentSha256)}
						</p>
						<p class="[margin:0] [font-size:12px]">
							Fonts:
							{version.fontRequirements.length
								? version.fontRequirements.map((font) => font.fontId).join(', ')
								: 'none recorded'}
						</p>
						<p class="[margin:0] [font-size:12px]">
							{version.slidePreviews.length} slide preview{version.slidePreviews.length === 1
								? ''
								: 's'}{version.coverPath ? ' · cover set' : ' · no cover yet'}
						</p>
					</li>
				{/each}
			</ul>
		</section>
	</div>
{/if}

<Modal
	open={previewOpen}
	closeDisabled={previewBusy}
	title="Generate slide previews"
	description="Renders every slide from the newest draft with the same fixed-page renderer PDF export uses, uploads the PNGs, and attaches them to one immutable version."
	onclose={() => {
		if (!previewBusy) previewOpen = false;
	}}
>
	<div class="[display:grid] [gap:var(--space-3)]">
		{#if previewLoading}<p role="status">Reading the draft…</p>{/if}
		{#if previewSlides.length > 0}
			<fieldset
				class="[margin:0] [border-radius:var(--radius-sm)] [padding:var(--space-3)] [border:1px_solid_var(--line)]"
			>
				<legend class="[font-size:12px] [font-weight:700]">Cover slide</legend>
				<div class="[display:grid] [gap:var(--space-2)]">
					{#each previewSlides as slide (slide.ordinal)}
						<label
							class="[display:flex] [align-items:center] [gap:var(--space-2)] [font-size:13px]"
						>
							<input
								type="radio"
								name="template-preview-cover"
								value={slide.ordinal}
								bind:group={previewCover}
							/>
							{slide.name}
						</label>
					{/each}
				</div>
			</fieldset>
		{/if}
		{#if previewStage}<p role="status" class="[margin:0]">{previewStage}</p>{/if}
		{#if previewError}<p role="alert" class="[margin:0] [font-weight:700]">{previewError}</p>{/if}
		<div class="[display:flex] [justify-content:flex-end] [gap:var(--space-2)]">
			<button
				type="button"
				class={button}
				disabled={previewBusy}
				onclick={() => (previewOpen = false)}>Cancel</button
			>
			<button
				type="button"
				class={buttonPrimary}
				disabled={previewBusy || previewLoading || previewSlides.length === 0}
				onclick={() => void confirmPreviews()}
				>{previewBusy ? 'Generating…' : 'Generate previews'}</button
			>
		</div>
	</div>
</Modal>

<Modal
	open={editorOpen}
	title="Edit template metadata"
	description="Title, use case, tags and order are stable metadata; saving uses compare-and-set. Draft document content is edited through “Edit draft”."
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
			Title
			<input
				id="catalog-template-title"
				required
				maxlength="200"
				bind:value={form.title}
				class="[min-height:38px] [border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			/>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Use case
			<select
				id="catalog-template-use-case"
				bind:value={form.useCase}
				class="[min-height:38px] [border-radius:var(--radius-sm)] [padding:6px_10px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			>
				{#each USE_CASES as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Description
			<textarea
				id="catalog-template-description"
				rows="3"
				maxlength="10000"
				bind:value={form.description}
				class="[border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			></textarea>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Tags (comma separated)
			<input
				id="catalog-template-tags"
				bind:value={form.tags}
				class="[min-height:38px] [border-radius:var(--radius-sm)] [padding:8px_12px] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
			/>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Order
			<input
				id="catalog-template-order"
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
					if (conflict) openEditor();
				}}>Reload the server version (discards these values)</button
			>
		{/if}
		<div class="[display:flex] [justify-content:flex-end] [gap:var(--space-2)]">
			<button type="button" class={button} onclick={() => (editorOpen = false)}>Cancel</button>
			<button type="submit" class={buttonPrimary} disabled={formBusy}
				>{formBusy ? 'Saving…' : 'Save metadata'}</button
			>
		</div>
	</form>
</Modal>

<style>
	.admin-cover {
		width: 240px;
		max-width: 100%;
		height: auto;
		aspect-ratio: 16 / 9;
		object-fit: cover;
	}
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
</style>
