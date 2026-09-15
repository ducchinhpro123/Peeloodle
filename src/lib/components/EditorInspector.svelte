<script>
	/**
	 * Sticker Properties panel, ported from the source `Inspector` in
	 * `src/features/editor/EditorPage.tsx`. Tabs keep the source contract
	 * (`role="tab"` + `data-state="active"`) so the shared stylesheet applies.
	 *
	 * Every continuous control opens one gesture and closes it, which is the
	 * source's "one slider drag is one undo entry" rule.
	 */
	import {
		ArrowDown,
		ArrowUp,
		Copy,
		Eye,
		EyeOff,
		FlipHorizontal2,
		FlipVertical2,
		Lock,
		RotateCw,
		Trash2,
		Unlock
	} from 'lucide-svelte';
	import Slider from './Slider.svelte';
	import ColorField from './ColorField.svelte';
	import { TEXT_FONTS, cssFontFamily } from '$lib/fonts';
	/** @typedef {import('$lib/editor/editorState.svelte').EditorState} EditorState */

	/**
	 * @type {{
	 *   editor: EditorState,
	 *   urls: Record<string, string>,
	 *   tab: string,
	 *   ontabchange: (tab: string) => void,
	 *   onuploadreplacement: (file: File, layerId: string) => void,
	 *   replacing?: boolean,
	 *   idPrefix?: string,
	 * }}
	 */
	let {
		editor,
		urls,
		tab,
		ontabchange,
		onuploadreplacement,
		replacing = false,
		idPrefix = 'inspector'
	} = $props();

	const tabs = [
		{ value: 'adjust', label: 'Adjust' },
		{ value: 'effects', label: 'Effects' },
		{ value: 'position', label: 'Position' },
		{ value: 'layers', label: 'Layers' }
	];

	/** @type {Array<{ key: 'brightness' | 'contrast' | 'saturation' | 'grayscale', label: string, min: number }>} */
	const filterFields = [
		{ key: 'brightness', label: 'Brightness', min: -100 },
		{ key: 'contrast', label: 'Contrast', min: -100 },
		{ key: 'saturation', label: 'Saturation', min: -100 },
		{ key: 'grayscale', label: 'Grayscale', min: 0 }
	];

	let doc = $derived(editor.document);
	let selected = $derived(editor.selectedLayer);
	let imageLayer = $derived(selected?.kind === 'image' ? selected : undefined);
	let textLayer = $derived(selected?.kind === 'text' ? selected : undefined);
	let brushTool = $derived(editor.activeTool === 'erase' || editor.activeTool === 'restore');

	/** @param {string} value */
	function changeTab(value) {
		// A focused field may unmount: close the open gesture first.
		if (!editor.maskStroke) editor.commitGesture();
		ontabchange(value);
	}
</script>

<aside class="inspector">
	<h2>Sticker Properties</h2>
	{#if imageLayer && doc}
		<div class="layer-card">
			<img class="layer-card-thumb" alt="" src={urls[imageLayer.assetId]} />
			<div class="layer-card-meta">
				<strong>{imageLayer.name}</strong>
				<small>
					{editor.assets[imageLayer.assetId]?.asset
						? `${editor.assets[imageLayer.assetId].asset.width} × ${editor.assets[imageLayer.assetId].asset.height}`
						: 'Image layer'}
				</small>
			</div>
			<div class="layer-card-actions">
				<button
					type="button"
					class="button"
					title="Keeps position, rotation, and effects; resets crop and mask data. Backgrounds are not removed automatically."
					disabled={imageLayer.locked || replacing}
					onclick={() => document.getElementById('replacement-photo-input')?.click()}
					>{replacing ? 'Replacing…' : 'Replace photo'}</button
				>
				<button
					type="button"
					class="button layer-delete"
					aria-label={`Delete ${imageLayer.name}`}
					onclick={() => {
						editor.selectLayer(imageLayer.id);
						editor.removeSelected();
					}}><Trash2 size={14} />Delete</button
				>
			</div>
			<input
				id="replacement-photo-input"
				type="file"
				accept="image/png,image/jpeg,image/webp"
				aria-label="Replacement photo"
				hidden
				onchange={(event) => {
					const input = event.currentTarget;
					const file = input.files?.[0];
					input.value = '';
					if (file && imageLayer) onuploadreplacement(file, imageLayer.id);
				}}
			/>
		</div>
	{/if}

	<div class="tabs-list" role="tablist" aria-label="Sticker properties">
		{#each tabs as item (item.value)}
			<button
				type="button"
				role="tab"
				id={`${idPrefix}-tab-${item.value}`}
				aria-selected={tab === item.value}
				aria-controls={`${idPrefix}-panel`}
				data-state={tab === item.value ? 'active' : 'inactive'}
				tabindex={tab === item.value ? 0 : -1}
				onclick={() => changeTab(item.value)}>{item.label}</button
			>
		{/each}
	</div>
	<div
		class="tabs-content"
		role="tabpanel"
		id={`${idPrefix}-panel`}
		aria-labelledby={`${idPrefix}-tab-${tab}`}
	>
		{#if tab === 'adjust'}
			{#if !selected}
				<p class="muted">Select a layer to edit its properties.</p>
			{:else if textLayer}
				{@render TextPanel(textLayer)}
			{:else if imageLayer}
				{@render ImagePanel(imageLayer)}
			{:else}
				<p class="muted">Shape style editing arrives later.</p>
			{/if}
		{:else if tab === 'effects'}
			{#if imageLayer}
				{@render EffectsPanel(imageLayer)}
			{:else}
				<p class="muted">
					Select an image layer to adjust brightness, contrast, saturation, and grayscale filters.
					No effect has been applied yet.
				</p>
			{/if}
		{:else if tab === 'position'}
			{#if selected}
				{@render PositionPanel(selected)}
			{:else}
				<p class="muted">Select a layer to change position.</p>
			{/if}
		{:else}
			{@render LayersPanel()}
		{/if}
	</div>
</aside>

{#snippet TextPanel(/** @type {import('$lib/domain/domain').TextLayer} */ text)}
	<div class="inspector-fields">
		<h3>Text layer</h3>
		<label>
			Content
			<textarea
				aria-label="Text content"
				value={text.content}
				onfocus={() => editor.beginGesture()}
				oninput={(event) => editor.updateText(text.id, { content: event.currentTarget.value })}
				onblur={() => editor.commitGesture()}></textarea>
		</label>
		<label>
			Font
			<select
				aria-label="Font family"
				value={text.fontFamily}
				onchange={(event) => {
					editor.setUploadError(null);
					editor.updateText(text.id, { fontFamily: event.currentTarget.value });
				}}
			>
				{#each TEXT_FONTS as font (font)}
					<option value={font}>{font}</option>
				{/each}
			</select>
		</label>
		<div class="font-preview" aria-hidden="true" style:font-family={cssFontFamily(text.fontFamily)}>
			{text.content || 'Aa'}
		</div>
		<label>
			<span>Size <small>{text.fontSize}px</small></span>
			<Slider
				value={text.fontSize}
				min={12}
				max={160}
				label="Font size"
				ongesturestart={() => editor.beginGesture()}
				ongestureend={() => editor.commitGesture()}
				oninput={(value) => editor.updateText(text.id, { fontSize: value })}
			/>
		</label>
		<div class="inspector-color">
			<span>Color</span>
			<ColorField
				label="Text color"
				color={text.color}
				ongesturestart={() => editor.beginGesture()}
				ongestureend={() => editor.commitGesture()}
				onchange={(color) =>
					editor.updateText(text.id, {
						color:
							color.length === 9 && color.toLowerCase().endsWith('ff') ? color.slice(0, 7) : color
					})}
			/>
		</div>
	</div>
{/snippet}

{#snippet ImagePanel(/** @type {import('$lib/domain/domain').ImageLayer} */ image)}
	{@const outline = image.outline ?? { enabled: false, color: '#ffffff', width: 12 }}
	<div class="inspector-fields">
		<label class="inspector-toggle">
			Outline
			<input
				class="inspector-switch-input"
				type="checkbox"
				aria-label="Toggle silhouette outline"
				checked={outline.enabled}
				onchange={(event) =>
					editor.updateOutline(image.id, { enabled: event.currentTarget.checked })}
			/>
		</label>
		<div class="inspector-color">
			<span>Color</span>
			<ColorField
				label="Outline color"
				color={outline.color}
				disabled={!outline.enabled}
				ongesturestart={() => editor.beginGesture()}
				ongestureend={() => editor.commitGesture()}
				onchange={(color) => editor.updateOutline(image.id, { color })}
			/>
		</div>
		<label>
			<span>Thickness</span>
			<span class="inspector-slider-value">
				<Slider
					value={outline.width}
					min={2}
					max={40}
					label="Outline thickness"
					disabled={!outline.enabled}
					ongesturestart={() => editor.beginGesture()}
					ongestureend={() => editor.commitGesture()}
					oninput={(value) => editor.updateOutline(image.id, { width: value })}
				/>
				<small>{outline.width} px</small>
			</span>
		</label>
		<p class="muted inspector-help">
			The outline follows visible pixels. An opaque photo outlines its rectangle; use Erase to make
			a cutout.
		</p>

		<div class="inspector-section">
			<b>Flip &amp; Rotate</b>
			<div class="button-row flip-row">
				<button type="button" class="button" onclick={() => editor.flipSelected('horizontal')}
					><FlipHorizontal2 size={14} />Flip H</button
				>
				<button type="button" class="button" onclick={() => editor.flipSelected('vertical')}
					><FlipVertical2 size={14} />Flip V</button
				>
				<button type="button" class="button" onclick={() => editor.rotateSelected90()}
					><RotateCw size={14} />Rotate 90°</button
				>
			</div>
		</div>

		<div class="inspector-section">
			<b>Background</b>
			<p class="muted" style="font-size: 12px">
				Automatic background removal is not available. Erase and Restore edit a mask; the original
				photo stays unchanged.
			</p>
			<div class="button-row">
				<button
					type="button"
					class={editor.activeTool === 'erase' ? 'button primary' : 'button'}
					onclick={() => editor.setTool(editor.activeTool === 'erase' ? 'select' : 'erase')}
					>Erase</button
				>
				<button
					type="button"
					class={editor.activeTool === 'restore' ? 'button primary' : 'button'}
					onclick={() => editor.setTool(editor.activeTool === 'restore' ? 'select' : 'restore')}
					>Restore</button
				>
				{#if image.maskKey}
					<button
						type="button"
						class="button"
						title="Reset mask to show full image"
						onclick={() => editor.clearMask(image.id)}>Reset Mask</button
					>
				{/if}
			</div>
		</div>

		{#if brushTool}
			<label>
				<span>Brush size</span>
				<span class="inspector-slider-value">
					<Slider
						value={editor.brushSize}
						min={4}
						max={120}
						label="Brush size"
						oninput={(value) => editor.setBrushSize(value)}
					/>
					<small>{editor.brushSize} px</small>
				</span>
			</label>
		{/if}
	</div>
{/snippet}

{#snippet EffectsPanel(/** @type {import('$lib/domain/domain').ImageLayer} */ image)}
	{@const filters = image.filters ?? { brightness: 0, contrast: 0, saturation: 0, grayscale: 0 }}
	<div class="inspector-fields">
		<h3>Filters &amp; Effects</h3>
		<p class="muted" style="font-size: 12px">
			Compose order: crop → mask → filters → silhouette outline → opacity → position. Zoom and pan
			do not change the sticker. Preview, save, and PNG export use this same order.
		</p>
		{#each filterFields as field (field.key)}
			<label>
				<span>{field.label} <small>{filters[field.key]}%</small></span>
				<Slider
					value={filters[field.key]}
					min={field.min}
					max={100}
					label={`Filter ${field.key}`}
					ongesturestart={() => editor.beginGesture()}
					ongestureend={() => editor.commitGesture()}
					oninput={(value) => editor.updateFilters(image.id, { [field.key]: value })}
				/>
			</label>
		{/each}
		<div class="button-row" style="margin-top: 12px">
			<button type="button" class="button" onclick={() => editor.resetFilters(image.id)}
				>Reset Filters</button
			>
		</div>
	</div>
{/snippet}

{#snippet PositionPanel(/** @type {import('$lib/domain/domain').Layer} */ layer)}
	{@const transform = layer.transform}
	<div class="inspector-fields">
		<div class="button-row">
			<button
				type="button"
				class="button"
				aria-label="Nudge left"
				onclick={() => editor.nudgeSelected(-8, 0)}>←</button
			>
			<button
				type="button"
				class="button"
				aria-label="Nudge right"
				onclick={() => editor.nudgeSelected(8, 0)}>→</button
			>
			<button
				type="button"
				class="button"
				aria-label="Nudge up"
				onclick={() => editor.nudgeSelected(0, -8)}>↑</button
			>
			<button
				type="button"
				class="button"
				aria-label="Nudge down"
				onclick={() => editor.nudgeSelected(0, 8)}>↓</button
			>
			<button type="button" class="button" onclick={() => editor.rotateSelected90()}
				>Rotate 90°</button
			>
		</div>
		<p class="muted">
			X {Math.round(transform.x)}, Y {Math.round(transform.y)}, {Math.round(transform.rotation)}°
		</p>
		<div class="button-row">
			<button type="button" class="button" onclick={() => editor.duplicateSelected()}
				>Duplicate</button
			>
			<button type="button" class="button" onclick={() => editor.removeSelected()}>Delete</button>
		</div>
	</div>
{/snippet}

{#snippet LayersPanel()}
	<div class="inspector-fields">
		<h3>Layers ({doc?.layers.length ?? 0})</h3>
		<p class="muted" style="font-size: 12px">
			Top is front. Reorder, hide, lock, or rename layers.
		</p>
		{#if !doc || doc.layers.length === 0}
			<p class="muted">No layers yet. Upload a photo or add text to start.</p>
		{:else}
			<div class="layer-stack">
				{#each [...doc.layers].reverse() as layer, reversedIndex (layer.id)}
					{@const originalIndex = doc.layers.length - 1 - reversedIndex}
					{@const isSelected = layer.id === selected?.id}
					{@const isTop = originalIndex === doc.layers.length - 1}
					{@const isBottom = originalIndex === 0}
					<div class="layer-row" class:active={isSelected}>
						<button
							type="button"
							class="layer-kind-tag"
							aria-label={`Select ${layer.name}`}
							aria-pressed={isSelected}
							onclick={() => editor.selectLayer(layer.id)}>{layer.kind}</button
						>
						<input
							class="layer-row-title"
							value={layer.name}
							aria-label={`Layer name: ${layer.name}`}
							onfocus={() => editor.beginGesture()}
							oninput={(event) => editor.renameLayer(layer.id, event.currentTarget.value)}
							onblur={() => editor.commitGesture()}
						/>
						<div class="layer-actions">
							<button
								type="button"
								class="layer-action-btn"
								class:dimmed={!layer.visible}
								title={layer.visible ? 'Hide layer' : 'Show layer'}
								aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
								onclick={() => editor.toggleLayerVisibility(layer.id)}
							>
								{#if layer.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
							</button>
							<button
								type="button"
								class="layer-action-btn"
								class:active={layer.locked}
								title={layer.locked ? 'Unlock layer' : 'Lock layer'}
								aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
								onclick={() => editor.toggleLayerLock(layer.id)}
							>
								{#if layer.locked}<Lock size={14} />{:else}<Unlock size={14} />{/if}
							</button>
							<button
								type="button"
								class="layer-action-btn"
								disabled={isTop}
								title="Bring forward"
								aria-label={`Bring ${layer.name} forward`}
								onclick={() => editor.reorderLayer(layer.id, 'up')}><ArrowUp size={14} /></button
							>
							<button
								type="button"
								class="layer-action-btn"
								disabled={isBottom}
								title="Send backward"
								aria-label={`Send ${layer.name} backward`}
								onclick={() => editor.reorderLayer(layer.id, 'down')}
								><ArrowDown size={14} /></button
							>
							<button
								type="button"
								class="layer-action-btn"
								title="Duplicate"
								aria-label={`Duplicate ${layer.name}`}
								onclick={() => {
									editor.selectLayer(layer.id);
									editor.duplicateSelected();
								}}><Copy size={14} /></button
							>
							<button
								type="button"
								class="layer-action-btn"
								title="Delete"
								aria-label={`Delete ${layer.name}`}
								onclick={() => {
									editor.selectLayer(layer.id);
									editor.removeSelected();
								}}><Trash2 size={14} /></button
							>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}
