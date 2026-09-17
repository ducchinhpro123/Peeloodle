<script>
	import Modal from '$lib/components/Modal.svelte';
	import { button } from '$lib/ui/styles.js';
	import { isCatalogError } from '$lib/catalog/repository';

	/** @type {{
	 * repository: import('$lib/catalog/repository').CatalogAdminRepository,
	 * needsCollection: boolean,
	 * defaultTitle: string,
	 * onsave: (input: {
	 *   metadata: import('$lib/catalog/repository').CatalogTemplateInput,
	 *   collectionId: string | null
	 * }) => Promise<void>
	 * }} */
	let { repository, needsCollection, defaultTitle, onsave } = $props();

	const USE_CASES = ['class', 'research-defense', 'club-pitch'];

	let open = $state(false);
	let loading = $state(false);
	let saving = $state(false);
	/** @type {import('$lib/catalog/types').CatalogCollection[]} */
	let collections = $state.raw([]);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {HTMLButtonElement | null} */
	let opener = null;

	let title = $state('');
	let useCase = $state('class');
	let description = $state('');
	let tags = $state('');
	/** @type {string} */
	let collectionId = $state('');

	const trimmedTitle = $derived(title.trim());
	const canSubmit = $derived(trimmedTitle.length > 0 && (!needsCollection || collectionId !== ''));

	async function loadCollections() {
		loading = true;
		error = null;
		try {
			const page = await repository.listCollectionsForAdmin({ limit: 100 });
			collections = page.items.filter((collection) => collection.state !== 'archived');
		} catch (cause) {
			collections = [];
			error = isCatalogError(cause)
				? 'The collections could not be loaded with this account.'
				: 'The collections could not be reached. Check the connection and try again.';
		} finally {
			loading = false;
		}
	}

	/** Re-opens with the form reset so a second save starts from the defaults. */
	function openDialog() {
		title = `${defaultTitle} template`.slice(0, 200);
		useCase = 'class';
		description = '';
		tags = '';
		collectionId = '';
		error = null;
		open = true;
		void loadCollections();
	}

	function normalizedTags() {
		return tags
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean)
			.slice(0, 50);
	}

	/** @param {SubmitEvent} event */
	async function submit(event) {
		event.preventDefault();
		if (saving || !canSubmit) return;
		saving = true;
		error = null;
		try {
			await onsave({
				metadata: {
					title: trimmedTitle,
					useCase,
					description: description.trim(),
					tags: normalizedTags(),
					sortOrder: 0
				},
				collectionId: needsCollection ? collectionId : null
			});
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The template draft could not be created.';
		} finally {
			saving = false;
		}
	}
</script>

<button type="button" class={button} bind:this={opener} onclick={openDialog}
	>Save as template</button
>

<Modal
	{open}
	closeDisabled={saving}
	title="Save as template"
	description="Copies this presentation into an independent template draft. The presentation here stays unchanged."
	onclose={() => {
		if (!saving) open = false;
	}}
	onclosed={() => opener?.focus()}
>
	<form class="[display:grid] [gap:var(--space-3)]" onsubmit={submit}>
		<label class="[display:grid] [gap:4px] [font-size:12px]">
			Title
			<input type="text" bind:value={title} required maxlength="200" />
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px]">
			Use case
			<select bind:value={useCase}>
				{#each USE_CASES as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px]">
			Description
			<textarea bind:value={description} rows="3"></textarea>
		</label>
		<label class="[display:grid] [gap:4px] [font-size:12px]">
			Tags
			<input type="text" bind:value={tags} placeholder="Comma-separated" />
		</label>
		{#if needsCollection}
			<label class="[display:grid] [gap:4px] [font-size:12px]">
				Collection
				<select bind:value={collectionId} required>
					<option value="" disabled>Choose a collection…</option>
					{#each collections as collection (collection.id)}
						<option value={collection.id}>{collection.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if loading}<p role="status">Loading collections…</p>{/if}
		{#if error}<p role="alert">{error}</p>{/if}
		<div class="[display:flex] [justify-content:flex-end] [gap:var(--space-2)]">
			<button type="button" class={button} disabled={saving} onclick={() => (open = false)}
				>Cancel</button
			>
			<button type="submit" class={button} disabled={saving || !canSubmit}>
				{saving ? 'Saving…' : 'Create template draft'}
			</button>
		</div>
	</form>
</Modal>
