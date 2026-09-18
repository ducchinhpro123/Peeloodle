<script>
	import { SvelteSet } from 'svelte/reactivity';
	import Modal from '$lib/components/Modal.svelte';
	import { button, buttonPrimary } from '$lib/ui/styles.js';
	import { isCatalogError } from '$lib/catalog/repository';
	import { parsePresentationDocument } from '$lib/presentations/model/parse';

	/**
	 * Layout insertion picker (P71): lists published templates, shows the slides
	 * of the chosen one by name, and hands the picked ordinals to the editor,
	 * which downloads, persists and adopts them as one undoable insertion.
	 *
	 * @type {{
	 *   repository: import('$lib/catalog/repository').CatalogRepository,
	 *   disabled?: boolean,
	 *   oninsert: (templateId: string, slideOrdinals: number[]) => Promise<{ ok: boolean, message?: string }>
	 * }}
	 */
	let { repository, disabled = false, oninsert } = $props();

	let open = $state(false);
	let loading = $state(false);
	let inserting = $state(false);
	/** @type {import('$lib/catalog/types').CatalogTemplate[]} */
	let templates = $state.raw([]);
	/** @type {string} */
	let templateId = $state('');
	/** @type {{ ordinal: number, name: string }[]} */
	let slides = $state.raw([]);
	const selected = new SvelteSet();
	/** @type {string | null} */
	let error = $state(null);
	/** @type {HTMLButtonElement | null} */
	let opener = $state(null);

	const canInsert = $derived(templateId !== '' && selected.size > 0 && !inserting);

	/** @param {unknown} cause */
	function errorText(cause) {
		if (isCatalogError(cause)) return 'The template catalog could not be reached.';
		if (cause instanceof Error) return cause.message;
		return 'The request failed. Please retry.';
	}

	async function openDialog() {
		open = true;
		error = null;
		templateId = '';
		slides = [];
		selected.clear();
		loading = true;
		try {
			const page = await repository.listTemplates({ limit: 100 });
			templates = page.items;
		} catch (cause) {
			templates = [];
			error = errorText(cause);
		} finally {
			loading = false;
		}
	}

	/** @param {string} id */
	async function chooseTemplate(id) {
		templateId = id;
		slides = [];
		selected.clear();
		error = null;
		if (!id) return;
		loading = true;
		try {
			const version = await repository.getTemplateVersion(id);
			const document = parsePresentationDocument(version.document);
			slides = document.slides.map((slide, ordinal) => ({
				ordinal,
				name: slide.name.trim() || `Slide ${ordinal + 1}`
			}));
		} catch (cause) {
			error = errorText(cause);
		} finally {
			loading = false;
		}
	}

	/** @param {number} ordinal */
	function toggleSlide(ordinal) {
		if (selected.has(ordinal)) selected.delete(ordinal);
		else selected.add(ordinal);
	}

	async function submit() {
		if (!canInsert) return;
		inserting = true;
		error = null;
		try {
			const result = await oninsert(templateId, [...selected]);
			if (!result.ok) {
				error = result.message ?? 'The slides could not be inserted.';
				return;
			}
			open = false;
		} finally {
			inserting = false;
		}
	}
</script>

<button
	type="button"
	class={button}
	{disabled}
	bind:this={opener}
	aria-label="Insert template slides"
	onclick={() => void openDialog()}>Insert slides</button
>

<Modal
	{open}
	closeDisabled={inserting}
	title="Insert template slides"
	description="Copies the chosen slides from a published deck template into this presentation, after the active slide. The template is never changed."
	onclose={() => {
		if (!inserting) open = false;
	}}
	onclosed={() => opener?.focus()}
>
	<div class="[display:grid] [gap:var(--space-3)]">
		<label class="[display:grid] [gap:4px] [font-size:12px] [font-weight:700]">
			Template
			<select
				bind:value={templateId}
				onchange={(event) => void chooseTemplate(event.currentTarget.value)}
			>
				<option value="">Choose a template…</option>
				{#each templates as template (template.id)}
					<option value={template.id}>{template.title} ({template.useCase})</option>
				{/each}
			</select>
		</label>

		{#if loading}<p role="status">Loading slides…</p>{/if}
		{#if slides.length > 0}
			<fieldset
				class="[margin:0] [border-radius:var(--radius-sm)] [padding:var(--space-3)] [border:1px_solid_var(--line)]"
			>
				<legend class="[font-size:12px] [font-weight:700]">Slides to insert</legend>
				<div class="[display:grid] [gap:var(--space-2)]">
					{#each slides as slide (slide.ordinal)}
						<label
							class="[display:flex] [align-items:center] [gap:var(--space-2)] [font-size:13px]"
						>
							<input
								type="checkbox"
								checked={selected.has(slide.ordinal)}
								onchange={() => toggleSlide(slide.ordinal)}
							/>
							{slide.ordinal + 1}. {slide.name}
						</label>
					{/each}
				</div>
			</fieldset>
		{/if}
		{#if error}<p role="alert" class="[margin:0] [font-weight:700]">{error}</p>{/if}
		<div class="[display:flex] [justify-content:flex-end] [gap:var(--space-2)]">
			<button type="button" class={button} disabled={inserting} onclick={() => (open = false)}
				>Cancel</button
			>
			<button
				type="button"
				class={buttonPrimary}
				disabled={!canInsert || loading}
				onclick={() => void submit()}>{inserting ? 'Inserting…' : 'Insert slides'}</button
			>
		</div>
	</div>
</Modal>
