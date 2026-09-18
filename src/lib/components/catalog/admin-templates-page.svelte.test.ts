/**
 * Browser contract for the admin template list (P66): real metadata, search and
 * state filters, honest empty/error states, and the base-aware detail link.
 * Driven against `MemoryCatalog`, which mirrors the guarded RPC semantics.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminTemplatesPage from './AdminTemplatesPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import type { CatalogTemplate } from '$lib/catalog/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const now = '2026-09-16T00:00:00.000Z';

function template(overrides: Partial<CatalogTemplate> = {}): CatalogTemplate {
	return {
		id: 't0000000-0000-4000-8000-000000000001',
		title: 'Class presentation',
		useCase: 'class',
		description: 'A complete class deck',
		tags: ['class', 'starter'],
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

const detailHref = (id: string) => `/admin/templates/${id}`;
const presentationsHref = '/presentations';

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

function listRow(container: HTMLElement, title: string): Promise<HTMLElement> {
	return waitFor(
		() =>
			[...container.querySelectorAll('li')].find((row) => (row.textContent ?? '').includes(title)),
		`the “${title}” row`
	);
}

describe('admin templates page', () => {
	it('lists real metadata, filters by state, and links to the detail screen', async () => {
		const catalog = new MemoryCatalog(
			{
				admins: [ADMIN],
				templates: [
					template(),
					template({
						id: 't0000000-0000-4000-8000-000000000002',
						title: 'Research defense',
						useCase: 'research-defense',
						state: 'published',
						publishedVersionId: 'w0000000-0000-4000-8000-000000000009',
						publishedAt: now,
						revision: 4,
						sortOrder: 2
					})
				]
			},
			ADMIN
		);
		const { container } = render(AdminTemplatesPage, {
			repository: catalog,
			detailHref,
			presentationsHref
		});

		const draft = await listRow(container, 'Class presentation');
		expect(draft.textContent).toContain('class');
		expect(draft.textContent).toContain('revision 2');
		expect(draft.querySelector('a')?.getAttribute('href')).toBe(
			`/admin/templates/${template().id}`
		);
		const published = await listRow(container, 'Research defense');
		expect(published.textContent).toContain('published');
		expect(published.textContent).toContain('has a published version');

		const selects = [...container.querySelectorAll('select')];
		const stateFilter = selects.at(-1);
		if (!(stateFilter instanceof HTMLSelectElement)) throw new Error('no state filter');
		stateFilter.value = 'published';
		stateFilter.dispatchEvent(new Event('change', { bubbles: true }));
		await waitFor(
			() =>
				container.querySelector('li')?.textContent?.includes('Research defense') &&
				!container.textContent?.includes('Class presentation'),
			'the published-only list'
		);
	});

	it('searches by title and shows the filtered empty state', async () => {
		const catalog = new MemoryCatalog({ admins: [ADMIN], templates: [template()] }, ADMIN);
		const { container } = render(AdminTemplatesPage, {
			repository: catalog,
			detailHref,
			presentationsHref
		});
		await listRow(container, 'Class presentation');

		const search = container.querySelector('#catalog-template-search');
		if (!(search instanceof HTMLInputElement)) throw new Error('no search input');
		search.value = 'nothing matches this';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		container
			.querySelector('form')
			?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		const filtered = await waitFor(
			() => container.textContent?.includes('No templates match these filters.'),
			'the filtered empty state'
		);
		expect(filtered).toBe(true);
	});

	it('shows an empty catalog with a create path', async () => {
		const catalog = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const { container } = render(AdminTemplatesPage, {
			repository: catalog,
			detailHref,
			presentationsHref
		});
		await waitFor(() => container.textContent?.includes('No templates yet.'), 'the empty state');
		expect(container.querySelector(`a[href="${presentationsHref}"]`)).not.toBeNull();
	});

	it('reports a membership failure instead of an empty list', async () => {
		const catalog = new MemoryCatalog({ templates: [template()] });
		const { container } = render(AdminTemplatesPage, {
			repository: catalog,
			detailHref,
			presentationsHref
		});
		await waitFor(() => container.querySelector('[role="alert"]'), 'the permission alert');
		expect(container.textContent).not.toContain('No templates yet.');
	});
});
