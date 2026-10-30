<script>
	/**
	 * The slide panel: numbered thumbnails of every slide, drag (or Alt+↑/↓) to
	 * reorder, ↑/↓ to move between slides, Delete and Ctrl+D acting on slides,
	 * and focus that follows the slide an action created or moved.
	 */
	import { GripVertical, Trash2 } from 'lucide-svelte';
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import SlideRailPreview from '../SlideRailPreview.svelte';

	const { doc, selection, artwork, actions, ui } = getSlideEditor();
	const presentation = $derived(doc.document);

	/** @type {{ id: string, pointerId: number, x: number, y: number } | null} */
	let slideDrag = null;
	/** @type {string | null} */
	let draggingSlideId = $state(null);
	/** @type {string | null} */
	let dropSlideId = $state(null);
	/** @type {'before' | 'after' | null} */
	let dropPosition = $state(null);
	let suppressSlideClick = false;
	// Slide buttons are addressed imperatively by the focus effect below and never
	// read from the template, so they stay out of the reactive graph.
	/** @type {Map<string, HTMLButtonElement>} */
	const slideButtons = new Map();

	// Focus the slide an action asked for (added, duplicated, moved, the survivor
	// of a deletion), once its button exists.
	$effect(() => {
		const target = ui.slideFocusRequest;
		if (!target) return;
		ui.clearSlideFocus();
		slideButtons.get(target)?.focus();
	});

	/**
	 * Keeps every slide's button addressable for the focus effect above.
	 * @param {string} id
	 * @returns {import('svelte/attachments').Attachment<HTMLButtonElement>}
	 */
	function registerSlideButton(id) {
		return (node) => {
			slideButtons.set(id, node);
			return () => {
				if (slideButtons.get(id) === node) slideButtons.delete(id);
			};
		};
	}

	/** @param {string} id @param {PointerEvent} event */
	function startSlideDrag(id, event) {
		if (
			event.button !== 0 ||
			(event.pointerType === 'touch' &&
				/** @type {HTMLElement} */ (event.currentTarget).classList.contains(
					'presentation-slide-card'
				))
		)
			return;
		event.preventDefault();
		slideDrag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
		/** @type {HTMLButtonElement} */ (event.currentTarget).setPointerCapture(event.pointerId);
	}

	/** @param {PointerEvent} event */
	function moveSlideDrag(event) {
		const drag = slideDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (!draggingSlideId && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
		draggingSlideId = drag.id;
		// Pointer capture keeps events on the source even above another card.
		// Use the pointer's geometry rather than elementFromPoint's captured hit.
		const target = [...document.querySelectorAll('.presentation-slide-card')].find((card) => {
			const rect = card.getBoundingClientRect();
			return (
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom
			);
		});
		const id = target?.getAttribute('data-slide-id');
		if (!target || !id || id === drag.id) {
			dropSlideId = null;
			dropPosition = null;
			return;
		}
		const rect = target.getBoundingClientRect();
		const horizontal = window.matchMedia('(max-width: 720px)').matches;
		dropSlideId = id;
		dropPosition = horizontal
			? event.clientX < rect.left + rect.width / 2
				? 'before'
				: 'after'
			: event.clientY < rect.top + rect.height / 2
				? 'before'
				: 'after';
	}

	/** @param {PointerEvent} event @param {boolean} commit */
	function finishSlideDrag(event, commit) {
		const drag = slideDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (draggingSlideId) {
			suppressSlideClick = true;
			setTimeout(() => (suppressSlideClick = false), 0);
			if (commit && dropSlideId && dropPosition) {
				const slides = doc.document?.slides ?? [];
				const source = slides.findIndex((item) => item.id === drag.id);
				const target = slides.findIndex((item) => item.id === dropSlideId);
				if (source !== -1 && target !== -1) {
					const index = target + (dropPosition === 'after' ? 1 : 0) - (source < target ? 1 : 0);
					doc.reorderSlide(drag.id, index);
				}
			}
		}
		slideDrag = null;
		draggingSlideId = null;
		dropSlideId = null;
		dropPosition = null;
	}

	/** @param {string} id @param {KeyboardEvent} event */
	function slideKeyDown(id, event) {
		if (
			event.defaultPrevented ||
			(event.target instanceof HTMLElement &&
				event.target.closest('input, textarea, select, [contenteditable], [role="menu"], dialog'))
		)
			return;
		const slides = doc.document?.slides ?? [];
		const index = slides.findIndex((slide) => slide.id === id);
		if (index < 0) return;
		if (
			(event.ctrlKey || event.metaKey) &&
			!event.altKey &&
			!event.shiftKey &&
			event.key.toLowerCase() === 'd'
		) {
			event.preventDefault();
			selection.selectSlide(id);
			actions.run('slide.duplicate');
			return;
		}
		if (
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey &&
			(event.key === 'Delete' || event.key === 'Backspace')
		) {
			event.preventDefault();
			selection.selectSlide(id);
			actions.run('slide.delete');
			return;
		}
		if (
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) ||
			(event.altKey && event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
		)
			return;
		event.preventDefault();
		if (event.altKey) {
			selection.selectSlide(id);
			actions.run(event.key === 'ArrowUp' ? 'slide.moveUp' : 'slide.moveDown');
			return;
		}
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? slides.length - 1
					: Math.max(0, Math.min(slides.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
		const target = slides[next];
		if (target) {
			selection.selectSlide(target.id);
			ui.focusSlide(target.id);
		}
	}

	/** @param {HTMLElement} node */
	function slideKeyboard(node) {
		/** @param {KeyboardEvent} event */
		const onkeydown = (event) => {
			const item =
				event.target instanceof HTMLElement ? event.target.closest('[data-slide-row]') : null;
			const id = item?.getAttribute('data-slide-row') ?? selection.activeSlideId;
			if (id) slideKeyDown(id, event);
		};
		node.addEventListener('keydown', onkeydown);
		return () => node.removeEventListener('keydown', onkeydown);
	}
</script>

{#if presentation}
	<aside
		class="presentation-slide-rail [border-inline-end:1px_solid_var(--line)]"
		aria-label="Slides"
		{@attach slideKeyboard}
	>
		<p>Slides</p>
		<p class="slide-order-hint">↑/↓ to select · Alt+↑/↓ to reorder</p>
		<span id="slide-order-hint" class="sr-only"
			>Drag to reorder. On touchscreens, use the handle at the top left of a slide. Or focus the
			slide and press Alt plus the up or down arrow key.</span
		>
		<div class="presentation-slide-list">
			{#each presentation.slides as slide, index (slide.id)}
				<div
					class={[
						'presentation-slide-item [min-inline-size:0]',
						{ 'is-dragging': draggingSlideId === slide.id }
					]}
					data-slide-row={slide.id}
				>
					<button
						type="button"
						class="presentation-slide-card"
						data-slide-id={slide.id}
						data-drop-position={dropSlideId === slide.id ? dropPosition : undefined}
						aria-current={slide.id === selection.activeSlide?.id ? 'true' : undefined}
						aria-label="Show slide {index + 1}: {slide.name}"
						aria-describedby="slide-order-hint"
						ondragstart={(event) => event.preventDefault()}
						onpointerdown={(event) => startSlideDrag(slide.id, event)}
						onpointermove={moveSlideDrag}
						onpointerup={(event) => finishSlideDrag(event, true)}
						onpointercancel={(event) => finishSlideDrag(event, false)}
						onclick={() => {
							if (!suppressSlideClick) {
								selection.selectSlide(slide.id);
								ui.focusSlide(slide.id);
							}
						}}
						{@attach registerSlideButton(slide.id)}
					>
						<SlideRailPreview {slide} pageSize={presentation.pageSize} images={artwork.images} />
						<b>{slide.name}</b>
					</button>
					<button
						type="button"
						class="presentation-slide-grip"
						aria-label="Drag slide {index + 1} to reorder"
						aria-describedby="slide-order-hint"
						onpointerdown={(event) => startSlideDrag(slide.id, event)}
						onpointermove={moveSlideDrag}
						onpointerup={(event) => finishSlideDrag(event, true)}
						onpointercancel={(event) => finishSlideDrag(event, false)}
						><GripVertical size={16} aria-hidden="true" /></button
					>
					<button
						type="button"
						class="presentation-slide-delete"
						aria-label="Delete slide {index + 1}"
						title="Delete slide {index + 1}"
						disabled={presentation.slides.length <= 1}
						onclick={() => actions.run('slide.delete', { slideId: slide.id })}
						><Trash2 size={16} aria-hidden="true" /></button
					>
				</div>
			{/each}
		</div>
	</aside>
{/if}

<style>
	.presentation-slide-rail {
		min-block-size: 0;
		padding: var(--space-4);
		overflow: auto;
		background: var(--surface);
	}
	.presentation-slide-rail > p {
		margin-block-start: 0;
		margin-block-end: var(--space-3);
		margin-inline-start: 0;
		margin-inline-end: 0;
		color: var(--muted);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.presentation-slide-rail > .slide-order-hint {
		font-weight: 500;
		letter-spacing: 0;
		line-height: 1.4;
		text-transform: none;
	}
	.presentation-slide-list {
		display: grid;
		gap: var(--space-3);
	}
	.presentation-slide-item {
		position: relative;
	}
	.presentation-slide-item.is-dragging {
		opacity: 0.6;
	}
	.presentation-slide-card {
		display: grid;
		inline-size: 100%;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 2px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		text-align: start;
		cursor: grab;
		touch-action: pan-x pan-y;
	}
	.presentation-slide-card:active {
		cursor: grabbing;
	}
	.presentation-slide-card[data-drop-position='before'] {
		box-shadow: 0 -4px 0 var(--mint);
	}
	.presentation-slide-card[data-drop-position='after'] {
		box-shadow: 0 4px 0 var(--mint);
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-card:hover {
			border-color: var(--mint);
		}
	}
	.presentation-slide-card[aria-current] {
		border-color: var(--mint);
		background: var(--pale);
	}
	.presentation-slide-card:focus-visible {
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	.presentation-slide-card b {
		overflow: hidden;
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.presentation-slide-grip {
		position: absolute;
		inset-block-start: 5px;
		inset-inline-start: 5px;
		display: grid;
		inline-size: 32px;
		block-size: 32px;
		place-items: center;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--muted);
		box-shadow: var(--shadow);
		cursor: grab;
		touch-action: none;
		opacity: 0;
		transition: opacity 150ms ease-out;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-item:hover .presentation-slide-grip {
			opacity: 1;
		}
	}
	.presentation-slide-item:focus-within .presentation-slide-grip {
		opacity: 1;
	}
	.presentation-slide-grip:focus-visible {
		opacity: 1;
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	.presentation-slide-delete {
		position: absolute;
		inset-block-start: 5px;
		inset-inline-end: 5px;
		display: grid;
		inline-size: 32px;
		block-size: 32px;
		place-items: center;
		border: 1px solid var(--danger-line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--danger);
		box-shadow: var(--shadow);
		cursor: pointer;
		opacity: 0;
		transition: opacity 150ms ease-out;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-item:hover .presentation-slide-delete {
			opacity: 1;
		}
	}
	.presentation-slide-item:focus-within .presentation-slide-delete {
		opacity: 1;
	}
	.presentation-slide-delete:focus-visible {
		opacity: 1;
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-delete:hover:not(:disabled) {
			background: var(--danger-tint);
			color: var(--danger-strong);
		}
	}
	.presentation-slide-delete:disabled {
		cursor: not-allowed;
	}
	@media (hover: hover) and (pointer: fine) {
		.presentation-slide-item:hover .presentation-slide-delete:disabled {
			opacity: 0.5;
		}
	}
	.presentation-slide-item:focus-within .presentation-slide-delete:disabled {
		opacity: 0.5;
	}
	@media (hover: none) {
		.presentation-slide-grip,
		.presentation-slide-card[aria-current] ~ .presentation-slide-delete {
			opacity: 1;
		}
	}
	@media (max-width: 720px) {
		.presentation-slide-rail {
			display: block;
			padding-block-start: var(--space-3);
			padding-block-end: var(--space-3);
			padding-inline-start: var(--space-4);
			padding-inline-end: var(--space-4);
			border-inline-end: 0;
			border-block-end: 1px solid var(--line);
		}
		.presentation-slide-list {
			display: flex;
			min-inline-size: 0;
			gap: var(--space-3);
			overflow-x: auto;
			padding-block-end: var(--space-1);
			scrollbar-width: thin;
		}
		.presentation-slide-item {
			flex: 0 0 144px;
		}
		.presentation-slide-grip {
			opacity: 1;
		}
		.presentation-slide-card[data-drop-position='before'] {
			box-shadow: -4px 0 0 var(--mint);
		}
		.presentation-slide-card[data-drop-position='after'] {
			box-shadow: 4px 0 0 var(--mint);
		}
	}
</style>
