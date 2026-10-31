/**
 * Copies the pinned onnxruntime-web WASM runtime into `static/vendor/ort/<version>/`,
 * where the cutout worker loads it from (`ort.env.wasm.wasmPaths`, built from the
 * same version via the `__ORT_VERSION__` define in vite.config.js), so no runtime
 * file comes from a third-party CDN. vercel.json serves `/vendor/ort/` as
 * `immutable`; the version folder makes that safe, because an upgrade changes
 * every URL instead of leaving returning users on a cached older `.wasm`. The `onnxruntime-web/webgpu`
 * build (aliased to `dist/ort.webgpu.min.mjs` in vite.config.js) uses the
 * asyncify variant for both its WebGPU and WASM execution providers: the `.mjs`
 * glue is imported at runtime and fetches the `.wasm` next to it.
 *
 * Runs before `dev` and `build`; the output is gitignored.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'node_modules/onnxruntime-web/dist');
const vendor = path.join(root, 'static/vendor/ort');
const FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

const { version } = JSON.parse(
	readFileSync(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8')
);

const target = path.join(vendor, version);

mkdirSync(target, { recursive: true });
// Drop other versions (and pre-versioning flat files) so only the pinned runtime is served.
for (const name of readdirSync(vendor)) {
	if (name !== version) rmSync(path.join(vendor, name), { recursive: true, force: true });
}
// Drop other variants inside the version folder.
for (const name of readdirSync(target)) {
	if (!FILES.includes(name)) rmSync(path.join(target, name), { recursive: true, force: true });
}
for (const name of FILES) {
	const from = path.join(dist, name);
	const to = path.join(target, name);
	let same = false;
	try {
		const a = statSync(from);
		const b = statSync(to);
		same = a.size === b.size && b.mtimeMs >= a.mtimeMs;
	} catch {
		same = false;
	}
	if (!same) copyFileSync(from, to);
}
console.log(
	`onnxruntime-web ${version}: copied ${FILES.length} runtime files to static/vendor/ort/${version}/`
);
