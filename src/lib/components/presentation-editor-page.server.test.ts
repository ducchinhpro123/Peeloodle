/**
 * The presentation editor's server-side import graph.
 *
 * Konva's Node entry top-level-requires the native `canvas` package, which is not
 * installed, so nothing the page imports statically may reach it: the slide canvas
 * lives behind a browser-only `$effect` for exactly that reason. This test loads
 * the page through a dedicated Vite server in SSR mode (a fresh server, not the
 * test runner's shared module loader, which can deadlock with browser mode), so
 * a static Konva import throws the real `Cannot find module 'canvas'` error here.
 *
 * The production build and its Playwright suite resolve Konva's browser entry and
 * never notice, which is why this guard has to load the module as the server does.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = path.resolve(import.meta.dirname, '../../..');

/** Minimal `$app/*` modules so the app code loads outside SvelteKit. */
function appStub(id: string, code: string): Plugin {
	const virtual = `\0${id}`;
	return {
		name: `stub-${id}`,
		resolveId: (source) => (source === id ? virtual : null),
		load: (resolved) => (resolved === virtual ? code : null)
	};
}

describe('presentation editor server graph', () => {
	it('imports the editor page without pulling Konva into the server bundle', async () => {
		const server = await createServer({
			root,
			configFile: false,
			logLevel: 'silent',
			server: { middlewareMode: true, hmr: false },
			optimizeDeps: { noDiscovery: true },
			resolve: { alias: { $lib: path.join(root, 'src/lib') } },
			plugins: [
				appStub('$app/environment', 'export const browser = false; export const dev = true;'),
				appStub(
					'$app/navigation',
					'export async function preloadCode() {} export async function goto() {}'
				),
				svelte()
			]
		});
		try {
			const page = await server.ssrLoadModule(
				'/src/lib/components/presentation/PresentationEditorPage.svelte'
			);
			expect(page.default).toBeTruthy();
		} finally {
			await server.close();
		}
	}, 120_000);
});
