<script>
	/**
	 * One numeric geometry field. It shows the committed value (or the live gesture
	 * preview), keeps the typing in a draft so a partly typed number is never
	 * committed, and writes through the store on Enter or when the field is left.
	 * Escape puts the document's value back.
	 *
	 * @type {{
	 *   label: string,
	 *   value: number,
	 *   step: number,
	 *   disabled: boolean,
	 *   oncommit: (value: number) => void
	 * }}
	 */
	let { label, value, step, disabled, oncommit } = $props();

	/** @param {number} input */
	const formatValue = (input) => String(Number(input.toFixed(1)));

	// A writable derived: the expression re-runs whenever the committed value (or a
	// live gesture preview) moves, while an assignment below keeps the user's own
	// typing as the field's value until the next move.
	let draft = $derived(formatValue(value));

	function commit() {
		const parsed = Number(draft);
		if (String(draft).trim() === '' || !Number.isFinite(parsed)) {
			draft = formatValue(value);
			return;
		}
		oncommit(parsed);
	}
</script>

<label>
	{label}
	<input
		type="number"
		{step}
		{disabled}
		value={draft}
		aria-label={label}
		oninput={(event) => (draft = event.currentTarget.value)}
		onblur={commit}
		onkeydown={(event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit();
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				draft = formatValue(value);
			}
		}}
	/>
</label>
