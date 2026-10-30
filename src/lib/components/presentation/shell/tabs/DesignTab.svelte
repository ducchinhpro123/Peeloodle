<script>
	/** Design: the deck's theme fonts and colours. */
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import RibbonGroup from '../RibbonGroup.svelte';
	import ThemeControls from '../../ThemeControls.svelte';

	const { doc } = getSlideEditor();
</script>

{#if doc.document}
	<RibbonGroup label="Theme">
		<ThemeControls
			theme={doc.document.theme}
			onchange={(next) => doc.setTheme(next, { historyGroup: 'theme' })}
			onendgroup={() => doc.endHistoryGroup()}
		/>
	</RibbonGroup>
{/if}
