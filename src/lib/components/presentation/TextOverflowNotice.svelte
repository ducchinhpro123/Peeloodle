<script>
	import { tick } from 'svelte';
	import { button } from '$lib/ui/styles.js';
	import { layoutTextElement } from '$lib/presentations/rendering/textLayout';
	import { measureTextWidth } from '$lib/presentations/editor/textMeasure';
	import { growTextToFit, textBoxInsidePage } from '$lib/presentations/editor/textFit';

	/**
	 * Sizing mode and text-overflow feedback (P27, extended). The layout service
	 * knows when a text element's content is taller than its box; this exposes the
	 * two explicit sizing actions and never changes font sizes implicitly.
	 *
	 * - `Automatic height` grows the box with the content inside the command that
	 *   changed it (store-level); this panel only flips the intent.
	 * - `Grow box to fit` is the one-click legacy action for fixed boxes, capped at
	 *   the slide edge.
	 * - `Shrink text to fit` is explicit, undoable and refuses below the readable
	 *   floor; the document is untouched when it refuses.
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

	/** The element id a grow attempt was made for; a cap message only applies to it. */
	let grownFor = $state(/** @type {string | null} */ (null));
	/** @type {string} */
	let fitError = $state('');
	const pageSize = $derived(store.current.document?.pageSize);
	// A box that already starts off the slide is never grown, so "reaches the slide
	// edge" would be the wrong explanation; it gets its own message instead.
	const offPage = $derived(pageSize !== undefined && !textBoxInsidePage(element, pageSize));
	const capped = $derived(
		layout.overflow && !offPage && (element.autoGrow || grownFor === element.id)
	);

	/** @param {Event} event */
	function changeSizing(event) {
		fitError = '';
		grownFor = null;
		const select = /** @type {HTMLSelectElement} */ (event.currentTarget);
		store.getState().updateElement(element.id, { autoGrow: select.value === 'grow' });
		store.getState().endHistoryGroup();
	}

	function grow() {
		const document = store.getState().document;
		if (!document) return;
		grownFor = element.id;
		const grown = growTextToFit(element, document.pageSize, measureTextWidth);
		if (grown.height !== element.height) {
			store.getState().updateElement(element.id, { height: grown.height });
		}
	}

	async function shrink() {
		const id = element.id;
		// Normal pointer focus/blur ends editing first; only a session that is still
		// open after that tick may not be shrunk from under its uncommitted runs.
		await tick();
		if (store.getState().view.editingElementId === id) {
			fitError = 'Finish editing this text before shrinking it.';
			return;
		}
		fitError = store.getState().shrinkText(id)
			? ''
			: 'This text cannot fit at a readable size. Enlarge the box or shorten the text.';
	}
</script>

<div class="presentation-text-sizing">
	<label>
		Text sizing
		<select
			aria-label="Text sizing"
			value={element.autoGrow ? 'grow' : 'fixed'}
			disabled={element.locked}
			onchange={changeSizing}
		>
			<option value="grow">Automatic height</option>
			<option value="fixed">Fixed box</option>
		</select>
	</label>
	<button type="button" class={button} disabled={element.locked} onclick={shrink}
		>Shrink text to fit</button
	>
	{#if fitError}<p class="presentation-fit-error" role="status">{fitError}</p>{/if}
</div>

{#if layout.overflow}
	<div class="presentation-overflow-notice" role="status">
		<p>Text overflows this box by about {overflowUnits} document units.</p>
		{#if offPage}
			<p>This box is outside the slide. Move it back onto the slide to fit its text.</p>
		{:else if capped}
			<p>Text reaches the slide edge. Move or widen the box, shrink the text, or shorten it.</p>
		{:else}
			<!-- Keeping focus in the text field stops the blur from ending the session
			     before the click lands; growing the box should not interrupt editing. -->
			<button
				type="button"
				class={button}
				disabled={element.locked}
				onmousedown={(event) => event.preventDefault()}
				onclick={grow}>Grow box to fit</button
			>
		{/if}
	</div>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-text-sizing {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
		margin-top: var(--space-3);
	}
	.presentation-text-sizing label {
		display: grid;
		gap: 4px;
		font-size: 13px;
	}
	.presentation-text-sizing select {
		border-radius: var(--radius-sm);
		padding: 8px;
	}
	.presentation-fit-error {
		margin: 0;
		color: #8d1d3f;
		font-size: 12px;
		font-weight: 600;
	}
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
