<script>
	/** Picture Format (contextual): replace, crop, flip and alt text of the selected picture. */
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import RibbonGroup from '../RibbonGroup.svelte';
	import ImageAdjustInspector from '../../ImageAdjustInspector.svelte';

	const { selection, inserts, policy } = getSlideEditor();
</script>

{#if selection.primary?.kind === 'image'}
	<RibbonGroup label="Picture">
		<ImageAdjustInspector
			element={selection.primary}
			onreplace={policy.capabilities.localMedia ? inserts.beginReplaceImage : undefined}
		/>
	</RibbonGroup>
{/if}
