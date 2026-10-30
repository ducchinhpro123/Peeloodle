<script>
	/** Insert: slides, template slides, text, pictures, stickers, catalog images, shapes. */
	import { ImagePlus } from 'lucide-svelte';
	import { button } from '#lib/ui/styles.js';
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import RibbonGroup from '../RibbonGroup.svelte';
	import InsertTemplateDialog from '../../InsertTemplateDialog.svelte';
	import StickerPickerDialog from '../../StickerPickerDialog.svelte';
	import CatalogPickerDialog from '../../CatalogPickerDialog.svelte';
	import AddSlideButton from './AddSlideButton.svelte';
	import ShapePicker from './ShapePicker.svelte';
	import TextInsertButtons from './TextInsertButtons.svelte';

	const { inserts, policy, services } = getSlideEditor();
</script>

<RibbonGroup label="Slides">
	<AddSlideButton />
	{#if services.catalog && policy.capabilities.templateSlides}<InsertTemplateDialog
			repository={services.catalog}
			disabled={inserts.inserting}
			oninsert={inserts.insertTemplateLayout}
		/>{/if}
</RibbonGroup>
<RibbonGroup label="Text"><TextInsertButtons /></RibbonGroup>
<RibbonGroup label="Images">
	{#if policy.capabilities.localMedia}
		<button
			type="button"
			class={button}
			disabled={inserts.inserting}
			onclick={() => inserts.pickImage()}
			><ImagePlus size={16} aria-hidden="true" />
			{inserts.inserting ? 'Adding image…' : 'Add image'}</button
		>
	{/if}
	{#if services.stickers && policy.capabilities.stickers}<StickerPickerDialog
			repository={services.stickers}
			disabled={inserts.inserting}
			onpick={(projectId) => void inserts.addSticker(projectId)}
		/>{/if}
	{#if services.catalog}<CatalogPickerDialog
			repository={services.catalog}
			disabled={inserts.inserting}
			oninsert={inserts.addCatalogImage}
		/>{/if}
</RibbonGroup>
<RibbonGroup label="Illustrations"><ShapePicker /></RibbonGroup>
