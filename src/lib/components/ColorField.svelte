<script>
	/**
	 * Colour control for text and outline colours. A native colour input plus a hex
	 * field replaces the React `react-colorful` popover; both open and close one
	 * undo gesture, so a continuous pick is a single history entry.
	 */
	/** @type {{ color: string, label: string, disabled?: boolean, onchange: (color: string) => void, ongesturestart?: () => void, ongestureend?: () => void }} */
	let {
		color,
		label,
		disabled = false,
		onchange,
		ongesturestart = undefined,
		ongestureend = undefined
	} = $props();

	let pickerOpen = $state(false);
	let picker = $derived(color.length === 9 ? color.slice(0, 7) : color);

	function start() {
		if (!disabled) ongesturestart?.();
	}
	function end() {
		if (!disabled) ongestureend?.();
	}
</script>

<span
	class="inspector-color-value [display:inline-flex] [flex-wrap:wrap] [align-items:center] [gap:8px] [min-inline-size:0]"
>
	<button
		type="button"
		class="inspector-swatch"
		aria-label={`${label} swatch`}
		aria-expanded={pickerOpen}
		{disabled}
		style:background={color}
		onclick={() => (pickerOpen = !pickerOpen)}
	></button>
	<input
		class="inspector-hue-picker [flex:1_0_100%] [block-size:188px] [inline-size:100%]"
		type="color"
		aria-label={label}
		{disabled}
		value={picker}
		hidden={!pickerOpen}
		onfocus={start}
		onblur={end}
		oninput={(event) => onchange(event.currentTarget.value)}
	/>
	<input
		class="inspector-hex"
		type="text"
		aria-label={`${label} hex value`}
		{disabled}
		value={color}
		spellcheck="false"
		onfocus={start}
		oninput={(event) => onchange(event.currentTarget.value)}
		onblur={end}
	/>
</span>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.inspector-swatch {
		appearance: none;
		inline-size: 26px;
		block-size: 26px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 50%;
		box-shadow: none;
	}
	.inspector-swatch:disabled {
		opacity: 0.45;
	}
	:global(.inspector .inspector-hex) {
		inline-size: 8.5rem;
		padding-block-start: 4px;
		padding-block-end: 4px;
		padding-inline-start: 8px;
		padding-inline-end: 8px;
		color: var(--muted);
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
	}
</style>
