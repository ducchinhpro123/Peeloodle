<script>
	/**
	 * Deterministic DOM artboard used by component tests (`import.meta.env.MODE === 'test'`).
	 * It shares the same document state and the same gesture commands as the Konva
	 * canvas, so tests exercise real drag/select/undo boundaries without a GPU canvas.
	 */
	import { ARTBOARD_SIZE } from '$lib/domain/domain';
	/** @typedef {import('$lib/domain/domain').Transform} Transform */
	/** @typedef {import('$lib/editor/editorState.svelte').EditorState} EditorState */

	/** @type {{ editor: EditorState, urls: Record<string, string> }} */
	let { editor, urls } = $props();

	/** @type {HTMLDivElement | undefined} */
	let artboard;

	let doc = $derived(editor.document);
	/** @type {{ pointerId: number, layerId: string, startX: number, startY: number, origin: Transform } | null} */
	let drag = null;

	function artboardScale() {
		return (artboard?.clientWidth ?? ARTBOARD_SIZE) / ARTBOARD_SIZE;
	}

	/**
	 * @param {PointerEvent} event
	 * @param {string} layerId
	 * @param {Transform} origin
	 */
	function beginDrag(event, layerId, origin) {
		if (event.button !== 0) return;
		editor.selectLayer(layerId);
		editor.beginGesture();
		artboard?.setPointerCapture?.(event.pointerId);
		drag = {
			pointerId: event.pointerId,
			layerId,
			startX: event.clientX,
			startY: event.clientY,
			origin
		};
	}

	/** @param {PointerEvent} event */
	function moveDrag(event) {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const scale = artboardScale();
		editor.applyTransform(drag.layerId, {
			...drag.origin,
			x: drag.origin.x + (event.clientX - drag.startX) / scale,
			y: drag.origin.y + (event.clientY - drag.startY) / scale
		});
	}

	/** @param {PointerEvent} event */
	function endDrag(event) {
		if (!drag || drag.pointerId !== event.pointerId) return;
		drag = null;
		editor.commitGesture();
	}
</script>

<div class="dom-artboard" data-testid="editor-canvas" bind:this={artboard}>
	{#if doc}
		{#each doc.layers as layer (layer.id)}
			{#if layer.visible}
				{@const selected = layer.id === editor.selectedLayerId}
				{#if layer.kind === 'image'}
					{@const asset = editor.assets[layer.assetId]?.asset}
					<button
						type="button"
						class="dom-layer"
						data-layer-id={layer.id}
						data-selected={selected || undefined}
						data-mask-key={layer.maskKey || undefined}
						aria-label={`Select ${layer.name}`}
						style:left="{(layer.transform.x / ARTBOARD_SIZE) * 100}%"
						style:top="{(layer.transform.y / ARTBOARD_SIZE) * 100}%"
						style:transform="rotate({layer.transform.rotation}deg) scale({layer.transform.scaleX}, {layer
							.transform.scaleY})"
						onpointerdown={(event) => beginDrag(event, layer.id, layer.transform)}
						onpointermove={moveDrag}
						onpointerup={endDrag}
						onpointercancel={endDrag}
					>
						<img
							alt={layer.name}
							src={urls[layer.assetId]}
							width={asset?.width ?? ARTBOARD_SIZE}
							height={asset?.height ?? ARTBOARD_SIZE}
							draggable="false"
						/>
					</button>
				{:else if layer.kind === 'text'}
					<p
						data-layer-id={layer.id}
						data-selected={selected || undefined}
						style:left="{(layer.transform.x / ARTBOARD_SIZE) * 100}%"
						style:top="{(layer.transform.y / ARTBOARD_SIZE) * 100}%"
						style:font-size="{layer.fontSize}px"
						style:color={layer.color}
						onpointerdown={(event) => beginDrag(event, layer.id, layer.transform)}
						onpointermove={moveDrag}
						onpointerup={endDrag}
						onpointercancel={endDrag}
						ondblclick={() => {
							editor.selectLayer(layer.id);
							editor.beginGesture();
							/** @type {HTMLTextAreaElement | null} */ (
								globalThis.document.querySelector('[aria-label="Text content"]')
							)?.focus();
						}}
					>
						{layer.content}
					</p>
				{:else}
					<span data-layer-id={layer.id} data-selected={selected || undefined}>{layer.shape}</span>
				{/if}
			{/if}
		{/each}
	{/if}
	{#if !doc || doc.layers.length === 0}
		<div class="canvas-placeholder">
			<strong>Your sticker canvas</strong>
			<small>Upload a photo or add text to start editing.</small>
		</div>
	{/if}
</div>

<style>
	.dom-artboard {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		overflow: hidden;
		background: var(--canvas);
	}
	.dom-layer {
		position: absolute;
		display: block;
		transform-origin: top left;
		border: 0;
		background: transparent;
		padding: 0;
	}
	.dom-layer img {
		display: block;
		height: auto;
		pointer-events: none;
	}
	.dom-artboard [data-selected] {
		outline: 3px solid var(--mint);
		outline-offset: 2px;
	}
	.dom-artboard p {
		position: absolute;
		margin: 0;
		font-weight: 800;
		line-height: 1;
		touch-action: none;
		white-space: pre;
	}
</style>
