<script>
	/** Shape Format (contextual): fill and outline of the selected shape. */
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import RibbonGroup from '../RibbonGroup.svelte';
	import ShapeStyleInspector from '../../ShapeStyleInspector.svelte';

	const { selection } = getSlideEditor();
</script>

{#if selection.primary?.kind === 'shape'}
	<RibbonGroup label="Shape style"><ShapeStyleInspector element={selection.primary} /></RibbonGroup>
{/if}
