<script>
	import { button } from '#lib/ui/styles.js';
	import { asset } from '$app/paths';
	/**
	 * Bottom asset tray: uploads, sticker catalog with search, and text presets.
	 * Ported from the source `AssetTray`; catalog data and the bundled sample
	 * artwork come from the source unchanged.
	 */
	import { Search, Upload } from 'lucide-svelte';
	import { STICKER_CATALOG, TEXT_PRESETS } from '#lib/editor/catalog.js';
	import { cssFontFamily } from '#lib/fonts.js';
	/** @typedef {import('#lib/editor/editorState.svelte.js').EditorState} EditorState */
	/** @typedef {import('#lib/editor/editorState.svelte.js').TextStyle} TextStyle */

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

<section
	class="asset-tray [margin:0] [padding-inline-start:10px] [padding-inline-end:10px] [padding-block-start:6px] [padding-block-end:8px]"
	tabindex="-1"
	aria-label="Sticker assets"
>
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
	<div class="asset-tray-head [display:flex] [align-items:center] [gap:var(--space-3)]">
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
		<div
			class="asset-items [display:flex] [align-items:center] [gap:8px] [overflow:auto] [padding-block-start:8px]"
		>
			<button
				type="button"
				class="asset-upload [display:flex] [flex-direction:column] [align-items:center] [justify-content:center] [gap:2px] [font-size:11px]"
				onclick={() => fileInput?.click()}
			>
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
				class={[button, 'asset-thumb catalog-asset']}
				aria-label="Add Cat in console"
				disabled={adding === '/samples/cat-in-console.png'}
				onclick={() => onaddsample('/samples/cat-in-console.png', 'Cat in console')}
			>
				<img alt="" src={asset('samples/cat-in-console.png')} loading="lazy" />

				<span>Cat in console</span>
			</button>
			<button
				type="button"
				class={[button, 'asset-thumb catalog-asset']}
				aria-label="Add Cuban solenodon"
				disabled={adding === '/samples/solenodon.png'}
				onclick={() => onaddsample('/samples/solenodon.png', 'Cuban solenodon')}
			>
				<img alt="" src={asset('samples/solenodon.png')} loading="lazy" />

				<span>Cuban solenodon</span>
			</button>
		</div>
	{:else if tab === 'stickers'}
		<p class="muted asset-note [display:none] [color:var(--muted)]">
			These are image layers, not editable text and not an OS emoji font. Lettering in a cutout
			stays part of the picture; use Text styles for words you can type.
		</p>
		<label class="filter-search asset-search [margin-inline-start:auto]">
			<Search size={16} />
			<input
				value={query}
				oninput={(event) => (query = event.currentTarget.value)}
				aria-label="Search stickers and decorations"
				placeholder="Search stickers…"
			/>
		</label>
		{#if matches.length === 0}
			<p class="muted asset-note [display:none] [color:var(--muted)]" role="status">
				No stickers match that search. Try another word — nothing was added.
			</p>
		{:else}
			<div
				class="asset-items [display:flex] [align-items:center] [gap:8px] [overflow:auto] [padding-block-start:8px]"
			>
				{#each matches as entry (entry.src)}
					<button
						type="button"
						class={[button, 'asset-thumb catalog-asset']}
						aria-label={`Add ${entry.name}`}
						title={entry.name}
						disabled={adding === entry.src}
						onclick={() => onaddsample(entry.src, entry.name)}
					>
						<img
							alt=""
							src={asset(
								/** @type {import('$app/types').AssetPath} */ (entry.src.replace(/^\//, ''))
							)}
							loading="lazy"
						/>
						<span>{adding === entry.src ? 'Adding…' : entry.name}</span>
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		<p class="muted asset-note [display:none] [color:var(--muted)]">
			Start with a style. Change the words, font, size, and color in Sticker Properties.
		</p>
		<div
			class="asset-items text-presets [display:flex] [align-items:center] [gap:8px] [overflow:auto] [padding-block-start:8px]"
		>
			{#each TEXT_PRESETS as preset (preset.fontFamily)}
				<button
					type="button"
					class={[button, 'text-preset']}
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

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.filter-search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-block-start: 8px;
		padding-block-end: 8px;
		padding-inline-start: 14px;
		padding-inline-end: 14px;
		border-radius: 999px;
		background: oklch(0.96948 0.004541 258.3246);
		color: oklch(0.494015 0.049212 261.4769);
	}
	.filter-search input {
		min-inline-size: 220px;
		border: 0;
		background: transparent;
	}
	.filter-search input {
		min-inline-size: 145px;
	}
	.asset-tray {
		min-inline-size: 0;
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: oklch(1 0 none);
	}
	.asset-thumb {
		inline-size: 80px;
		block-size: 70px;
		padding: 0;
		overflow: clip;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: oklch(1 0 none);
	}
	.asset-thumb img {
		inline-size: 100%;
		block-size: 100%;
		object-fit: contain;
	}
	.asset-tray .filter-search {
		margin-block-start: 0;
		margin-block-end: 8px;
		margin-inline-start: 0;
		margin-inline-end: 0;
		max-inline-size: min(280px, 100%);
	}
	.asset-tray .filter-search input {
		min-inline-size: 0;
		inline-size: 100%;
	}
	.asset-view-all {
		margin-inline-start: auto;
		padding: 0;
		border: 0;
		background: transparent;
		color: oklch(0.551582 0.11869 163.307);
		font-size: 12px;
		font-weight: 700;
	}
	.asset-tray [role='tablist'] {
		display: flex;
		gap: var(--space-4);
		overflow: auto;
	}
	.asset-tray [role='tab'] {
		padding-block-start: 5px;
		padding-block-end: 5px;
		padding-inline-start: 2px;
		padding-inline-end: 2px;
		border: 0;
		background: transparent;
		white-space: nowrap;
		font-size: 13px;
	}
	.asset-tray [role='tab'][data-state='active'] {
		border-block-end: 2px solid var(--mint);
		color: oklch(0.569191 0.122802 163.1218);
	}
	.asset-items button {
		flex: 0 0 68px;
		block-size: 68px;
		border: 1px dashed var(--mint);
		border-radius: var(--radius-sm);
		background: oklch(1 0 none);
		color: oklch(0.569191 0.122802 163.1218);
	}
	.asset-tray [role='tab'] {
		text-transform: capitalize;
	}
	.asset-items .sticker {
		padding: 7px;
		border-radius: 10px;
		background: oklch(0.972008 0.006231 255.4748);
		font-size: 45px;
	}
	.asset-error {
		margin-block-end: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--cream);
		color: var(--ink);
		font-size: 13px;
	}
	.asset-items .catalog-asset {
		flex-basis: 76px;
		inline-size: 76px;
		block-size: 76px;
		flex-direction: column;
		gap: 2px;
		padding: 4px;
		border-style: solid;
		color: var(--ink);
	}
	.catalog-asset img {
		inline-size: 100%;
		block-size: 48px;
		object-fit: contain;
	}
	.catalog-asset span {
		inline-size: 100%;
		overflow: hidden;
		font-size: 9px;
		line-height: 1.15;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.asset-items .text-preset {
		flex: 0 0 148px;
		block-size: 88px;
		flex-direction: column;
		gap: 0;
		padding-block-start: 6px;
		padding-block-end: 6px;
		padding-inline-start: 8px;
		padding-inline-end: 8px;
		border-style: solid;
		color: var(--ink);
	}
	.text-preset-sample {
		display: grid;
		flex: 1;
		align-items: center;
		font-size: 20px;
		font-weight: 400;
		line-height: 1.3;
		white-space: nowrap;
	}
	.text-preset strong {
		font-size: 12px;
	}
	.text-preset small {
		font-size: 10px;
		color: var(--muted);
		font-weight: 500;
	}
	@media (max-width: 720px) {
		.asset-tray {
			margin-block-end: 50px;
		}
		.filter-search {
			inline-size: 100%;
			margin-inline-start: 0;
		}
		.filter-search input {
			inline-size: 100%;
		}
	}
</style>
