<script>
	import { untrack } from 'svelte';
	import { fontStackFor } from '$lib/presentations/rendering/fonts';
	import { safeLink } from '$lib/presentations/model/links';
	import {
		BRIDGE_ATTR,
		htmlToParagraphs,
		paragraphsToHtml,
		paragraphsToPlainText,
		plainTextToParagraphs,
		readParagraphsFromDom
	} from '$lib/presentations/editor/textBridge';
	import {
		applyParagraphStyleToSelection,
		applyRunStyleToSelection,
		caretOffsetInParagraph,
		isApplicablePatch,
		paragraphBlockForNode,
		paragraphBlocks,
		placeCaretAtParagraphOffset,
		readParagraphStyle,
		readSelectionStyle
	} from '$lib/presentations/editor/textFormat';
	import {
		bridgeDefaultsFor,
		textHistoryGroup
	} from '$lib/presentations/editor/textEditSession.svelte';

	/**
	 * DOM editor for one text element (P17). The paragraph/run model stays
	 * authoritative: the field is seeded from `paragraphsToHtml`, every commit
	 * reads back through `readParagraphsFromDom`, and the DOM tree is never
	 * persisted. The box keeps document-unit metrics and is scaled as a whole, so
	 * zooming never re-seeds the field or moves the caret.
	 *
	 * @type {{
	 *   element: import('$lib/presentations/model/types').TextElement,
	 *   scale: number,
	 *   offsetX: number,
	 *   offsetY: number,
	 *   theme: import('$lib/presentations/model/types').Theme,
	 *   session: import('$lib/presentations/editor/textEditSession.svelte').TextEditSession,
	 *   store: import('$lib/presentations/editor/store.svelte').PresentationStore
	 * }}
	 */
	let { element, scale, offsetX, offsetY, theme, session, store } = $props();

	/** @type {HTMLDivElement | null} */
	let field = null;
	let composing = false;
	let finished = false;
	/** @type {string | null} */
	let seededElementId = null;
	/** Last selection inside this field, so a toolbar control can restore it. */
	/** @type {Range | null} */
	let formatRange = null;
	/** @type {string | null} */
	let commitError = $state(null);

	function defaults() {
		return bridgeDefaultsFor(element, theme);
	}

	/**
	 * Places the caret at the end of the last paragraph block, never after it.
	 * @param {HTMLElement} host
	 */
	function placeCaretAtEnd(host) {
		const selection = window.getSelection?.();
		if (!selection) return;
		const range = document.createRange();
		// Inside the last paragraph block, not after it: a caret at the end of the
		// host would let typing insert a bare text node outside any paragraph.
		const target = host.lastElementChild ?? host;
		range.selectNodeContents(target);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	/**
	 * Inserts normalized plain text at the caret, keeping line breaks as <br>.
	 * @param {HTMLElement} host
	 * @param {string} text
	 */
	function insertPlainText(host, text) {
		if (!text) return;
		const selection = window.getSelection?.();
		const candidate = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		// A selection left over from another element (or a detached tree) must not
		// swallow the paste; fall back to the end of this field.
		const range = candidate && host.contains(candidate.commonAncestorContainer) ? candidate : null;
		const target = range ?? document.createRange();
		if (!range) {
			target.selectNodeContents(host);
			target.collapse(false);
		}
		target.deleteContents();
		const lines = text.split('\n');
		let last = null;
		for (const [index, line] of lines.entries()) {
			if (index > 0) {
				last = document.createElement('br');
				target.insertNode(last);
				target.setStartAfter(last);
				target.collapse(true);
			}
			if (!line) continue;
			last = document.createTextNode(line);
			target.insertNode(last);
			target.setStartAfter(last);
			target.collapse(true);
		}
		if (selection && last) {
			selection.removeAllRanges();
			selection.addRange(target);
		}
	}

	/** @param {HTMLDivElement | null} host */
	function commit(host = field) {
		if (!host) return;
		try {
			const paragraphs = readParagraphsFromDom(host, defaults());
			// A genuinely empty field keeps the element's style: one empty run with the
			// same defaults the seed used, in the model's field order, so re-committing
			// an untouched box is still a no-op.
			if (paragraphs.every((paragraph) => paragraph.runs.every((run) => run.text === ''))) {
				paragraphs[0].runs = [{ text: '', ...defaults() }];
			}
			store.getState().updateText(element.id, paragraphs, {
				historyGroup: textHistoryGroup(element.id)
			});
			commitError = null;
		} catch {
			// A rejected command (for example the element text limit) must not strand
			// the session or pretend the text was stored.
			commitError = 'This text is too long to save. Shorten it to keep editing.';
		}
	}

	/** Track the field's selection so a toolbar control can act after focus moved to it. */
	function captureSelection() {
		const host = field;
		const selection = window.getSelection?.();
		if (!host || !selection || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);
		if (host.contains(range.commonAncestorContainer)) formatRange = range.cloneRange();
	}

	/**
	 * Re-renders the field from the committed model, keeping the caret in place.
	 * @param {number} paragraphIndex
	 * @param {number} offset
	 */
	function reseed(paragraphIndex, offset) {
		const host = field;
		if (!host) return;
		const updated = store
			.getState()
			.document?.slides.flatMap((slide) => slide.elements)
			.find((candidate) => candidate.id === element.id);
		const source = updated?.kind === 'text' ? updated : element;
		host.innerHTML = paragraphsToHtml(source.paragraphs, { lineHeight: source.lineHeight });
		const block = /** @type {HTMLElement | null} */ (
			host.querySelector(`[${BRIDGE_ATTR.paragraph}="${paragraphIndex}"]`)
		);
		if (block) placeCaretAtParagraphOffset(block, offset);
	}

	function finish(host = field) {
		finished = true;
		try {
			commit(host);
		} finally {
			const state = store.getState();
			state.endHistoryGroup();
			state.endTextEdit();
		}
	}

	// A save must commit what is only on screen, and the DOM field belongs to this
	// component: the session's flush lives exactly as long as the field is open.
	$effect(() => {
		session.registerFlush(() => commit());
		return () => session.registerFlush(null);
	});

	// The formatting toolbar reads and writes through this controller for exactly
	// as long as the session is open.
	$effect(() => {
		const restoreRange = () => {
			const host = field;
			const selection = window.getSelection?.();
			if (!host || !selection) return false;
			const active = document.activeElement;
			const focusedInHost = active instanceof Node && host.contains(active);
			const live =
				selection.rangeCount > 0 && host.contains(selection.getRangeAt(0).commonAncestorContainer)
					? selection.getRangeAt(0)
					: null;
			// Focus still in the field: the live selection is the truth.
			if (focusedInHost && live) return true;
			// A toolbar control owns focus; the field's selection may have collapsed,
			// so restore the last selection made inside it.
			const saved = formatRange;
			if (saved && host.contains(saved.commonAncestorContainer)) {
				selection.removeAllRanges();
				selection.addRange(saved);
				return true;
			}
			if (live) {
				selection.removeAllRanges();
				selection.addRange(live);
				return true;
			}
			return false;
		};

		/**
		 * The range a passive read should describe. When the field owns focus the
		 * live selection is the truth; when a toolbar control owns it (the link or
		 * colour input), the toolbar reads the selection it saved earlier **without**
		 * putting it back in the document. Restoring it here would hand focus back
		 * from the control to this field — Chromium focuses an editable host whose
		 * selection becomes the document selection — so the next keystroke meant for
		 * the control would edit the text box instead. Only a command restores it.
		 */
		/** `undefined` reads the live selection, `null` reads nothing. */
		const readRange = () => {
			const host = field;
			if (!host) return null;
			const active = document.activeElement;
			if (active instanceof Node && host.contains(active)) return undefined;
			const saved = formatRange;
			return saved && host.contains(saved.commonAncestorContainer) ? saved : null;
		};

		const caretPosition = () => {
			const host = field;
			const selection = window.getSelection?.();
			const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
			const block = range && host ? paragraphBlockForNode(host, range.startContainer) : null;
			const blocks = block && host ? paragraphBlocks(host) : [];
			return {
				paragraphIndex: block ? Math.max(0, blocks.indexOf(block)) : 0,
				offset:
					block && range
						? caretOffsetInParagraph(block, range.startContainer, range.startOffset)
						: 0
			};
		};

		session.registerFormat({
			apply(patch) {
				const host = field;
				if (!host || !isApplicablePatch(patch) || !restoreRange()) return;
				if (applyRunStyleToSelection(host, patch)) commit(host);
			},
			read() {
				const host = field;
				if (!host) {
					const { fontId, size, color } = defaults();
					return { bold: false, italic: false, fontId, size, color, link: null };
				}
				return readSelectionStyle(host, defaults(), readRange());
			},
			applyParagraph(patch) {
				const host = field;
				if (!host || !restoreRange()) return;
				const position = caretPosition();
				if (!applyParagraphStyleToSelection(host, patch)) return;
				commit(host);
				// Alignment and bullet markers are structural, so the field is rebuilt
				// from the committed model with the caret put back.
				reseed(position.paragraphIndex, position.offset);
			},
			readParagraph() {
				const host = field;
				if (!host) return { alignment: null, bullet: null, bulletLevel: null };
				return readParagraphStyle(host, readRange());
			},
			applyLink(href) {
				const host = field;
				if (!host || !restoreRange())
					return { ok: false, message: 'Select some text before adding a link.' };
				if (href === null) {
					if (applyRunStyleToSelection(host, { link: '' })) commit(host);
					return { ok: true };
				}
				const safe = safeLink(href);
				if (!safe) return { ok: false, message: 'Only http, https and mailto links can be added.' };
				if (applyRunStyleToSelection(host, { link: safe })) commit(host);
				return { ok: true };
			},
			setLineHeight(value) {
				const host = field;
				const next = Math.min(3, Math.max(0.8, Math.round(value * 100) / 100));
				if (!host || next === element.lineHeight) return;
				const position = caretPosition();
				store.getState().updateElement(
					element.id,
					{ lineHeight: next },
					{
						historyGroup: textHistoryGroup(element.id)
					}
				);
				reseed(position.paragraphIndex, position.offset);
			},
			lineHeight() {
				return element.lineHeight;
			}
		});
		return () => session.registerFormat(null);
	});

	$effect(() => {
		const onSelectionChange = () => {
			const host = field;
			const active = document.activeElement;
			// Only cache selections made while the field owns focus: moving focus to a
			// toolbar control can collapse the field's selection, and that collapse
			// must not overwrite the range the control is about to act on.
			if (!host || !(active instanceof Node && host.contains(active))) return;
			captureSelection();
		};
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	/**
	 * Seed once per element so panning, zooming, or our own commits never reset the
	 * caret. Every commit replaces the element object, so the dependency has to be
	 * the id alone: an effect that read the element would re-run on each keystroke
	 * and drag the caret to the end of the text with it. The derived compares by
	 * value, and the rest of the body is untracked.
	 */
	const elementId = $derived(element.id);

	$effect(() => {
		const id = elementId;
		untrack(() => {
			const host = field;
			if (!host) return;
			if (seededElementId !== id) {
				seededElementId = id;
				const current = element;
				host.innerHTML = paragraphsToHtml(current.paragraphs, {
					lineHeight: current.lineHeight
				});
			}
			// Focus and caret placement wait for the next frame: the double click that
			// opens this overlay also triggers the browser's own word selection, which
			// would otherwise replace what the caret is meant to do.
			const frame = requestAnimationFrame(() => {
				host.focus();
				placeCaretAtEnd(host);
			});
			return () => cancelAnimationFrame(frame);
		});
	});

	// Flush anything still on screen if the overlay goes away without a blur. The
	// editing target itself is cleared by the store command that removed it (slide
	// switch, delete, undo), never here.
	$effect(() => {
		return () => {
			const host = field;
			if (finished || !host) return;
			commit(host);
			store.getState().endHistoryGroup();
		};
	});

	const verticalAlignment = $derived(
		element.verticalAlign === 'middle'
			? 'center'
			: element.verticalAlign === 'bottom'
				? 'flex-end'
				: 'flex-start'
	);
</script>

<div
	class="presentation-text-editor-layer"
	data-testid="text-edit-overlay"
	style:left="{offsetX}px"
	style:top="{offsetY}px"
	style:transform="scale({scale})"
>
	<div
		bind:this={field}
		class="presentation-text-editor"
		data-testid="text-edit-field"
		role="textbox"
		aria-multiline="true"
		aria-label="Text content"
		contenteditable="true"
		tabindex="0"
		style:left="{element.x}px"
		style:top="{element.y}px"
		style:width="{element.width}px"
		style:height="{element.height}px"
		style:padding="{element.padding}px"
		style:line-height={element.lineHeight}
		style:transform="rotate({element.rotation}deg)"
		style:justify-content={verticalAlignment}
		style:font-family={fontStackFor(defaults().fontId)}
		style:font-size="{defaults().size}px"
		style:color={defaults().color}
		oninput={(event) => {
			// IME composition commits once on compositionend instead of per keystroke.
			// (`isComposing` belongs to InputEvent, which is what an `input` on a
			// contenteditable actually fires; the handler's declared type is Event.)
			if (composing || ('isComposing' in event && event.isComposing)) return;
			commit();
		}}
		oncompositionstart={() => {
			composing = true;
		}}
		oncompositionend={() => {
			composing = false;
			commit();
		}}
		onpaste={(event) => {
			event.preventDefault();
			const host = field;
			if (!host) return;
			const clipboard = event.clipboardData;
			if (!clipboard) return;
			const html = clipboard.getData('text/html');
			const paragraphs = html
				? htmlToParagraphs(html, defaults())
				: plainTextToParagraphs(clipboard.getData('text/plain'), defaults());
			// Only normalized plain text enters the field; pasted markup never touches
			// the document, and line breaks stay line breaks.
			insertPlainText(host, paragraphsToPlainText(paragraphs));
			commit();
		}}
		onkeydown={(event) => {
			// Escape cancels an IME candidate window; only a plain Escape ends the session.
			if (event.key !== 'Escape' || composing || event.isComposing) return;
			event.preventDefault();
			event.currentTarget.blur();
		}}
		onkeyup={captureSelection}
		onmouseup={captureSelection}
		onblur={(event) => {
			// The blur can arrive before the selection collapses; keep it for the
			// toolbar control that is taking focus.
			captureSelection();
			// Focus moving into the formatting toolbar is not leaving the session:
			// a select or color control takes focus while the selection stays live.
			const next = /** @type {HTMLElement | null} */ (event.relatedTarget);
			if (next?.closest('[data-text-toolbar]')) return;
			finish();
		}}
	></div>
	{#if commitError}<p class="presentation-text-editor-alert" role="alert">{commitError}</p>{/if}
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.presentation-text-editor-layer {
		position: absolute;
		z-index: 3;
		pointer-events: none;
		transform-origin: 0 0;
	}
	.presentation-text-editor {
		position: absolute;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		overflow-wrap: break-word;
		border-radius: 4px;
		outline: 2px dashed var(--mint);
		outline-offset: 6px;
		pointer-events: auto;
		caret-color: var(--mint);
		/* The field carries the element rotation; the layer above carries scale/offset. */
		transform-origin: 0 0;
	}
	/* Paragraph blocks must never flex-shrink away from their measured height. */
	.presentation-text-editor :global(p) {
		flex-shrink: 0;
		min-width: 0;
	}
	.presentation-text-editor:focus-visible {
		outline: 2px dashed var(--mint);
	}
	.presentation-text-editor-alert {
		position: absolute;
		top: 100%;
		left: 0;
		margin: var(--space-4) 0 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--warning-line);
		border-radius: var(--radius-sm);
		background: var(--warning-bg);
		color: var(--warning-ink);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
</style>
