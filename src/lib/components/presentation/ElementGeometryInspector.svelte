<script>
	import { alignToSlide } from '$lib/presentations/editor/alignmentGuides';
	import { elementGeometry, withRotation } from '$lib/presentations/editor/transformGeometry';
	import GeometryField from './GeometryField.svelte';
	import TextOverflowNotice from './TextOverflowNotice.svelte';
	import ShapeStyleInspector from './ShapeStyleInspector.svelte';
	import ImageAdjustInspector from './ImageAdjustInspector.svelte';

	/**
	 * Numeric element geometry (P24). These fields are the keyboard path to the
	 * same values the canvas handles produce, and they read the live gesture
	 * preview so the numbers and the frame never disagree while an element is
	 * being dragged. Locked elements show their numbers read-only: the command
	 * would refuse them.
	 *
	 * @type {{
	 *   element: import('$lib/presentations/model/types').Element,
	 *   store: import('$lib/presentations/editor/store.svelte').PresentationStore,
	 *   onreplaceimage?: (elementId: string) => void
	 * }}
	 */
	let { element, store, onreplaceimage = undefined } = $props();

	/** @type {Array<{ key: 'x' | 'y' | 'width' | 'height' | 'rotation', label: string, step: number }>} */
	const FIELDS = [
		{ key: 'x', label: 'X position', step: 1 },
		{ key: 'y', label: 'Y position', step: 1 },
		{ key: 'width', label: 'Width', step: 1 },
		{ key: 'height', label: 'Height', step: 1 },
		{ key: 'rotation', label: 'Rotation', step: 0.1 }
	];
	/** @type {Array<{ key: import('$lib/presentations/editor/alignmentGuides').SlideAlignment, label: string }>} */
	const ALIGN_ACTIONS = [
		{ key: 'left', label: 'Left' },
		{ key: 'center-horizontal', label: 'Center' },
		{ key: 'right', label: 'Right' },
		{ key: 'top', label: 'Top' },
		{ key: 'middle-vertical', label: 'Middle' },
		{ key: 'bottom', label: 'Bottom' }
	];

	const transformPreview = $derived(store.current.view.transformPreview);
	const pageSize = $derived(store.current.document?.pageSize);
	const geometry = $derived(elementGeometry(element, transformPreview ?? null));

	/** @param {'x' | 'y' | 'width' | 'height' | 'rotation'} key @param {number} value */
	function commitField(key, value) {
		// Rotation keeps the visual centre: the stored origin moves with the angle,
		// so the frame does not jump when the number changes.
		store
			.getState()
			.commitTransform(
				element.id,
				key === 'rotation' ? withRotation(geometry, value) : { ...geometry, [key]: value }
			);
	}

	/** @param {import('$lib/presentations/editor/alignmentGuides').SlideAlignment} alignment */
	function align(alignment) {
		if (!pageSize) return;
		const state = store.getState();
		const current = elementGeometry(element, state.view.transformPreview ?? null);
		state.commitTransform(element.id, {
			...current,
			...alignToSlide(current, pageSize, alignment)
		});
	}
</script>

<div class="presentation-geometry-fields">
	{#each FIELDS as field (field.key)}
		<GeometryField
			label={field.label}
			step={field.step}
			disabled={element.locked}
			value={geometry[field.key]}
			oncommit={(value) => commitField(field.key, value)}
		/>
	{/each}
</div>
<div class="presentation-align-controls" role="group" aria-label="Align to slide">
	{#each ALIGN_ACTIONS as action (action.key)}
		<button
			type="button"
			class="button"
			aria-label="Align {action.label}"
			title="Align {action.label}"
			disabled={element.locked}
			onclick={() => align(action.key)}>{action.label}</button
		>
	{/each}
</div>
{#if element.locked}<p class="muted">
		This element is locked, so it ignores moves, resizes, and rotations.
	</p>{/if}
{#if element.kind === 'text'}
	<TextOverflowNotice {element} {store} />
{:else if element.kind === 'shape'}
	<ShapeStyleInspector {element} {store} />
{:else if element.kind === 'image'}
	<ImageAdjustInspector {element} {store} onreplace={onreplaceimage} />
{/if}
