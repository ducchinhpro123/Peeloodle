<script>
	import TemplateCard from './TemplateCard.svelte';
	import { shellHref } from '#lib/app/navigation.js';
	import {
		instantiateTemplate,
		getFavoriteTemplateIds,
		templateData,
		toggleFavoriteTemplateId
	} from '#lib/editor/templates.js';
	/** @typedef {import('#lib/domain/domain.js').Template} Template */

	/**
	 * @type {{
	 *   repository: import('#lib/persistence/repository.js').StickerLabRepository,
	 *   onopen: (projectId: string) => void,
	 *   title: string,
	 *   items?: Template[],
	 *   flushTop?: boolean,
	 * }}
	 */
	let { repository, onopen, title, items = templateData.slice(0, 4), flushTop = false } = $props();

	let favorites = $state(getFavoriteTemplateIds());
	let live = true;

	$effect(() => {
		live = true;
		const refresh = () => (favorites = getFavoriteTemplateIds());
		window.addEventListener('stickerlab:favorites', refresh);
		window.addEventListener('storage', refresh);
		return () => {
			live = false;
			window.removeEventListener('stickerlab:favorites', refresh);
			window.removeEventListener('storage', refresh);
		};
	});

	/**
	 * Clones into independent asset ids, saves locally, then opens the copy.
	 * @param {Template} template
	 */
	async function handleUse(template) {
		const { document, assets } = await instantiateTemplate(template);
		if (!live) return;
		await repository.saveProjectWithAssets(document, assets);
		if (live) onopen(document.id);
	}
</script>

<section>
	<div
		class="section-title [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-3)]"
		class:flush-top={flushTop}
	>
		<h2>{title}</h2>
		<a href={shellHref('/templates')}>View all</a>
	</div>
	<div class="rail [max-width:100%] [min-width:0]">
		{#each items as template (template.id)}
			<TemplateCard
				{template}
				isFavorite={favorites.includes(template.id)}
				onToggleFavorite={(id) => (favorites = toggleFavoriteTemplateId(id))}
				onUse={handleUse}
			/>
		{/each}
	</div>
</section>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.section-title {
		margin: var(--space-5) 0 var(--space-4);
	}
	.section-title.flush-top {
		margin-top: 0;
	}
	.section-title h2 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 16px;
	}
	.section-title a {
		color: #008dce;
		font-size: 13px;
		font-weight: 600;
	}
	.rail {
		display: flex;
		gap: var(--space-4);
		padding: 2px 2px var(--space-3);
		overflow: auto;
		scroll-snap-type: x proximity;
		scrollbar-width: thin;
		scrollbar-color: #c4d9cf transparent;
	}
</style>
