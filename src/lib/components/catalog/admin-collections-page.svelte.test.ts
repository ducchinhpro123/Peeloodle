/**
 * Browser contract for the admin collections screen (P52), driven against
 * `MemoryCatalog` — the same semantics as the guarded RPCs.
 *
 * Covers the list's honest states, creation, search, the compare-and-set
 * conflict (the form keeps the administrator's values and the next save
 * replaces the other edit explicitly), the contained-items archive refusal with
 * its explicit consent, and a membership failure shown instead of a silent
 * empty list.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminCollectionsPage from './AdminCollectionsPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import type { CatalogAsset, CatalogCollection } from '$lib/catalog/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const now = '2026-09-16T00:00:00.000Z';

function collection(overrides: Partial<CatalogCollection> = {}): CatalogCollection {
	return {
		id: 'c0000000-0000-4000-8000-000000000001',
		name: 'Animals',
		description: 'Everyday animals',
		tags: ['animals'],
		sortOrder: 1,
		state: 'draft',
		revision: 1,
		publishedAt: null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function asset(overrides: Partial<CatalogAsset> = {}): CatalogAsset {
	return {
		id: 'a0000000-0000-4000-8000-000000000001',
		collectionId: 'c0000000-0000-4000-8000-000000000001',
		name: 'Cat',
		description: '',
		tags: [],
		kind: 'raster',
		provenance: {},
		sortOrder: 1,
		state: 'published',
		revision: 2,
		publishedVersionId: 'v0000000-0000-4000-8000-000000000001',
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
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

async function openDialog(container: HTMLElement, title: string): Promise<HTMLDialogElement> {
	return waitFor(
		() =>
			[...container.querySelectorAll('dialog')].find(
				(dialog) => dialog.open && (dialog.textContent ?? '').includes(title)
			),
		`the “${title}” dialog`
	);
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

function rowFor(container: HTMLElement, name: string): Promise<HTMLElement> {
	return waitFor(
		() =>
			[...container.querySelectorAll('li')].find((row) => (row.textContent ?? '').includes(name)),
		`the “${name}” row`
	);
}

describe('admin collections page', () => {
	it('lists draft and published collections with their state and revision', async () => {
		const catalog = new MemoryCatalog(
			{
				admins: [ADMIN],
				collections: [
					collection(),
					collection({
						id: 'c0000000-0000-4000-8000-000000000002',
						name: 'Spaces',
						state: 'published',
						sortOrder: 2,
						publishedAt: now,
						revision: 3
					})
				]
			},
			ADMIN
		);
		const page = render(AdminCollectionsPage, { repository: catalog });
		const animals = await rowFor(page.container, 'Animals');
		const spaces = await rowFor(page.container, 'Spaces');
		const flat = (element: HTMLElement) => (element.textContent ?? '').replace(/\s+/g, ' ');
		expect(flat(animals)).toContain('draft');
		expect(flat(animals)).toContain('revision 1');
		expect(flat(spaces)).toContain('published');
		expect(flat(spaces)).toContain('revision 3');
	});

	it('creates a draft collection through the dialog', async () => {
		const catalog = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const page = render(AdminCollectionsPage, { repository: catalog });
		buttonByText(page.container, 'New collection').click();
		const dialog = await openDialog(page.container, 'New collection');
		type(dialog.querySelector<HTMLInputElement>('#catalog-collection-name')!, 'Animals');
		type(dialog.querySelector<HTMLTextAreaElement>('#catalog-collection-description')!, 'Pets');
		type(dialog.querySelector<HTMLInputElement>('#catalog-collection-tags')!, 'pets, animals');
		buttonByText(dialog, 'Create draft').click();
		await rowFor(page.container, 'Animals');
		await waitFor(
			() => page.container.textContent?.includes('Created “Animals” as a draft.'),
			'the creation notice'
		);
		expect(catalog.collections).toHaveLength(1);
		expect(catalog.collections[0].tags).toEqual(['pets', 'animals']);
		expect(catalog.collections[0].state).toBe('draft');
	});

	it('searches on submit and can clear the filter', async () => {
		const catalog = new MemoryCatalog(
			{
				admins: [ADMIN],
				collections: [
					collection(),
					collection({
						id: 'c0000000-0000-4000-8000-000000000002',
						name: 'Spaces',
						sortOrder: 2
					})
				]
			},
			ADMIN
		);
		const page = render(AdminCollectionsPage, { repository: catalog });
		await rowFor(page.container, 'Animals');
		const search = page.container.querySelector<HTMLInputElement>('#catalog-collection-search')!;
		type(search, 'space');
		buttonByText(page.container, 'Search').click();
		await waitFor(() => !page.container.textContent?.includes('Animals'), 'the filtered list');
		await rowFor(page.container, 'Spaces');
		expect(page.container.textContent).not.toContain('Animals');
		buttonByText(page.container, 'Clear').click();
		await rowFor(page.container, 'Animals');
		expect(page.container.textContent).toContain('Animals');
	});

	it('keeps the form values on a revision conflict and replaces the other edit on the next save', async () => {
		const catalog = new MemoryCatalog({ admins: [ADMIN], collections: [collection()] }, ADMIN);
		const page = render(AdminCollectionsPage, { repository: catalog });
		const animals = await rowFor(page.container, 'Animals');
		buttonByText(animals, 'Edit').click();
		const dialog = await openDialog(page.container, 'Edit collection');
		type(dialog.querySelector<HTMLInputElement>('#catalog-collection-name')!, 'Animals (mine)');
		// Another administrator saves first.
		catalog.collections[0].revision = 2;
		catalog.collections[0].name = 'Animals (theirs)';
		buttonByText(dialog, 'Save changes').click();
		await waitFor(
			() => dialog.textContent?.includes('Another change made this revision 2'),
			'the conflict message'
		);
		expect(dialog.querySelector<HTMLInputElement>('#catalog-collection-name')?.value).toBe(
			'Animals (mine)'
		);
		buttonByText(dialog, 'Save changes').click();
		await waitFor(
			() => page.container.textContent?.includes('Saved “Animals (mine)”.'),
			'the saved notice'
		);
		expect(catalog.collections[0].name).toBe('Animals (mine)');
		expect(catalog.collections[0].revision).toBe(3);
	});

	it('refuses to archive a non-empty collection until its items are included', async () => {
		const catalog = new MemoryCatalog(
			{
				admins: [ADMIN],
				collections: [collection({ state: 'published', publishedAt: now })],
				assets: [asset()]
			},
			ADMIN
		);
		const page = render(AdminCollectionsPage, { repository: catalog });
		const animals = await rowFor(page.container, 'Animals');
		buttonByText(animals, 'Archive').click();
		const dialog = await openDialog(page.container, 'Archive collection');
		buttonByText(dialog, 'Archive collection').click();
		await waitFor(
			() => dialog.textContent?.includes('still contains 1 item'),
			'the contained-items refusal'
		);
		expect(catalog.collections[0].state).toBe('published');
		const include = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
		include.click();
		buttonByText(dialog, 'Archive collection').click();
		await waitFor(
			() => page.container.textContent?.includes('Archived “Animals”.'),
			'the archive notice'
		);
		expect(catalog.collections[0].state).toBe('archived');
		expect(catalog.assets[0].state).toBe('archived');
	});

	it('shows a membership failure instead of an empty list', async () => {
		const catalog = new MemoryCatalog({ admins: [], collections: [collection()] }, 'other-account');
		const page = render(AdminCollectionsPage, { repository: catalog });
		await waitFor(
			() => page.container.textContent?.includes('no longer a catalog administrator'),
			'the permission message'
		);
		expect(buttonByText(page.container, 'Try again')).toBeTruthy();
	});
});
