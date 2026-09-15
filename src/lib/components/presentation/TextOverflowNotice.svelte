<script>
	import { button } from '$lib/ui/styles.js';
	import { layoutTextElement } from '$lib/presentations/rendering/textLayout';
	import { measureTextWidth } from '$lib/presentations/editor/textMeasure';

	/**
	 * Actionable text-overflow feedback (P27). The layout service already knows
	 * when a text element's content is taller than its box; this shows the amount
	 * and offers the one-click fix, growing the box to the measured content height.
	 *
	 * @type {{
	 *   element: import('$lib/presentations/model/types').TextElement,
	 *   store: import('$lib/presentations/editor/store.svelte').PresentationStore
	 * }}
	 */
	let { element, store } = $props();

	const layout = $derived(layoutTextElement(element, measureTextWidth));
	const boxHeight = $derived(Math.max(0, element.height - element.padding * 2));
	const overflowUnits = $derived(Math.ceil(layout.contentHeight - boxHeight));
	const fitHeight = $derived(Math.ceil(layout.contentHeight + element.padding * 2));
</script>

{#if layout.overflow}
	<div class="presentation-overflow-notice" role="status">
		<p>Text overflows this box by about {overflowUnits} document units.</p>
		<!-- Keeping focus in the text field stops the blur from ending the session
		     before the click lands; growing the box should not interrupt editing. -->
		<button
			type="button"
			class={button}
			onmousedown={(event) => event.preventDefault()}
			onclick={() => store.getState().updateElement(element.id, { height: fitHeight })}
			>Grow box to fit</button
		>
	</div>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-overflow-notice {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
		margin-top: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--warning-line);
		border-radius: var(--radius-sm);
		background: var(--warning-bg);
		color: var(--warning-ink);
		font-size: 12px;
		font-weight: 600;
	}
	.presentation-overflow-notice p {
		margin: 0;
	}
</style>
