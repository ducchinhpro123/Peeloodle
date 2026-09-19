/**
 * Browser contract for the public deck-template browser (P69/P70): real
 * metadata and covers, an all-slide preview, and a clone that lands in the
 * local presentation repository through the callback.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '$lib/presentations/rendering/presentation-fonts.css';
import PresentationTemplatesPage from './PresentationTemplatesPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import { CatalogError } from '$lib/catalog/repository';
import type { CatalogRepository } from '$lib/catalog/repository';
import { createMemoryPresentationRepository } from '$lib/presentations/persistence/repository';
import { sha256Hex } from '$lib/hash';
import { fixtureImagePng } from '$lib/presentations/model/fixtures/fixture';
import { createImageElement, createPresentationDocument } from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogTemplate,
	CatalogTemplateVersion
} from '$lib/catalog/types';

const now = '2026-09-16T00:00:00.000Z';

async function fixture() {
	const bytes = fixtureImagePng();
	const sha = await sha256Hex(bytes);
	const assetId = 'a0000000-0000-4000-8000-0000000000f1';
	const versionId = 'v0000000-0000-4000-8000-0000000000f1';
	const derivativePath = `assets/${assetId}/${versionId}/asset.png`;
	const assetVersion: CatalogAssetVersion = {
		id: versionId,
		assetId,
		versionNumber: 1,
		sourcePath: 'batches/b/j.png',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1024,
		sourceMime: 'image/png',
		derivativePath,
		derivativeSha256: sha,
		derivativeBytes: bytes.length,
		derivativeMime: 'image/png',
		derivativeWidth: 256,
		derivativeHeight: 256,
		thumbnailPath: null,
		validationState: 'validated',
		createdAt: now
	};
	const asset: CatalogAsset = {
		id: assetId,
		collectionId: null,
		name: 'Cat',
		description: '',
		tags: [],
		kind: 'raster',
		provenance: {},
		sortOrder: 1,
		state: 'published',
		revision: 2,
		publishedVersionId: versionId,
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	const document = createPresentationDocument({ id: 'template-doc', title: 'Template' });
	const assetPin = {
		id: `asset-${sha}`,
		blobKey: `catalog/${sha}`,
		mimeType: 'image/png' as const,
		width: 256,
		height: 256,
		sha256: sha,
		byteLength: bytes.length,
		provenance: {
			source: 'catalog' as const,
			label: 'Catalog art',
			catalogItemId: assetId,
			catalogVersionId: versionId
		}
	};
	document.assets = [assetPin];
	document.slides[0]!.elements.push(
		createImageElement({ assetId: assetPin.id, width: 256, height: 256 })
	);
	const json = presentationDocumentToJson(document);
	const template: CatalogTemplate = {
		id: 't0000000-0000-4000-8000-0000000000f1',
		title: 'Class deck',
		useCase: 'class',
		description: 'A complete class deck',
		tags: ['class'],
		sortOrder: 1,
		state: 'published',
		revision: 3,
		publishedVersionId: 'w0000000-0000-4000-8000-0000000000f1',
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	const coverPath = `templates/${template.id}/w0000000-0000-4000-8000-0000000000f1/preview-01.png`;
	const templateVersion: CatalogTemplateVersion = {
		id: template.publishedVersionId!,
		templateId: template.id,
		versionNumber: 2,
		document: JSON.parse(json),
		documentSha256: await sha256Hex(new TextEncoder().encode(json)),
		documentBytes: new TextEncoder().encode(json).length,
		coverPath,
		coverSha256: 'd'.repeat(64),
		slidePreviews: [
			{
				path: coverPath,
				ordinal: 0,
				sha256: 'd'.repeat(64),
				bytes: 1024,
				width: 960,
				height: 540
			}
		],
		fontRequirements: [{ fontId: 'be-vietnam-pro' }],
		validationState: 'validated',
		validation: {},
		createdAt: now
	};
	const catalog = new MemoryCatalog(
		{
			assets: [asset],
			versions: [assetVersion],
			templates: [template],
			templateVersions: [templateVersion],
			dependencies: [{ templateVersionId: templateVersion.id, assetId, assetVersionId: versionId }],
			derivativeUrls: new Map([
				[derivativePath, 'https://example.test/asset.png'],
				[coverPath, 'https://example.test/slide-1.png']
			])
		},
		null
	);
	return { bytes, template, catalog };
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

describe('presentation templates page', () => {
	it('lists published templates with covers and an all-slide preview', async () => {
		const { template, catalog } = await fixture();
		const presentations = createMemoryPresentationRepository();
		const page = render(PresentationTemplatesPage, {
			catalogRepository: catalog,
			presentationRepository: presentations,
			onused: () => {}
		});

		await waitFor(() => page.container.textContent?.includes('Class deck'), 'the card');
		// The fixture's cover is the first slide preview (the real system stores the
		// chosen preview path as the cover), so the same signed URL serves both.
		const cover = await waitFor(
			() => page.container.querySelector('img[src="https://example.test/slide-1.png"]'),
			'the cover image'
		);
		expect(cover).not.toBeNull();
		expect(page.container.textContent).toContain('A complete class deck');

		buttonByText(page.container, 'Preview slides').click();
		const dialog = await waitFor(
			() =>
				[...page.container.querySelectorAll('dialog')].find(
					(row) => row.open && (row.textContent ?? '').includes('all slides')
				),
			'the preview dialog'
		);
		await waitFor(
			() => dialog.querySelector('img[src="https://example.test/slide-1.png"]'),
			'the first slide image'
		);
		expect(template.id).toBe(catalog.templates[0]!.id);
	});

	it('clones into the local repository and reports the new presentation', async () => {
		const { bytes, template, catalog } = await fixture();
		const presentations = createMemoryPresentationRepository();
		const onused = vi.fn();
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(
				new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
			);
		try {
			const page = render(PresentationTemplatesPage, {
				catalogRepository: catalog,
				presentationRepository: presentations,
				onused
			});
			await waitFor(() => page.container.textContent?.includes('Class deck'), 'the card');
			buttonByText(page.container, 'Use template').click();

			await waitFor(() => onused.mock.calls.length > 0, 'the clone callback');
			const cloneId = onused.mock.calls[0]![0] as string;
			expect(cloneId).not.toBe(template.id);
			const clone = await presentations.getPresentation(cloneId);
			expect(clone.title).toBe('Class deck');
			expect(clone.slides).toHaveLength(1);
			const media = await presentations.getMedia(clone.assets[0]!.id);
			expect(media.bytes).toEqual(bytes);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('shows honest empty and unconfigured states', async () => {
		const presentations = createMemoryPresentationRepository();
		const empty = render(PresentationTemplatesPage, {
			catalogRepository: new MemoryCatalog({}, null),
			presentationRepository: presentations,
			onused: () => {}
		});
		const emptyText = await waitFor(
			() => empty.container.textContent?.includes('No deck templates are published yet.'),
			'the empty state'
		);
		expect(emptyText).toBe(true);

		const unconfigured = render(PresentationTemplatesPage, {
			catalogRepository: null,
			presentationRepository: presentations,
			onused: () => {}
		});
		const unconfiguredText = await waitFor(
			() => unconfigured.container.textContent?.includes('not configured for this site'),
			'the unconfigured state'
		);
		expect(unconfiguredText).toBe(true);
	});

	// P78: a catalog outage must read as an outage, never as "no templates".
	it('reports a catalog outage instead of an empty library', async () => {
		const presentations = createMemoryPresentationRepository();
		const down = {
			listTemplates: async () => {
				throw new CatalogError('unavailable', 'network down');
			}
		} as unknown as CatalogRepository;
		const page = render(PresentationTemplatesPage, {
			catalogRepository: down,
			presentationRepository: presentations,
			onused: () => {}
		});
		const outage = await waitFor(
			() => page.container.textContent?.includes('could not be reached'),
			'the outage message'
		);
		expect(outage).toBe(true);
		expect(page.container.textContent).not.toContain('No deck templates are published yet.');
	});
});
