<script>
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import { buttonIcon } from '#lib/ui/styles.js';
	import { Minus, Plus, Scan } from 'lucide-svelte';
	import {
		clampPresentationZoom,
		PRESENTATION_MAX_ZOOM,
		PRESENTATION_MIN_ZOOM
	} from '#lib/presentations/editor/viewGeometry.js';

	const { viewport } = getSlideEditor();
	let zoom = $derived(viewport.zoom);

	/** @param {number} factor */
	function zoomBy(factor) {
		const current = viewport.zoom;
		viewport.setZoom(clampPresentationZoom(current * factor));
	}

	function fit() {
		viewport.setZoom(1);
		viewport.setPan({ x: 0, y: 0 });
	}
</script>

<div class="presentation-canvas-controls" aria-label="Canvas view controls">
	<button
		class={buttonIcon}
		aria-label="Zoom out"
		onclick={() => zoomBy(0.8)}
		disabled={zoom <= PRESENTATION_MIN_ZOOM}><Minus size={15} /></button
	>
	<output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
	<button
		class={buttonIcon}
		aria-label="Zoom in"
		onclick={() => zoomBy(1.25)}
		disabled={zoom >= PRESENTATION_MAX_ZOOM}><Plus size={15} /></button
	>
	<button class={buttonIcon} aria-label="Fit slide to window" onclick={fit}
		><Scan size={15} /></button
	>
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-canvas-controls {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.presentation-canvas-controls output {
		min-inline-size: 48px;
		color: var(--ink);
		font-size: 12px;
		font-weight: 800;
		text-align: center;
	}
	.presentation-canvas-controls :global(.button.icon) {
		inline-size: 28px;
		min-block-size: 24px;
	}
</style>
