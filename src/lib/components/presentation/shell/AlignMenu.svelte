<script>
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import {
		alignmentOptions,
		distributionOptions
	} from '#lib/presentations/editor/actions/arrange.js';
	import { button } from '#lib/ui/styles.js';
	import ActionMenu from './ActionMenu.svelte';
	const { actions, selection } = getSlideEditor();
	/** @type {{ x: number, y: number, trigger: HTMLButtonElement } | null} */
	let menu = $state(null);
	function close(restore = true) {
		const trigger = menu?.trigger;
		menu = null;
		if (restore) trigger?.focus();
	}
</script>

<button
	type="button"
	class={button}
	aria-label="Align elements"
	title={selection.ids.length > 1 ? 'Align within selection' : 'Align to slide'}
	aria-haspopup="menu"
	aria-expanded={menu !== null}
	disabled={!alignmentOptions.some((option) => actions.isEnabled(`align.${option.key}`))}
	onclick={(event) => {
		if (menu) {
			close();
			return;
		}
		const rect = event.currentTarget.getBoundingClientRect();
		menu = { x: rect.left, y: rect.bottom + 4, trigger: event.currentTarget };
	}}>Align</button
>
{#if menu}<ActionMenu
		items={[
			...alignmentOptions.map((option) => `align.${option.key}`),
			...distributionOptions.map((option) => `distribute.${option.key}`)
		]}
		trigger={menu.trigger}
		x={menu.x}
		y={menu.y}
		label={selection.ids.length > 1 ? 'Align within selection' : 'Align to slide'}
		onclose={close}
	/>{/if}
