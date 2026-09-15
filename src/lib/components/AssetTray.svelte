<script>
	import { asset } from '$app/paths';
	/**
	 * Bottom asset tray: uploads, sticker catalog with search, and text presets.
	 * Ported from the source `AssetTray`; catalog data and the bundled sample
	 * artwork come from the source unchanged.
	 */
	import { Search, Upload } from 'lucide-svelte';
	import { STICKER_CATALOG, TEXT_PRESETS } from '$lib/editor/catalog';
	import { cssFontFamily } from '$lib/fonts';
	/** @typedef {import('$lib/editor/editorState.svelte').EditorState} EditorState */
	/** @typedef {import('$lib/editor/editorState.svelte').TextStyle} TextStyle */

	/**
	 * @type {{
	 *   editor: EditorState,
	 *   urls: Record<string, string>,
	 *   tab: string,
	 *   ontabchange: (tab: string) => void,
	 *   onupload: (file: File) => void,
	 *   onaddtext: (style: Partial<TextStyle>) => void,
	 *   onaddsample: (src: string, name: string) => void,
	 *   adding?: string | null,
	 * }}
	 */
	let {
		editor,
		urls,
		tab,
		ontabchange,
		onupload,
		onaddtext,
		onaddsample,
		adding = null
	} = $props();

	/** @type {HTMLInputElement | undefined} */
	let fileInput;
	let query = $state('');

	let imageLayers = $derived(
		(editor.document?.layers ?? []).filter((layer) => layer.kind === 'image')
	);
	let needle = $derived(query.trim().toLowerCase());
	let matches = $derived(
		needle
			? STICKER_CATALOG.filter((entry) => entry.name.toLowerCase().includes(needle))
			: STICKER_CATALOG
	);

	const tabs = [
		{ value: 'uploads', label: 'Recent Uploads' },
		{ value: 'stickers', label: 'Stickers' },
		{ value: 'text', label: 'Text styles' }
	];
</script>

<section class="asset-tray" tabindex="-1" aria-label="Sticker assets">
	<input
		bind:this={fileInput}
		class="sr-only"
		type="file"
		accept="image/png,image/jpeg,image/webp"
		aria-label="Choose photo file"
		data-testid="photo-file-input"
		onchange={(event) => {
			const input = event.currentTarget;
			const file = input.files?.[0];
			input.value = '';
			if (file) onupload(file);
		}}
	/>
	{#if editor.uploadError}
		<p role="alert" class="asset-error">{editor.uploadError}</p>
	{/if}
	<div class="asset-tray-head">
		<div class="tabs-list" role="tablist" aria-label="Asset types">
			{#each tabs as item (item.value)}
				<button
					type="button"
					role="tab"
					aria-selected={tab === item.value}
					data-state={tab === item.value ? 'active' : 'inactive'}
					tabindex={tab === item.value ? 0 : -1}
					onclick={() => ontabchange(item.value)}>{item.label}</button
				>
			{/each}
		</div>
		<button type="button" class="asset-view-all" onclick={() => ontabchange('stickers')}
			>View All</button
		>
	</div>

	{#if tab === 'uploads'}
		<div class="asset-items">
			<button type="button" class="asset-upload" onclick={() => fileInput?.click()}>
				<Upload size={18} />Upload Photo
			</button>
			{#each imageLayers as layer (layer.id)}
				<button
					type="button"
					class="asset-thumb"
					aria-label={`Select ${layer.name}`}
					onclick={() => editor.selectLayer(layer.id)}
				>
					<img alt={layer.name} src={layer.kind === 'image' ? urls[layer.assetId] : undefined} />
				</button>
			{/each}
			<button
				type="button"
				class="button asset-thumb catalog-asset"
				aria-label="Add Cat in console"
				disabled={adding === '/samples/cat-in-console.png'}
				onclick={() => onaddsample('/samples/cat-in-console.png', 'Cat in console')}
			>
				<img alt="" src={asset('/samples/cat-in-console.png')} loading="lazy" /><span
					>Cat in console</span
				>
			</button>
			<button
				type="button"
				class="button asset-thumb catalog-asset"
				aria-label="Add Cuban solenodon"
				disabled={adding === '/samples/solenodon.png'}
				onclick={() => onaddsample('/samples/solenodon.png', 'Cuban solenodon')}
			>
				<img alt="" src={asset('/samples/solenodon.png')} loading="lazy" /><span
					>Cuban solenodon</span
				>
			</button>
		</div>
	{:else if tab === 'stickers'}
		<p class="muted asset-note">
			These are image layers, not editable text and not an OS emoji font. Lettering in a cutout
			stays part of the picture; use Text styles for words you can type.
		</p>
		<label class="filter-search asset-search">
			<Search size={16} />
			<input
				value={query}
				oninput={(event) => (query = event.currentTarget.value)}
				aria-label="Search stickers and decorations"
				placeholder="Search stickers…"
			/>
		</label>
		{#if matches.length === 0}
			<p class="muted asset-note" role="status">
				No stickers match that search. Try another word — nothing was added.
			</p>
		{:else}
			<div class="asset-items">
				{#each matches as entry (entry.src)}
					<button
						type="button"
						class="button asset-thumb catalog-asset"
						aria-label={`Add ${entry.name}`}
						title={entry.name}
						disabled={adding === entry.src}
						onclick={() => onaddsample(entry.src, entry.name)}
					>
						<img alt="" src={asset(entry.src)} loading="lazy" />
						<span>{adding === entry.src ? 'Adding…' : entry.name}</span>
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		<p class="muted asset-note">
			Start with a style. Change the words, font, size, and color in Sticker Properties.
		</p>
		<div class="asset-items text-presets">
			{#each TEXT_PRESETS as preset (preset.fontFamily)}
				<button
					type="button"
					class="button text-preset"
					aria-label={`Add ${preset.fontFamily} text`}
					onclick={() => onaddtext(preset)}
				>
					<span
						class="text-preset-sample"
						style:font-family={cssFontFamily(preset.fontFamily)}
						style:color={preset.color}>{preset.content}</span
					>
					<strong>{preset.fontFamily}</strong><small>{preset.description}</small>
				</button>
			{/each}
		</div>
	{/if}
</section>
