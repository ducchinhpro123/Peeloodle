<script>
	import { rasterizeSlidePage } from '#lib/presentations/rendering/rasterizeSlide.js';

	/** @type {{ slide: import('#lib/presentations/model/types').Slide, pageSize: import('$lib/presentations/model/types').PresentationDocument['pageSize'], images: import('$lib/presentations/rendering/renderSlide').PresentationImageSources }} */
	let { slide, pageSize, images } = $props();
	let visible = $state(false);
	/** @type {string | null} */
	let url = $state(null);

	/** @type {import('svelte/attachments').Attachment<HTMLElement>} */
	const loadWhenVisible = (node) => {
		if (typeof IntersectionObserver === 'undefined') {
			visible = true;
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					visible = true;
					observer.disconnect();
				}
			},
			{ rootMargin: '180px' }
		);
		observer.observe(node);
		return () => observer.disconnect();
	};

	$effect(() => {
		if (!visible) return;
		// The editor replaces a slide on each command. Coalesce quick edits and
		// discard rasters that finish after a newer command or after unmount.
		let live = true;
		// Read props synchronously so Svelte tracks slide and artwork changes.
		const currentSlide = slide;
		const currentPageSize = pageSize;
		const currentImages = images;
		const timer = setTimeout(() => {
			void rasterizeSlidePage({
				slide: currentSlide,
				pageSize: currentPageSize,
				images: currentImages,
				width: 320,
				height: 180
			})
				.then((raster) => {
					if (live) url = raster.dataUrl;
				})
				.catch(() => {
					// Keep the slide background as the fallback if a preview cannot render.
				});
		}, 100);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	});
</script>

<span class="preview" style:background={slide.background} {@attach loadWhenVisible}>
	{#if url}
		<img data-testid="slide-rail-preview" src={url} alt="" width="320" height="180" />
	{/if}
</span>

<style>
	.preview {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: 6px;
	}
	.preview img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
