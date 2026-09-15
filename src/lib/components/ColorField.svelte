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

<span class="inspector-color-value">
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
		class="inspector-hue-picker"
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
