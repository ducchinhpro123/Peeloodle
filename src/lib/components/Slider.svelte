<script>
	/**
	 * Range control that keeps the source gesture contract: pointer/keyboard
	 * interaction start opens one undo gesture and interaction end closes it, so a
	 * continuous slider move is a single history entry. Uses a native
	 * `&lt;input type="range"&gt;` for keyboard and assistive-technology support.
	 */
	/** @type {{ value: number, min: number, max: number, label: string, disabled?: boolean, oninput: (value: number) => void, ongesturestart?: () => void, ongestureend?: () => void }} */
	let {
		value,
		min,
		max,
		label,
		disabled = false,
		oninput,
		ongesturestart = undefined,
		ongestureend = undefined
	} = $props();

	let percent = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
	let dragging = false;

	function start() {
		if (disabled || dragging) return;
		dragging = true;
		ongesturestart?.();
	}

	function end() {
		if (!dragging) return;
		dragging = false;
		ongestureend?.();
	}
</script>

<span
	class="slider [position:relative] [display:flex] [height:18px] [width:130px] [touch-action:none] [align-items:center] [user-select:none]"
	data-slot="slider"
	data-disabled={disabled ? '' : undefined}
>
	<span class="slider-track" data-slot="slider-track">
		<span class="slider-range" data-slot="slider-range" style:width="{percent}%"></span>
	</span>
	<span class="slider-thumb" data-slot="slider-thumb" style:left="calc({percent}% - 8px)"></span>
	<input
		type="range"
		class="slider-input [position:absolute] [inset:0] [margin:0] [height:100%] [width:100%] [cursor:pointer] [opacity:0]"
		{min}
		{max}
		{disabled}
		{value}
		aria-label={label}
		onpointerdown={start}
		onpointerup={end}
		onpointercancel={end}
		onkeydown={(event) => {
			if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') start();
		}}
		onkeyup={(event) => {
			if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') end();
		}}
		onblur={end}
		oninput={(event) => oninput(Number(event.currentTarget.value))}
	/>
</span>

<style>
	.slider-input:focus-visible + :global(*) {
		outline: none;
	}
	.slider:has(.slider-input:focus-visible) {
		outline: 2px solid var(--mint);
		outline-offset: 2px;
		border-radius: 999px;
	}

	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.slider-track {
		position: relative;
		height: 5px;
		flex-grow: 1;
		overflow: hidden;
		border-radius: 999px;
		background: #dce4e8;
	}
	.slider-range {
		position: absolute;
		height: 100%;
		border-radius: 999px;
		background: var(--mint);
	}
	.slider-thumb {
		display: block;
		width: 17px;
		height: 17px;
		border: 2px solid #fff;
		border-radius: 50%;
		background: #009b6c;
		box-shadow: 0 1px 3px #001a3544;
	}
	.slider[data-disabled] {
		opacity: 0.55;
	}
</style>
