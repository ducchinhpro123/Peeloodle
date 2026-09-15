<script>
	/**
	 * Direct Konva integration (no react-konva), ported from
	 * `src/features/editor/KonvaCanvas.tsx`.
	 *
	 * The stage is only a rendering layer: every gesture writes through the same
	 * document commands the inspector and shortcuts use, so Konva nodes, object
	 * URLs and viewport state never enter the persisted document.
	 */
	import Konva from 'konva';
	import { ARTBOARD_SIZE } from '$lib/domain/domain';
	import { getStageMetrics, viewportAfterWheel } from '$lib/editor/maskUtils';
	import { createMaskBrush } from '$lib/editor/maskBrush';
	import {
		createImageSurface,
		decodeMaskImage,
		formatCssFilter
	} from '$lib/exports/renderDocument';
	import { cssFontFamily, loadFont, measureTextEditBox } from '$lib/fonts';
	/** @typedef {import('$lib/editor/editorState.svelte').EditorState} EditorState */
	import DomCanvas from './DomCanvas.svelte';

	/**
	 * @type {{
	 *   editor: EditorState,
	 *   urls: Record<string, string>,
	 *   domFallback?: boolean,
	 * }}
	 */
	let { editor, urls, domFallback = import.meta.env.MODE === 'test' } = $props();

	let host = $state(/** @type {HTMLDivElement | undefined} */ (undefined));
	let size = $state({ width: 640, height: 480 });
	/** @type {Konva.Stage | undefined} */
	let stage;
	/** @type {Konva.Layer | undefined} */
	let sceneLayer;
	/** @type {Konva.Transformer | undefined} */
	let transformer;
	/** @type {Konva.Rect | undefined} */
	let artboardRect;
	/** @type {Map<string, Konva.Node>} */
	// Imperative Konva/canvas caches, never read from the template: reactive
	// collections would proxy Konva nodes and canvases for no benefit.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const nodes = new Map();
	/** @type {Map<string, { signature: string, canvas: HTMLCanvasElement | null }>} */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const surfaces = new Map();

	let imagesVersion = $state(0);
	let fontsLoaded = $state(/** @type {string[]} */ ([]));
	let maskVersion = $state(0);
	/** @type {Map<string, CanvasImageSource>} */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const maskImages = new Map();
	/** @type {Map<string, HTMLImageElement>} */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const htmlImages = new Map();
	/** @type {string | null} */
	let editingTextId = $state(null);
	let spaceHeld = $state(false);
	let panning = $state(false);
	let brushActive = $derived(editor.activeTool === 'erase' || editor.activeTool === 'restore');
	let panMode = $derived(editor.activeTool === 'pan' || spaceHeld || panning);
	let brushCursor = $state(/** @type {HTMLDivElement | undefined} */ (undefined));

	/**
	 * The pointer/encoding lifetime of one mask stroke (port of the source
	 * `useMaskBrush`). Preview frames repoint the live Konva image directly; the
	 * committed document takes over on the reconcile after `applyMask`.
	 */
	const brush = createMaskBrush({
		editor: () => editor,
		host: () => host,
		cursor: () => brushCursor,
		blocked: () => spaceHeld || panning || editor.activeTool === 'pan',
		preview: (layerId, live) => previewMask(layerId, live)
	});

	$effect(() => {
		// The brush's pointer pipeline follows the source hook's element listeners.
		if (domFallback || !host) return;
		const element = host;
		const handlers = brush.handlers;
		element.addEventListener('pointerdown', handlers.onpointerdown);
		element.addEventListener('pointermove', handlers.onpointermove);
		element.addEventListener('pointerup', handlers.onpointerup);
		element.addEventListener('pointercancel', handlers.onpointercancel);
		element.addEventListener('lostpointercapture', handlers.onlostpointercapture);
		element.addEventListener('pointerleave', handlers.onpointerleave);
		return () => {
			element.removeEventListener('pointerdown', handlers.onpointerdown);
			element.removeEventListener('pointermove', handlers.onpointermove);
			element.removeEventListener('pointerup', handlers.onpointerup);
			element.removeEventListener('pointercancel', handlers.onpointercancel);
			element.removeEventListener('lostpointercapture', handlers.onlostpointercapture);
			element.removeEventListener('pointerleave', handlers.onpointerleave);
		};
	});

	$effect(() => {
		// Source: the stroke ends when the tool, selection, viewport, brush size or
		// document changes. `sync()` compares against the values at stroke start,
		// so the selection write made by the stroke's own pointer-down cannot end it.
		void editor.activeTool;
		void editor.selectedLayerId;
		void editor.viewport;
		void editor.brushSize;
		void editor.document?.id;
		brush.sync();
	});

	$effect(() => {
		// No reactive reads: this effect exists only to own the brush's teardown.
		return () => brush.dispose();
	});

	/**
	 * Repoints one image node at the live mask canvas while a stroke paints.
	 * `null` means the stroke ended; the next reconcile restores the committed
	 * surface (`ensureSurface` re-runs because `applyMask` changed the document).
	 *
	 * @param {string} layerId
	 * @param {HTMLCanvasElement | null} live
	 */
	function previewMask(layerId, live) {
		if (!live) return;
		const node = nodes.get(layerId);
		const layer = editor.document?.layers.find((item) => item.id === layerId);
		const asset = layer?.kind === 'image' ? editor.assets[layer.assetId]?.asset : undefined;
		const image = layer?.kind === 'image' ? htmlImages.get(layer.assetId) : undefined;
		if (!(node instanceof Konva.Image) || !layer || layer.kind !== 'image' || !asset || !image)
			return;
		const padding = layer.outline?.enabled ? Math.ceil(layer.outline.width) : 0;
		const width = layer.crop?.width ?? asset.width;
		const height = layer.crop?.height ?? asset.height;
		// Source parity: preview rasters cap at 1024 px; masks and exports stay
		// full-resolution. Without this a 2048 px photo composites every frame.
		const previewRatio = Math.min(1, 1024 / (Math.max(width, height) + padding * 2));
		const surface = /** @type {HTMLCanvasElement} */ (
			createImageSurface(
				image,
				{ crop: layer.crop, filters: layer.filters, outline: layer.outline },
				width,
				height,
				undefined,
				live,
				previewRatio
			).canvas
		);
		node.image(surface);
		node.width(width + padding * 2);
		node.height(height + padding * 2);
		node.offset({ x: padding, y: padding });
		node.getLayer()?.batchDraw();
	}

	$effect(() => {
		if (domFallback || !host) return;
		const stageInstance = new Konva.Stage({ container: host, ...measureHost() });
		const layerInstance = new Konva.Layer();
		artboardRect = new Konva.Rect({
			name: 'artboard',
			width: ARTBOARD_SIZE,
			height: ARTBOARD_SIZE,
			listening: true
		});
		transformer = new Konva.Transformer({
			rotateEnabled: true,
			enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
			boundBoxFunc: (oldBox, newBox) =>
				Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox
		});
		layerInstance.add(artboardRect);
		layerInstance.add(transformer);
		stageInstance.add(layerInstance);
		stageInstance.on('mousedown touchstart', (event) => {
			if (brushActive || panMode) return;
			if (event.target === stageInstance || event.target.name() === 'artboard')
				editor.selectLayer(null);
		});
		stage = stageInstance;
		sceneLayer = layerInstance;
		const observer = new ResizeObserver(() => {
			size = measureHost();
		});
		observer.observe(host);
		return () => {
			observer.disconnect();
			htmlImages.clear();
			maskImages.clear();
			surfaces.clear();
			nodes.clear();
			stageInstance.destroy();
			stage = undefined;
			sceneLayer = undefined;
			transformer = undefined;
			artboardRect = undefined;
		};
	});

	$effect(() => {
		stage?.size({ width: size.width, height: size.height });
	});

	function measureHost() {
		return { width: host?.clientWidth || 640, height: host?.clientHeight || 480 };
	}

	// Load asset images and mask rasters before the scene reads them.
	$effect(() => {
		if (domFallback) return;
		const assets = editor.assets;
		for (const id of Object.keys(assets)) {
			const url = urls[id];
			if (!url || htmlImages.has(id)) continue;
			const element = new window.Image();
			element.onload = () => {
				htmlImages.set(id, element);
				imagesVersion += 1;
			};
			element.src = url;
		}
		const document = editor.document;
		// Evict rasters no layer references any more (a replaced or cleared mask) and
		// release bitmap-backed ones, instead of pinning every mask ever decoded.
		/** @type {Set<string>} */
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping for one pass
		const liveMaskKeys = new Set();
		for (const layer of document?.layers ?? []) {
			if (layer.kind === 'image' && layer.maskKey) liveMaskKeys.add(layer.maskKey);
		}
		for (const [key, image] of [...maskImages]) {
			if (liveMaskKeys.has(key)) continue;
			maskImages.delete(key);
			if ('close' in image && typeof image.close === 'function') image.close();
		}
		for (const layer of document?.layers ?? []) {
			if (layer.kind !== 'image' || !layer.maskKey) continue;
			const blob = editor.masks[layer.maskKey];
			const asset = editor.assets[layer.assetId]?.asset;
			if (!blob || !asset || maskImages.has(layer.maskKey)) continue;
			const key = layer.maskKey;
			void decodeMaskImage(blob, asset.width, asset.height)
				.then((image) => {
					maskImages.set(key, image);
					maskVersion += 1;
				})
				.catch((error) =>
					editor.setUploadError(
						error instanceof Error ? error.message : 'Could not decode image mask'
					)
				);
		}
	});

	// Konva caches text measurements at construction, so mount text only after its font loads.
	$effect(() => {
		if (domFallback) return;
		/** @type {string[]} */
		const families = [];
		for (const layer of editor.document?.layers ?? []) {
			if (layer.kind !== 'text' || !layer.visible) continue;
			if (!families.includes(layer.fontFamily)) families.push(layer.fontFamily);
		}
		for (const family of families) {
			if (fontsLoaded.includes(family)) continue;
			void loadFont(family)
				.then(() => (fontsLoaded = [...fontsLoaded, family]))
				.catch((error) =>
					editor.setUploadError(error instanceof Error ? error.message : `Could not load ${family}`)
				);
		}
	});

	$effect(() => {
		if (domFallback || !stage || !sceneLayer) return;
		const document = editor.document;
		const selectedLayerId = editor.selectedLayerId;
		const viewport = editor.viewport;
		const activeTool = editor.activeTool;
		void activeTool;
		const maskTick = maskVersion;
		const imageTick = imagesVersion;
		const editedId = editingTextId;
		void maskTick;
		void imageTick;

		const metrics = getStageMetrics(size.width, size.height, viewport);
		stage.scale({ x: metrics.viewScale, y: metrics.viewScale });
		stage.position({ x: metrics.stageX, y: metrics.stageY });

		/** @type {Set<string>} */
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping for one reconcile pass
		const live = new Set();
		for (const layer of document?.layers ?? []) {
			if (!layer.visible) continue;
			const node = ensureNode(layer);
			if (!node) continue;
			live.add(layer.id);
			applyTransformToNode(node, layer);
			node.visible(layer.kind !== 'text' || layer.id !== editedId);
			node.opacity(layer.kind === 'text' && layer.id === editedId ? 0 : layer.opacity);
			node.draggable(!layer.locked && !panMode && !brushActive);
			node.listening(!(layer.kind === 'text' && layer.id === editedId));
			if (layer.kind === 'text') {
				const text = /** @type {Konva.Text} */ (node);
				text.text(layer.content);
				text.fontFamily(cssFontFamily(layer.fontFamily));
				text.fontSize(layer.fontSize);
				text.fill(layer.color);
			}
		}
		for (const [id, node] of nodes) {
			if (live.has(id)) continue;
			node.destroy();
			nodes.delete(id);
			surfaces.delete(id);
		}

		const selectedNode = selectedLayerId ? nodes.get(selectedLayerId) : undefined;
		const selectedLayer = document?.layers.find((layer) => layer.id === selectedLayerId);
		const canTransform =
			selectedNode &&
			selectedLayer?.visible &&
			!selectedLayer.locked &&
			!editedId &&
			!panMode &&
			!brushActive;
		transformer?.nodes(canTransform ? [selectedNode] : []);
		transformer?.moveToTop();
		sceneLayer.batchDraw();
	});

	/**
	 * @param {import('$lib/domain/domain').Layer} layer
	 * @returns {Konva.Node | undefined}
	 */
	function ensureNode(layer) {
		const existing = nodes.get(layer.id);
		if (layer.kind === 'image') {
			const surface = ensureSurface(layer);
			if (!surface) return undefined;
			const padding = layer.outline?.enabled ? Math.ceil(layer.outline.width) : 0;
			const width = surface.width + padding * 2;
			const height = surface.height + padding * 2;
			if (existing instanceof Konva.Image) {
				// The image node is reused across reconcile passes, exactly like the
				// source's React-Konva props: a changed asset, crop, mask, filter or
				// outline must re-point the raster *and* the padded geometry, or the
				// canvas keeps showing the pre-edit surface while the document,
				// export and reload use the new one.
				if (
					existing.image() !== surface.canvas ||
					existing.width() !== width ||
					existing.height() !== height ||
					existing.offsetX() !== padding ||
					existing.offsetY() !== padding
				) {
					existing.image(surface.canvas);
					existing.width(width);
					existing.height(height);
					existing.offset({ x: padding, y: padding });
				}
				return existing;
			}
			existing?.destroy();
			const node = new Konva.Image({
				x: layer.transform.x,
				y: layer.transform.y,
				rotation: layer.transform.rotation,
				scaleX: layer.transform.scaleX,
				scaleY: layer.transform.scaleY,
				image: surface.canvas,
				width,
				height,
				offsetX: padding,
				offsetY: padding
			});
			sceneLayer?.add(node);
			nodes.set(layer.id, node);
			bindHandlers(node, layer.id, layer.kind);
			return node;
		}
		if (layer.kind === 'text') {
			if (!fontsLoaded.includes(layer.fontFamily)) return undefined;
			if (existing instanceof Konva.Text) return existing;
			existing?.destroy();
			const node = new Konva.Text({
				x: layer.transform.x,
				y: layer.transform.y,
				rotation: layer.transform.rotation,
				scaleX: layer.transform.scaleX,
				scaleY: layer.transform.scaleY,
				lineHeight: 1,
				wrap: 'none',
				align: 'left',
				verticalAlign: 'top'
			});
			sceneLayer?.add(node);
			nodes.set(layer.id, node);
			bindHandlers(node, layer.id, layer.kind);
			return node;
		}
		if (existing && !(existing instanceof Konva.Text)) return existing;
		existing?.destroy();
		const node =
			layer.shape === 'circle'
				? new Konva.Ellipse({
						x: layer.transform.x,
						y: layer.transform.y,
						rotation: layer.transform.rotation,
						scaleX: layer.transform.scaleX,
						scaleY: layer.transform.scaleY,
						radiusX: 60,
						radiusY: 60,
						fill: layer.fill
					})
				: new Konva.Rect({
						x: layer.transform.x,
						y: layer.transform.y,
						rotation: layer.transform.rotation,
						scaleX: layer.transform.scaleX,
						scaleY: layer.transform.scaleY,
						width: 120,
						height: 120,
						fill: layer.fill
					});
		sceneLayer?.add(node);
		nodes.set(layer.id, node);
		bindHandlers(node, layer.id, layer.kind);
		return node;
	}

	/**
	 * Composites crop → mask → filters → outline once per distinct appearance, then
	 * reuses that canvas through drag/zoom frames (the source's `useMemo` seam).
	 *
	 * @param {import('$lib/domain/domain').ImageLayer} layer
	 * @returns {{ canvas: CanvasImageSource, width: number, height: number } | undefined}
	 */
	function ensureSurface(layer) {
		const asset = editor.assets[layer.assetId];
		const image = htmlImages.get(layer.assetId);
		const maskImage = layer.maskKey ? (maskImages.get(layer.maskKey) ?? null) : null;
		if (!asset || !image) return undefined;
		if (layer.maskKey && !maskImage) return undefined;
		const width = layer.crop?.width ?? asset.asset.width;
		const height = layer.crop?.height ?? asset.asset.height;
		const signature = JSON.stringify([
			layer.assetId,
			layer.crop,
			layer.filters,
			layer.outline,
			layer.maskKey,
			width,
			height
		]);
		const cached = surfaces.get(layer.id);
		if (cached && cached.signature === signature) {
			return { canvas: /** @type {CanvasImageSource} */ (cached.canvas ?? image), width, height };
		}
		const plain =
			!layer.crop &&
			!maskImage &&
			!layer.outline?.enabled &&
			formatCssFilter(layer.filters) === 'none';
		const canvas = plain
			? null
			: /** @type {HTMLCanvasElement} */ (
					createImageSurface(
						image,
						{ crop: layer.crop, filters: layer.filters, outline: layer.outline },
						width,
						height,
						undefined,
						maskImage
					).canvas
				);
		const surface = /** @type {CanvasImageSource} */ (canvas ?? image);
		surfaces.set(layer.id, { signature, canvas });
		return { canvas: surface, width, height };
	}

	/**
	 * @param {Konva.Node} node
	 * @param {import('$lib/domain/domain').Layer} layer
	 */
	function applyTransformToNode(node, layer) {
		node.position({ x: layer.transform.x, y: layer.transform.y });
		node.rotation(layer.transform.rotation);
		node.scale({ x: layer.transform.scaleX, y: layer.transform.scaleY });
	}

	/**
	 * Binds this app's listeners exactly once per node, namespaced `.app` so that
	 * Konva's own drag listeners (`.konva`) are never removed. Handlers resolve the
	 * current layer by id, so they never close over a stale document.
	 *
	 * @param {Konva.Node} node
	 * @param {string} layerId
	 * @param {import('$lib/domain/domain').Layer['kind']} kind
	 */
	function bindHandlers(node, layerId, kind) {
		node.off('.app');
		const current = () => editor.document?.layers.find((item) => item.id === layerId);
		const interactive = () => {
			const layer = current();
			return Boolean(layer && !layer.locked && !panMode && !brushActive);
		};
		node.on(
			'mousedown.app touchstart.app',
			(/** @type {Konva.KonvaEventObject<MouseEvent>} */ event) => {
				if (!interactive()) return;
				event.cancelBubble = true;
				editor.selectLayer(layerId);
			}
		);
		node.on('dragstart.app', () => {
			if (!interactive()) return;
			editor.selectLayer(layerId);
			editor.beginGesture();
		});
		node.on('dragmove.app', (/** @type {Konva.KonvaEventObject<DragEvent>} */ event) =>
			editor.applyTransform(layerId, readTransform(event.target))
		);
		node.on('dragend.app', (/** @type {Konva.KonvaEventObject<DragEvent>} */ event) => {
			editor.applyTransform(layerId, readTransform(event.target));
			editor.commitGesture();
		});
		node.on('transformstart.app', () => {
			if (!interactive()) return;
			editor.beginGesture();
		});
		node.on('transform.app', (/** @type {Konva.KonvaEventObject<Event>} */ event) =>
			editor.applyTransform(layerId, readTransform(event.target))
		);
		node.on('transformend.app', (/** @type {Konva.KonvaEventObject<Event>} */ event) => {
			editor.applyTransform(layerId, readTransform(event.target));
			editor.commitGesture();
		});
		if (kind === 'text') {
			const startEditing = (/** @type {Konva.KonvaEventObject<Event>} */ event) => {
				if (!interactive()) return;
				event.cancelBubble = true;
				editor.selectLayer(layerId);
				editor.beginGesture();
				editingTextId = layerId;
			};
			node.on('dblclick.app', startEditing);
			node.on('dbltap.app', startEditing);
		}
	}

	/** @param {Konva.Node} node */
	function readTransform(node) {
		return {
			x: node.x(),
			y: node.y(),
			rotation: node.rotation(),
			scaleX: node.scaleX(),
			scaleY: node.scaleY()
		};
	}

	/** Wheel zoom (cursor anchored), space/hand pan and pointer pan, as the source. */
	$effect(() => {
		if (domFallback || !host) return;
		const element = host;
		/** @type {{ pointerId: number, x: number, y: number } | null} */
		let panRef = null;

		const onWheel = (/** @type {WheelEvent} */ event) => {
			if (event.deltaY === 0) return;
			event.preventDefault();
			const rect = element.getBoundingClientRect();
			editor.setViewport(
				viewportAfterWheel(
					element.clientWidth,
					element.clientHeight,
					editor.viewport,
					event.clientX - rect.left,
					event.clientY - rect.top,
					event.deltaY,
					event.deltaMode
				)
			);
		};
		const onPointerDown = (/** @type {PointerEvent} */ event) => {
			if (event.button !== 0 || event.pointerType === 'touch') return;
			if (!spaceHeld && editor.activeTool !== 'pan') return;
			event.preventDefault();
			event.stopPropagation();
			try {
				element.setPointerCapture(event.pointerId);
			} catch {
				// pointerup still ends the pan
			}
			panRef = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
			panning = true;
		};
		const onPointerMove = (/** @type {PointerEvent} */ event) => {
			if (!panRef || panRef.pointerId !== event.pointerId) return;
			const dx = event.clientX - panRef.x;
			const dy = event.clientY - panRef.y;
			panRef.x = event.clientX;
			panRef.y = event.clientY;
			const viewport = editor.viewport;
			editor.setViewport({ panX: viewport.panX + dx, panY: viewport.panY + dy });
		};
		const endPan = (/** @type {PointerEvent} */ event) => {
			if (!panRef || panRef.pointerId !== event.pointerId) return;
			panRef = null;
			panning = false;
			if (element.hasPointerCapture?.(event.pointerId)) {
				try {
					element.releasePointerCapture(event.pointerId);
				} catch {
					// already released
				}
			}
		};

		element.addEventListener('wheel', onWheel, { capture: true, passive: false });
		element.addEventListener('pointerdown', onPointerDown, true);
		element.addEventListener('pointermove', onPointerMove);
		element.addEventListener('pointerup', endPan);
		element.addEventListener('pointercancel', endPan);
		element.addEventListener('lostpointercapture', endPan);
		return () => {
			element.removeEventListener('wheel', onWheel, true);
			element.removeEventListener('pointerdown', onPointerDown, true);
			element.removeEventListener('pointermove', onPointerMove);
			element.removeEventListener('pointerup', endPan);
			element.removeEventListener('pointercancel', endPan);
			element.removeEventListener('lostpointercapture', endPan);
		};
	});

	let textEditor = $state(/** @type {HTMLTextAreaElement | undefined} */ (undefined));

	$effect(() => {
		if (editingTextId && textEditor) textEditor.focus();
	});

	let editing = $derived(
		editingTextId ? editor.document?.layers.find((layer) => layer.id === editingTextId) : undefined
	);
	let editingNode = $derived(editingTextId ? nodes.get(editingTextId) : undefined);
	let editingBox = $derived.by(() => {
		if (!editing || editing.kind !== 'text') return null;
		const scale = editingNode ? editingNode.getAbsoluteScale() : { x: 1, y: 1 };
		const fontSize = editing.fontSize * Math.abs(scale.y || scale.x || 1);
		const context = globalThis.document?.createElement('canvas').getContext('2d');
		const box = context
			? measureTextEditBox(context, editing.content || ' ', editing.fontFamily, fontSize)
			: { width: fontSize * 4, height: fontSize };
		const position = editingNode ? editingNode.getAbsolutePosition() : { x: 24, y: 24 };
		const rotation = editingNode ? editingNode.getAbsoluteRotation() : editing.transform.rotation;
		return { fontSize, box, position, rotation };
	});

	function stopEditing() {
		editor.commitGesture();
		editingTextId = null;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.code !== 'Space' && event.key !== ' ') return;
		if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
		// Space inside a dialog or on any interactive control belongs to that control:
		// preventDefault here would swallow the button's own activation (the source
		// canvas disabled its Space handling entirely while a dialog was open).
		if (globalThis.document?.querySelector('dialog[open]')) return;
		const target = /** @type {HTMLElement | null} */ (event.target);
		if (
			target?.closest?.(
				'input, textarea, select, button, a[href], summary, [contenteditable="true"], ' +
					'[role="slider"], [role="dialog"], [role="button"], [role="link"]'
			)
		) {
			return;
		}
		event.preventDefault();
		if (spaceHeld) return;
		spaceHeld = true;
		if (editor.gestureActive) editor.commitGesture();
		void editor.commitMaskStroke().catch(() => undefined);
	}}
	onkeyup={(event) => {
		if (event.code !== 'Space' && event.key !== ' ') return;
		spaceHeld = false;
	}}
	onblur={() => (spaceHeld = false)}
/>

{#if domFallback}
	<DomCanvas {editor} {urls} />
{:else}
	<div
		class="artboard-host{brushActive ? ' brush-active' : ''}{spaceHeld ? ' space-pan' : ''}{panning
			? ' is-panning'
			: ''}"
		data-testid="editor-canvas"
		data-space-pan={spaceHeld || undefined}
		data-panning={panning || undefined}
		bind:this={host}
	>
		{#if editing && editing.kind === 'text' && editingBox}
			<textarea
				class="canvas-text-edit"
				aria-label="Edit canvas text"
				bind:this={textEditor}
				value={editing.content}
				rows={Math.max(1, editing.content.split('\n').length)}
				style:left="{editingBox.position.x}px"
				style:top="{editingBox.position.y}px"
				style:width="{editingBox.box.width}px"
				style:height="{editingBox.box.height}px"
				style:font-family={cssFontFamily(editing.fontFamily)}
				style:font-size="{editingBox.fontSize}px"
				style:color={editing.color}
				style:transform={editingBox.rotation ? `rotate(${editingBox.rotation}deg)` : undefined}
				oninput={(event) => {
					if (editing?.kind === 'text')
						editor.updateText(editing.id, { content: event.currentTarget.value });
				}}
				onblur={stopEditing}
				onkeydown={(event) => {
					if (event.key === 'Escape') event.currentTarget.blur();
				}}></textarea>
		{/if}
		<div
			bind:this={brushCursor}
			class="brush-cursor"
			data-testid="brush-cursor"
			aria-hidden="true"
			style="display: none"
		></div>
	</div>
{/if}

<style>
	.artboard-host {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 320px;
		touch-action: none;
	}
	.artboard-host.space-pan,
	.artboard-host.is-panning {
		cursor: grab;
	}
	.artboard-host.is-panning {
		cursor: grabbing;
	}
	.artboard-host.brush-active {
		cursor: crosshair;
	}
	.canvas-text-edit {
		position: absolute;
		margin: 0;
		padding: 0;
		border: 1px dashed var(--mint);
		background: #ffffffd9;
		transform-origin: top left;
		line-height: 1;
		resize: none;
		overflow: hidden;
	}
</style>
