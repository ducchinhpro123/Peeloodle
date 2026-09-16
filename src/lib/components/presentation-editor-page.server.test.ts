/**
 * The presentation editor's server-side import graph.
 *
 * Konva's Node entry top-level-requires the native `canvas` package, which is not
 * installed, so nothing the page imports statically may reach it: the slide canvas
 * lives behind a browser-only `$effect` for exactly that reason. Importing the page
 * here (a node environment, like SSR) fails if that client-only seam is undone —
 * the production build and its Playwright suite resolve Konva's browser entry and
 * never notice.
 */
import { describe, expect, it } from 'vitest';

describe('presentation editor server graph', () => {
	it('imports the editor page without pulling Konva into the server bundle', async () => {
		const page = await import('./presentation/PresentationEditorPage.svelte');
		expect(page.default).toBeTruthy();
	}, 60_000);
});
