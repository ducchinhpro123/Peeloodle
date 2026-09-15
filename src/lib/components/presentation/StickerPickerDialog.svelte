<script>
	import Modal from '$lib/components/Modal.svelte';

	/**
	 * Saved-sticker picker for the presentation editor (P33). Lists the real local
	 * sticker projects; choosing one asks the page to snapshot and place it. An
	 * empty or unreadable library says so instead of rendering dead controls.
	 *
	 * @type {{
	 *   repository: import('$lib/persistence/repository').StickerLabRepository,
	 *   disabled?: boolean,
	 *   onpick: (projectId: string) => void
	 * }}
	 */
	let { repository, disabled = false, onpick } = $props();

	let open = $state(false);
	/** @type {import('$lib/domain/domain').ProjectDocument[] | null} */
	let projects = $state.raw(null);
	let error = $state(false);
	/** @type {HTMLButtonElement | null} */
	let opener = null;

	$effect(() => {
		if (!open) return;
		let live = true;
		projects = null;
		error = false;
		repository
			.listProjects()
			.then((list) => {
				if (live) projects = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
			})
			.catch(() => {
				if (live) error = true;
			});
		return () => {
			live = false;
		};
	});
</script>

<button type="button" class="button" bind:this={opener} {disabled} onclick={() => (open = true)}
	>Add sticker</button
>
<Modal
	{open}
	title="Add a saved sticker"
	description="A snapshot is placed as its own image. Editing or deleting the sticker later does not change it."
	onclose={() => (open = false)}
	onclosed={() => opener?.focus()}
>
	{#if error}<p role="alert">Your saved stickers could not be read.</p>{/if}
	{#if projects === null && !error}<p role="status">Loading stickers…</p>{/if}
	{#if projects?.length === 0}<p>
			No saved stickers yet. Create one in the sticker editor first.
		</p>{/if}
	<ul class="presentation-sticker-picker">
		{#each projects ?? [] as project (project.id)}
			<li>
				<button
					type="button"
					class="button"
					onclick={() => {
						onpick(project.id);
						open = false;
					}}
				>
					{project.title || 'Untitled sticker'}
					<span>{project.layers.length} {project.layers.length === 1 ? 'layer' : 'layers'}</span>
				</button>
			</li>
		{/each}
	</ul>
</Modal>
