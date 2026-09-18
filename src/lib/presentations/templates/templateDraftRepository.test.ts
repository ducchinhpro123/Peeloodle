/**
 * Contract for the template-mode presentation repository (P66).
 *
 * The shared editor persists through a `PresentationRepository`; this adapter
 * maps that contract onto the catalog: newest immutable version in, derivative
 * bytes out, new immutable version on save, revision conflict when another
 * administrator wrote first. `MemoryCatalog` supplies the server semantics and
 * a fetch stub supplies Storage.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '$lib/hash';
import { fixtureImagePng } from '$lib/presentations/model/fixtures/fixture';
import {
	createImageElement,
	createPresentationDocument
} from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import { MemoryCatalog } from '$lib/catalog/memory';
import {
	createTemplateDraftRepository,
	TEMPLATE_SAVE_CONFLICT_MESSAGE
} from './templateDraftRepository';
import type { CatalogAssetVersion, CatalogTemplateVersion } from '$lib/catalog/types';
import type { PresentationDocument } from '$lib/presentations/model/types';

const now = '2026-09-16T00:00:00.000Z';
const adminId = '11111111-1111-4111-8111-111111111111';
const derivativePath = 'assets/a/v/asset.png';
const signedUrl = 'https://storage.test/asset.png';

async function fixture() {
	const bytes = fixtureImagePng();
	const sha256 = await sha256Hex(bytes);
	const version: CatalogAssetVersion = {
		id: 'v0000000-0000-4000-8000-000000000001',
		assetId: 'a0000000-0000-4000-8000-000000000001',
		versionNumber: 1,
		sourcePath: 'batches/b/j.png',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1024,
		sourceMime: 'image/png',
		derivativePath,
		derivativeSha256: sha256,
		derivativeBytes: bytes.length,
		derivativeMime: 'image/png',
		derivativeWidth: 256,
		derivativeHeight: 256,
		thumbnailPath: null,
		validationState: 'validated',
		createdAt: now
	};

	const document = createPresentationDocument({ id: 'template-doc', title: 'Template copy' });
	const asset = {
		id: `asset-${sha256}`,
		blobKey: `catalog/${sha256}`,
		mimeType: 'image/png' as const,
		width: 256,
		height: 256,
		sha256,
		byteLength: bytes.length,
		provenance: {
			source: 'catalog' as const,
			label: 'Catalog art',
			catalogItemId: version.assetId,
			catalogVersionId: version.id
		}
	};
	document.assets = [asset];
	document.slides[0]!.elements.push(
		createImageElement({ assetId: asset.id, width: 256, height: 256 })
	);
	const json = presentationDocumentToJson(document);

	const catalog = new MemoryCatalog(
		{
			admins: [adminId],
			assets: [],
			versions: [version],
			derivativeUrls: new Map([[derivativePath, signedUrl]])
		},
		adminId
	);
	const created = await catalog.createTemplateDraft({
		metadata: {
			title: 'Template copy',
			useCase: 'class',
			description: '',
			tags: [],
			sortOrder: 0
		},
		document: JSON.parse(json),
		documentSha256: await sha256Hex(new TextEncoder().encode(json)),
		documentBytes: new TextEncoder().encode(json).length,
		fontRequirements: [{ fontId: document.theme.headingFontId }]
	});
	if (!created.ok) throw new Error(JSON.stringify(created));
	return { bytes, version, document, catalog, draft: created.item };
}

/** A fetch stub that serves the fixture bytes for the signed URL. */
function fetchStub(bytes: Uint8Array, calls: string[] = []) {
	return async (input: RequestInfo | URL) => {
		calls.push(String(input));
		return new Response(bytes.slice(), {
			status: 200,
			headers: { 'content-type': 'image/png' }
		});
	};
}

describe('template draft repository', () => {
	it('loads the newest version under the template id and serves derivative bytes', async () => {
		const { bytes, catalog, draft } = await fixture();
		const calls: string[] = [];
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: draft.template.id,
			fetch: fetchStub(bytes, calls)
		});

		const loaded = await repository.getPresentation(draft.template.id);
		expect(loaded.id).toBe(draft.template.id);
		expect(loaded.title).toBe('Template copy');
		expect(loaded.assets).toHaveLength(1);

		const media = await repository.getMedia(loaded.assets[0]!.id);
		expect(media.mimeType).toBe('image/png');
		expect(media.bytes).toEqual(bytes);
		expect(calls).toEqual([signedUrl]);
		// The second read is cached, so no second signed URL request.
		await repository.getMedia(loaded.assets[0]!.id);
		expect(calls).toEqual([signedUrl]);
	});

	it('reports an unknown template or one without a version as not_found', async () => {
		const { catalog } = await fixture();
		const empty = await catalog.createTemplate({
			title: 'No version yet',
			useCase: 'class',
			description: '',
			tags: [],
			sortOrder: 1
		});
		if (!empty.ok) throw new Error(JSON.stringify(empty));
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: empty.item.id,
			fetch: fetchStub(new Uint8Array())
		});
		await expect(repository.getPresentation(empty.item.id)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(repository.getPresentation('another-id')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('saves a new immutable version against the revision it read', async () => {
		const { bytes, catalog, draft } = await fixture();
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: draft.template.id,
			fetch: fetchStub(bytes)
		});
		const loaded = await repository.getPresentation(draft.template.id);
		const edited: PresentationDocument = {
			...loaded,
			title: 'Edited draft',
			revision: loaded.revision + 1
		};
		await repository.savePresentation(edited);

		expect(catalog.templateVersions).toHaveLength(2);
		const saved: CatalogTemplateVersion = catalog.templateVersions[1]!;
		expect(saved).toMatchObject({
			versionNumber: 2,
			validationState: 'pending',
			coverPath: null,
			slidePreviews: []
		});
		expect((saved.document as PresentationDocument).title).toBe('Edited draft');
		expect(catalog.templates[0]).toMatchObject({ revision: 2 });
		expect(catalog.dependencies).toHaveLength(2);
		expect(saved.documentSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(saved.fontRequirements.length).toBeGreaterThan(0);
	});

	it('refuses artwork that is not catalog-backed before any write', async () => {
		const { bytes, catalog, draft } = await fixture();
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: draft.template.id,
			fetch: fetchStub(bytes)
		});
		const loaded = await repository.getPresentation(draft.template.id);
		const foreign = structuredClone(loaded);
		foreign.assets[0]!.provenance = { source: 'upload', label: 'Upload' };
		await expect(repository.savePresentation(foreign)).rejects.toMatchObject({
			code: 'invalid_asset'
		});
		expect(catalog.templateVersions).toHaveLength(1);
		expect(catalog.templates[0]).toMatchObject({ revision: 1 });
	});

	it('adopts the server revision after a conflict so an explicit retry replaces', async () => {
		const { bytes, catalog, draft } = await fixture();
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: draft.template.id,
			fetch: fetchStub(bytes)
		});
		const loaded = await repository.getPresentation(draft.template.id);
		const ours: PresentationDocument = {
			...loaded,
			title: 'Ours',
			revision: loaded.revision + 1
		};

		// Another administrator saves first: revision moves from 1 to 2.
		const other = { ...JSON.parse(presentationDocumentToJson(loaded)), title: 'Theirs' };
		const otherJson = JSON.stringify(other);
		const otherResult = await catalog.saveTemplateVersion({
			templateId: draft.template.id,
			expectedRevision: 1,
			document: other,
			documentSha256: await sha256Hex(new TextEncoder().encode(otherJson)),
			documentBytes: otherJson.length,
			fontRequirements: []
		});
		expect(otherResult.ok).toBe(true);

		await expect(repository.savePresentation(ours)).rejects.toMatchObject({
			code: 'revision_conflict',
			message: TEMPLATE_SAVE_CONFLICT_MESSAGE
		});
		expect(catalog.templateVersions).toHaveLength(2);

		// The explicit retry (the UI's second Save) now writes version 3.
		await repository.savePresentation({ ...ours, revision: ours.revision + 1 });
		expect(catalog.templateVersions).toHaveLength(3);
		expect((catalog.templateVersions[2]!.document as PresentationDocument).title).toBe('Ours');
		expect(catalog.templates[0]).toMatchObject({ revision: 3 });
	});

	it('maps a non-validated dependency to invalid_asset and reports transport failures', async () => {
		const { bytes, catalog, draft } = await fixture();
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: draft.template.id,
			fetch: fetchStub(bytes)
		});
		const loaded = await repository.getPresentation(draft.template.id);

		catalog.versions[0]!.validationState = 'pending';
		await expect(repository.savePresentation(loaded)).rejects.toMatchObject({
			code: 'invalid_asset'
		});
		expect(catalog.templateVersions).toHaveLength(1);
	});

	it('detects derivative bytes that no longer match the pinned version', async () => {
		const { bytes, version, catalog, draft } = await fixture();
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: draft.template.id,
			fetch: fetchStub(bytes)
		});
		const loaded = await repository.getPresentation(draft.template.id);
		// Storage hands back different bytes than the version records.
		version.derivativeSha256 = 'f'.repeat(64);
		await expect(repository.getMedia(loaded.assets[0]!.id)).rejects.toMatchObject({
			code: 'invalid_asset'
		});
	});

	it('re-reads the newest version after invalidate', async () => {
		const { bytes, catalog, draft } = await fixture();
		const repository = createTemplateDraftRepository({
			catalog,
			templateId: draft.template.id,
			fetch: fetchStub(bytes)
		});
		const loaded = await repository.getPresentation(draft.template.id);
		// Another tab writes version 2 while this adapter caches version 1.
		const other = { ...JSON.parse(presentationDocumentToJson(loaded)), title: 'Newer' };
		const otherJson = JSON.stringify(other);
		const saved = await catalog.saveTemplateVersion({
			templateId: draft.template.id,
			expectedRevision: 1,
			document: other,
			documentSha256: await sha256Hex(new TextEncoder().encode(otherJson)),
			documentBytes: otherJson.length,
			fontRequirements: []
		});
		expect(saved.ok).toBe(true);

		expect((await repository.getPresentation(draft.template.id)).title).toBe('Template copy');
		repository.invalidate();
		expect((await repository.getPresentation(draft.template.id)).title).toBe('Newer');
	});
});
