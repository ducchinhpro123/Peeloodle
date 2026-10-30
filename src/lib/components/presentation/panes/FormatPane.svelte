<script>
	/** The Format pane: slide background, then the selected element's exact geometry. */
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import ElementGeometryInspector from '../ElementGeometryInspector.svelte';

	const { doc, selection, inserts, policy } = getSlideEditor();
	const activeSlide = $derived(selection.activeSlide);
	const selectedElement = $derived(selection.primary);
</script>

<div class="presentation-inspector">
	{#if activeSlide}
		<label
			class="presentation-slide-background [margin-block-end:var(--space-5)] [display:grid] [gap:var(--space-1)] [font-size:11px] [font-weight:700] [color:var(--muted)]"
		>
			Slide background
			<input
				type="color"
				aria-label="Slide background"
				value={activeSlide.background}
				oninput={(event) =>
					doc.setSlideBackground(activeSlide.id, event.currentTarget.value, {
						historyGroup: `slide-bg:${activeSlide.id}`
					})}
				onblur={() => doc.endHistoryGroup()}
			/>
		</label>
	{/if}
	{#if selectedElement}
		<p>{selectedElement.name || 'Element'}</p>
		<ElementGeometryInspector
			element={selectedElement}
			onreplaceimage={policy.capabilities.localMedia ? inserts.beginReplaceImage : undefined}
		/>
	{/if}
</div>

<style>
	.presentation-slide-background input {
		inline-size: 100%;
		min-block-size: 36px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
	}
	.presentation-inspector {
		min-block-size: 0;
	}
	.presentation-inspector > p:not(.muted) {
		margin-block-start: 0;
		margin-block-end: var(--space-3);
		margin-inline-start: 0;
		margin-inline-end: 0;
		color: var(--muted);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
</style>
