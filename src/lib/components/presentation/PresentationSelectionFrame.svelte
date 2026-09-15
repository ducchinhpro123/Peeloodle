<script>
	import { transformFrameInView } from '$lib/presentations/editor/transformGeometry';

	/**
	 * The selected element's frame and manipulation handles. They are plain DOM
	 * on top of the canvas, positioned through the shared viewport mapping, so
	 * what the user grabs is exactly what the inspector numbers describe.
	 * Nothing here reads or writes the document.
	 *
	 * @type {{
	 *   geometry: import('$lib/presentations/editor/transformGeometry').TransformGeometry,
	 *   viewport: import('$lib/presentations/editor/viewGeometry').PresentationViewport,
	 *   locked: boolean,
	 *   ongesturestart: (
	 *     kind: 'resize' | 'rotate',
	 *     handle: import('$lib/presentations/editor/transformGeometry').ResizeHandle | null,
	 *     event: PointerEvent
	 *   ) => void
	 * }}
	 */
	let { geometry, viewport, locked, ongesturestart } = $props();

	const RESIZE_HANDLES = /** @type {const} */ (['nw', 'ne', 'se', 'sw']);
	const frame = $derived(transformFrameInView(geometry, viewport));
</script>

<div
	class="presentation-selection-outline"
	data-testid="presentation-selection-frame"
	aria-hidden="true"
	style:left="{frame.x}px"
	style:top="{frame.y}px"
	style:width="{frame.width}px"
	style:height="{frame.height}px"
	style:transform={frame.rotation ? `rotate(${frame.rotation}deg)` : undefined}
>
	{#if !locked}
		{#each RESIZE_HANDLES as handle (handle)}
			<button
				type="button"
				tabindex="-1"
				class="presentation-transform-handle presentation-transform-{handle}"
				data-testid="presentation-handle-{handle}"
				aria-label="Resize selection"
				onpointerdown={(event) => ongesturestart('resize', handle, event)}
			></button>
		{/each}
		<button
			type="button"
			tabindex="-1"
			class="presentation-transform-handle is-rotate"
			data-testid="presentation-handle-rotate"
			aria-label="Rotate selection"
			onpointerdown={(event) => ongesturestart('rotate', null, event)}
		></button>
	{/if}
</div>
