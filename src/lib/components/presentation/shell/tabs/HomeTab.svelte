<script>
	/** Home: undo, clipboard, slides, text formatting, drawing and text editing. */
	import { Copy, PenLine } from 'lucide-svelte';
	import { button } from '#lib/ui/styles.js';
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import ActionButton from '../ActionButton.svelte';
	import RibbonGroup from '../RibbonGroup.svelte';
	import BuiltinLayoutDialog from '../../BuiltinLayoutDialog.svelte';
	import TextFormatToolbar from '../../TextFormatToolbar.svelte';
	import AddSlideButton from './AddSlideButton.svelte';
	import ShapePicker from './ShapePicker.svelte';
	import TextInsertButtons from './TextInsertButtons.svelte';

	const { doc, selection, inserts, actions, ui, text } = getSlideEditor();
	const selectedText = $derived(selection.primary?.kind === 'text' ? selection.primary : null);

	/** @param {import('#lib/presentations/templates/builtinLayouts.js').BuiltinLayoutId} layoutId */
	function addBuiltinLayout(layoutId) {
		const result = inserts.addBuiltinLayout(layoutId);
		if (result.ok && result.slideId) ui.focusSlide(result.slideId);
		return result;
	}
</script>

<RibbonGroup label="Undo">
	<ActionButton id="history.undo" variant="icon" iconSize={17} />
	<ActionButton id="history.redo" variant="icon" iconSize={17} />
</RibbonGroup>
<RibbonGroup label="Clipboard">
	<ActionButton id="clipboard.paste" />
	<ActionButton id="clipboard.copy" />
	<ActionButton id="clipboard.cut" />
	<ActionButton id="element.duplicate" />
</RibbonGroup>
<RibbonGroup label="Slides">
	{#if doc.document}
		<AddSlideButton />
		<BuiltinLayoutDialog
			theme={doc.document.theme}
			disabled={inserts.inserting}
			oninsert={addBuiltinLayout}
		/>
		<button
			type="button"
			class={button}
			aria-label="Duplicate active slide"
			title="Duplicate active slide"
			onclick={() => actions.run('slide.duplicate')}
			><Copy size={16} aria-hidden="true" /><span class="ribbon-label">Duplicate</span></button
		>
	{/if}
</RibbonGroup>
<RibbonGroup label="Font and paragraph">
	{#if selection.editingId}<TextFormatToolbar session={text} />{:else}<p class="ribbon-hint">
			Double-click text to format it.
		</p>{/if}
</RibbonGroup>
<RibbonGroup label="Drawing">
	<ShapePicker />
	<TextInsertButtons />
</RibbonGroup>
{#if selectedText}
	<RibbonGroup label="Editing">
		<button
			type="button"
			class={button}
			aria-label="Edit text: {selectedText.name}"
			onclick={() => selection.startTextEdit(selectedText.id)}
			><PenLine size={16} aria-hidden="true" /> Edit text</button
		>
	</RibbonGroup>
{/if}

<style>
	.ribbon-hint {
		max-inline-size: 15ch;
		margin: 0;
		color: var(--muted);
		font-size: 11px;
		line-height: 1.35;
	}
</style>
