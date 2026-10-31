/**
 * Types shared by the background-removal worker, its public API and the UI.
 */

export type CutoutBackend = 'webgpu' | 'wasm';

export type CutoutErrorCode =
	'network' | 'integrity' | 'too-large' | 'unsupported' | 'size-mismatch' | 'aborted';

export class CutoutError extends Error {
	readonly code: CutoutErrorCode;

	constructor(code: CutoutErrorCode, message?: string) {
		super(message ?? code);
		this.name = 'CutoutError';
		this.code = code;
	}
}

export type CutoutProgress =
	{ phase: 'download'; loaded: number; total: number } | { phase: 'infer' };

export type CutoutResult = {
	/** PNG at the source's width×height: white RGB, alpha = keep. */
	mask: Blob;
	backend: CutoutBackend;
	/** Share of pixels with alpha ≥ 128, 0..1. */
	keptFraction: number;
	/** 0 when the model came from memory or Cache Storage. */
	downloadMs: number;
	/** Session creation (first run only) + pre-processing + inference + post-processing. */
	inferenceMs: number;
};

/** Main thread → worker. */
export type CutoutRequest =
	| { type: 'run'; id: number; image: Blob; width: number; height: number }
	| { type: 'cancel'; id: number };

/** Worker → main thread. */
export type CutoutResponse =
	| { type: 'progress'; id: number; progress: CutoutProgress }
	| { type: 'result'; id: number; result: CutoutResult }
	| { type: 'error'; id: number; code: CutoutErrorCode; message: string };
