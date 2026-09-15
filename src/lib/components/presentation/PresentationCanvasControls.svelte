<script>
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
		class="button icon"
		aria-label="Zoom out"
		onclick={() => zoomBy(0.8)}
		disabled={zoom <= PRESENTATION_MIN_ZOOM}><Minus size={17} /></button
	>
	<output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
	<button
		class="button icon"
		aria-label="Zoom in"
		onclick={() => zoomBy(1.25)}
		disabled={zoom >= PRESENTATION_MAX_ZOOM}><Plus size={17} /></button
	>
	<button class="button icon" aria-label="Fit slide to window" onclick={fit}
		><Scan size={17} /></button
	>
</div>
