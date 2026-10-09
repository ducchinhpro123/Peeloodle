<script>
	import { button } from '#lib/ui/styles.js';
	import Modal from '#lib/components/Modal.svelte';

	/**
	 * Saved-sticker picker for the presentation editor (P33). Lists the real local
	 * sticker projects; choosing one asks the page to snapshot and place it. An
	 * empty or unreadable library says so instead of rendering dead controls.
	 *
	 * @type {{
	 *   repository: import('#lib/persistence/repository.js').StickerLabRepository,
	 *   disabled?: boolean,
	 *   onpick: (projectId: string) => void
	 * }}
	 */
	let { repository, disabled = false, onpick } = $props();

	let open = $state(false);
	/** @type {import('#lib/domain/domain.js').ProjectDocument[] | null} */
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

<button type="button" class={button} bind:this={opener} {disabled} onclick={() => (open = true)}
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
	<ul
		class="presentation-sticker-picker [margin-inline-start:0] [margin-inline-end:0] [margin-block-start:var(--space-4)] [margin-block-end:0] [display:grid] [gap:var(--space-2)] [padding:0] [list-style:none]"
	>
		{#each projects ?? [] as project (project.id)}
			<li>
				<button
					type="button"
					class={button}
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

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
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
	:global(.empty h2) {
		color: var(--ink);
	}
	:global(.empty p) {
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
	.empty {
		min-block-size: 250px;
		margin-block-start: 20px;
	}
	.presentation-sticker-picker .button {
		display: flex;
		inline-size: 100%;
		min-block-size: 40px;
		justify-content: space-between;
		gap: var(--space-3);
		text-align: start;
	}
	.presentation-sticker-picker span {
		color: var(--muted);
		font-size: 11px;
		font-weight: 700;
	}
</style>
