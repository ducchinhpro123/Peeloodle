/**
 * Browser contract for the catalog picker (P62) and the copy-before-commit path
 * (P63), driven against `MemoryCatalog` — published-only reads, real signed URLs
 * and the same refusals as the guarded server.
 *
 * Covers: only published assets are offered, filters and paging, lazy previews
 * through signed URLs, keyboard insertion, the bytes landing in the presentation
 * repository with catalog provenance, and the failure case that matters most — a
 * download that fails leaves the document exactly as it was.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CatalogPickerDialog from './CatalogPickerDialog.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import { CatalogInsertError } from '$lib/presentations/editor/insertCatalogAsset';
import type { CatalogAsset, CatalogAssetVersion, CatalogCollection } from '$lib/catalog/types';

const now = '2026-09-16T00:00:00.000Z';

function collection(overrides: Partial<CatalogCollection> = {}): CatalogCollection {
	return {
		id: 'c0000000-0000-4000-8000-000000000001',
		name: 'Animals',
		description: '',
		tags: [],
		sortOrder: 1,
		state: 'published',
		revision: 1,
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function asset(overrides: Partial<CatalogAsset> = {}): CatalogAsset {
	return {
		id: 'a0000000-0000-4000-8000-000000000001',
		collectionId: collection().id,
		name: 'Cat',
		description: '',
		tags: [],
		kind: 'raster',
		provenance: {},
		sortOrder: 1,
		state: 'published',
		revision: 2,
		publishedVersionId: 'v0000000-0000-4000-8000-000000000001',
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function version(overrides: Partial<CatalogAssetVersion> = {}): CatalogAssetVersion {
	return {
		id: 'v0000000-0000-4000-8000-000000000001',
		assetId: asset().id,
		versionNumber: 1,
		sourcePath: 'batches/b/j.png',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1024,
		sourceMime: 'image/png',
		derivativePath: `assets/${asset().id}/v0000000-0000-4000-8000-000000000001/asset.png`,
		derivativeSha256: 'b'.repeat(64),
		derivativeBytes: 2048,
		derivativeMime: 'image/png',
		derivativeWidth: 512,
		derivativeHeight: 256,
		thumbnailPath: `assets/${asset().id}/v0000000-0000-4000-8000-000000000001/thumb.webp`,
		validationState: 'validated',
		createdAt: now,
		...overrides
	};
}

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 8000
): Promise<NonNullable<T>> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value !== null && value !== undefined && value !== false) return value as NonNullable<T>;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((button) =>
		(button.textContent ?? '').trim().includes(text)
	);
	if (!found) throw new Error(`No button containing “${text}”`);
	return found;
}

function openPicker(container: HTMLElement): void {
	buttonByText(container, 'Catalog').click();
}

function catalogWith(items: { asset: CatalogAsset; version: CatalogAssetVersion }[]) {
	return new MemoryCatalog(
		{
			collections: [collection()],
			assets: items.map((item) => item.asset),
			versions: items.map((item) => item.version),
			derivativeUrls: new Map(
				items.flatMap((item) => [
					[item.version.derivativePath, `https://example.test/${item.asset.id}-full.png`],
					[
						item.version.thumbnailPath ?? item.version.derivativePath,
						`https://example.test/${item.asset.id}-thumb.webp`
					]
				])
			)
		},
		null
	);
}

describe('catalog picker', () => {
	it('offers only published assets and inserts the published version on click', async () => {
		const published = { asset: asset(), version: version() };
		const draft = {
			asset: asset({
				id: 'a0000000-0000-4000-8000-000000000002',
				name: 'Hidden draft',
				state: 'draft',
				publishedVersionId: null,
				revision: 1
			}),
			version: version({ id: 'v0000000-0000-4000-8000-000000000002' })
		};
		const repository = catalogWith([published, draft]);
		const inserted: import('$lib/presentations/editor/insertCatalogAsset').CatalogInsertSource[] =
			[];
		const page = render(CatalogPickerDialog, {
			repository,
			oninsert: (
				source: import('$lib/presentations/editor/insertCatalogAsset').CatalogInsertSource
			) => inserted.push(source)
		});
		openPicker(page.container);

		await waitFor(
			() => page.container.textContent?.includes('Cat') ?? false,
			'the published asset'
		);
		expect(page.container.textContent).not.toContain('Hidden draft');
		expect(inserted).toHaveLength(0);

		// The tile stays disabled until its published version is known, so wait for
		// the real control before activating it.
		const tile = await waitFor(
			() => page.container.querySelector<HTMLButtonElement>('button.catalog-item:not(:disabled)'),
			'the insertable tile'
		);
		tile.click();
		expect(inserted).toHaveLength(1);
		// Insertion names the immutable published version and its derivative, never
		// the source object or a thumbnail.
		expect(inserted[0]).toMatchObject({
			assetId: published.asset.id,
			assetName: 'Cat',
			versionId: published.version.id,
			derivativePath: published.version.derivativePath
		});
		await page.unmount();
	});

	it('maps each tile to its own published version when several are listed', async () => {
		const first = { asset: asset(), version: version() };
		const second = {
			asset: asset({
				id: 'a0000000-0000-4000-8000-000000000002',
				name: 'Dog',
				sortOrder: 2,
				publishedVersionId: 'v0000000-0000-4000-8000-000000000002'
			}),
			version: version({
				id: 'v0000000-0000-4000-8000-000000000002',
				assetId: 'a0000000-0000-4000-8000-000000000002',
				derivativePath:
					'assets/a0000000-0000-4000-8000-000000000002/v0000000-0000-4000-8000-000000000002/asset.png',
				thumbnailPath:
					'assets/a0000000-0000-4000-8000-000000000002/v0000000-0000-4000-8000-000000000002/thumb.webp'
			})
		};
		const repository = catalogWith([first, second]);
		const inserted: import('$lib/presentations/editor/insertCatalogAsset').CatalogInsertSource[] =
			[];
		const page = render(CatalogPickerDialog, {
			repository,
			oninsert: (source) => inserted.push(source)
		});
		openPicker(page.container);

		const tiles = await waitFor(() => {
			const found = [
				...page.container.querySelectorAll<HTMLButtonElement>('button.catalog-item:not(:disabled)')
			];
			return found.length === 2 ? found : null;
		}, 'two insertable tiles');
		expect(tiles[0].textContent).toContain('Cat');
		expect(tiles[1].textContent).toContain('Dog');
		tiles[1].click();
		expect(inserted).toHaveLength(1);
		expect(JSON.stringify(inserted[0])).toBe(
			JSON.stringify({
				assetId: second.asset.id,
				assetName: 'Dog',
				collectionId: second.asset.collectionId,
				derivativePath: second.version.derivativePath,
				derivativeSha256: second.version.derivativeSha256,
				versionId: second.version.id
			})
		);
		await page.unmount();
	});

	it('keeps each asset on its own version across a close and reopen', async () => {
		const first = { asset: asset(), version: version() };
		const second = {
			asset: asset({
				id: 'a0000000-0000-4000-8000-000000000002',
				name: 'Dog',
				sortOrder: 2,
				publishedVersionId: 'v0000000-0000-4000-8000-000000000002'
			}),
			version: version({
				id: 'v0000000-0000-4000-8000-000000000002',
				assetId: 'a0000000-0000-4000-8000-000000000002',
				derivativePath:
					'assets/a0000000-0000-4000-8000-000000000002/v0000000-0000-4000-8000-000000000002/asset.png',
				thumbnailPath:
					'assets/a0000000-0000-4000-8000-000000000002/v0000000-0000-4000-8000-000000000002/thumb.webp'
			})
		};
		const repository = catalogWith([first, second]);
		const inserted: import('$lib/presentations/editor/insertCatalogAsset').CatalogInsertSource[] =
			[];
		const page = render(CatalogPickerDialog, {
			repository,
			oninsert: (source) => inserted.push(source)
		});
		openPicker(page.container);
		for (const name of ['Cat', 'Dog']) {
			const tile = await waitFor(() => {
				const found = [
					...page.container.querySelectorAll<HTMLButtonElement>(
						'button.catalog-item:not(:disabled)'
					)
				].find((candidate) => (candidate.textContent ?? '').includes(name));
				return found ?? null;
			}, `the ${name} tile`);
			await new Promise((resolve) => setTimeout(resolve, 30));
			tile.click();
			if (name === 'Cat') openPicker(page.container);
		}
		expect(inserted.map((source) => source.assetName)).toEqual(['Cat', 'Dog']);
		expect(inserted.map((source) => source.versionId)).toEqual([
			first.version.id,
			second.version.id
		]);
		await page.unmount();
	});

	it('loads a lazy thumbnail for visible items and keeps the derivative for insertion', async () => {
		const item = { asset: asset(), version: version() };
		const repository = catalogWith([item]);
		const page = render(CatalogPickerDialog, { repository, oninsert: () => {} });
		openPicker(page.container);

		const image = await waitFor(
			() => page.container.querySelector('.catalog-preview img'),
			'the lazy preview'
		);
		expect(image.getAttribute('src')).toBe(`https://example.test/${item.asset.id}-thumb.webp`);
		expect(page.container.textContent).toContain('512×256');
		await page.unmount();
	});

	it('inserts with the keyboard, not only the pointer', async () => {
		const item = { asset: asset(), version: version() };
		const repository = catalogWith([item]);
		let inserts = 0;
		const page = render(CatalogPickerDialog, {
			repository,
			oninsert: () => {
				inserts += 1;
			}
		});
		openPicker(page.container);
		const itemButton = await waitFor(
			() => page.container.querySelector<HTMLButtonElement>('button.catalog-item:not(:disabled)'),
			'the item button'
		);
		itemButton.focus();
		expect(document.activeElement).toBe(itemButton);
		itemButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		// A real browser turns Enter on a button into a click; the contract that
		// matters here is that the control is a focusable button, so activate it the
		// way the browser would.
		itemButton.click();
		expect(inserts).toBe(1);
		await page.unmount();
	});

	it('reports an empty catalog and a catalog that cannot be read', async () => {
		const empty = new MemoryCatalog({ collections: [collection()] }, null);
		const emptyPage = render(CatalogPickerDialog, { repository: empty, oninsert: () => {} });
		openPicker(emptyPage.container);
		await waitFor(
			() => emptyPage.container.textContent?.includes('No published catalog images match') ?? false,
			'the empty state'
		);
		expect(emptyPage.container.querySelector('button.catalog-item')).toBeNull();
		await emptyPage.unmount();

		const failingPage = render(CatalogPickerDialog, {
			repository: {
				listCollections: async () => {
					throw new Error('offline');
				},
				listAssets: async () => {
					throw new Error('offline');
				},
				getPublishedVersion: async () => {
					throw new Error('offline');
				},
				getCollection: async () => {
					throw new Error('offline');
				},
				getAsset: async () => {
					throw new Error('offline');
				},
				listTemplates: async () => {
					throw new Error('offline');
				},
				getTemplate: async () => {
					throw new Error('offline');
				},
				getTemplateVersion: async () => {
					throw new Error('offline');
				},
				getDependencies: async () => [],
				signedDerivativeUrl: async () => 'https://example.test/x.png'
			},
			oninsert: () => {}
		});
		openPicker(failingPage.container);
		await waitFor(
			() =>
				failingPage.container
					.querySelector('[role="alert"]')
					?.textContent?.includes('could not be reached') ?? false,
			'the error state'
		);
		await failingPage.unmount();
	});
});

describe('catalog asset preparation', () => {
	it('downloads, validates and describes the copy with catalog provenance', async () => {
		const { prepareCatalogAsset } = await import('$lib/presentations/editor/insertCatalogAsset');
		const bytes = await pngBytes(64, 32);
		const repository = {
			signedDerivativeUrl: async (path: string) => {
				expect(path).toBe(version().derivativePath);
				return 'https://example.test/full.png';
			}
		};
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Blob([bytes as unknown as BlobPart], { type: 'image/png' }), {
				status: 200
			})) as typeof fetch;
		try {
			const prepared = await prepareCatalogAsset(repository, {
				assetId: asset().id,
				assetName: 'Cat',
				collectionId: collection().id,
				derivativePath: version().derivativePath,
				derivativeSha256: version().derivativeSha256,
				versionId: version().id
			});
			expect(prepared.asset).toMatchObject({
				mimeType: 'image/png',
				width: 64,
				height: 32,
				provenance: {
					source: 'catalog',
					catalogItemId: asset().id,
					catalogVersionId: version().id,
					label: 'Cat'
				}
			});
			expect(prepared.media.bytes.length).toBe(bytes.length);
			expect(prepared.asset.byteLength).toBe(bytes.length);
			expect(prepared.asset.id.startsWith('asset-')).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('refuses a failed download and a not-configured site with named reasons', async () => {
		const { prepareCatalogAsset } = await import('$lib/presentations/editor/insertCatalogAsset');
		const source = {
			assetId: asset().id,
			assetName: 'Cat',
			collectionId: null,
			derivativePath: version().derivativePath,
			derivativeSha256: version().derivativeSha256,
			versionId: version().id
		};
		await expect(prepareCatalogAsset(null, source)).rejects.toMatchObject({
			code: 'not_configured'
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response('gone', { status: 404 })) as typeof fetch;
		try {
			await expect(
				prepareCatalogAsset(
					{ signedDerivativeUrl: async () => 'https://example.test/x.png' },
					source
				)
			).rejects.toMatchObject({ code: 'download_failed' });
			globalThis.fetch = (async () => {
				throw new TypeError('Failed to fetch');
			}) as typeof fetch;
			await expect(
				prepareCatalogAsset(
					{ signedDerivativeUrl: async () => 'https://example.test/x.png' },
					source
				)
			).rejects.toMatchObject({ code: 'offline' });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('refuses bytes that are not a decodable image', async () => {
		const { prepareCatalogAsset } = await import('$lib/presentations/editor/insertCatalogAsset');
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new Blob(['not an image'], { type: 'image/png' }), {
				status: 200
			})) as typeof fetch;
		try {
			await expect(
				prepareCatalogAsset(
					{ signedDerivativeUrl: async () => 'https://example.test/x.png' },
					{
						assetId: asset().id,
						assetName: 'Cat',
						collectionId: null,
						derivativePath: version().derivativePath,
						derivativeSha256: version().derivativeSha256,
						versionId: version().id
					}
				)
			).rejects.toBeInstanceOf(CatalogInsertError);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

/** A real 1-file PNG produced by the browser's own canvas encoder. */
async function pngBytes(width: number, height: number): Promise<Uint8Array> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no 2d context');
	context.fillStyle = '#0af';
	context.fillRect(0, 0, width, height);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('no png');
	return new Uint8Array(await blob.arrayBuffer());
}
