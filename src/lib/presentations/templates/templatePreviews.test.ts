/**
 * P67 preview-generation contract: staged failures, one upload per slide, and
 * the commit envelope bound to the exact pending version.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '$lib/hash';
import { createPresentationDocument } from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import { MemoryCatalog } from '$lib/catalog/memory';
import { generateTemplatePreviews } from './templatePreviews';
import type { PresentationDocument } from '$lib/presentations/model/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';

function twoSlideDocument(): PresentationDocument {
	const document = createPresentationDocument({ id: 'template-doc', title: 'Template' });
	document.slides.push({
		...structuredClone(document.slides[0]!),
		id: 'template-slide-2',
		name: 'Second slide'
	});
	return document;
}

async function fixture() {
	const document = twoSlideDocument();
	const json = presentationDocumentToJson(document);
	const encoded = new TextEncoder().encode(json);
	const catalog = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
	const created = await catalog.createTemplateDraft({
		metadata: { title: 'Template', useCase: 'class', description: '', tags: [], sortOrder: 0 },
		document: JSON.parse(json),
		documentSha256: await sha256Hex(encoded),
		documentBytes: encoded.length,
		fontRequirements: []
	});
	if (!created.ok) throw new Error(JSON.stringify(created));
	const head = created.item;
	const rasterize = async (input: { slide: { id: string } }) => ({
		bytes: new TextEncoder().encode(`PNG:${input.slide.id}`),
		dataUrl: 'data:image/png;base64,',
		width: 960,
		height: 540
	});
	const base = {
		templateId: head.template.id,
		versionId: head.version.id,
		expectedRevision: head.template.revision,
		documentSha256: head.version.documentSha256,
		document,
		images: new Map(),
		coverOrdinal: 1,
		rasterize,
		upload: (path: string, blob: Blob) => catalog.uploadDerivative(path, blob, 'image/png'),
		attach: (input: Parameters<typeof catalog.attachTemplatePreviews>[0]) =>
			catalog.attachTemplatePreviews(input)
	};
	return { catalog, head, base };
}

describe('generateTemplatePreviews', () => {
	it('renders, uploads and commits one preview per slide with the chosen cover', async () => {
		const { catalog, head, base } = await fixture();
		const progress: string[] = [];
		const draft = await generateTemplatePreviews({
			...base,
			onProgress: (event) => progress.push(`${event.stage}:${event.completed}/${event.total}`)
		});

		expect(draft.version).toMatchObject({
			versionNumber: 2,
			validationState: 'pending',
			coverPath: `templates/${head.template.id}/${head.version.id}/preview-02.png`
		});
		expect(draft.version.slidePreviews.map((preview) => preview.ordinal)).toEqual([0, 1]);
		expect(draft.version.slidePreviews[1]!.sha256).toBe(
			await sha256Hex(new TextEncoder().encode('PNG:template-slide-2'))
		);
		expect(catalog.objects).toHaveLength(2);
		expect(catalog.objects.every((object) => object.mime === 'image/png')).toBe(true);
		expect(progress).toEqual(['rendering:1/2', 'rendering:2/2', 'uploading:1/2', 'uploading:2/2']);
		// A byte-report mismatch would be refused by the memory gate instead.
		expect(draft.version.validation).toMatchObject({ cover_ordinal: 1 });
	});

	it('refuses in the render stage without uploading anything', async () => {
		const { catalog, base } = await fixture();
		await expect(
			generateTemplatePreviews({
				...base,
				rasterize: async (input: { slide: { id: string } }) => {
					if (input.slide.id === 'template-slide-2') throw new Error('canvas exploded');
					return { bytes: new Uint8Array([1]), dataUrl: '', width: 960, height: 540 };
				}
			})
		).rejects.toMatchObject({ code: 'render_failed' });
		expect(catalog.objects).toHaveLength(0);
		expect(catalog.templateVersions).toHaveLength(1);
	});

	it('reports the upload stage and the attach refusal separately', async () => {
		const { catalog, base } = await fixture();
		await expect(
			generateTemplatePreviews({
				...base,
				upload: async () => {
					throw new Error('storage offline');
				}
			})
		).rejects.toMatchObject({ code: 'upload_failed' });
		expect(catalog.templateVersions).toHaveLength(1);

		await expect(generateTemplatePreviews({ ...base, expectedRevision: 99 })).rejects.toMatchObject(
			{ code: 'attach_refused', reason: 'revision_conflict' }
		);
		// The objects are already uploaded; the refused commit references none of them.
		expect(catalog.objects).toHaveLength(2);
		expect(catalog.templateVersions).toHaveLength(1);
	});

	it('clamps the cover ordinal to the deck', async () => {
		const { catalog, head, base } = await fixture();
		const draft = await generateTemplatePreviews({ ...base, coverOrdinal: 99 });
		expect(draft.version.coverPath).toBe(
			`templates/${head.template.id}/${head.version.id}/preview-02.png`
		);
		expect(catalog.templateVersions).toHaveLength(2);
	});
});
