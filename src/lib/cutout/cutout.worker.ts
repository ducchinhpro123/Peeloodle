/// <reference lib="webworker" />
/**
 * Background-removal worker: the only module that imports onnxruntime-web.
 *
 * One ORT session is created lazily and reused across jobs. WebGPU is tried only
 * when an adapter resolves; any failure there falls back to single-threaded WASM
 * (no SharedArrayBuffer, so no COOP/COEP requirement). One job runs at a time;
 * `cancel` marks the job aborted and the flag is checked between stages.
 */
import * as ort from 'onnxruntime-web/webgpu';
import { postprocess, preprocess } from './isnet';
import { loadModel } from './modelLoader';
import { MODEL_INPUT_SIZE } from './modelInfo';
import {
	CutoutError,
	type CutoutBackend,
	type CutoutRequest,
	type CutoutResponse
} from './protocol';

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = '/vendor/ort/';
ort.env.wasm.numThreads = 1;

type GpuNavigator = { gpu?: { requestAdapter(): Promise<unknown> } };

let session: ort.InferenceSession | null = null;
let backend: CutoutBackend = 'wasm';
const aborted = new Set<number>();
const controllers = new Map<number, AbortController>();
/** Jobs run strictly one after another: a cancelled job may still hold the session. */
let queue: Promise<void> = Promise.resolve();

function post(message: CutoutResponse) {
	self.postMessage(message);
}

async function webGpuAvailable(): Promise<boolean> {
	try {
		const adapter = await (navigator as unknown as GpuNavigator).gpu?.requestAdapter();
		return adapter != null;
	} catch {
		return false;
	}
}

async function createSession(bytes: ArrayBuffer, target: CutoutBackend) {
	return ort.InferenceSession.create(new Uint8Array(bytes), {
		executionProviders: [target],
		graphOptimizationLevel: 'all'
	});
}

async function ensureSession(bytes: ArrayBuffer): Promise<ort.InferenceSession> {
	if (session) return session;
	if (await webGpuAvailable()) {
		try {
			session = await createSession(bytes, 'webgpu');
			backend = 'webgpu';
			return session;
		} catch {
			session = null;
		}
	}
	try {
		session = await createSession(bytes, 'wasm');
		backend = 'wasm';
		return session;
	} catch (error) {
		session = null;
		throw new CutoutError('unsupported', error instanceof Error ? error.message : String(error));
	}
}

async function infer(bytes: ArrayBuffer, input: Float32Array): Promise<Float32Array> {
	const tensor = () => new ort.Tensor('float32', input, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
	const once = async (active: ort.InferenceSession) => {
		const outputs = await active.run({ [active.inputNames[0]]: tensor() });
		const output = outputs[active.outputNames[0]];
		const data = (await output.getData()) as Float32Array;
		for (const value of Object.values(outputs)) value.dispose();
		return data;
	};
	const active = await ensureSession(bytes);
	try {
		return await once(active);
	} catch (error) {
		if (backend !== 'webgpu') {
			throw new CutoutError('unsupported', error instanceof Error ? error.message : String(error));
		}
		// WebGPU inference failed: rebuild on WASM once.
		await active.release().catch(() => undefined);
		session = null;
		try {
			session = await createSession(bytes, 'wasm');
			backend = 'wasm';
			return await once(session);
		} catch (fallbackError) {
			session = null;
			throw new CutoutError(
				'unsupported',
				fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
			);
		}
	}
}

async function run(id: number, image: Blob, width: number, height: number) {
	const controller = controllers.get(id) ?? new AbortController();
	const checkpoint = () => {
		if (aborted.has(id)) throw new CutoutError('aborted');
	};
	try {
		checkpoint();
		const { bytes, downloadMs } = await loadModel(
			(loaded, total) =>
				post({ type: 'progress', id, progress: { phase: 'download', loaded, total } }),
			controller.signal
		);
		checkpoint();
		post({ type: 'progress', id, progress: { phase: 'infer' } });
		const started = performance.now();

		let bitmap: ImageBitmap;
		try {
			bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
		} catch (error) {
			throw new CutoutError('unsupported', error instanceof Error ? error.message : String(error));
		}
		let input: Float32Array;
		try {
			if (bitmap.width !== width || bitmap.height !== height) {
				throw new CutoutError(
					'size-mismatch',
					`Decoded ${bitmap.width}×${bitmap.height}, expected ${width}×${height}`
				);
			}
			input = preprocess(bitmap);
		} finally {
			bitmap.close();
		}
		checkpoint();
		const output = await infer(bytes, input);
		checkpoint();
		const { mask, keptFraction } = await postprocess(output, width, height);
		checkpoint();
		post({
			type: 'result',
			id,
			result: {
				mask,
				backend,
				keptFraction,
				downloadMs,
				inferenceMs: Math.round(performance.now() - started)
			}
		});
	} catch (error) {
		const failure =
			error instanceof CutoutError
				? error
				: error instanceof RangeError
					? new CutoutError('too-large', error.message)
					: new CutoutError('unsupported', error instanceof Error ? error.message : String(error));
		post({ type: 'error', id, code: failure.code, message: failure.message });
	} finally {
		controllers.delete(id);
		aborted.delete(id);
	}
}

self.onmessage = (event: MessageEvent<CutoutRequest>) => {
	const message = event.data;
	if (message.type === 'run') {
		controllers.set(message.id, new AbortController());
		const { id, image, width, height } = message;
		queue = queue.then(() => run(id, image, width, height));
	} else if (message.type === 'cancel' && controllers.has(message.id)) {
		aborted.add(message.id);
		controllers.get(message.id)?.abort();
	}
};
