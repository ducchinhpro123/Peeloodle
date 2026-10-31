import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/** The installed onnxruntime-web version: names the folder its runtime is served from. */
const ortVersion = JSON.parse(
	readFileSync(new URL('./node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8')
).version;

export default defineConfig({
	// `/vendor/ort/<version>/` in the cutout worker (see scripts/cutout/copy-ort-assets.mjs).
	define: { __ORT_VERSION__: JSON.stringify(ortVersion) },
	resolve: {
		alias: [
			{
				find: /^lucide-svelte$/,
				replacement: fileURLToPath(new URL('./src/lib/ui/icons.js', import.meta.url))
			},
			// The cutout worker loads ORT's WASM glue (`.mjs`) and binary from the
			// self-hosted `/vendor/ort/` (see scripts/cutout/copy-ort-assets.mjs). The
			// package's default "bundle" build embeds the glue and makes Vite emit a
			// second 27 MB copy of the `.wasm`; this is the same WebGPU build without it.
			{
				find: /^onnxruntime-web\/webgpu$/,
				replacement: fileURLToPath(
					new URL('./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', import.meta.url)
				)
			}
		]
	},
	// ORT loads its glue with a dynamic import, which needs an ES module worker.
	worker: { format: 'es' },
	// lucide-svelte ships Svelte dev-mode internals; compiling it from source keeps
	// the dev element instrumentation consistent with the app's Svelte version.
	optimizeDeps: { exclude: ['lucide-svelte'] },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		}),

		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			emitTsDeclarations: true
		})
	]
});
