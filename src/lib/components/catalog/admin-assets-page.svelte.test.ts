/**
 * Browser contract for the asset grid and inspector (P59) with publication and
 * archiving (P60), driven against `MemoryCatalog` — the same guarded semantics as
 * the RPCs.
 *
 * Covers: the grid's honest empty and loaded states, the real version facts in
 * the inspector, publication of a validated version, the refusal to publish an
 * unvalidated one, a revision conflict that keeps the typed values, and the
 * pinned-template refusal on archive.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdminAssetsPage from './AdminAssetsPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogTemplate,
	CatalogTemplateVersion
} from '$lib/catalog/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const now = '2026-09-16T00:00:00.000Z';

function collection(overrides: Partial<CatalogCollection> = {}): CatalogCollection {
	return {
		id: 'c0000000-0000-4000-8000-000000000001',
		name: 'Animals',
		description: '',
		tags: [],
		sortOrder: 1,
		state: 'published',
		revision: 1,
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function asset(overrides: Partial<CatalogAsset> = {}): CatalogAsset {
	return {
		id: 'a0000000-0000-4000-8000-000000000001',
		collectionId: collection().id,
		name: 'Cat',
		description: 'A cat',
		tags: ['animal'],
		kind: 'raster',
		provenance: { original_name: 'cat.png', source: 'upload' },
		sortOrder: 1,
		state: 'draft',
		revision: 1,
		publishedVersionId: null,
		publishedAt: null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function version(overrides: Partial<CatalogAssetVersion> = {}): CatalogAssetVersion {
	return {
		id: 'v0000000-0000-4000-8000-000000000001',
		assetId: asset().id,
		versionNumber: 1,
		sourcePath: 'batches/b/j.png',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 1024,
		sourceMime: 'image/png',
		derivativePath: `assets/${asset().id}/v0000000-0000-4000-8000-000000000001/asset.png`,
		derivativeSha256: 'b'.repeat(64),
		derivativeBytes: 2048,
		derivativeMime: 'image/png',
		derivativeWidth: 512,
		derivativeHeight: 256,
		thumbnailPath: null,
		validationState: 'validated',
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

/**
 * Waits for the card, then clicks a node queried at that moment: the grid
 * re-renders when the collections load, so a node captured by an earlier poll can
 * already be detached when the click would arrive.
 */
async function clickCard(container: HTMLElement, name: string): Promise<void> {
	const find = (): HTMLButtonElement | null => {
		const found = [...container.querySelectorAll('button.asset-card')].find((card) =>
			(card.textContent ?? '').includes(name)
		);
		return found instanceof HTMLButtonElement ? found : null;
	};
	await waitFor(find, `the “${name}” card`);
	await new Promise((resolve) => setTimeout(resolve, 30));
	const card = find();
	if (!card) throw new Error(`The “${name}” card disappeared`);
	card.click();
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('admin assets page', () => {
	it('says there is nothing to show when the filters match no asset', async () => {
		const repository = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const page = render(AdminAssetsPage, { repository });
		await waitFor(
			() => page.container.textContent?.includes('No assets match') ?? false,
			'the empty state'
		);
		expect(page.container.textContent).toContain('Upload files on the Uploads screen');
		await page.unmount();
	});

	it('shows a draft with its version facts and publishes that version', async () => {
		const seeded = asset();
		const repository = new MemoryCatalog(
			{
				admins: [ADMIN],
				collections: [collection()],
				assets: [seeded],
				versions: [version()],
				derivativeUrls: new Map([[version().derivativePath, 'https://example.test/preview.png']])
			},
			ADMIN
		);
		const page = render(AdminAssetsPage, { repository });
		await clickCard(page.container, 'Cat');
		await waitFor(
			() => page.container.textContent?.includes('Version 1: 512×256') ?? false,
			'the version facts'
		);
		expect(page.container.textContent).toContain('Provenance: {"original_name":"cat.png"');
		expect(page.container.querySelector('img')?.getAttribute('src')).toBe(
			'https://example.test/preview.png'
		);

		buttonByText(page.container, 'Publish').click();
		await waitFor(
			() => page.container.textContent?.includes('Cat is published') ?? false,
			'the publication notice'
		);
		expect(repository.assets[0]?.state).toBe('published');
		expect(repository.assets[0]?.publishedVersionId).toBe(version().id);
		await page.unmount();
	});

	it('cannot publish without a validated version and says so', async () => {
		const repository = new MemoryCatalog(
			{
				admins: [ADMIN],
				collections: [collection()],
				assets: [asset()],
				versions: [version({ validationState: 'pending' })]
			},
			ADMIN
		);
		const page = render(AdminAssetsPage, { repository });
		await clickCard(page.container, 'Cat');
		await waitFor(
			() => page.container.textContent?.includes('pending') ?? false,
			'the pending version'
		);
		// The button is offered but the server refuses; the refusal is explained.
		buttonByText(page.container, 'Publish').click();
		await waitFor(
			() => page.container.textContent?.includes('has not passed validation') ?? false,
			'the validation refusal'
		);
		expect(repository.assets[0]?.state).toBe('draft');
		await page.unmount();
	});

	it('keeps the typed values when another edit happened first', async () => {
		const seeded = asset();
		const repository = new MemoryCatalog(
			{ admins: [ADMIN], collections: [collection()], assets: [seeded] },
			ADMIN
		);
		const page = render(AdminAssetsPage, { repository });
		await clickCard(page.container, 'Cat');
		await waitFor(
			() => page.container.querySelector('input[type="text"]') ?? null,
			`the name field; saw: ${page.container.textContent?.replace(/\s+/g, ' ').slice(0, 260)}`
		);

		// Someone else edits the same asset after this screen loaded.
		const other = await repository.updateAsset(seeded.id, 1, {
			collectionId: null,
			name: 'Cat (other tab)',
			description: '',
			tags: [],
			kind: 'raster',
			provenance: {},
			sortOrder: 2
		});
		expect(other.ok).toBe(true);

		const nameInput = page.container.querySelector<HTMLInputElement>('input[type="text"]');
		if (!nameInput) throw new Error('No name input');
		type(nameInput, 'Cat (mine)');
		buttonByText(page.container, 'Save metadata').click();

		await waitFor(
			() => page.container.textContent?.includes('Another change happened first') ?? false,
			'the conflict message'
		);
		expect(page.container.textContent).toContain('server has revision 2');
		expect(nameInput.value).toBe('Cat (mine)');
		expect(buttonByText(page.container, 'Save and replace the other edit')).toBeTruthy();

		buttonByText(page.container, 'Save and replace the other edit').click();
		await waitFor(
			() => repository.assets[0]?.name === 'Cat (mine)',
			'the second save to replace the other edit'
		);
		await page.unmount();
	});

	it('explains a pinned template instead of archiving the asset', async () => {
		const seeded = asset({ state: 'published', publishedVersionId: version().id, revision: 2 });
		const template: CatalogTemplate = {
			id: 't0000000-0000-4000-8000-000000000001',
			title: 'Class deck',
			useCase: 'class',
			description: '',
			tags: [],
			sortOrder: 1,
			state: 'published',
			revision: 1,
			publishedVersionId: 'w0000000-0000-4000-8000-000000000001',
			publishedAt: now,
			archivedAt: null,
			createdAt: now,
			updatedAt: now
		};
		const templateVersion: CatalogTemplateVersion = {
			id: 'w0000000-0000-4000-8000-000000000001',
			templateId: template.id,
			versionNumber: 1,
			document: {},
			coverPath: 'templates/t/w/cover.png',
			slidePreviews: [],
			validationState: 'validated',
			createdAt: now
		};
		const repository = new MemoryCatalog(
			{
				admins: [ADMIN],
				collections: [collection()],
				assets: [seeded],
				versions: [version()],
				templates: [template],
				templateVersions: [templateVersion],
				dependencies: [
					{
						templateVersionId: templateVersion.id,
						assetId: seeded.id,
						assetVersionId: version().id
					}
				]
			},
			ADMIN
		);
		const page = render(AdminAssetsPage, { repository });
		await clickCard(page.container, 'Cat');
		await waitFor(
			() => page.container.textContent?.includes('Version 1') ?? false,
			'the inspector'
		);
		buttonByText(page.container, 'Archive').click();
		const dialog = await waitFor(
			() =>
				[...page.container.querySelectorAll('dialog')].find(
					(candidate) => candidate.open && candidate.textContent?.includes('Archive this asset?')
				) ?? null,
			'the archive dialog'
		);
		buttonByText(dialog, 'Archive asset').click();
		await waitFor(
			() => dialog.textContent?.includes('A published template uses this asset') ?? false,
			'the pinned refusal'
		);
		expect(repository.assets[0]?.state).toBe('published');
		await page.unmount();
	});
});
