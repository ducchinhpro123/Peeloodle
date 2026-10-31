/**
 * Public background-removal API. Owns the worker's lifecycle: created on the
 * first call, one job at a time, terminated by `disposeCutout()` or replaced
 * after a crash. onnxruntime-web is only ever loaded inside the worker.
 */
import { isModelCached as modelCached } from './modelLoader';
import {
	CutoutError,
	type CutoutProgress,
	type CutoutRequest,
	type CutoutResponse,
	type CutoutResult
} from './protocol';

type PendingJob = {
	id: number;
	resolve: (result: CutoutResult) => void;
	reject: (error: CutoutError) => void;
	onProgress?: (progress: CutoutProgress) => void;
	cleanup: () => void;
	/** The worker reported the inference phase: the model loaded and the run began. */
	inferring: boolean;
};

let worker: Worker | null = null;
let pending: PendingJob | null = null;
let nextId = 1;
/** The worker holds the verified model in memory (covers Cache Storage being unavailable). */
let workerHasModel = false;
/** Runs the worker has not finished yet, cancelled ones included (each ends with one result/error). */
let inflight = 0;
let drainWaiters: Array<() => void> = [];

function drained() {
	if (inflight > 0) return;
	const waiters = drainWaiters;
	drainWaiters = [];
	for (const resolve of waiters) resolve();
}

function settle(job: PendingJob) {
	if (pending === job) pending = null;
	job.cleanup();
}

function failPending(error: CutoutError) {
	const job = pending;
	if (!job) return;
	settle(job);
	job.reject(error);
}

function send(target: Worker, message: CutoutRequest) {
	target.postMessage(message);
}

function getWorker(): Worker {
	if (worker) return worker;
	const created = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' });
	created.onmessage = (event: MessageEvent<CutoutResponse>) => {
		const message = event.data;
		if (message.type !== 'progress') {
			inflight = Math.max(0, inflight - 1);
			drained();
		}
		const job = pending;
		if (!job || job.id !== message.id) return;
		if (message.type === 'progress') {
			if (message.progress.phase === 'infer') job.inferring = true;
			job.onProgress?.(message.progress);
		} else if (message.type === 'result') {
			settle(job);
			workerHasModel = true;
			job.resolve(message.result);
		} else {
			settle(job);
			job.reject(new CutoutError(message.code, message.message));
		}
	};
	created.onerror = (event) => {
		event.preventDefault();
		// A crashed worker (e.g. out of memory) is replaced on the next call.
		created.terminate();
		if (worker === created) {
			worker = null;
			workerHasModel = false;
			inflight = 0;
			drained();
		}
		// Heuristic: a worker that dies mid-inference has almost always run out of memory.
		const code = pending?.inferring ? 'too-large' : 'unsupported';
		failPending(new CutoutError(code, event.message || 'The background remover crashed'));
	};
	worker = created;
	return created;
}

export function removeBackground(
	image: Blob,
	opts: {
		width: number;
		height: number;
		signal?: AbortSignal;
		onProgress?: (p: CutoutProgress) => void;
	}
): Promise<CutoutResult> {
	if (pending) {
		return Promise.reject(new CutoutError('aborted', 'Another background removal is running'));
	}
	if (opts.signal?.aborted) return Promise.reject(new CutoutError('aborted'));
	const target = getWorker();
	const id = nextId++;
	return new Promise<CutoutResult>((resolve, reject) => {
		const onAbort = () => {
			if (pending?.id !== id) return;
			if (worker === target) send(target, { type: 'cancel', id });
			failPending(new CutoutError('aborted'));
		};
		const job: PendingJob = {
			id,
			resolve,
			reject,
			onProgress: opts.onProgress,
			cleanup: () => opts.signal?.removeEventListener('abort', onAbort),
			inferring: false
		};
		pending = job;
		opts.signal?.addEventListener('abort', onAbort, { once: true });
		inflight += 1;
		send(target, {
			type: 'run',
			id,
			image,
			width: opts.width,
			height: opts.height,
			useCache: typeof caches !== 'undefined'
		});
	});
}

/** True when a run would not need to download the model. */
export function isModelCached(): Promise<boolean> {
	if (workerHasModel) return Promise.resolve(true);
	return typeof caches === 'undefined' ? Promise.resolve(false) : modelCached();
}

/**
 * Resolves once the worker has finished every run it was sent, including
 * cancelled ones whose output is discarded (or the worker is gone).
 */
export function workerDrained(): Promise<void> {
	if (inflight === 0) return Promise.resolve();
	return new Promise((resolve) => drainWaiters.push(resolve));
}

/** Terminates the worker (and its session); a pending job rejects as aborted. */
export function disposeCutout(): void {
	worker?.terminate();
	worker = null;
	workerHasModel = false;
	inflight = 0;
	drained();
	failPending(new CutoutError('aborted'));
}
