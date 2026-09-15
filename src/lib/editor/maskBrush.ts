/**
 * The mask brush pointer pipeline, ported from
 * `../Peeloodle/src/features/editor/useMaskBrush.ts` (React main `54eae61c`).
 *
 * Pointer capture, preview frames and PNG encoding live here, outside the
 * serializable document. A stroke is registered with the editor
 * (`beginMaskStroke`) as the single awaitable continuation saving, exporting,
 * reloading and tool switches share; the pointer-up commit encodes the canvas
 * exactly once and applies it as one history entry.
 */

import type { EditorState } from './editorState.svelte';
import type { ImageLayer, ProjectDocument } from '../domain/domain';
import {
	canvasToPngBlob,
	getBrushRadiiInImage,
	getStageMetrics,
	screenToImageLocal
} from './maskUtils';
import { createMaskPainter, loadMaskCanvas } from './maskPainter';
import type { MaskStroke } from './maskStroke';

type LocalPoint = { u: number; v: number };
/** The editor view values whose change ends the active stroke (source subscription). */
type StrokeBaseline = {
	tool: EditorState['activeTool'];
	layerId: string | null;
	viewport: EditorState['viewport'];
	brushSize: number;
	document: ProjectDocument | null;
};

export type MaskBrushOptions = {
	/** A getter so the caller's reactive binding is read at call time, not captured. */
	editor: () => EditorState;
	host: () => HTMLDivElement | undefined;
	cursor: () => HTMLDivElement | undefined;
	/**
	 * True while the canvas is in a pan mode (Space held, the pan tool, or an
	 * active pan): the brush stands down so a Space-pan drag cannot paint. The
	 * source suppressed the brush through React's delegated handlers; a direct
	 * listener needs the mode check explicitly.
	 */
	blocked: () => boolean;
	/**
	 * Live preview frame for a layer: a canvas while painting, `null` when the
	 * stroke ends and the committed document takes over again.
	 */
	preview: (layerId: string, canvas: HTMLCanvasElement | null) => void;
};

export function createMaskBrush(options: MaskBrushOptions) {
	const editor = options.editor();
	const { host, cursor, blocked, preview } = options;
	let frame: number | null = null;
	let active: {
		pointerId: number;
		paint: (event: PointerEvent) => void;
		finish: () => Promise<void>;
	} | null = null;
	let baseline: StrokeBaseline | null = null;

	function hideCursor() {
		const element = cursor();
		if (element) element.style.display = 'none';
	}

	function pointerdown(event: PointerEvent) {
		const state = editor;
		if (
			active ||
			state.maskStroke ||
			state.gestureActive ||
			event.button !== 0 ||
			blocked() ||
			(state.activeTool !== 'erase' && state.activeTool !== 'restore')
		)
			return;
		const hostElement = host();
		const doc = state.document;
		if (!hostElement || !doc) return;
		const candidate =
			doc.layers.find((layer) => layer.id === state.selectedLayerId && layer.kind === 'image') ??
			[...doc.layers]
				.reverse()
				.find((layer) => layer.kind === 'image' && layer.visible && !layer.locked);
		if (!candidate || candidate.kind !== 'image' || candidate.locked || !candidate.visible) return;
		const layer: ImageLayer = structuredClone(candidate);
		const asset = state.assets[layer.assetId]?.asset;
		if (!asset) return;
		const metrics = getStageMetrics(
			hostElement.clientWidth,
			hostElement.clientHeight,
			state.viewport
		);
		const radii = getBrushRadiiInImage(state.brushSize, layer);
		if (![radii.x, radii.y].every((radius) => Number.isFinite(radius) && radius > 0)) return;
		const mode = state.activeTool;
		const sourceBlob = layer.maskKey ? state.masks[layer.maskKey] : undefined;
		if (layer.maskKey && !sourceBlob) {
			state.setUploadError('The image mask is missing. Reload or reset the mask before painting.');
			return;
		}
		const point = (sourceEvent: PointerEvent) => {
			const rect = hostElement.getBoundingClientRect();
			return screenToImageLocal(
				{ x: sourceEvent.clientX - rect.left, y: sourceEvent.clientY - rect.top },
				layer,
				asset,
				metrics
			);
		};
		const first = point(event);
		if (!Number.isFinite(first.u) || !Number.isFinite(first.v)) return;
		state.selectLayer(layer.id);
		state.setUploadError(null);
		event.preventDefault();
		try {
			hostElement.setPointerCapture(event.pointerId);
		} catch {
			// Pointer-up still finalizes without capture.
		}
		let phase: 'drawing' | 'finishing' | 'failed' = 'drawing';
		let canvas: HTMLCanvasElement | undefined;
		let painter: ReturnType<typeof createMaskPainter> | undefined;
		let last: LocalPoint | undefined;
		const queued: LocalPoint[] = [first];
		let pending: Promise<void> | null = null;
		let failureMessage: string | null = null;
		// Registered with the editor as soon as painting starts; its commit is what
		// saves, exports and tool switches await.
		const session: MaskStroke = { layerId: layer.id, commit: () => finish() };

		const isCurrent = () => {
			const current = editor;
			const target = current.document?.layers.find((item) => item.id === layer.id);
			return (
				current.maskStroke === session &&
				current.document?.id === doc.id &&
				target?.kind === 'image' &&
				target.maskKey === layer.maskKey &&
				target.visible &&
				!target.locked
			);
		};
		const previewFrame = () => {
			if (frame !== null || !canvas) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				if (canvas && isCurrent()) preview(layer.id, canvas);
			});
		};
		const paintPoint = (next: LocalPoint) => {
			if (!painter) {
				queued.push(next);
				return;
			}
			painter.paint(last ?? next, next, radii, mode);
			last = next;
			previewFrame();
		};
		const ready = loadMaskCanvas(asset.width, asset.height, sourceBlob).then((loaded) => {
			canvas = loaded;
			painter = createMaskPainter(loaded, layer.crop);
			for (const queuedPoint of queued) paintPoint(queuedPoint);
			queued.length = 0;
		});
		// A release/save may arrive after decoding fails; keep that failure observable to finish().
		void ready.catch(() => undefined);

		const clean = () => {
			if (frame !== null) {
				cancelAnimationFrame(frame);
				frame = null;
			}
			preview(layer.id, null);
			if (active?.finish === finish) active = null;
			baseline = null;
			if (editor.maskStroke === session) editor.abandonMaskStroke();
			if (hostElement.hasPointerCapture(event.pointerId)) {
				hostElement.releasePointerCapture(event.pointerId);
			}
		};
		const finish = (): Promise<void> => {
			if (pending) return pending;
			phase = 'finishing';
			pending = (async () => {
				await ready;
				if (!isCurrent() || !canvas || !painter?.hasChanges()) {
					clean();
					return;
				}
				const blob = await canvasToPngBlob(canvas);
				if (isCurrent()) {
					editor.applyMask(layer.id, crypto.randomUUID(), blob);
					if (failureMessage && editor.uploadError === failureMessage) editor.setUploadError(null);
				}
				clean();
			})().catch((error: unknown) => {
				phase = 'failed';
				pending = null;
				if (!canvas) clean();
				if (editor.document?.id === doc.id) {
					const message =
						error instanceof Error ? error.message : 'Could not finish the mask stroke';
					failureMessage = canvas
						? `${message}. Save to retry; the stroke is retained.`
						: `${message}. Reload or reset the mask before painting.`;
					editor.setUploadError(failureMessage);
					editor.setSaveStatus('save-failed', message);
				} else {
					clean();
				}
				throw error;
			});
			return pending;
		};
		active = {
			pointerId: event.pointerId,
			finish,
			paint: (next) => {
				if (phase === 'drawing' && next.pointerId === event.pointerId) paintPoint(point(next));
			}
		};
		// The values at stroke start: a later change finishes the stroke rather than
		// splitting it across documents/tools (`sync()` below, source subscription).
		baseline = {
			tool: state.activeTool,
			layerId: state.selectedLayerId,
			viewport: state.viewport,
			brushSize: state.brushSize,
			document: doc
		};
		editor.beginMaskStroke(session);
	}

	function pointermove(event: PointerEvent) {
		const state = editor;
		const hostElement = host();
		const cursorElement = cursor();
		if (
			hostElement &&
			cursorElement &&
			(state.activeTool === 'erase' || state.activeTool === 'restore')
		) {
			const box = hostElement.getBoundingClientRect();
			const { viewScale } = getStageMetrics(
				hostElement.clientWidth,
				hostElement.clientHeight,
				state.viewport
			);
			cursorElement.style.display = 'block';
			cursorElement.style.left = `${event.clientX - box.left}px`;
			cursorElement.style.top = `${event.clientY - box.top}px`;
			cursorElement.style.width = cursorElement.style.height = `${state.brushSize * viewScale}px`;
			cursorElement.style.border = `2px dashed ${state.activeTool === 'erase' ? '#ff4d9a' : '#08b879'}`;
		}
		active?.paint(event);
	}

	function end(event: PointerEvent) {
		if (active?.pointerId === event.pointerId) void active.finish().catch(() => undefined);
	}

	function leave() {
		if (!active) hideCursor();
	}

	/** Commits the active stroke; the editor state reads as unchanged until it lands. */
	function finishActive() {
		void active?.finish().catch(() => undefined);
	}

	/**
	 * Ends the active stroke when the pointer's view changed: tool, selection,
	 * viewport, brush size or document. Called from the host's reactive effect,
	 * which is where the source hook's store subscription ran.
	 */
	function sync() {
		if (!active || !baseline) return;
		const state = editor;
		const changed =
			state.activeTool !== baseline.tool ||
			state.selectedLayerId !== baseline.layerId ||
			state.viewport !== baseline.viewport ||
			state.brushSize !== baseline.brushSize ||
			// Any document-object change, not just an id change: the source finished
			// the stroke when `next.document !== previous.document`.
			state.document !== baseline.document;
		if (!changed) return;
		hideCursor();
		finishActive();
	}

	function dispose() {
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		finishActive();
	}

	return {
		handlers: {
			onpointerdown: pointerdown,
			onpointermove: pointermove,
			onpointerup: end,
			onpointercancel: end,
			onlostpointercapture: end,
			onpointerleave: leave
		},
		sync,
		finishActive,
		dispose
	};
}
