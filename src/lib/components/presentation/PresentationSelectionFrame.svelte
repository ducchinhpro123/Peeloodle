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

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	/*
 * Handles live inside the frame, whose 2px border is drawn inside its box; the
 * -2px offsets put each handle's centre exactly on the element's own corner, so
 * grabbing a handle starts the resize from the current size instead of jumping
 * by the border width.
 */
	.presentation-transform-handle {
		position: absolute;
		width: 14px;
		height: 14px;
		border: 2px solid var(--mint);
		border-radius: 4px;
		background: #fff;
		box-shadow: var(--shadow);
		pointer-events: auto;
		touch-action: none;
	}
	@media (max-width: 1150px), (pointer: coarse) {
		.presentation-transform-handle::before {
			position: absolute;
			inset: -17px;
			content: '';
		}
	}
	.presentation-transform-nw {
		cursor: nwse-resize;
	}
	.presentation-transform-se {
		cursor: nwse-resize;
	}
	.presentation-transform-ne {
		cursor: nesw-resize;
	}
	.presentation-transform-sw {
		cursor: nesw-resize;
	}
	.presentation-transform-nw {
		left: -2px;
		top: -2px;
		transform: translate(-50%, -50%);
	}
	.presentation-transform-ne {
		right: -2px;
		top: -2px;
		transform: translate(50%, -50%);
	}
	.presentation-transform-se {
		right: -2px;
		bottom: -2px;
		transform: translate(50%, 50%);
	}
	.presentation-transform-sw {
		left: -2px;
		bottom: -2px;
		transform: translate(-50%, 50%);
	}
	.presentation-transform-handle.is-rotate {
		left: 50%;
		top: -2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		cursor: grab;
		transform: translate(-50%, calc(-100% - 24px));
	}
	.presentation-transform-handle.is-rotate::after {
		position: absolute;
		left: 50%;
		top: 100%;
		width: 2px;
		height: 24px;
		background: var(--mint);
		content: '';
		transform: translateX(-50%);
	}
	.presentation-selection-outline {
		position: absolute;
		z-index: 2;
		border: 2px solid var(--mint);
		border-radius: 4px;
		box-shadow: 0 0 0 1px #ffffffcc inset;
		transform-origin: 0 0;
		pointer-events: none;
	}
</style>
