<script>
	import { PRESENTATION_FONT_FAMILIES } from '#lib/presentations/rendering/fonts.js';

	/**
	 * Document theme controls (P32). The theme is the default for new slides and
	 * text, never a retroactive restyle: changing it leaves existing elements
	 * exactly as they are. Each editing session groups into one undo entry.
	 *
	 * @type {{
	 *   theme: import('#lib/presentations/model/types.js').Theme,
	 *   onchange: (theme: import('#lib/presentations/model/types.js').Theme) => void,
	 *   onendgroup: () => void
	 * }}
	 */
	let { theme, onchange, onendgroup } = $props();

	const COLOR_FIELDS = [
		{ key: 'text', label: 'Text' },
		{ key: 'accent', label: 'Accent' },
		{ key: 'background', label: 'Background' }
	];

	/** @param {Partial<import('#lib/presentations/model/types.js').Theme> & { colors?: Record<string, string> }} patch */
	function update(patch) {
		onchange({
			...theme,
			...patch,
			colors: { ...theme.colors, ...patch.colors }
		});
	}
</script>

<div class="presentation-theme-fields [display:grid] [gap:var(--space-3)]">
	<label>
		Heading font
		<select
			aria-label="Heading font"
			value={theme.headingFontId}
			onchange={(event) => update({ headingFontId: event.currentTarget.value })}
			onblur={onendgroup}
		>
			{#each PRESENTATION_FONT_FAMILIES as family (family.id)}
				<option value={family.id}>{family.displayName}</option>
			{/each}
		</select>
	</label>
	<label>
		Body font
		<select
			aria-label="Body font"
			value={theme.bodyFontId}
			onchange={(event) => update({ bodyFontId: event.currentTarget.value })}
			onblur={onendgroup}
		>
			{#each PRESENTATION_FONT_FAMILIES as family (family.id)}
				<option value={family.id}>{family.displayName}</option>
			{/each}
		</select>
	</label>
	{#each COLOR_FIELDS as field (field.key)}
		<label>
			{field.label}
			<input
				type="color"
				aria-label="{field.label} color"
				value={theme.colors[field.key] ?? '#ffffff'}
				oninput={(event) => update({ colors: { [field.key]: event.currentTarget.value } })}
				onblur={onendgroup}
			/>
		</label>
	{/each}
	<p class="muted [color:var(--muted)]">
		These are defaults for new slides and text. Existing elements keep their own styles.
	</p>
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-theme-fields label {
		display: grid;
		gap: var(--space-1);
		color: var(--muted);
		font-size: 11px;
		font-weight: 700;
	}
	.presentation-theme-fields select {
		min-height: 36px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
	.presentation-theme-fields input {
		min-height: 36px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
	.presentation-theme-fields input[type='color'] {
		width: 100%;
		padding: 2px;
	}
	.presentation-theme-fields .muted {
		margin: 0;
	}
</style>
