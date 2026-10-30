<script>
	/**
	 * A button for one registry action: label, icon, tooltip with its shortcut,
	 * disabled state and visibility all come from the action, so the button, the
	 * keyboard and menus can never disagree about what it does.
	 */
	import { button, buttonIcon } from '#lib/ui/styles.js';
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import { formatShortcut } from '#lib/presentations/editor/actions/registry.js';

	/** @type {{ id: string, variant?: 'icon' | 'label', iconSize?: number, args?: Record<string, unknown>, label?: string }} */
	let { id, variant = 'label', iconSize = 16, args = undefined, label = undefined } = $props();

	const { actions } = getSlideEditor();
	const action = $derived(actions.get(id));
	const name = $derived(label ?? action.label);
	const shortcut = $derived(action.shortcuts?.[0]);
	const title = $derived(shortcut ? `${name} (${formatShortcut(shortcut)})` : name);
</script>

{#if actions.isAvailable(id)}
	<button
		type="button"
		class={variant === 'icon' ? buttonIcon : button}
		aria-label={name}
		{title}
		disabled={!actions.isEnabled(id)}
		onclick={() => actions.run(id, args)}
		>{#if action.icon}<action.icon
				size={iconSize}
				aria-hidden="true"
			/>{/if}{#if variant === 'label'}
			{action.shortLabel ?? name}{/if}</button
	>
{/if}
