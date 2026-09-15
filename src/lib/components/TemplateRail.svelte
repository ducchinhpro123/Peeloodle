<script>
	import TemplateCard from './TemplateCard.svelte';
	import { shellHref } from '$lib/app/navigation';
	import {
		instantiateTemplate,
		getFavoriteTemplateIds,
		templateData,
		toggleFavoriteTemplateId
	} from '$lib/editor/templates';
	/** @typedef {import('$lib/domain/domain').Template} Template */

	/**
	 * @type {{
	 *   repository: import('$lib/persistence/repository').StickerLabRepository,
	 *   onopen: (projectId: string) => void,
	 *   title: string,
	 *   items?: Template[],
	 * }}
	 */
	let { repository, onopen, title, items = templateData.slice(0, 4) } = $props();

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
	<div class="section-title">
		<h2>{title}</h2>
		<a href={shellHref('/templates')}>View all</a>
	</div>
	<div class="rail">
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
