/**
 * UI state machine for "Remove background": runs one job for an image layer,
 * reports progress, and applies the mask as one undo step only if the job was
 * not cancelled and the layer is still the same unlocked image.
 */
import type { EditorState } from '#lib/editor/editorState.svelte.js';
import { removeBackground } from './removeBackground';
import { CutoutError, type CutoutErrorCode, type CutoutResult } from './protocol';

export type CutoutState = 'idle' | 'consent' | 'downloading' | 'running' | 'done' | 'error';

export type CutoutController = {
	readonly state: CutoutState;
	readonly message: string;
	readonly last: CutoutResult | null;
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
	unsupported: "Background removal isn't supported in this browser."
} as const;

/** Fewer than 1% or more than 99% kept pixels reads as "no clear subject". */
const DEGENERATE_MIN = 0.01;
const DEGENERATE_MAX = 0.99;

function errorMessage(code: CutoutErrorCode): string {
	switch (code) {
		case 'network':
		case 'integrity':
			return CUTOUT_COPY.download;
		case 'too-large':
			return CUTOUT_COPY.tooLarge;
		default:
			return CUTOUT_COPY.unsupported;
	}
}

class Controller implements CutoutController {
	state = $state<CutoutState>('idle');
	message = $state('');
	last = $state.raw<CutoutResult | null>(null);
	#editor: EditorState;
	#job: AbortController | null = null;
	#layerId: string | null = null;

	constructor(editor: EditorState) {
		this.#editor = editor;
	}

	start = async (layerId: string): Promise<void> => {
		if (this.#job) return;
		this.#layerId = layerId;
		await this.#run(layerId);
	};

	confirm = (): void => {
		if (this.state === 'consent' && this.#layerId) void this.#run(this.#layerId);
	};

	cancel = (): void => {
		this.#job?.abort();
		this.#job = null;
		this.state = 'idle';
		this.message = '';
	};

	retry = (): void => {
		if (this.#layerId && !this.#job) void this.start(this.#layerId);
	};

	async #run(layerId: string): Promise<void> {
		const editor = this.#editor;
		const documentId = editor.document?.id;
		const layer = editor.document?.layers.find((item) => item.id === layerId);
		if (!documentId || layer?.kind !== 'image' || layer.locked) return;
		const record = editor.assets[layer.assetId];
		if (!record) return;

		const job = new AbortController();
		this.#job = job;
		this.state = 'running';
		this.message = CUTOUT_COPY.running;
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
							Math.floor((progress.loaded / Math.max(1, progress.total)) * 100)
						);
						this.state = 'downloading';
						this.message = CUTOUT_COPY.downloading(percent);
					} else {
						this.state = 'running';
						this.message = CUTOUT_COPY.running;
					}
				}
			});
			// Stale guards, checked immediately before applying.
			if (job.signal.aborted || this.#job !== job) return;
			const current =
				editor.document?.id === documentId
					? editor.document.layers.find((item) => item.id === layerId)
					: undefined;
			if (current?.kind !== 'image' || current.locked || current.assetId !== layer.assetId) {
				this.state = 'idle';
				this.message = '';
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
				this.state = 'idle';
				this.message = '';
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
