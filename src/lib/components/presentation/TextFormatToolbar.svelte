<script>
	import { button, buttonIcon } from '$lib/ui/styles.js';
	import {
		AlignCenter,
		AlignJustify,
		AlignLeft,
		AlignRight,
		Bold,
		IndentDecrease,
		IndentIncrease,
		Italic,
		Link2,
		Link2Off,
		List,
		ListOrdered
	} from 'lucide-svelte';
	import { PRESENTATION_FONT_FAMILIES } from '$lib/presentations/rendering/fonts';

	/**
	 * `svelte2tsx` infers a `$state.raw(null)` variable from its initialiser, so the
	 * precise type has to be asserted on the argument rather than declared above.
	 * @typedef {import('$lib/presentations/editor/textFormat').TextFormatState} TextFormatState
	 * @typedef {import('$lib/presentations/editor/textFormat').ParagraphFormatState} ParagraphFormatState
	 */

	/**
	 * Text formatting toolbar (P26/P27). It reads and writes the live editing
	 * session through the controller `TextEditOverlay` registers, so it never
	 * reaches into the DOM field itself. Buttons keep the field focused; selects,
	 * the color control and the link field may take focus, and the overlay
	 * restores the cached selection for them.
	 *
	 * @type {{
	 *   session: import('$lib/presentations/editor/textEditSession.svelte').TextEditSession
	 * }}
	 */
	let { session } = $props();

	const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96];
	const LINE_HEIGHTS = [1, 1.15, 1.5, 2];
	const ALIGNMENTS = /** @type {const} */ (['left', 'center', 'right', 'justify']);
	const ALIGN_ICONS = {
		left: AlignLeft,
		center: AlignCenter,
		right: AlignRight,
		justify: AlignJustify
	};

	let format = $state.raw(/** @type {TextFormatState | null} */ (null));
	let paragraph = $state.raw(/** @type {ParagraphFormatState | null} */ (null));
	let lineHeight = $state(1);
	let linkValue = $state('');
	/** @type {string | null} */
	let linkError = $state(null);

	function refresh() {
		const active = session.format();
		if (!active) {
			format = null;
			paragraph = null;
			return;
		}
		format = active.read();
		paragraph = active.readParagraph();
		lineHeight = active.lineHeight();
	}

	// Caret and selection moves are not reactive state, so they arrive as DOM
	// events; the field itself is owned by the overlay.
	$effect(() => {
		const onSelectionChange = () => refresh();
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	$effect(() => {
		// `refresh` reads the session's controller, which is reactive state: the
		// toolbar follows the overlay as it registers the controller when a field
		// opens and releases it when the field closes.
		refresh();
	});

	/** @param {import('$lib/presentations/editor/textFormat').RunStylePatch} patch */
	function apply(patch) {
		const active = session.format();
		if (!active) return;
		active.apply(patch);
		refresh();
	}

	/** @param {import('$lib/presentations/editor/textFormat').ParagraphStylePatch} patch */
	function applyParagraph(patch) {
		const active = session.format();
		if (!active) return;
		active.applyParagraph(patch);
		refresh();
	}

	/** @param {SubmitEvent} event */
	function submitLink(event) {
		event.preventDefault();
		const active = session.format();
		if (!active) return;
		const value = linkValue.trim();
		if (!value) {
			linkError = 'Enter a link address, or use Remove link.';
			return;
		}
		const result = active.applyLink(value);
		if (!result.ok) {
			linkError = result.message;
			return;
		}
		linkError = null;
		linkValue = '';
		refresh();
	}

	function removeLink() {
		const active = session.format();
		if (!active) return;
		active.applyLink(null);
		linkError = null;
		linkValue = '';
		refresh();
	}

	const knownFont = $derived(
		format?.fontId != null &&
			PRESENTATION_FONT_FAMILIES.some((family) => family.id === format?.fontId)
	);
	const knownSize = $derived(format?.size != null && FONT_SIZES.includes(format.size));
	const knownLineHeight = $derived(LINE_HEIGHTS.includes(lineHeight));
	const level = $derived(paragraph?.bulletLevel ?? 0);
</script>

{#if format && paragraph}
	<div
		class="presentation-text-toolbar"
		data-text-toolbar
		role="toolbar"
		aria-label="Text formatting"
	>
		<div
			class="presentation-text-toolbar-group [display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-2)]"
			role="group"
			aria-label="Character"
		>
			<button
				type="button"
				class={buttonIcon}
				aria-label="Bold"
				aria-pressed={format.bold}
				title="Bold"
				onmousedown={(event) => event.preventDefault()}
				onclick={() => apply({ bold: !format?.bold })}><Bold size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				class={buttonIcon}
				aria-label="Italic"
				aria-pressed={format.italic}
				title="Italic"
				onmousedown={(event) => event.preventDefault()}
				onclick={() => apply({ italic: !format?.italic })}
				><Italic size={16} aria-hidden="true" /></button
			>
			<label class="presentation-text-toolbar-field">
				<span class="sr-only">Font family</span>
				<select
					aria-label="Font family"
					value={format.fontId ?? ''}
					onchange={(event) => apply({ fontId: event.currentTarget.value })}
				>
					{#if format.fontId === null}<option value="">Mixed</option>{/if}
					{#if !knownFont && format.fontId !== null}<option value={format.fontId}
							>{format.fontId}</option
						>{/if}
					{#each PRESENTATION_FONT_FAMILIES as family (family.id)}
						<option value={family.id}>{family.displayName}</option>
					{/each}
				</select>
			</label>
			<label class="presentation-text-toolbar-field">
				<span class="sr-only">Font size</span>
				<select
					aria-label="Font size"
					value={format.size ?? ''}
					onchange={(event) => apply({ size: Number(event.currentTarget.value) })}
				>
					{#if format.size === null}<option value="">Mixed</option>{/if}
					{#if !knownSize && format.size !== null}<option value={format.size}>{format.size}</option
						>{/if}
					{#each FONT_SIZES as size (size)}
						<option value={size}>{size}</option>
					{/each}
				</select>
			</label>
			<label class="presentation-text-toolbar-field presentation-text-toolbar-color">
				<span class="sr-only">Text color</span>
				<input
					type="color"
					aria-label="Text color"
					value={format.color ?? '#08152f'}
					oninput={(event) => apply({ color: event.currentTarget.value })}
				/>
			</label>
		</div>

		<div
			class="presentation-text-toolbar-group [display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-2)]"
			role="group"
			aria-label="Paragraph"
		>
			{#each ALIGNMENTS as alignment (alignment)}
				{@const Icon = ALIGN_ICONS[alignment]}
				<button
					type="button"
					class={buttonIcon}
					aria-label="Align {alignment}"
					aria-pressed={paragraph.alignment === alignment}
					title="Align {alignment}"
					onmousedown={(event) => event.preventDefault()}
					onclick={() => applyParagraph({ alignment })}
					><Icon size={16} aria-hidden="true" /></button
				>
			{/each}
			<button
				type="button"
				class={buttonIcon}
				aria-label="Bulleted list"
				aria-pressed={paragraph.bullet === 'bullet'}
				title="Bulleted list"
				onmousedown={(event) => event.preventDefault()}
				onclick={() =>
					applyParagraph({ bullet: paragraph?.bullet === 'bullet' ? 'none' : 'bullet' })}
				><List size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				class={buttonIcon}
				aria-label="Numbered list"
				aria-pressed={paragraph.bullet === 'number'}
				title="Numbered list"
				onmousedown={(event) => event.preventDefault()}
				onclick={() =>
					applyParagraph({ bullet: paragraph?.bullet === 'number' ? 'none' : 'number' })}
				><ListOrdered size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				class={buttonIcon}
				aria-label="Decrease indent"
				title="Decrease indent"
				disabled={paragraph.bullet === 'none' || level === 0}
				onmousedown={(event) => event.preventDefault()}
				onclick={() =>
					applyParagraph({ bulletLevel: /** @type {0 | 1 | 2} */ (Math.max(0, level - 1)) })}
				><IndentDecrease size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				class={buttonIcon}
				aria-label="Increase indent"
				title="Increase indent"
				disabled={level === 2}
				onmousedown={(event) => event.preventDefault()}
				onclick={() =>
					applyParagraph({
						bullet: paragraph?.bullet === 'none' ? 'bullet' : undefined,
						bulletLevel: /** @type {0 | 1 | 2} */ (Math.min(2, level + 1))
					})}><IndentIncrease size={16} aria-hidden="true" /></button
			>
			<label class="presentation-text-toolbar-field">
				<span class="sr-only">Line spacing</span>
				<select
					aria-label="Line spacing"
					value={lineHeight}
					onchange={(event) => {
						const next = Number(event.currentTarget.value);
						session.format()?.setLineHeight(next);
						lineHeight = next;
					}}
				>
					{#if !knownLineHeight}<option value={lineHeight}>{lineHeight}</option>{/if}
					{#each LINE_HEIGHTS as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
		</div>

		<form
			class="presentation-text-toolbar-group presentation-text-toolbar-link [display:flex] [flex-wrap:wrap] [align-items:center] [gap:var(--space-2)]"
			onsubmit={submitLink}
		>
			<label class="presentation-text-toolbar-field">
				<span class="sr-only">Link URL</span>
				<input
					type="text"
					inputmode="url"
					aria-label="Link URL"
					placeholder="https://…"
					value={linkValue}
					oninput={(event) => {
						linkValue = event.currentTarget.value;
						linkError = null;
					}}
				/>
			</label>
			<button
				type="submit"
				class={button}
				title="Add link"
				onmousedown={(event) => event.preventDefault()}
				><Link2 size={16} aria-hidden="true" /> Add link</button
			>
			{#if format.link}
				<button
					type="button"
					class={buttonIcon}
					aria-label="Remove link"
					title="Remove link"
					onmousedown={(event) => event.preventDefault()}
					onclick={removeLink}><Link2Off size={16} aria-hidden="true" /></button
				>
			{/if}
			{#if linkError}<p class="presentation-text-toolbar-error" role="alert">{linkError}</p>{/if}
		</form>
	</div>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-text-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--surface-warm);
	}
	.presentation-text-toolbar-group + .presentation-text-toolbar-group {
		padding-left: var(--space-2);
		border-left: 1px solid var(--line);
	}
	.presentation-text-toolbar .button.icon {
		width: 36px;
		min-height: 36px;
	}
	.presentation-text-toolbar .button[aria-pressed='true'] {
		background: var(--pale);
		color: #00764f;
		box-shadow: inset 0 0 0 2px var(--mint);
	}
	.presentation-text-toolbar-field select {
		min-height: 36px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
	.presentation-text-toolbar-field input {
		min-height: 36px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
	.presentation-text-toolbar-color input {
		width: 44px;
		padding: 2px;
	}
	.presentation-text-toolbar-link input {
		min-width: 170px;
	}
	.presentation-text-toolbar-error {
		flex-basis: 100%;
		margin: 0;
		color: var(--danger);
		font-size: 12px;
		font-weight: 700;
	}
</style>
