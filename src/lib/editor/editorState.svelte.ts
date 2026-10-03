/**
 * Svelte rune port of the React editor store (`src/features/editor/store.ts`).
 *
 * The serializable `ProjectDocument` stays authoritative; Konva nodes, object
 * URLs and viewport state are never persisted. Every command below keeps the
 * source semantics: one history entry per completed gesture, revision bumps on
 * committed edits, assets/masks pruned against everything history can reach,
 * selection/zoom never dirty the document, and `markSaved` only clears the
 * revision that was actually persisted.
 *
 * An instance is created once per app tree (root layout) and shared through
 * context, so a draft survives navigation between `/create` and the editor.
 */

import { createProjectDocument } from '#lib/persistence/repository.js';
import type { AssetRecord, MaskRecord } from '#lib/persistence/repository.js';
import type {
	ImageFilters,
	Layer,
	LayerOutline,
	ProjectDocument,
	TextLayer,
	Transform
} from '#lib/domain/domain.js';
import { fitImageToArtboard } from '#lib/assets/assetLoader.js';
import type { MaskStroke } from './maskStroke';
import {
	assetsFor,
	cloneDocument,
	masksFor,
	replaceLayer,
	sameContent,
	touch,
	uniqueAssetIds
} from './editorStateHelpers';

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved-locally' | 'save-failed';
export type EditorTool = 'select' | 'pan' | 'text' | 'rotate' | 'erase' | 'restore';
export type Viewport = { zoom: number; panX: number; panY: number };

export const HISTORY_LIMIT = 50;
export type TextStyle = Pick<TextLayer, 'content' | 'fontFamily' | 'fontSize' | 'color'>;

const defaultViewport: Viewport = { zoom: 1, panX: 0, panY: 0 };

export class EditorState {
	workspaceEpoch = $state(0);
	document = $state.raw<ProjectDocument | null>(null);
	assets = $state.raw<Record<string, AssetRecord>>({});
	masks = $state.raw<Record<string, Blob>>({});
	brushSize = $state(30);
	/** The mask stroke in progress, if any; its commit is awaited before reads. */
	maskStroke = $state.raw<MaskStroke | null>(null);
	selectedLayerId = $state<string | null>(null);
	viewport = $state<Viewport>({ ...defaultViewport });
	past = $state.raw<ProjectDocument[]>([]);
	future = $state.raw<ProjectDocument[]>([]);
	saveStatus = $state<SaveStatus>('idle');
	saveError = $state<string | null>(null);
	loadError = $state<string | null>(null);
	loading = $state(false);
	dirty = $state(false);
	gestureActive = $state(false);
	gestureStart = $state.raw<ProjectDocument | null>(null);
	activeTool = $state<EditorTool>('select');
	uploadError = $state<string | null>(null);
	/**
	 * True while an editor route is attached to this draft. The save coordinator
	 * flips it on the route's mount/unmount, and the root layout's recovery banner
	 * reads it through `recoveryDraft()`, so it has to be reactive: the flag and the
	 * failed write can settle in either order.
	 */
	editorAttached = $state(true);

	selectedLayer = $derived(
		this.document?.layers.find((layer) => layer.id === this.selectedLayerId)
	);
	canUndo = $derived(this.past.length > 0);
	canRedo = $derived(this.future.length > 0);

	#resetFields(): void {
		this.document = null;
		this.assets = {};
		this.masks = {};
		this.brushSize = 30;
		this.maskStroke = null;
		this.selectedLayerId = null;
		this.viewport = { ...defaultViewport };
		this.past = [];
		this.future = [];
		this.saveStatus = 'idle';
		this.saveError = null;
		this.loadError = null;
		this.loading = false;
		this.dirty = false;
		this.gestureActive = false;
		this.gestureStart = null;
		this.activeTool = 'select';
		this.uploadError = null;
	}

	#withHistory(): {
		past: ProjectDocument[];
		future: ProjectDocument[];
		masks: Record<string, Blob>;
	} {
		if (!this.document || this.gestureActive)
			return { past: this.past, future: this.future, masks: this.masks };
		const past = [...this.past, cloneDocument(this.document)];
		if (past.length > HISTORY_LIMIT) past.shift();
		return { past, future: [], masks: masksFor(this.masks, [this.document, ...past]) };
	}

	/**
	 * The shared tail of every committed edit: record the new revision, prune
	 * assets and masks against the document and history that can still reach them,
	 * mark dirty, and keep a write that is already in flight marked as saving.
	 */
	#publishEdit(input: {
		past: ProjectDocument[];
		document: ProjectDocument;
		future?: ProjectDocument[];
		assets?: Record<string, AssetRecord>;
		masks?: Record<string, Blob>;
		selectedLayerId?: string | null;
		activeTool?: EditorTool;
		uploadError?: string | null;
		gestureActive?: boolean;
		gestureStart?: ProjectDocument | null;
	}): void {
		const future = input.future ?? [];
		const assets = input.assets ?? this.assets;
		const masks = input.masks ?? this.masks;
		this.past = input.past;
		this.future = future;
		this.document = input.document;
		this.assets = assetsFor(assets, [input.document, ...input.past, ...future]);
		this.masks = masksFor(masks, [input.document, ...input.past, ...future]);
		this.dirty = true;
		this.saveStatus = this.saveStatus === 'saving' ? 'saving' : 'unsaved';
		if (input.selectedLayerId !== undefined) this.selectedLayerId = input.selectedLayerId;
		if (input.activeTool !== undefined) this.activeTool = input.activeTool;
		if (input.uploadError !== undefined) this.uploadError = input.uploadError;
		if (input.gestureActive !== undefined) this.gestureActive = input.gestureActive;
		if (input.gestureStart !== undefined) this.gestureStart = input.gestureStart;
	}

	/**
	 * One edit command. Without an open gesture it records history, bumps the
	 * revision and prunes; live-preview commands pass `gesture: 'defer'` so a
	 * drag, slider or open text session mutates the working document only and
	 * `commitGesture` records the single entry when it ends.
	 */
	#commitEdit(input: {
		apply: (document: ProjectDocument) => ProjectDocument;
		gesture?: 'commit' | 'defer';
		asset?: AssetRecord;
		mask?: { key: string; blob: Blob };
		selectedLayerId?: string | null;
		activeTool?: EditorTool;
		uploadError?: string | null;
	}): boolean {
		if (!this.document) return false;
		const next = input.apply(this.document);
		if (input.gesture === 'defer' && this.gestureActive) {
			this.document = next;
			return true;
		}
		const history = this.#withHistory();
		this.#publishEdit({
			past: history.past,
			future: history.future,
			document: touch(next),
			assets: input.asset ? { ...this.assets, [input.asset.asset.id]: input.asset } : this.assets,
			masks: input.mask ? { ...this.masks, [input.mask.key]: input.mask.blob } : this.masks,
			selectedLayerId: input.selectedLayerId,
			activeTool: input.activeTool,
			uploadError: input.uploadError
		});
		return true;
	}

	createDraft = (id?: string): string => {
		const document = createProjectDocument({ id, title: 'Untitled Sticker' });
		const epoch = this.workspaceEpoch;
		this.#resetFields();
		this.workspaceEpoch = epoch;
		this.document = document;
		return document.id;
	};

	hydrate = (
		document: ProjectDocument,
		records: AssetRecord[],
		maskRecords: MaskRecord[] = []
	): void => {
		const assets: Record<string, AssetRecord> = {};
		for (const record of records) assets[record.asset.id] = record;
		const masks: Record<string, Blob> = {};
		for (const record of maskRecords) masks[record.key] = record.blob;
		const epoch = this.workspaceEpoch;
		this.#resetFields();
		this.workspaceEpoch = epoch;
		this.document = cloneDocument(document);
		this.assets = assets;
		this.masks = masks;
		this.selectedLayerId = document.layers.at(-1)?.id ?? null;
		this.saveStatus = 'saved-locally';
	};

	setLoadError = (message: string): void => {
		this.loadError = message;
		this.loading = false;
	};

	setLoading = (loading: boolean): void => {
		this.loading = loading;
	};

	selectLayer = (id: string | null): void => {
		if (id !== this.selectedLayerId && !this.maskStroke) this.commitGesture();
		this.selectedLayerId = id;
	};

	setViewport = (viewport: Partial<Viewport>): void => {
		const current = this.viewport;
		const zoom = viewport.zoom ?? current.zoom;
		const next = {
			zoom: Number.isFinite(zoom) ? Math.min(4, Math.max(0.25, zoom)) : current.zoom,
			panX: viewport.panX ?? current.panX,
			panY: viewport.panY ?? current.panY
		};
		if (next.zoom === current.zoom && next.panX === current.panX && next.panY === current.panY)
			return;
		this.viewport = next;
	};

	setTool = (tool: EditorTool): void => {
		this.activeTool = tool;
	};

	setBrushSize = (size: number): void => {
		if (Number.isFinite(size)) this.brushSize = Math.max(4, Math.min(120, Math.round(size)));
	};

	setUploadError = (message: string | null): void => {
		this.uploadError = message;
	};

	beginGesture = (): void => {
		if (!this.document || this.gestureActive) return;
		this.gestureActive = true;
		this.gestureStart = cloneDocument(this.document);
	};

	beginMaskStroke = (stroke: MaskStroke): void => {
		this.maskStroke = stroke;
	};

	/** Commits the registered stroke (no-op when none); a rejection keeps it registered. */
	commitMaskStroke = async (): Promise<void> => {
		const stroke = this.maskStroke;
		if (!stroke) return;
		await stroke.commit();
	};

	/** Forgets the registered stroke without committing. */
	abandonMaskStroke = (): void => {
		if (this.maskStroke) this.maskStroke = null;
	};

	commitGesture = (): void => {
		if (!this.gestureActive || !this.document || !this.gestureStart) {
			this.gestureActive = false;
			this.gestureStart = null;
			return;
		}
		if (sameContent(this.gestureStart, this.document)) {
			this.gestureActive = false;
			this.gestureStart = null;
			return;
		}
		this.#publishEdit({
			past: [...this.past, this.gestureStart].slice(-HISTORY_LIMIT),
			document: touch(this.document),
			gestureActive: false,
			gestureStart: null
		});
	};

	addImageLayer = (record: AssetRecord, name = 'Image'): void => {
		if (!this.document) return;
		const layerId = crypto.randomUUID();
		const activeTool = this.activeTool;
		this.#commitEdit({
			apply: (document) => {
				const layers: Layer[] = [
					...document.layers,
					{
						id: layerId,
						name,
						kind: 'image',
						assetId: record.asset.id,
						transform: fitImageToArtboard(record.asset.width, record.asset.height),
						opacity: 1,
						visible: true,
						locked: false
					}
				];
				return { ...document, layers, assetIds: uniqueAssetIds(layers) };
			},
			asset: record,
			selectedLayerId: layerId,
			uploadError: null,
			activeTool: activeTool === 'erase' || activeTool === 'restore' ? activeTool : 'select'
		});
	};

	replaceImageLayer = (id: string, record: AssetRecord): void => {
		const layer = this.document?.layers.find((item) => item.id === id);
		if (!this.document || layer?.kind !== 'image' || layer.locked || this.gestureActive) return;
		const original = this.assets[layer.assetId]?.asset;
		if (!original) return;
		const t = layer.transform;
		const width = layer.crop?.width ?? original.width;
		const height = layer.crop?.height ?? original.height;
		const scale = Math.min(
			Math.abs(width * t.scaleX) / record.asset.width,
			Math.abs(height * t.scaleY) / record.asset.height
		);
		const scaleX = Math.sign(t.scaleX) * scale;
		const scaleY = Math.sign(t.scaleY) * scale;
		const dx = (width * t.scaleX - record.asset.width * scaleX) / 2;
		const dy = (height * t.scaleY - record.asset.height * scaleY) / 2;
		const radians = (t.rotation * Math.PI) / 180;
		const transform = {
			...t,
			scaleX,
			scaleY,
			x: t.x + dx * Math.cos(radians) - dy * Math.sin(radians),
			y: t.y + dx * Math.sin(radians) + dy * Math.cos(radians)
		};
		this.#commitEdit({
			// Fit without stretching; old crop/mask coordinates cannot apply to a different photo.
			apply: (document) => {
				const layers = document.layers.map((item) =>
					item.id === id
						? { ...layer, assetId: record.asset.id, crop: undefined, maskKey: undefined, transform }
						: item
				);
				return { ...document, layers, assetIds: uniqueAssetIds(layers) };
			},
			asset: record,
			uploadError: null
		});
	};

	addTextLayer = (style: Partial<TextStyle> = {}): void => {
		if (!this.document) return;
		const layerId = crypto.randomUUID();
		const layer: TextLayer = {
			id: layerId,
			name: style.content ?? 'Text',
			kind: 'text',
			content: style.content ?? 'Text',
			fontFamily: style.fontFamily ?? 'Plus Jakarta Sans',
			fontSize: style.fontSize ?? 64,
			color: style.color ?? '#08152f',
			transform: { x: 320, y: 430, rotation: 0, scaleX: 1, scaleY: 1 },
			opacity: 1,
			visible: true,
			locked: false
		};
		this.#commitEdit({
			apply: (document) => ({ ...document, layers: [...document.layers, layer] }),
			selectedLayerId: layerId,
			activeTool: 'select'
		});
	};

	updateText = (
		id: string,
		patch: Partial<Pick<TextLayer, 'content' | 'fontFamily' | 'fontSize' | 'color'>>
	): void => {
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, id, (layer) =>
					layer.kind === 'text' ? { ...layer, ...patch } : layer
				),
			gesture: 'defer'
		});
	};

	updateTitle = (title: string): void => {
		this.#commitEdit({
			apply: (document) => ({ ...document, title }),
			gesture: 'defer'
		});
	};

	applyTransform = (id: string, transform: Transform): void => {
		const layer = this.document?.layers.find((item) => item.id === id);
		if (!this.document || !layer || layer.locked) return;
		this.#commitEdit({
			apply: (document) => replaceLayer(document, id, (item) => ({ ...item, transform })),
			gesture: 'defer'
		});
	};

	removeSelected = (): void => {
		const layer = this.selectedLayer;
		if (!this.document || !layer || layer.locked) return;
		this.#commitEdit({
			apply: (document) => {
				const layers = document.layers.filter((item) => item.id !== layer.id);
				return { ...document, layers, assetIds: uniqueAssetIds(layers) };
			},
			selectedLayerId: null
		});
	};

	duplicateSelected = (): void => {
		const layer = this.selectedLayer;
		if (!this.document || !layer) return;
		const copy: Layer = {
			...layer,
			id: crypto.randomUUID(),
			name: `${layer.name} copy`,
			transform: { ...layer.transform, x: layer.transform.x + 24, y: layer.transform.y + 24 },
			locked: false
		};
		this.#commitEdit({
			apply: (document) => {
				const layers = [...document.layers, copy];
				return { ...document, layers, assetIds: uniqueAssetIds(layers) };
			},
			selectedLayerId: copy.id
		});
	};

	nudgeSelected = (dx: number, dy: number): void => {
		const layer = this.selectedLayer;
		if (!this.document || !layer || layer.locked) return;
		this.applyTransform(layer.id, {
			...layer.transform,
			x: layer.transform.x + dx,
			y: layer.transform.y + dy
		});
	};

	rotateSelected90 = (): void => {
		const layer = this.selectedLayer;
		if (!this.document || !layer || layer.locked) return;
		const transform = layer.transform;
		const asset = layer.kind === 'image' ? this.assets[layer.assetId]?.asset : undefined;
		if (layer.kind === 'image' && asset) {
			const radians = (transform.rotation * Math.PI) / 180;
			const halfWidth = ((layer.crop?.width ?? asset.width) * transform.scaleX) / 2;
			const halfHeight = ((layer.crop?.height ?? asset.height) * transform.scaleY) / 2;
			const dx = halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians);
			const dy = halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians);
			// A quarter turn keeps the visible image center fixed, including crops and flips.
			this.applyTransform(layer.id, {
				...transform,
				x: transform.x + dx + dy,
				y: transform.y + dy - dx,
				rotation: transform.rotation + 90
			});
		} else {
			this.applyTransform(layer.id, { ...transform, rotation: transform.rotation + 90 });
		}
	};

	flipSelected = (axis: 'horizontal' | 'vertical'): void => {
		const layer = this.selectedLayer;
		if (!this.document || !layer || layer.locked || layer.kind !== 'image') return;
		const asset = this.assets[layer.assetId]?.asset;
		if (!asset) return;
		const transform = layer.transform;
		const radians = (transform.rotation * Math.PI) / 180;
		const dx = axis === 'horizontal' ? (layer.crop?.width ?? asset.width) * transform.scaleX : 0;
		const dy = axis === 'vertical' ? (layer.crop?.height ?? asset.height) * transform.scaleY : 0;
		this.applyTransform(layer.id, {
			...transform,
			x: transform.x + dx * Math.cos(radians) - dy * Math.sin(radians),
			y: transform.y + dx * Math.sin(radians) + dy * Math.cos(radians),
			scaleX: axis === 'horizontal' ? -transform.scaleX : transform.scaleX,
			scaleY: axis === 'vertical' ? -transform.scaleY : transform.scaleY
		});
	};

	reorderLayer = (id: string, direction: 'up' | 'down'): void => {
		if (!this.document) return;
		const index = this.document.layers.findIndex((item) => item.id === id);
		if (index === -1) return;
		const targetIndex = direction === 'up' ? index + 1 : index - 1;
		if (targetIndex < 0 || targetIndex >= this.document.layers.length) return;
		this.#commitEdit({
			apply: (document) => {
				const layers = [...document.layers];
				const [item] = layers.splice(index, 1);
				layers.splice(targetIndex, 0, item!);
				return { ...document, layers };
			}
		});
	};

	toggleLayerVisibility = (id: string): void => {
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, id, (layer) => ({ ...layer, visible: !layer.visible }))
		});
	};

	toggleLayerLock = (id: string): void => {
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, id, (layer) => ({ ...layer, locked: !layer.locked }))
		});
	};

	renameLayer = (id: string, name: string): void => {
		const trimmed = name.trim() || 'Layer';
		this.#commitEdit({
			apply: (document) => replaceLayer(document, id, (layer) => ({ ...layer, name: trimmed })),
			gesture: 'defer'
		});
	};

	updateFilters = (id: string, patch: Partial<ImageFilters>): void => {
		const defaultFilters: ImageFilters = {
			brightness: 0,
			contrast: 0,
			saturation: 0,
			grayscale: 0
		};
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, id, (layer) => {
					if (layer.kind !== 'image') return layer;
					const current = layer.filters ?? defaultFilters;
					return { ...layer, filters: { ...current, ...patch } };
				}),
			gesture: 'defer'
		});
	};

	resetFilters = (id: string): void => {
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, id, (layer) =>
					layer.kind === 'image' ? { ...layer, filters: undefined } : layer
				)
		});
	};

	updateOutline = (id: string, patch: Partial<LayerOutline>): void => {
		const defaultOutline: LayerOutline = { enabled: true, color: '#ffffff', width: 12 };
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, id, (layer) => {
					if (layer.kind !== 'image') return layer;
					const current = layer.outline ?? defaultOutline;
					return { ...layer, outline: { ...current, ...patch } };
				}),
			gesture: 'defer'
		});
	};

	applyMask = (layerId: string, maskKey: string, maskBlob: Blob): void => {
		const layer = this.document?.layers.find((item) => item.id === layerId);
		if (
			!this.document ||
			layer?.kind !== 'image' ||
			layer.locked ||
			layer.maskKey === maskKey ||
			!maskKey ||
			maskBlob.size === 0
		)
			return;
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, layerId, (item) =>
					item.kind === 'image' ? { ...item, maskKey } : item
				),
			mask: { key: maskKey, blob: maskBlob }
		});
	};

	clearMask = (layerId: string): void => {
		const layer = this.document?.layers.find((item) => item.id === layerId);
		if (!this.document || layer?.kind !== 'image' || layer.locked || !layer.maskKey) return;
		this.#commitEdit({
			apply: (document) =>
				replaceLayer(document, layerId, (item) =>
					item.kind === 'image' ? { ...item, maskKey: undefined } : item
				),
			uploadError: null
		});
	};

	undo = (): void => {
		if (this.maskStroke || this.gestureActive || !this.document || this.past.length === 0) return;
		const previous = this.past[this.past.length - 1]!;
		const document = touch({ ...previous, revision: this.document.revision });
		const past = this.past.slice(0, -1);
		const future = [...this.future, cloneDocument(this.document)];
		this.document = document;
		this.past = past;
		this.future = future;
		this.assets = assetsFor(this.assets, [document, ...past, ...future]);
		this.masks = masksFor(this.masks, [document, ...past, ...future]);
		this.selectedLayerId = previous.layers.some((layer) => layer.id === this.selectedLayerId)
			? this.selectedLayerId
			: null;
		this.dirty = true;
		this.saveStatus = 'unsaved';
	};

	redo = (): void => {
		if (this.maskStroke || this.gestureActive || !this.document || this.future.length === 0) return;
		const next = this.future[this.future.length - 1]!;
		const document = touch({ ...next, revision: this.document.revision });
		const future = this.future.slice(0, -1);
		const past = [...this.past, cloneDocument(this.document)];
		this.document = document;
		this.future = future;
		this.past = past;
		this.assets = assetsFor(this.assets, [document, ...past, ...future]);
		this.masks = masksFor(this.masks, [document, ...past, ...future]);
		this.selectedLayerId = next.layers.some((layer) => layer.id === this.selectedLayerId)
			? this.selectedLayerId
			: null;
		this.dirty = true;
		this.saveStatus = 'unsaved';
	};

	setSaveStatus = (status: SaveStatus, error: string | null = null): void => {
		this.saveStatus = status;
		this.saveError = error;
	};

	/** Save completion may only clear the revision actually persisted. */
	markSaved = (revision: number): void => {
		if (!this.document || this.document.revision !== revision) {
			this.saveStatus = this.dirty ? 'unsaved' : this.saveStatus;
			return;
		}
		this.dirty = false;
		this.saveStatus = 'saved-locally';
		this.saveError = null;
	};

	reset = (): void => {
		const epoch = this.workspaceEpoch;
		this.#resetFields();
		this.workspaceEpoch = epoch + 1;
	};
}

export function saveStatusLabel(status: SaveStatus, dirty: boolean): string {
	if (status === 'saving') return 'Saving';
	if (status === 'saved-locally') return 'Saved locally';
	if (status === 'save-failed') return 'Save failed';
	if (status === 'unsaved' || dirty) return 'Unsaved changes';
	return 'Not saved yet';
}
