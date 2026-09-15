<script>
	import { buttonIcon } from '$lib/ui/styles.js';
	import { Minus, Plus, Scan } from 'lucide-svelte';
	import {
		clampPresentationZoom,
		PRESENTATION_MAX_ZOOM,
		PRESENTATION_MIN_ZOOM
	} from '$lib/presentations/editor/viewGeometry';

	/** @type {{ store: import('$lib/presentations/editor/store.svelte').PresentationStore }} */
	let { store } = $props();
	let zoom = $derived(store.current.view.zoom);

	/** @param {number} factor */
	function zoomBy(factor) {
		const current = store.getState().view.zoom;
		store.getState().setZoom(clampPresentationZoom(current * factor));
	}

	function fit() {
		store.getState().setZoom(1);
		store.getState().setPan({ x: 0, y: 0 });
	}
</script>

<div class="presentation-canvas-controls" aria-label="Canvas view controls">
	<button
		class={buttonIcon}
		aria-label="Zoom out"
		onclick={() => zoomBy(0.8)}
		disabled={zoom <= PRESENTATION_MIN_ZOOM}><Minus size={17} /></button
	>
	<output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
	<button
		class={buttonIcon}
		aria-label="Zoom in"
		onclick={() => zoomBy(1.25)}
		disabled={zoom >= PRESENTATION_MAX_ZOOM}><Plus size={17} /></button
	>
	<button class={buttonIcon} aria-label="Fit slide to window" onclick={fit}
		><Scan size={17} /></button
	>
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-canvas-controls {
		position: absolute;
		z-index: 2;
		right: var(--space-4);
		bottom: var(--space-4);
		display: flex;
		align-items: center;
		gap: 2px;
		padding: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #fffffff2;
		box-shadow: var(--shadow);
	}
	.presentation-canvas-controls output {
		min-width: 48px;
		color: var(--ink);
		font-size: 12px;
		font-weight: 800;
		text-align: center;
	}
	.presentation-canvas-controls .button.icon {
		width: 36px;
		min-height: 36px;
	}
	@media (max-width: 720px) {
		.presentation-canvas-controls {
			right: var(--space-3);
			bottom: var(--space-3);
		}
	}
</style>
