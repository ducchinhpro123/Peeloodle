<script>
	import { onDestroy } from 'svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { button } from '#lib/ui/styles.js';
	import { ensurePresentationFonts } from '#lib/presentations/rendering/fonts.js';
	import {
		PRESENTATION_PAGE_HEIGHT,
		PRESENTATION_PAGE_WIDTH
	} from '#lib/presentations/model/types.js';
	import {
		BUILTIN_LAYOUTS,
		createBuiltinLayout
	} from '#lib/presentations/templates/builtinLayouts.js';

	/**
	 * Offline built-in layout picker: five cards, each previewed with the shared
	 * rasterizer from the actual layout slide so what is shown is what is inserted.
	 * Previews are generated only while the dialog is open and are invalidated when
	 * it closes or unmounts; a failed preview degrades to a labeled fallback and
	 * never blocks insertion.
	 *
	 * @type {{
	 *   theme: import('#lib/presentations/model/types.js').Theme,
	 *   disabled?: boolean,
	 *   oninsert: (id: import('#lib/presentations/templates/builtinLayouts.js').BuiltinLayoutId) => { ok: boolean, message?: string }
	 * }}
	 */
	let { theme, disabled = false, oninsert } = $props();

	let open = $state(false);
	let error = $state('');
	/** @type {Record<string, string>} */
	let previews = $state({});
	let epoch = 0;

	onDestroy(() => {
		epoch++;
	});

	function close() {
		epoch++;
		open = false;
	}

	async function show() {
		open = true;
		error = '';
		previews = {};
		const generation = ++epoch;
		const slides = BUILTIN_LAYOUTS.map((item) => ({
			id: item.id,
			slide: createBuiltinLayout(item.id, theme)
		}));
		try {
			await ensurePresentationFonts();
			const { rasterizeSlidePage } = await import('#lib/presentations/rendering/rasterizeSlide.js');
			for (const item of slides) {
				if (generation !== epoch) return;
				const raster = await rasterizeSlidePage({
					slide: item.slide,
					pageSize: { width: PRESENTATION_PAGE_WIDTH, height: PRESENTATION_PAGE_HEIGHT },
					images: new Map(),
					width: 320,
					height: 180
				});
				if (generation !== epoch) return;
				previews[item.id] = raster.dataUrl;
			}
		} catch {
			// Preview failure never prevents inserting the ordinary editable slide.
		}
	}

	/** @param {import('#lib/presentations/templates/builtinLayouts.js').BuiltinLayoutId} id */
	function insert(id) {
		const result = oninsert(id);
		if (result.ok) close();
		else error = result.message ?? 'The slide could not be added.';
	}
</script>

<button type="button" class={button} {disabled} onclick={show}>Add layout</button>
<Modal
	{open}
	title="Add a slide layout"
	description="Adds a new slide after the current slide. Your existing content stays unchanged."
	onclose={close}
>
	<div class="layout-grid">
		{#each BUILTIN_LAYOUTS as item (item.id)}
			<button type="button" class="layout-card" {disabled} onclick={() => insert(item.id)}>
				{#if previews[item.id]}
					<img src={previews[item.id]} alt="" width="320" height="180" />
				{:else}
					<span class="preview-fallback" aria-hidden="true">Slide preview</span>
				{/if}
				<span>{item.name}</span>
			</button>
		{/each}
	</div>
	{#if error}<p role="alert">{error}</p>{/if}
</Modal>

<style>
	.layout-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}
	.layout-card {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.layout-card:focus-visible {
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	.layout-card img,
	.preview-fallback {
		width: 100%;
		height: auto;
		aspect-ratio: 16 / 9;
	}
	.preview-fallback {
		display: grid;
		place-items: center;
		background: var(--surface);
	}
	@media (max-width: 600px) {
		.layout-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
