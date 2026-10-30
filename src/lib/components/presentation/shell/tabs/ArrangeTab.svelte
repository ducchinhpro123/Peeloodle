<script>
	/** Arrange: align, distribute, stacking order, rotation, lock, visibility, delete. */
	import ActionButton from '../ActionButton.svelte';
	import AlignMenu from '../AlignMenu.svelte';
	import RibbonGroup from '../RibbonGroup.svelte';
</script>

<RibbonGroup label="Align"><AlignMenu /></RibbonGroup>
<RibbonGroup label="Distribute"
	><ActionButton id="distribute.horizontal" /><ActionButton id="distribute.vertical" /></RibbonGroup
>
<RibbonGroup label="Order">
	<ActionButton id="arrange.bringForward" />
	<ActionButton id="arrange.sendBackward" />
	<ActionButton id="arrange.bringToFront" />
	<ActionButton id="arrange.sendToBack" />
</RibbonGroup>
<RibbonGroup label="Rotate">
	<ActionButton id="element.rotateLeft" />
	<ActionButton id="element.rotateRight" />
</RibbonGroup>
<RibbonGroup label="Element">
	<ActionButton id="element.toggleLock" />
	<ActionButton id="element.toggleVisible" />
	<ActionButton id="element.delete" />
</RibbonGroup>
