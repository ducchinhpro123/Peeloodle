<script>
	import { Pencil, Presentation, ShieldAlert } from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { button, buttonPrimary } from '$lib/ui/styles.js';
	import { isCatalogError } from '$lib/catalog/repository';

	/**
	 * Admin template detail (P66): the stable metadata, the immutable version
	 * facts, and the two actions that exist here — edit the metadata through the
	 * compare-and-set RPC, and open the newest draft in the shared editor.
	 * Preview generation (P67) and publication/archive validation (P68) extend
	 * this screen; nothing here claims they exist yet.
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
