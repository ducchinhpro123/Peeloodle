/**
 * Loads the background-removal model: memory → Cache Storage → network.
 *
 * The network body is streamed for progress, hashed in full, and only put into
 * Cache Storage after the SHA-256 matches, so an interrupted or tampered download
 * is never cached or loaded. Cache Storage is optional: when it is unavailable
 * (private mode, quota) the verified bytes are kept in memory for this session.
 */
import { CACHE_NAME, MODEL_BYTES, MODEL_SHA256, MODEL_URL } from './modelInfo';
import { CutoutError } from './protocol';

/** Marks a cache entry as written by this loader for this exact model. */
const HASH_HEADER = 'x-cutout-sha256';

let memory: ArrayBuffer | null = null;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cacheStorage(): CacheStorage | null {
	try {
		return typeof caches === 'undefined' ? null : caches;
	} catch {
		return null;
	}
}

/** Deletes caches left by earlier model versions. Best effort. */
async function pruneOldCaches(storage: CacheStorage): Promise<void> {
	try {
		const keys = await storage.keys();
		await Promise.all(
			keys
				.filter((key) => key.startsWith('cutout-') && key !== CACHE_NAME)
				.map((key) => storage.delete(key))
		);
	} catch {
		// Cache Storage may refuse in private mode; stale caches are not fatal.
	}
}

async function readCached(storage: CacheStorage): Promise<ArrayBuffer | null> {
	try {
		// `open` creates a missing cache; only look inside one that already exists.
		if (!(await storage.has(CACHE_NAME))) return null;
		const cache = await storage.open(CACHE_NAME);
		const response = await cache.match(MODEL_URL);
		if (!response) return null;
		const bytes = await response.arrayBuffer();
		if ((await sha256Hex(bytes)) === MODEL_SHA256) return bytes;
		await cache.delete(MODEL_URL);
		return null;
	} catch {
		return null;
	}
}

async function download(
	onProgress: (loaded: number, total: number) => void,
	signal: AbortSignal
): Promise<ArrayBuffer> {
	let response: Response;
	try {
		response = await fetch(MODEL_URL, { signal });
	} catch (error) {
		if (signal.aborted) throw new CutoutError('aborted');
		throw new CutoutError('network', error instanceof Error ? error.message : String(error));
	}
	if (!response.ok) throw new CutoutError('network', `HTTP ${response.status}`);

	const total = Number(response.headers.get('content-length')) || MODEL_BYTES;
	onProgress(0, total);
	if (!response.body) {
		let bytes: ArrayBuffer;
		try {
			bytes = await response.arrayBuffer();
		} catch (error) {
			if (signal.aborted) throw new CutoutError('aborted');
			throw new CutoutError('network', error instanceof Error ? error.message : String(error));
		}
		onProgress(bytes.byteLength, total);
		return bytes;
	}

	const chunks: Uint8Array[] = [];
	let loaded = 0;
	const reader = response.body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			loaded += value.byteLength;
			onProgress(loaded, Math.max(total, loaded));
		}
	} catch (error) {
		if (signal.aborted) throw new CutoutError('aborted');
		throw new CutoutError('network', error instanceof Error ? error.message : String(error));
	}
	const bytes = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes.buffer;
}

/**
 * Returns the verified model bytes. `downloadMs` is 0 when no network transfer
 * happened.
 */
export async function loadModel(
	onProgress: (loaded: number, total: number) => void,
	signal: AbortSignal,
	useCache = true
): Promise<{ bytes: ArrayBuffer; downloadMs: number }> {
	if (memory) return { bytes: memory, downloadMs: 0 };
	if (signal.aborted) throw new CutoutError('aborted');

	const storage = useCache ? cacheStorage() : null;
	if (storage) {
		await pruneOldCaches(storage);
		const cached = await readCached(storage);
		if (cached) {
			memory = cached;
			return { bytes: cached, downloadMs: 0 };
		}
	}
	if (signal.aborted) throw new CutoutError('aborted');

	const started = performance.now();
	const bytes = await download(onProgress, signal);
	if (signal.aborted) throw new CutoutError('aborted');
	if ((await sha256Hex(bytes)) !== MODEL_SHA256) {
		throw new CutoutError('integrity', 'The downloaded model does not match its SHA-256');
	}
	const downloadMs = Math.round(performance.now() - started);
	memory = bytes;

	if (storage) {
		try {
			const cache = await storage.open(CACHE_NAME);
			await cache.put(
				MODEL_URL,
				new Response(bytes, {
					headers: { 'content-type': 'application/octet-stream', [HASH_HEADER]: MODEL_SHA256 }
				})
			);
		} catch {
			// Quota or private mode: the in-memory copy serves this session.
		}
	}
	return { bytes, downloadMs };
}

/** True when a run would not need to download the model. */
export async function isModelCached(): Promise<boolean> {
	if (memory) return true;
	const storage = cacheStorage();
	if (!storage) return false;
	try {
		if (!(await storage.has(CACHE_NAME))) return false;
		const cache = await storage.open(CACHE_NAME);
		const response = await cache.match(MODEL_URL);
		return response?.headers.get(HASH_HEADER) === MODEL_SHA256;
	} catch {
		return false;
	}
}
