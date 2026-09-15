<script>
	import {
		acquirePresentationThumbnail,
		presentationThumbnailKey,
		releasePresentationThumbnail
	} from '$lib/presentations/library/presentationThumbnails';

	/** @type {{
	 *   repository: import('$lib/presentations/persistence/repository').PresentationRepository,
	 *   documentId: string,
	 *   revision: number,
	 *   source?: import('$lib/presentations/library/presentationThumbnails').PresentationThumbnailSource
	 * }} */
	let { repository, documentId, revision, source = undefined } = $props();

	let url = $state(/** @type {string | null} */ (null));

	/** @type {import('svelte/attachments').Attachment<HTMLElement>} */
	const loadWhenVisible = (node) => {
		const key = presentationThumbnailKey(documentId, revision);
		let live = true;
		/** @type {IntersectionObserver | undefined} */
		let observer;

		const load = async () => {
			observer?.disconnect();
			const thumbnail = await acquirePresentationThumbnail(
				{ repository, documentId, revision },
				source
			);
			if (live) url = thumbnail?.url ?? null;
		};

		url = null;
		if (typeof IntersectionObserver === 'undefined') {
			void load();
		} else {
			observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) void load();
				},
				{ rootMargin: '240px' }
			);
			observer.observe(node);
		}

		return () => {
			live = false;
			observer?.disconnect();
			releasePresentationThumbnail(key);
		};
	};
</script>

<span
	class="presentation-card-thumb [position:absolute] [inset:0] [z-index:2]"
	{@attach loadWhenVisible}
>
	{#if url}
		<img data-testid="presentation-card-thumb" src={url} alt="" width="480" height="270" />
	{/if}
</span>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	/* The real slide render sits over the paper preview (z-index 1) and its tape: absolute and opaque, so
   it can neither move the card's layout nor leave the paper showing through it. */
	.presentation-card-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
