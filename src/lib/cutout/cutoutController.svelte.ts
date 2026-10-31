/**
 * UI state machine for "Remove background": runs one job for an image layer,
 * reports progress, and applies the mask as one undo step only if the job was
 * not cancelled and the layer is still the same unlocked image.
 *
 * A watcher (created on first use, from an event handler, so no component owns
 * it) abandons the running job as soon as its layer is deleted, locked, given
 * another photo, painted with Erase/Restore, or its project closes; opening
 * another project also clears a finished run's status.
 */
import { untrack } from 'svelte';
import type { EditorState } from '#lib/editor/editorState.svelte.js';
import { isModelCached, removeBackground, workerDrained } from './removeBackground';
import { CutoutError, type CutoutErrorCode, type CutoutResult } from './protocol';

export type CutoutState = 'idle' | 'consent' | 'downloading' | 'running' | 'done' | 'error';

export type CutoutController = {
	readonly state: CutoutState;
	/**
	 * The image layer the state, message, progress and result belong to; null
	 * when idle with no run. Views show them only for this layer.
	 */
	readonly layerId: string | null;
	readonly message: string;
	readonly progress: number | null;
	readonly last: CutoutResult | null;
	/** Abandoned runs whose late worker output has settled and been discarded. */
	readonly dropped: number;
	/** A finished result is held until the open drag, slider or text session ends. */
	readonly deferred: boolean;
	start(layerId: string): Promise<void>;
	confirm(): void;
	cancel(): void;
	retry(): void;
};

export const CUTOUT_COPY = {
	downloading: (percent: number) => `Downloading model… ${percent}%`,
	running: 'Removing background…',
	success: 'Background removed — use Erase/Restore to touch up.',
	degenerate: "Couldn't find a clear subject — try Erase instead.",
	download: "Couldn't download the model. Check your connection.",
	tooLarge: 'This photo is too large for your device. Try a smaller one.',
	unsupported: "Background removal isn't supported in this browser.",
	unreadable: "Couldn't read this photo. Try uploading it again."
} as const;

/** Fewer than 1% or more than 99% kept pixels reads as "no clear subject". */
const DEGENERATE_MIN = 0.01;
const DEGENERATE_MAX = 0.99;

/** `missing-asset`: the layer's photo bytes are not loaded in the editor. */
function errorMessage(code: CutoutErrorCode | 'missing-asset'): string {
	switch (code) {
		case 'network':
		case 'integrity':
			return CUTOUT_COPY.download;
		case 'too-large':
			return CUTOUT_COPY.tooLarge;
		case 'size-mismatch':
		case 'missing-asset':
			return CUTOUT_COPY.unreadable;
		default:
			return CUTOUT_COPY.unsupported;
	}
}

class Controller implements CutoutController {
	state = $state<CutoutState>('idle');
	message = $state('');
	/** Download percent while `downloading`; null shows an indeterminate bar. */
	progress = $state<number | null>(null);
	last = $state.raw<CutoutResult | null>(null);
	dropped = $state(0);
	deferred = $state(false);
	layerId = $state<string | null>(null);
	#editor: EditorState;
	#job: AbortController | null = null;
	/** The bound layer's photo when the running job started. */
	#assetId: string | null = null;
	/** The project the status belongs to; `undefined` until the watcher starts. */
	#documentId: string | null | undefined = undefined;
	#tool: string | undefined = undefined;
	#watching = false;
	#starting = false;

	constructor(editor: EditorState) {
		this.#editor = editor;
	}

	/** Starts the watcher once; it lives as long as the EditorState. */
	#watch(): void {
		if (this.#watching) return;
		this.#watching = true;
		this.#documentId = this.#editor.document?.id ?? null;
		this.#tool = this.#editor.activeTool;
		$effect.root(() => {
			$effect(() => {
				const editor = this.#editor;
				// Dependencies: the document (layers, lock, assetId), strokes and the tool.
				void editor.document;
				void editor.maskStroke;
				void editor.activeTool;
				untrack(() => this.#guard());
			});
		});
	}

	#guard(): void {
		const editor = this.#editor;
		const documentId = editor.document?.id ?? null;
		const tool = editor.activeTool;
		const toolChanged = tool !== this.#tool;
		this.#tool = tool;
		if (documentId !== this.#documentId) {
			this.#documentId = documentId;
			this.#reset();
			return;
		}
		if (!this.#job || !this.layerId) return;
		const layer = editor.document?.layers.find((item) => item.id === this.layerId);
		const brushOnLayer =
			editor.maskStroke?.layerId === this.layerId ||
			(toolChanged &&
				(tool === 'erase' || tool === 'restore') &&
				editor.selectedLayerId === this.layerId);
		if (
			layer?.kind !== 'image' ||
			layer.locked ||
			layer.assetId !== this.#assetId ||
			brushOnLayer
		) {
			this.cancel();
		}
	}

	/** Aborts the running job; once the worker has settled it counts as dropped. */
	#abandon(): void {
		const job = this.#job;
		if (!job) return;
		this.#job = null;
		job.abort();
		void workerDrained().then(() => {
			this.dropped += 1;
		});
	}

	/**
	 * Resolves once no gesture is open (or the job is aborted). Applying inside an
	 * open gesture would fold the mask into that gesture's undo step, and the
	 * user's gesture is never committed on their behalf.
	 */
	#gestureEnded(signal: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			let settled = false;
			let stop = (): void => {};
			const done = (): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', done);
				queueMicrotask(() => stop());
				resolve();
			};
			signal.addEventListener('abort', done, { once: true });
			stop = $effect.root(() => {
				$effect(() => {
					if (!this.#editor.gestureActive) done();
				});
			});
		});
	}

	/** Back to a clean idle state, as for a newly opened project. */
	#reset(): void {
		this.#abandon();
		this.state = 'idle';
		this.message = '';
		this.progress = null;
		this.last = null;
		this.layerId = null;
		this.#assetId = null;
	}

	start = async (layerId: string): Promise<void> => {
		this.#watch();
		// `#starting` covers the async cache probe, so a double click is one job.
		if (this.#job || this.#starting || this.state === 'consent') return;
		// A new run: the previous run's status (perhaps on another layer) is cleared.
		if (layerId !== this.layerId) this.last = null;
		this.layerId = layerId;
		this.state = 'idle';
		this.message = '';
		this.#starting = true;
		try {
			if (!(await isModelCached())) {
				this.state = 'consent';
				this.message = '';
				return;
			}
		} finally {
			this.#starting = false;
		}
		await this.#run(layerId, false);
	};

	confirm = (): void => {
		if (this.state === 'consent' && this.layerId && !this.#job) {
			void this.#run(this.layerId, true);
		}
	};

	cancel = (): void => {
		this.#abandon();
		this.state = 'idle';
		this.message = '';
		this.progress = null;
	};

	/**
	 * Re-runs on the same layer. An error is only reachable after consent (or with
	 * the model already cached), so Retry does not ask again.
	 */
	retry = (): void => {
		const layerId = this.layerId;
		if (this.state !== 'error' || !layerId || this.#job || this.#starting) return;
		this.#starting = true;
		void isModelCached()
			.catch(() => false)
			.then((cached) => {
				this.#starting = false;
				if (this.state === 'error' && this.layerId === layerId && !this.#job) {
					return this.#run(layerId, !cached);
				}
			});
	};

	async #run(layerId: string, downloading: boolean): Promise<void> {
		const editor = this.#editor;
		const documentId = editor.document?.id;
		const layer = editor.document?.layers.find((item) => item.id === layerId);
		const record = layer?.kind === 'image' ? editor.assets[layer.assetId] : undefined;
		if (!documentId || layer?.kind !== 'image' || layer.locked) {
			// The button is disabled for these; a layer that changed under the click is a no-op.
			this.state = 'idle';
			this.message = '';
			return;
		}
		if (!record) {
			// The photo's bytes are not loaded: say so, and let Retry try again.
			this.state = 'error';
			this.message = errorMessage('missing-asset');
			this.progress = null;
			return;
		}

		const job = new AbortController();
		this.#job = job;
		this.#assetId = layer.assetId;
		this.#documentId = documentId;
		// After consent the request is in flight before the first byte arrives.
		this.state = downloading ? 'downloading' : 'running';
		this.message = downloading ? CUTOUT_COPY.downloading(0) : CUTOUT_COPY.running;
		this.progress = downloading ? 0 : null;
		try {
			const result = await removeBackground(record.blob, {
				width: record.asset.width,
				height: record.asset.height,
				signal: job.signal,
				onProgress: (progress) => {
					if (this.#job !== job) return;
					if (progress.phase === 'download') {
						const percent = Math.min(
							100,
							Math.round((progress.loaded / Math.max(1, progress.total)) * 100)
						);
						this.state = 'downloading';
						this.progress = percent;
						this.message = CUTOUT_COPY.downloading(percent);
					} else {
						this.progress = null;
						this.state = 'running';
						this.message = CUTOUT_COPY.running;
					}
				}
			});
			// Hold the result while a gesture is open; the guards below run after it.
			while (editor.gestureActive && !job.signal.aborted) {
				this.deferred = true;
				try {
					await this.#gestureEnded(job.signal);
				} finally {
					this.deferred = false;
				}
			}
			// Stale guards, checked immediately before applying.
			if (job.signal.aborted || this.#job !== job) return;
			const current =
				editor.document?.id === documentId
					? editor.document.layers.find((item) => item.id === layerId)
					: undefined;
			if (current?.kind !== 'image' || current.locked || current.assetId !== layer.assetId) {
				this.#job = null;
				this.state = 'idle';
				this.message = '';
				this.progress = null;
				this.dropped += 1;
				return;
			}
			editor.applyMask(layerId, crypto.randomUUID(), result.mask);
			this.last = result;
			this.state = 'done';
			this.message =
				result.keptFraction < DEGENERATE_MIN || result.keptFraction > DEGENERATE_MAX
					? CUTOUT_COPY.degenerate
					: CUTOUT_COPY.success;
		} catch (error) {
			if (job.signal.aborted || this.#job !== job) return;
			const code = error instanceof CutoutError ? error.code : 'unsupported';
			if (code === 'aborted') {
				// Aborted outside the controller (`disposeCutout` when the editor closes):
				// the worker is gone, so the run has settled and nothing will be applied.
				this.state = 'idle';
				this.message = '';
				this.progress = null;
				this.dropped += 1;
				return;
			}
			this.state = 'error';
			this.message = errorMessage(code);
		} finally {
			if (this.#job === job) this.#job = null;
		}
	}
}

export function createCutoutController(editor: EditorState): CutoutController {
	return new Controller(editor);
}

const controllers = new WeakMap<EditorState, CutoutController>();

/**
 * The controller shared by every Background section bound to `editor`, so a
 * running job survives the inspector remounting (tab switch, mobile sheet).
 */
export function cutoutControllerFor(editor: EditorState): CutoutController {
	let controller = controllers.get(editor);
	if (!controller) {
		controller = createCutoutController(editor);
		controllers.set(editor, controller);
	}
	return controller;
}
