<script>
	/** Adds a slide after the active one (Ctrl+M), from the Home and Insert tabs. */
	import { Plus } from 'lucide-svelte';
	import { button } from '#lib/ui/styles.js';
	import { getSlideEditor } from '#lib/presentations/editor/context.js';

	const { actions } = getSlideEditor();
</script>

<button
	type="button"
	class={button}
	aria-label="Add slide"
	title="Add slide"
	onclick={() => actions.run('slide.add')}
	><Plus size={16} aria-hidden="true" /><span class="ribbon-label">Add slide</span></button
>
