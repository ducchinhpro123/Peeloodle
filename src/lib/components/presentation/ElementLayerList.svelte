<script>
	import { buttonIcon } from '$lib/ui/styles.js';
	import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-svelte';

	/** @type {{ store: import('$lib/presentations/editor/store.svelte').PresentationStore }} */
	let { store } = $props();
	let state = $derived(store.current);
	let slide = $derived(
		state.document?.slides.find((item) => item.id === state.view.activeSlideId) ??
			state.document?.slides[0]
	);
</script>

{#if slide}
	<ul class="presentation-layer-list [display:grid] [gap:var(--space-2)]">
		{#each [...slide.elements].reverse() as element, reverseIndex (element.id)}
			{@const index = slide.elements.length - 1 - reverseIndex}
			<li
				class="presentation-layer-item"
				data-selected={state.view.selectedElementIds.includes(element.id)}
			>
				<button
					class="presentation-layer-select"
					onclick={() => store.getState().selectElements([element.id])}
					><span>{element.kind}</span><b>{element.name}</b></button
				>
				<div
					class="presentation-layer-actions [display:grid] [grid-template-columns:repeat(6,_minmax(0,_1fr))] [gap:2px]"
				>
					<button
						class={buttonIcon}
						aria-label={`${element.visible ? 'Hide' : 'Show'} ${element.name}`}
						onclick={() => store.getState().toggleElementVisible(element.id)}
						>{#if element.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}</button
					>
					<button
						class={buttonIcon}
						aria-label={`${element.locked ? 'Unlock' : 'Lock'} ${element.name}`}
						onclick={() => store.getState().toggleElementLocked(element.id)}
						>{#if element.locked}<Lock size={14} />{:else}<Unlock size={14} />{/if}</button
					>
					<button
						class={buttonIcon}
						aria-label={`Move ${element.name} forward`}
						disabled={index === slide.elements.length - 1}
						onclick={() => store.getState().reorderElement(element.id, index + 1)}
						><ChevronUp size={14} /></button
					>
					<button
						class={buttonIcon}
						aria-label={`Move ${element.name} backward`}
						disabled={index === 0}
						onclick={() => store.getState().reorderElement(element.id, index - 1)}
						><ChevronDown size={14} /></button
					>
					<button
						class={buttonIcon}
						aria-label={`Duplicate ${element.name}`}
						onclick={() => store.getState().duplicateElement(element.id)}><Copy size={14} /></button
					>
					<button
						class={[buttonIcon, 'presentation-layer-delete']}
						aria-label={`Delete ${element.name}`}
						onclick={() => store.getState().removeElement(element.id)}><Trash2 size={14} /></button
					>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-layer-item {
		display: grid;
		gap: 2px;
		padding: var(--space-1);
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface);
		content-visibility: auto;
		contain-intrinsic-size: auto 58px;
	}
	.presentation-layer-item[data-selected='true'] {
		border-color: var(--mint);
		background: var(--pale);
	}
	.presentation-layer-select {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-width: 0;
		padding: 4px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--ink);
		font-size: 11px;
		text-align: left;
	}
	.presentation-layer-select span {
		color: var(--muted);
		font-size: 10px;
		text-transform: capitalize;
	}
	.presentation-layer-select b {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-layer-select:focus-visible {
		outline: 2px solid var(--mint);
		outline-offset: 1px;
	}
	.presentation-layer-actions .button.icon {
		width: 100%;
		min-height: 26px;
		padding: 3px;
	}
	.presentation-layer-delete {
		color: var(--danger);
	}
</style>
