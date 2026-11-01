<script>
	/**
	 * Drawn over the photo while its background is being removed: the photo dims
	 * and a soft band of light sweeps down it, like a scanner reading it. It sits
	 * exactly on the photo through zoom, pan, rotation and flip (`box` is the
	 * photo's on-screen box) and never takes pointer input.
	 */
	import { cssMatrix } from '#lib/editor/layerScreenBox.js';

	/** @type {{ box: import('#lib/editor/layerScreenBox.js').ScreenBox }} */
	let { box } = $props();
</script>

<div
	class="cutout-scan"
	data-testid="cutout-scan"
	aria-hidden="true"
	style:width="{box.width}px"
	style:height="{box.height}px"
	style:transform={cssMatrix(box)}
>
	<div class="cutout-scan-band"></div>
</div>

<style>
	.cutout-scan {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		z-index: 2;
		overflow: hidden;
		transform-origin: 0 0;
		pointer-events: none;
		background: color-mix(in oklch, oklch(0.269988 0.034841 183.1133) 22%, transparent);
	}
	.cutout-scan-band {
		position: absolute;
		inset-inline: 0;
		inset-block-start: 0;
		block-size: 28%;
		background: linear-gradient(
			to bottom,
			transparent,
			color-mix(in oklch, oklch(0.982 0.04 166) 55%, transparent) 70%,
			oklch(0.982 0.04 166 / 0.85) 92%,
			transparent
		);
		translate: 0 -100%;
	}
	@media (prefers-reduced-motion: no-preference) {
		.cutout-scan {
			animation: cutout-scan-in 240ms var(--ease-out) both;
		}
		.cutout-scan-band {
			animation: cutout-sweep 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
		}
	}
	/* Reduced motion: the static dim alone says "working"; the band stays hidden. */
	@keyframes cutout-sweep {
		from {
			translate: 0 -100%;
		}
		to {
			translate: 0 360%;
		}
	}
	@keyframes cutout-scan-in {
		from {
			opacity: 0;
		}
	}
</style>
