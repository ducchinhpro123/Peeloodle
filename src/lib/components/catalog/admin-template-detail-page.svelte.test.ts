/**
 * Browser contract for the admin template detail screen (P66): metadata,
 * immutable version facts, compare-and-set metadata editing with a conflict that
 * keeps the typed values, and the missing / no-version states.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '$lib/presentations/rendering/presentation-fonts.css';
import AdminTemplateDetailPage from './AdminTemplateDetailPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import { sha256Hex } from '$lib/hash';
import { fixtureImagePng } from '$lib/presentations/model/fixtures/fixture';
import { createImageElement, createPresentationDocument } from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import type {
	CatalogAssetVersion,
	CatalogTemplate,
	CatalogTemplateVersion
} from '$lib/catalog/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const now = '2026-09-16T00:00:00.000Z';
const listHref = '/admin/templates';
const editHref = '/admin/templates/t0000000-0000-4000-8000-000000000001/edit';

function template(overrides: Partial<CatalogTemplate> = {}): CatalogTemplate {
	return {
		id: 't0000000-0000-4000-8000-000000000001',
		title: 'Class presentation',
		useCase: 'class',
		description: 'A complete class deck',
		tags: ['class'],
		sortOrder: 1,
		state: 'draft',
		revision: 2,
		publishedVersionId: null,
		publishedAt: null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function version(overrides: Partial<CatalogTemplateVersion> = {}): CatalogTemplateVersion {
	return {
		id: 'w0000000-0000-4000-8000-000000000001',
		templateId: template().id,
		versionNumber: 1,
		document: { schemaVersion: 1, assets: [] },
		documentSha256: 'a'.repeat(64),
		documentBytes: 2048,
		coverPath: null,
		coverSha256: null,
		slidePreviews: [],
		fontRequirements: [{ fontId: 'be-vietnam-pro' }],
		validationState: 'pending',
		validation: { created_by: ADMIN },
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

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('admin template detail page', () => {
	it('shows stable metadata and newest-first version facts', async () => {
		const catalog = new MemoryCatalog(
			{
				admins: [ADMIN],
				templates: [template()],
				templateVersions: [
					version(),
					version({
						id: 'w0000000-0000-4000-8000-000000000002',
						versionNumber: 2,
						documentBytes: 4096,
						documentSha256: 'b'.repeat(64),
						fontRequirements: [{ fontId: 'inter' }, { fontId: 'be-vietnam-pro' }],
						createdAt: '2026-09-17T00:00:00.000Z'
					})
				]
			},
			ADMIN
		);
		const page = render(AdminTemplateDetailPage, {
			templateId: template().id,
			repository: catalog,
			listHref,
			editHref
		});

		await waitFor(() => page.container.textContent?.includes('Class presentation'), 'the title');
		const text = page.container.textContent ?? '';
		expect(text).toContain('A complete class deck');
		expect(text).toContain('revision 2');
		expect(text).toContain('Version 2');
		expect(text).toContain('4.0 kB');
		expect(text).toContain('inter, be-vietnam-pro');
		const edit = page.container.querySelector(`a[href="${editHref}"]`);
		expect(edit).not.toBeNull();
	});

	it('edits metadata through compare-and-set and shows the saved revision', async () => {
		const catalog = new MemoryCatalog(
			{ admins: [ADMIN], templates: [template()], templateVersions: [version()] },
			ADMIN
		);
		const page = render(AdminTemplateDetailPage, {
			templateId: template().id,
			repository: catalog,
			listHref,
			editHref
		});
		await waitFor(() => page.container.textContent?.includes('Class presentation'), 'the title');

		buttonByText(page.container, 'Edit metadata').click();
		const dialog = await waitFor(
			() =>
				[...page.container.querySelectorAll('dialog')].find(
					(row) => row.open && (row.textContent ?? '').includes('Edit template metadata')
				),
			'the metadata dialog'
		);
		type(dialog.querySelector<HTMLInputElement>('#catalog-template-title')!, 'Class deck v2');
		type(dialog.querySelector<HTMLInputElement>('#catalog-template-tags')!, 'class, starter');
		buttonByText(dialog, 'Save metadata').click();

		await waitFor(
			() => page.container.textContent?.includes('Saved “Class deck v2”.'),
			'the saved notice'
		);
		expect(catalog.templates[0]).toMatchObject({
			title: 'Class deck v2',
			tags: ['class', 'starter'],
			revision: 3
		});
	});

	it('keeps typed values on a metadata revision conflict and adopts the server revision', async () => {
		const catalog = new MemoryCatalog(
			{ admins: [ADMIN], templates: [template()], templateVersions: [version()] },
			ADMIN
		);
		const page = render(AdminTemplateDetailPage, {
			templateId: template().id,
			repository: catalog,
			listHref,
			editHref
		});
		await waitFor(() => page.container.textContent?.includes('Class presentation'), 'the title');

		buttonByText(page.container, 'Edit metadata').click();
		const dialog = await waitFor(
			() =>
				[...page.container.querySelectorAll('dialog')].find(
					(row) => row.open && (row.textContent ?? '').includes('Edit template metadata')
				),
			'the metadata dialog'
		);
		type(dialog.querySelector<HTMLInputElement>('#catalog-template-title')!, 'My title');
		// Another administrator changes the same template first.
		await catalog.updateTemplate(template().id, 2, {
			title: 'Other title',
			useCase: 'class',
			description: '',
			tags: [],
			sortOrder: 1
		});
		buttonByText(dialog, 'Save metadata').click();

		await waitFor(
			() => (dialog.textContent ?? '').includes('Saving again replaces it'),
			'the conflict message'
		);
		const title = dialog.querySelector<HTMLInputElement>('#catalog-template-title');
		expect(title?.value).toBe('My title');
		expect(catalog.templates[0]).toMatchObject({ title: 'Other title', revision: 3 });
	});

	it('generates and attaches slide previews from the exact pending draft', async () => {
		const bytes = fixtureImagePng();
		const sha = await sha256Hex(bytes);
		const assetId = 'a0000000-0000-4000-8000-0000000000c1';
		const assetVersionId = 'v0000000-0000-4000-8000-0000000000c1';
		const derivativePath = `assets/${assetId}/${assetVersionId}/asset.png`;
		const version: CatalogAssetVersion = {
			id: assetVersionId,
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
		const document = createPresentationDocument({ id: 'template-doc', title: 'Template' });
		const asset = {
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
				catalogVersionId: assetVersionId
			}
		};
		document.assets = [asset];
		document.slides[0]!.elements.push(
			createImageElement({ assetId: asset.id, width: 256, height: 256 })
		);
		const json = presentationDocumentToJson(document);
		const encoded = new TextEncoder().encode(json);
		const catalog = new MemoryCatalog({ admins: [ADMIN], versions: [version] }, ADMIN);
		const created = await catalog.createTemplateDraft({
			metadata: {
				title: 'Preview deck',
				useCase: 'class',
				description: '',
				tags: [],
				sortOrder: 0
			},
			document: JSON.parse(json),
			documentSha256: await sha256Hex(encoded),
			documentBytes: encoded.length,
			fontRequirements: []
		});
		if (!created.ok) throw new Error(JSON.stringify(created));
		const templateId = created.item.template.id;
		catalog.derivativeUrls.set(derivativePath, 'https://example.test/template.png');

		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(
				new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
			);
		try {
			const page = render(AdminTemplateDetailPage, {
				templateId,
				repository: catalog,
				listHref,
				editHref
			});
			await waitFor(
				() => page.container.textContent?.includes('Generate previews'),
				'the generate button'
			);
			buttonByText(page.container, 'Generate previews').click();

			const dialog = await waitFor(
				() =>
					[...page.container.querySelectorAll('dialog')].find(
						(row) => row.open && (row.textContent ?? '').includes('Cover slide')
					),
				'the preview dialog'
			);
			expect(dialog.querySelectorAll('input[type="radio"]').length).toBe(1);
			buttonByText(dialog, 'Generate previews').click();

			await waitFor(
				() => page.container.textContent?.includes('Previews attached as version 2.'),
				'the attached notice'
			);
			expect(catalog.templateVersions).toHaveLength(2);
			const successor = catalog.templateVersions[1]!;
			expect(successor).toMatchObject({
				versionNumber: 2,
				validationState: 'pending',
				documentSha256: created.item.version.documentSha256
			});
			expect(successor.slidePreviews).toHaveLength(1);
			expect(successor.coverPath).toBe(successor.slidePreviews[0]!.path);
			expect(
				catalog.objects.filter((object) => object.bucket === 'catalog-derivatives')
			).toHaveLength(1);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('reports a missing template and a template without versions', async () => {
		const missing = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const first = render(AdminTemplateDetailPage, {
			templateId: template().id,
			repository: missing,
			listHref,
			editHref
		});
		await waitFor(
			() => first.container.textContent?.includes('Template not found'),
			'the missing state'
		);

		const empty = new MemoryCatalog({ admins: [ADMIN], templates: [template()] }, ADMIN);
		const second = render(AdminTemplateDetailPage, {
			templateId: template().id,
			repository: empty,
			listHref,
			editHref
		});
		await waitFor(
			() => second.container.textContent?.includes('no draft version yet'),
			'the no-version message'
		);
		expect(second.container.querySelector(`a[href="${editHref}"]`)).toBeNull();
	});
});
