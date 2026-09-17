/**
 * Orchestration contract for P65 save-as-template (Task 4).
 *
 * Four paths: a text-only deck, an already-catalog image, a local image that
 * must ride the existing upload/processing pipeline, and a processing failure
 * that must write nothing anywhere.
 */
import { describe, expect, it, vi } from 'vitest';
import { fixtureImagePng, FIXTURE_IMAGE_SHA256 } from '$lib/presentations/model/fixtures/fixture';
import {
	clonePresentationDocumentWithNewIds,
	createImageElement,
	createPresentationDocument
} from '$lib/presentations/model/factories';
import { createMemoryPresentationRepository } from '$lib/presentations/persistence/repository';
import { MemoryCatalog } from '$lib/catalog/memory';
import { saveAsTemplateDraft } from './saveAsTemplateDraft';
import type { CatalogAssetVersion, CatalogCollection } from '$lib/catalog/types';
import type { PresentationDocument } from '$lib/presentations/model/types';

const now = '2026-09-16T00:00:00.000Z';
const adminId = '11111111-1111-4111-8111-111111111111';

function collection(): CatalogCollection {
	return {
		id: 'c0000000-0000-4000-8000-000000000001',
		name: 'Templates',
		description: '',
		tags: [],
		sortOrder: 1,
		state: 'published',
		revision: 1,
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
}

function catalogVersion(overrides: Partial<CatalogAssetVersion> = {}): CatalogAssetVersion {
	return {
		id: 'v0000000-0000-4000-8000-000000000001',
		assetId: 'a0000000-0000-4000-8000-000000000001',
		versionNumber: 1,
		sourcePath: 'batches/b/j.png',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1024,
		sourceMime: 'image/png',
		derivativePath: 'assets/a/v/asset.png',
		derivativeSha256: 'b'.repeat(64),
		derivativeBytes: 800,
		derivativeMime: 'image/png',
		derivativeWidth: 64,
		derivativeHeight: 64,
		thumbnailPath: null,
		validationState: 'validated',
		createdAt: now,
		...overrides
	};
}

function metadata() {
	return {
		title: 'Editor deck template',
		useCase: 'class',
		description: '',
		tags: ['class'],
		sortOrder: 0
	};
}

/** One-slide deck whose single image element uses `assetId`. */
function deckWithImage(assetId: string): PresentationDocument {
	const document = createPresentationDocument({ id: 'source-deck', title: 'Editor deck' });
	document.assets = [
		{
			id: assetId,
			blobKey: `local/${assetId}`,
			mimeType: 'image/png',
			width: 256,
			height: 256,
			sha256: FIXTURE_IMAGE_SHA256,
			byteLength: fixtureImagePng().length,
			provenance: { source: 'upload', label: 'Upload' }
		}
	];
	document.slides[0]!.elements.push(createImageElement({ assetId, width: 256, height: 256 }));
	return document;
}

describe('saveAsTemplateDraft', () => {
	it('copies a text-only deck into a pending draft and leaves the source untouched', async () => {
		const source = createPresentationDocument({ id: 'source-deck', title: 'Editor deck' });
		const before = structuredClone(source);
		const presentations = createMemoryPresentationRepository();
		const catalog = new MemoryCatalog({ admins: [adminId] }, adminId);

		const draft = await saveAsTemplateDraft({
			sourceDocument: source,
			presentationRepository: presentations,
			catalogRepository: catalog,
			collectionId: null,
			metadata: metadata()
		});

		expect(draft.version.validationState).toBe('pending');
		expect(draft.version.documentSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(catalog.templates).toHaveLength(1);
		expect(catalog.templateVersions).toHaveLength(1);
		expect(catalog.dependencies).toHaveLength(0);
		const cloned = draft.version.document as PresentationDocument;
		expect(cloned.id).not.toBe(source.id);
		expect(cloned.slides[0]!.id).not.toBe(source.slides[0]!.id);
		expect(cloned.assets).toHaveLength(0);
		expect(source).toEqual(before);
	});

	it('reuses an existing validated catalog version and refuses a mismatch', async () => {
		const assetId = 'a0000000-0000-4000-8000-000000000001';
		const validated = catalogVersion();
		const source = deckWithImage('local-asset');
		source.assets[0]!.provenance = {
			source: 'catalog',
			label: 'Cat',
			catalogItemId: assetId,
			catalogVersionId: validated.id
		};
		source.assets[0]!.sha256 = validated.derivativeSha256;
		source.assets[0]!.byteLength = validated.derivativeBytes;
		source.assets[0]!.mimeType = validated.derivativeMime;
		source.assets[0]!.width = validated.derivativeWidth;
		source.assets[0]!.height = validated.derivativeHeight;
		const presentations = createMemoryPresentationRepository();
		const catalog = new MemoryCatalog(
			{ admins: [adminId], collections: [collection()], assets: [], versions: [validated] },
			adminId
		);

		const draft = await saveAsTemplateDraft({
			sourceDocument: source,
			presentationRepository: presentations,
			catalogRepository: catalog,
			collectionId: collection().id,
			metadata: metadata()
		});
		expect(draft.version.validationState).toBe('pending');
		expect(catalog.uploadBatches).toHaveLength(0);
		expect(catalog.dependencies).toEqual([
			{
				templateVersionId: catalog.templateVersions[0]!.id,
				assetId,
				assetVersionId: validated.id
			}
		]);

		const mismatched = clonePresentationDocumentWithNewIds(source);
		mismatched.assets[0]!.sha256 = 'f'.repeat(64);
		await expect(
			saveAsTemplateDraft({
				sourceDocument: mismatched,
				presentationRepository: presentations,
				catalogRepository: catalog,
				collectionId: collection().id,
				metadata: metadata()
			})
		).rejects.toMatchObject({ code: 'dependency_mismatch' });
		expect(catalog.templates).toHaveLength(1);
	});

	it('uploads a local image, processes it, and rewrites the cloned asset', async () => {
		const assetId = 'local-asset';
		const source = deckWithImage(assetId);
		const presentations = createMemoryPresentationRepository();
		presentations.seedMedia({ assetId, bytes: fixtureImagePng(), mimeType: 'image/png' });
		const catalog = new MemoryCatalog({ admins: [adminId], collections: [collection()] }, adminId);

		const draft = await saveAsTemplateDraft({
			sourceDocument: source,
			presentationRepository: presentations,
			catalogRepository: catalog,
			collectionId: collection().id,
			metadata: metadata()
		});

		const document = draft.version.document as PresentationDocument;
		expect(document.assets).toHaveLength(1);
		const [asset] = document.assets;
		expect(asset!.provenance).toMatchObject({
			source: 'catalog',
			catalogItemId: catalog.assets[0]!.id
		});
		expect(asset!.blobKey).toBe(`catalog/${asset!.sha256}`);
		expect(catalog.dependencies).toEqual([
			{
				templateVersionId: catalog.templateVersions[0]!.id,
				assetId: catalog.assets[0]!.id,
				assetVersionId: catalog.versions[0]!.id
			}
		]);
		expect(catalog.uploadBatches[0]!.state).toBe('closed');
		expect(source.assets[0]!.provenance.source).toBe('upload');
	});

	it('writes nothing when processing fails and reports upload_failed', async () => {
		const assetId = 'local-asset';
		const source = deckWithImage(assetId);
		const presentations = createMemoryPresentationRepository();
		presentations.seedMedia({ assetId, bytes: fixtureImagePng(), mimeType: 'image/png' });
		const catalog = new MemoryCatalog(
			{
				admins: [adminId],
				collections: [collection()],
				process: async () => {
					throw new Error('decode exploded');
				}
			},
			adminId
		);

		await expect(
			saveAsTemplateDraft({
				sourceDocument: source,
				presentationRepository: presentations,
				catalogRepository: catalog,
				collectionId: collection().id,
				metadata: metadata()
			})
		).rejects.toMatchObject({ code: 'upload_failed' });
		expect(catalog.templates).toHaveLength(0);
		expect(catalog.templateVersions).toHaveLength(0);
		expect(catalog.dependencies).toHaveLength(0);
		expect(source.assets[0]!.provenance).toEqual({ source: 'upload', label: 'Upload' });
	});

	it('does not create a template when closing the upload batch is refused', async () => {
		const presentations = createMemoryPresentationRepository();
		presentations.seedMedia({
			assetId: 'local-asset',
			bytes: fixtureImagePng(),
			mimeType: 'image/png'
		});
		const catalog = new MemoryCatalog({ admins: [adminId], collections: [collection()] }, adminId);
		vi.spyOn(catalog, 'closeUploadBatch').mockResolvedValue({
			ok: false,
			reason: 'not_found',
			detail: {}
		});
		await expect(
			saveAsTemplateDraft({
				sourceDocument: deckWithImage('local-asset'),
				presentationRepository: presentations,
				catalogRepository: catalog,
				collectionId: collection().id,
				metadata: metadata()
			})
		).rejects.toMatchObject({ code: 'upload_failed' });
		expect(catalog.templates).toHaveLength(0);
	});

	it('requires a collection when any asset is not catalog-backed', async () => {
		const source = deckWithImage('local-asset');
		const presentations = createMemoryPresentationRepository();
		const catalog = new MemoryCatalog({ admins: [adminId] }, adminId);

		await expect(
			saveAsTemplateDraft({
				sourceDocument: source,
				presentationRepository: presentations,
				catalogRepository: catalog,
				collectionId: null,
				metadata: metadata()
			})
		).rejects.toMatchObject({ code: 'collection_required' });
		expect(catalog.uploadBatches).toHaveLength(0);
	});

	it('reports missing media as missing_media', async () => {
		const source = deckWithImage('local-asset');
		const presentations = createMemoryPresentationRepository();
		const catalog = new MemoryCatalog({ admins: [adminId], collections: [collection()] }, adminId);

		await expect(
			saveAsTemplateDraft({
				sourceDocument: source,
				presentationRepository: presentations,
				catalogRepository: catalog,
				collectionId: collection().id,
				metadata: metadata()
			})
		).rejects.toMatchObject({ code: 'missing_media' });
		expect(catalog.templates).toHaveLength(0);
	});
});
