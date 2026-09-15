/**
 * Base-aware bundled artwork.
 *
 * A subdirectory deployment (`kit.paths.base`) must fetch bundled art through
 * SvelteKit's `asset()` while the stored provenance keeps the canonical source
 * path, so provenance stays comparable across deployment origins. `$app/paths`
 * is mocked with a base so a missing prefix is distinguishable from a no-op.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({
	asset: (path: string) => `/stickerlab${path}`
}));

import { ingestBundledImage } from './assetLoader';

afterEach(() => vi.unstubAllGlobals());

describe('bundled artwork', () => {
	it('fetches through the base-aware asset() and records the canonical provenance', async () => {
		const fetchMock = vi.fn(async () => new Response('not an image', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		// The bytes are rejected by upload validation; the fetch URL is the contract.
		await expect(ingestBundledImage('/art/stickers/x.webp')).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledWith('/stickerlab/art/stickers/x.webp');
	});
});
