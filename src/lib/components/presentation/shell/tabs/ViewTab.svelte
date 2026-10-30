<script>
	/** View: fit, the Format and Selection panes, and collapsing the ribbon. */
	import ActionButton from '../ActionButton.svelte';
	import RibbonGroup from '../RibbonGroup.svelte';
</script>

<RibbonGroup label="Zoom">
	<ActionButton id="view.fit" />
</RibbonGroup>
<RibbonGroup label="Show">
	<ActionButton id="view.formatPane" />
	<ActionButton id="view.selectionPane" />
</RibbonGroup>
<RibbonGroup label="Ribbon">
	<ActionButton id="view.toggleRibbon" />
</RibbonGroup>
