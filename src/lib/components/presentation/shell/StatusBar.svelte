<script>
	/**
	 * A div with an explicit landmark role: inside <main> a <footer> is not a
	 * content-info landmark.
	 *
	 * The editor's status bar: where you are in the deck and how the canvas is
	 * zoomed, like the strip along the bottom of PowerPoint.
	 */
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import PresentationCanvasControls from '../PresentationCanvasControls.svelte';

	const { doc, selection } = getSlideEditor();
	const slides = $derived(doc.document?.slides ?? []);
	const position = $derived(
		slides.findIndex((slide) => slide.id === selection.activeSlide?.id) + 1
	);
</script>

<div class="editor-status-bar" role="contentinfo" aria-label="Editor status">
	<p role="status" aria-live="polite" aria-atomic="true">Slide {position} of {slides.length}</p>
	<PresentationCanvasControls />
</div>

<style>
	.editor-status-bar {
		display: flex;
		min-block-size: 28px;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-inline: var(--space-3);
		border-block-start: 1px solid oklch(0.9 0.006 264);
		background: oklch(0.968 0.003 264);
		color: var(--muted);
		font-size: 12px;
	}
	.editor-status-bar p {
		margin: 0;
	}
</style>
