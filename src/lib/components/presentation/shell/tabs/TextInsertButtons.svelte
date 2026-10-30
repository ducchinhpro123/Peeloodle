<script>
	/** The text-box presets, shared by the Home and Insert tabs. */
	import { Type } from 'lucide-svelte';
	import { button } from '#lib/ui/styles.js';
	import { getSlideEditor } from '#lib/presentations/editor/context.js';

	const { inserts } = getSlideEditor();
</script>

<button type="button" class={button} onclick={() => inserts.addTextBox('heading')}
	>Add heading</button
>
<button type="button" class={button} onclick={() => inserts.addTextBox('subheading')}
	>Add subheading</button
>
<button type="button" class={button} onclick={() => inserts.addTextBox('body')}
	>Add body text</button
>
<button type="button" class={button} onclick={() => inserts.addTextBox()}
	><Type size={16} aria-hidden="true" /> Add text</button
>
