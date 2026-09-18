/**
 * Browser contract for the layout-insertion picker (P71): published templates
 * only, slide selection by name, the exact ordinals handed to the editor, and
 * an honest failure that keeps the dialog open.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InsertTemplateDialog from './InsertTemplateDialog.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import { createPresentationDocument } from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import type { CatalogTemplate, CatalogTemplateVersion } from '$lib/catalog/types';

const now = '2026-09-16T00:00:00.000Z';

async function fixture() {
	const document = createPresentationDocument({ id: 'template-doc', title: 'Template' });
	document.slides.push({
		...structuredClone(document.slides[0]!),
		id: 'template-slide-2',
		name: 'Agenda'
	});
	const json = presentationDocumentToJson(document);
	const template: CatalogTemplate = {
		id: 't0000000-0000-4000-8000-000000000111',
		title: 'Class deck',
		useCase: 'class',
		description: '',
		tags: [],
		sortOrder: 1,
		state: 'published',
		revision: 3,
		publishedVersionId: 'w0000000-0000-4000-8000-000000000111',
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	const version: CatalogTemplateVersion = {
		id: template.publishedVersionId!,
		templateId: template.id,
		versionNumber: 2,
		document: JSON.parse(json),
		documentSha256: 'e'.repeat(64),
		documentBytes: json.length,
		coverPath: `templates/${template.id}/${template.publishedVersionId}/preview-01.png`,
		coverSha256: 'd'.repeat(64),
		slidePreviews: [],
		fontRequirements: [{ fontId: 'be-vietnam-pro' }],
		validationState: 'validated',
		validation: {},
		createdAt: now
	};
	return new MemoryCatalog({ templates: [template], templateVersions: [version] }, null);
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

describe('insert template dialog', () => {
	it('lists the template slides, hands the chosen ordinals to the editor, and closes', async () => {
		const catalog = await fixture();
		const oninsert = vi.fn(async () => ({ ok: true }));
		const page = render(InsertTemplateDialog, { repository: catalog, oninsert });

		buttonByText(page.container, 'Insert slides').click();
		const dialog = await waitFor(
			() =>
				[...page.container.querySelectorAll('dialog')].find(
					(row) => row.open && (row.textContent ?? '').includes('Insert template slides')
				),
			'the insert dialog'
		);
		const select = await waitFor(() => dialog.querySelector('select'), 'the template select');
		select.value = catalog.templates[0]!.id;
		select.dispatchEvent(new Event('change', { bubbles: true }));

		await waitFor(() => dialog.textContent?.includes('2. Agenda'), 'the slide list');
		const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')];
		expect(boxes).toHaveLength(2);
		for (const box of boxes) box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await waitFor(
			() => !buttonByText(dialog, 'Insert slides').disabled,
			'the enabled insert button'
		);
		buttonByText(dialog, 'Insert slides').click();

		await waitFor(() => oninsert.mock.calls.length > 0, 'the insert callback');
		expect(oninsert).toHaveBeenCalledWith(catalog.templates[0]!.id, [0, 1]);
		await waitFor(() => !dialog.open, 'the dialog to close');
	});

	it('keeps the dialog open and shows the failure', async () => {
		const catalog = await fixture();
		const oninsert = vi.fn(async () => ({
			ok: false,
			message: 'This template’s artwork could not be downloaded (404).'
		}));
		const page = render(InsertTemplateDialog, { repository: catalog, oninsert });

		buttonByText(page.container, 'Insert slides').click();
		const dialog = await waitFor(
			() =>
				[...page.container.querySelectorAll('dialog')].find(
					(row) => row.open && (row.textContent ?? '').includes('Insert template slides')
				),
			'the insert dialog'
		);
		const select = await waitFor(() => dialog.querySelector('select'), 'the template select');
		select.value = catalog.templates[0]!.id;
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await waitFor(() => dialog.querySelectorAll('input[type="checkbox"]').length === 2, 'slides');
		dialog
			.querySelectorAll('input[type="checkbox"]')[0]
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await waitFor(
			() => !buttonByText(dialog, 'Insert slides').disabled,
			'the enabled insert button'
		);
		buttonByText(dialog, 'Insert slides').click();

		const alert = await waitFor(() => dialog.querySelector('[role="alert"]'), 'the alert');
		expect(alert.textContent).toContain('could not be downloaded');
		expect(dialog.open).toBe(true);
	});
});
