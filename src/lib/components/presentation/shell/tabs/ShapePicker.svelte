<script>
	/** The shape gallery as a select: choosing a shape inserts it centred on the slide. */
	import { getSlideEditor } from '#lib/presentations/editor/context.js';

	const { inserts } = getSlideEditor();
</script>

<label class="presentation-add-shape"
	><span class="sr-only">Add shape</span><select
		aria-label="Add shape"
		value=""
		onchange={(event) => {
			const kind =
				/** @type {import('#lib/presentations/editor/shapeTools.js').ShapeInsertKind | ''} */ (
					event.currentTarget.value
				);
			event.currentTarget.value = '';
			if (kind) inserts.addShape(kind);
		}}
		><option value="">Add shape…</option><option value="rectangle">Rectangle</option><option
			value="rounded-rectangle">Rounded rectangle</option
		><option value="ellipse">Ellipse</option><option value="line">Line</option><option value="arrow"
			>Arrow</option
		></select
	></label
>

<style>
	.presentation-add-shape {
		position: relative;
	}
	.presentation-add-shape select {
		min-block-size: 30px;
		padding-block-start: 6px;
		padding-block-end: 6px;
		padding-inline-start: 8px;
		padding-inline-end: 8px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		font-size: 12px;
		font-weight: 700;
	}
</style>
