<script>
	/** @type {{
	 *   element: import('$lib/presentations/model/types').ShapeElement,
	 *   store: import('$lib/presentations/editor/store.svelte').PresentationStore
	 * }} */
	let { element, store } = $props();

	const DEFAULT_FILL = '#08b879';
	const DEFAULT_STROKE = '#08152f';
	const linear = $derived(element.shape === 'line' || element.shape === 'arrow');

	/**
	 * Every change is grouped under one history entry per editing session.
	 * @param {Partial<import('$lib/presentations/model/types').ShapeElement>} update
	 */
	function patch(update) {
		store
			.getState()
			.updateElement(element.id, update, { historyGroup: `shape-style:${element.id}` });
	}

	function endGroup() {
		store.getState().endHistoryGroup();
	}
</script>

<div
	class="presentation-shape-fields [margin-top:var(--space-3)] [display:grid] [gap:var(--space-3)]"
>
	{#if !linear}
		<label>
			Fill
			<input
				type="color"
				aria-label="Shape fill color"
				value={element.fill ?? DEFAULT_FILL}
				disabled={element.fill === null}
				oninput={(event) => patch({ fill: event.currentTarget.value })}
				onblur={endGroup}
			/>
		</label>
		<label
			class="presentation-shape-toggle [display:flex] [align-items:center] [gap:var(--space-2)]"
		>
			<input
				type="checkbox"
				aria-label="No fill"
				checked={element.fill === null}
				onchange={(event) => patch({ fill: event.currentTarget.checked ? null : DEFAULT_FILL })}
				onblur={endGroup}
			/>
			No fill
		</label>
	{/if}
	<label>
		{linear ? 'Line color' : 'Stroke'}
		<input
			type="color"
			aria-label="Shape stroke color"
			value={element.stroke ?? DEFAULT_STROKE}
			disabled={element.stroke === null}
			oninput={(event) => patch({ stroke: event.currentTarget.value })}
			onblur={endGroup}
		/>
	</label>
	{#if !linear}
		<label
			class="presentation-shape-toggle [display:flex] [align-items:center] [gap:var(--space-2)]"
		>
			<input
				type="checkbox"
				aria-label="No stroke"
				checked={element.stroke === null}
				onchange={(event) =>
					patch({
						stroke: event.currentTarget.checked ? null : DEFAULT_STROKE,
						strokeWidth: event.currentTarget.checked ? 0 : Math.max(1, element.strokeWidth)
					})}
				onblur={endGroup}
			/>
			No stroke
		</label>
	{/if}
	<label>
		{linear ? 'Line width' : 'Stroke width'}
		<input
			type="number"
			aria-label="Stroke width"
			min="1"
			max="40"
			step="1"
			value={Math.max(1, element.strokeWidth)}
			onchange={(event) => patch({ strokeWidth: Number(event.currentTarget.value) })}
			onblur={endGroup}
		/>
	</label>
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-shape-fields label {
		display: grid;
		gap: var(--space-1);
		color: var(--muted);
		font-size: 11px;
		font-weight: 700;
	}
	.presentation-shape-fields input[type='color'] {
		width: 100%;
		min-height: 36px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
	}
	.presentation-shape-fields input[type='number'] {
		min-height: 36px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
</style>
