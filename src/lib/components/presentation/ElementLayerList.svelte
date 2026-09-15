<script>
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
	<ul class="presentation-layer-list">
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
				<div class="presentation-layer-actions">
					<button
						class="button icon"
						aria-label={`${element.visible ? 'Hide' : 'Show'} ${element.name}`}
						onclick={() => store.getState().toggleElementVisible(element.id)}
						>{#if element.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}</button
					>
					<button
						class="button icon"
						aria-label={`${element.locked ? 'Unlock' : 'Lock'} ${element.name}`}
						onclick={() => store.getState().toggleElementLocked(element.id)}
						>{#if element.locked}<Lock size={14} />{:else}<Unlock size={14} />{/if}</button
					>
					<button
						class="button icon"
						aria-label={`Move ${element.name} forward`}
						disabled={index === slide.elements.length - 1}
						onclick={() => store.getState().reorderElement(element.id, index + 1)}
						><ChevronUp size={14} /></button
					>
					<button
						class="button icon"
						aria-label={`Move ${element.name} backward`}
						disabled={index === 0}
						onclick={() => store.getState().reorderElement(element.id, index - 1)}
						><ChevronDown size={14} /></button
					>
					<button
						class="button icon"
						aria-label={`Duplicate ${element.name}`}
						onclick={() => store.getState().duplicateElement(element.id)}><Copy size={14} /></button
					>
					<button
						class="button icon presentation-layer-delete"
						aria-label={`Delete ${element.name}`}
						onclick={() => store.getState().removeElement(element.id)}><Trash2 size={14} /></button
					>
				</div>
			</li>
		{/each}
	</ul>
{/if}
