<script>
	/**
	 * Project card preview. The thumbnail cache owns the object URL, so this
	 * component never revokes it; a failed or pending render falls back to the
	 * source's honest placeholder copy.
	 */
	import { acquireProjectThumbnail } from '$lib/editor/projectThumbnails';

	/** @type {{ project: import('$lib/domain/domain').ProjectDocument, repository: import('$lib/persistence/repository').StickerLabRepository }} */
	let { project, repository } = $props();

	let url = $state(/** @type {string | null} */ (null));
	let failed = $state(false);

	$effect(() => {
		const current = project;
		const repo = repository;
		let live = true;
		void (async () => {
			if (import.meta.env.MODE === 'test') return;
			try {
				const thumbnail = await acquireProjectThumbnail({ repository: repo, project: current });
				if (!live) return;
				if (thumbnail) url = thumbnail;
				else failed = true;
			} catch {
				if (!live) return;
				url = null;
				failed = true;
			}
		})();
		return () => {
			live = false;
		};
	});
</script>

<div class="project-thumb" aria-hidden="true">
	{#if url}
		<img src={url} alt="" />
	{:else}
		<span
			class="project-preview-placeholder [padding:var(--space-2)] [text-align:center] [font-size:12px] [color:var(--muted)]"
			>{project.layers.length === 0
				? 'Blank canvas'
				: failed
					? 'Preview unavailable'
					: 'Loading preview…'}</span
		>
	{/if}
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	:global(.card) {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
	}
</style>
