/**
 * Browser contract for the admin template detail screen (P66): metadata,
 * immutable version facts, compare-and-set metadata editing with a conflict that
 * keeps the typed values, and the missing / no-version states.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminTemplateDetailPage from './AdminTemplateDetailPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import type { CatalogTemplate, CatalogTemplateVersion } from '$lib/catalog/types';

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
