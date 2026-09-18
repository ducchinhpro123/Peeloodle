/**
 * P70 contract: a template clone is independent, fully downloaded and verified
 * before the local write, and a failure leaves no presentation behind.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '$lib/hash';
import { fixtureImagePng } from '$lib/presentations/model/fixtures/fixture';
import { createImageElement, createPresentationDocument } from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import { createMemoryPresentationRepository } from '$lib/presentations/persistence/repository';
import { MemoryCatalog } from '$lib/catalog/memory';
import { cloneTemplate } from './cloneTemplate';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogTemplate,
	CatalogTemplateVersion
} from '$lib/catalog/types';
import type { PresentationDocument } from '$lib/presentations/model/types';

const now = '2026-09-16T00:00:00.000Z';

async function fixture() {
	const bytes = fixtureImagePng();
	const sha = await sha256Hex(bytes);
	const assetId = 'a0000000-0000-4000-8000-0000000000e1';
	const versionId = 'v0000000-0000-4000-8000-0000000000e1';
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
	const document = createPresentationDocument({ id: 'template-doc', title: 'Template copy' });
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
		id: 't0000000-0000-4000-8000-0000000000e1',
		title: 'Class deck',
		useCase: 'class',
		description: '',
		tags: ['class'],
		sortOrder: 1,
		state: 'published',
		revision: 3,
		publishedVersionId: 'w0000000-0000-4000-8000-0000000000e1',
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
		coverPath: `templates/${template.id}/${template.publishedVersionId}/cover.png`,
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
	return { bytes, sha, asset, template, document, catalog, fetchStub };
}

describe('cloneTemplate', () => {
	it('clones with fresh ids and stored media, leaving the template untouched', async () => {
		const { bytes, sha, template, document, catalog, fetchStub } = await fixture();
		const presentations = createMemoryPresentationRepository();

		const clone = await cloneTemplate({
			catalogRepository: catalog,
			presentationRepository: presentations,
			templateId: template.id,
			fetch: fetchStub
		});

		expect(clone.id).not.toBe(document.id);
		expect(clone.title).toBe('Class deck');
		expect(clone.slides[0]!.id).not.toBe(document.slides[0]!.id);
		expect(clone.assets[0]!.id).not.toBe(document.assets[0]!.id);
		expect(clone.assets[0]!.provenance).toMatchObject({
			source: 'catalog',
			catalogItemId: fixtureAssetId(document)
		});
		const stored = await presentations.getPresentation(clone.id);
		expect(stored.slides[0]!.elements).toHaveLength(1);
		const media = await presentations.getMedia(clone.assets[0]!.id);
		expect(media.bytes).toEqual(bytes);
		expect(media.mimeType).toBe('image/png');
		// The source document still has its own ids and hash.
		expect(document.assets[0]!.sha256).toBe(sha);
		expect(catalog.dependencies).toHaveLength(1);
	});

	it('creates two independent clones', async () => {
		const { template, catalog, fetchStub } = await fixture();
		const presentations = createMemoryPresentationRepository();
		const first = await cloneTemplate({
			catalogRepository: catalog,
			presentationRepository: presentations,
			templateId: template.id,
			fetch: fetchStub
		});
		const second = await cloneTemplate({
			catalogRepository: catalog,
			presentationRepository: presentations,
			templateId: template.id,
			fetch: fetchStub
		});
		expect(first.id).not.toBe(second.id);
		expect(first.assets[0]!.id).not.toBe(second.assets[0]!.id);
		expect(await presentations.hasMedia(first.assets[0]!.id)).toBe(true);
		expect(await presentations.hasMedia(second.assets[0]!.id)).toBe(true);
	});

	it('refuses a replaced asset and writes no presentation', async () => {
		const { template, catalog, fetchStub } = await fixture();
		const presentations = createMemoryPresentationRepository();
		catalog.assets[0]!.publishedVersionId = 'v0000000-0000-4000-8000-0000000000ff';
		catalog.versions.push({
			...catalog.versions[0]!,
			id: 'v0000000-0000-4000-8000-0000000000ff',
			versionNumber: 2,
			derivativeSha256: 'f'.repeat(64)
		});

		await expect(
			cloneTemplate({
				catalogRepository: catalog,
				presentationRepository: presentations,
				templateId: template.id,
				fetch: fetchStub
			})
		).rejects.toMatchObject({ code: 'missing_media' });
		expect(await presentations.listPresentations()).toHaveLength(0);
	});

	it('refuses tampered bytes and writes no presentation', async () => {
		const { template, catalog } = await fixture();
		const presentations = createMemoryPresentationRepository();
		await expect(
			cloneTemplate({
				catalogRepository: catalog,
				presentationRepository: presentations,
				templateId: template.id,
				fetch: async () =>
					new Response(new Uint8Array([1, 2, 3]), {
						status: 200,
						headers: { 'content-type': 'image/png' }
					})
			})
		).rejects.toMatchObject({ code: 'invalid_media' });
		expect(await presentations.listPresentations()).toHaveLength(0);
	});

	it('refuses an unpublished template', async () => {
		const { template, catalog, fetchStub } = await fixture();
		catalog.templates[0]!.state = 'draft';
		const presentations = createMemoryPresentationRepository();
		await expect(
			cloneTemplate({
				catalogRepository: catalog,
				presentationRepository: presentations,
				templateId: template.id,
				fetch: fetchStub
			})
		).rejects.toMatchObject({ code: 'not_available' });
	});
});

function fixtureAssetId(document: PresentationDocument): string {
	return document.assets[0]!.provenance.catalogItemId!;
}
