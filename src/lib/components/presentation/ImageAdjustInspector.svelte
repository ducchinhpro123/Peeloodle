<script>
	import { button, buttonIcon } from '#lib/ui/styles.js';
	import { FlipHorizontal2, FlipVertical2, RefreshCw } from 'lucide-svelte';

	/**
	 * Image adjust controls (P29): flip, non-destructive crop and replace.
	 *
	 * Crop is stored as normalized 0..1 document data, never baked into the
	 * pixels, so undo and reopening always restore the original image. Flip and
	 * crop changes are grouped under one history entry per editing session.
	 *
	 * @type {{
	 *   element: import('#lib/presentations/model/types.js').ImageElement,
	 *   store: import('#lib/presentations/editor/store.svelte.js').PresentationStore,
	 *   onreplace?: (elementId: string) => void
	 * }}
	 */
	let { element, store, onreplace = undefined } = $props();

	const CROP_FIELDS = /** @type {const} */ (['left', 'top', 'right', 'bottom']);
	/** @param {number} value */
	const asPercent = (value) => Math.round(value * 1000) / 10;

	/** @param {Partial<import('#lib/presentations/model/types.js').ImageElement>} update */
	function patch(update) {
		store
			.getState()
			.updateElement(element.id, update, { historyGroup: `image-adjust:${element.id}` });
	}

	function endGroup() {
		store.getState().endHistoryGroup();
	}

	const values = $derived({
		left: asPercent(element.crop.x),
		top: asPercent(element.crop.y),
		right: asPercent(1 - (element.crop.x + element.crop.width)),
		bottom: asPercent(1 - (element.crop.y + element.crop.height))
	});

	/** @param {Partial<Record<'left' | 'top' | 'right' | 'bottom', number>>} change */
	function applyCrop(change) {
		/** @param {number} value */
		const clamp = (value) => Math.min(90, Math.max(0, Number.isFinite(value) ? value : 0)) / 100;
		const left = clamp(change.left ?? values.left);
		const top = clamp(change.top ?? values.top);
		const right = clamp(change.right ?? values.right);
		const bottom = clamp(change.bottom ?? values.bottom);
		patch({
			crop: {
				x: left,
				y: top,
				// A sliver must remain visible so the crop can always be adjusted back.
				width: Math.max(0.05, 1 - left - right),
				height: Math.max(0.05, 1 - top - bottom)
			}
		});
	}
</script>

<div
	class="presentation-image-fields [margin-top:var(--space-3)] [display:grid] [gap:var(--space-3)]"
>
	<div class="presentation-image-actions [display:flex] [flex-wrap:wrap] [gap:var(--space-2)]">
		<button
			type="button"
			class={buttonIcon}
			aria-label="Flip horizontally"
			aria-pressed={element.flipX}
			title="Flip horizontally"
			onmousedown={(event) => event.preventDefault()}
			onclick={() => patch({ flipX: !element.flipX })}
			><FlipHorizontal2 size={16} aria-hidden="true" /></button
		>
		<button
			type="button"
			class={buttonIcon}
			aria-label="Flip vertically"
			aria-pressed={element.flipY}
			title="Flip vertically"
			onmousedown={(event) => event.preventDefault()}
			onclick={() => patch({ flipY: !element.flipY })}
			><FlipVertical2 size={16} aria-hidden="true" /></button
		>
		{#if onreplace}
			<button
				type="button"
				class={button}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => onreplace?.(element.id)}
				><RefreshCw size={16} aria-hidden="true" /> Replace photo</button
			>
		{/if}
	</div>
	<div class="presentation-geometry-fields">
		{#each CROP_FIELDS as field (field)}
			<label>
				Crop {field} %
				<input
					type="number"
					aria-label="Crop {field} percent"
					min="0"
					max="90"
					step="1"
					value={values[field]}
					onchange={(event) => applyCrop({ [field]: Number(event.currentTarget.value) })}
					onblur={endGroup}
				/>
			</label>
		{/each}
	</div>
	<button
		type="button"
		class={button}
		onmousedown={(event) => event.preventDefault()}
		onclick={() => patch({ crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset crop</button
	>
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-image-actions .button {
		min-height: 36px;
	}
	.presentation-geometry-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}
	.presentation-geometry-fields label {
		display: grid;
		gap: var(--space-1);
		color: var(--muted);
		font-size: 11px;
		font-weight: 700;
	}
	.presentation-geometry-fields input {
		min-width: 0;
		width: 100%;
		padding: 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
	.presentation-geometry-fields input:focus-visible {
		outline: 2px solid var(--mint);
		outline-offset: 1px;
	}
</style>
