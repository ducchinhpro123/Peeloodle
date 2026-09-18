/**
 * P71 contract: only the chosen slides and only the assets they draw are
 * prepared, every id is fresh, and a replaced or tampered dependency refuses
 * before anything reaches the editor.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '$lib/hash';
import { fixtureImagePng } from '$lib/presentations/model/fixtures/fixture';
import { createImageElement, createPresentationDocument } from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import { MemoryCatalog } from '$lib/catalog/memory';
import { loadTemplateLayout } from './templateLayout';
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
	const assetId = 'a0000000-0000-4000-8000-000000000101';
	const versionId = 'v0000000-0000-4000-8000-000000000101';
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
	document.slides.push({
		...structuredClone(document.slides[0]!),
		id: 'template-slide-2',
		name: 'Text only'
	});
	document.slides[1]!.elements = [];
	const json = presentationDocumentToJson(document);
	const template: CatalogTemplate = {
		id: 't0000000-0000-4000-8000-000000000101',
		title: 'Class deck',
		useCase: 'class',
		description: '',
		tags: [],
		sortOrder: 1,
		state: 'published',
		revision: 3,
		publishedVersionId: 'w0000000-0000-4000-8000-000000000101',
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	const templateVersion: CatalogTemplateVersion = {
		id: template.publishedVersionId!,
		templateId: template.id,
		versionNumber: 2,
		document: JSON.parse(json),
		documentSha256: await sha256Hex(new TextEncoder().encode(json)),
		documentBytes: new TextEncoder().encode(json).length,
		coverPath: `templates/${template.id}/${template.publishedVersionId}/preview-01.png`,
		coverSha256: 'd'.repeat(64),
		slidePreviews: [],
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
			derivativeUrls: new Map([[derivativePath, 'https://example.test/asset.png']])
		},
		null
	);
	const fetchStub = async () =>
		new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } });
	return { bytes, document, template, catalog, fetchStub };
}

describe('loadTemplateLayout', () => {
	it('prepares only the chosen slides and the assets they draw, with fresh ids', async () => {
		const { bytes, document, template, catalog, fetchStub } = await fixture();
		const layout = await loadTemplateLayout({
			catalogRepository: catalog,
			templateId: template.id,
			slideOrdinals: [1],
			fetch: fetchStub
		});

		expect(layout.slides).toHaveLength(1);
		expect(layout.slides[0]!.name).toBe('Text only');
		expect(layout.slides[0]!.id).not.toBe(document.slides[1]!.id);
		// A text-only slide draws no artwork, so nothing is downloaded.
		expect(layout.assets).toHaveLength(0);
		expect(layout.media).toHaveLength(0);

		const withImage = await loadTemplateLayout({
			catalogRepository: catalog,
			templateId: template.id,
			slideOrdinals: [0],
			fetch: fetchStub
		});
		expect(withImage.slides).toHaveLength(1);
		expect(withImage.assets).toHaveLength(1);
		expect(withImage.assets[0]!.id).not.toBe(document.assets[0]!.id);
		expect(withImage.media).toHaveLength(1);
		expect(withImage.media[0]!.assetId).toBe(withImage.assets[0]!.id);
		expect(withImage.media[0]!.bytes).toEqual(bytes);
	});

	it('refuses an empty or out-of-range selection', async () => {
		const { template, catalog, fetchStub } = await fixture();
		await expect(
			loadTemplateLayout({
				catalogRepository: catalog,
				templateId: template.id,
				slideOrdinals: [],
				fetch: fetchStub
			})
		).rejects.toMatchObject({ code: 'no_slides' });
		await expect(
			loadTemplateLayout({
				catalogRepository: catalog,
				templateId: template.id,
				slideOrdinals: [9],
				fetch: fetchStub
			})
		).rejects.toMatchObject({ code: 'no_slides' });
	});

	it('refuses a replaced dependency before preparing anything', async () => {
		const { template, catalog, fetchStub } = await fixture();
		catalog.assets[0]!.publishedVersionId = 'v0000000-0000-4000-8000-0000000001ff';
		catalog.versions.push({
			...catalog.versions[0]!,
			id: 'v0000000-0000-4000-8000-0000000001ff',
			versionNumber: 2,
			derivativeSha256: 'f'.repeat(64)
		});
		await expect(
			loadTemplateLayout({
				catalogRepository: catalog,
				templateId: template.id,
				slideOrdinals: [0],
				fetch: fetchStub
			})
		).rejects.toMatchObject({ code: 'missing_media' });
	});
});
