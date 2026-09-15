/**
 * Browser regression for the real `/my-stickers` library page
 * (port of the source `src/features/packs/PacksPage.tsx` from React main
 * `54eae61c`).
 *
 * Covers the source page's visible contracts: hero + controls, the five view
 * pills, the pack grid and detail aside, the create/edit/duplicate/delete flows,
 * membership add/reorder/remove, the honest later-slice views, the favorites
 * rail and the sticker drawer. The destructive cases assert the source's
 * semantics — deleting a pack keeps its stickers, and removing a sticker from a
 * pack keeps the sticker and its assets — and the failure case asserts that a
 * refused write surfaces the repository's message instead of a silent no-op.
 *
 * The URL wiring (view parameter, `?pack=` deep link, `#local-stickers` hash) and
 * the real ZIP download are covered by the route/Playwright journeys.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PacksPage from '$lib/components/PacksPage.svelte';
import { createProjectDocument, createMemoryRepository } from '$lib/persistence/repository';
import type { AssetRecord } from '$lib/persistence/repository';
import type { PackRecord, ProjectDocument } from '$lib/domain/domain';
import { templateData } from '$lib/editor/templates';
import type { PackView } from '$lib/packs/packActions';

const FAVORITES_KEY = 'stickerlab_fav_templates';

/** Waits for a condition that depends on effects/async repository work. */
async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 8000
): Promise<T> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function packRecord(overrides: Partial<PackRecord> = {}): PackRecord {
	return {
		id: 'pack-1',
		title: 'Cats',
		description: 'Sleepy friends',
		visibility: 'local',
		projectIds: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

let stickerCount = 0;

/** A saved sticker with one real asset row, so "keeps the artwork" is checkable. */
async function seedSticker(
	repository: ReturnType<typeof createMemoryRepository>,
	title: string
): Promise<ProjectDocument> {
	stickerCount += 1;
	const id = `sticker-${stickerCount}`;
	const assetId = `asset-${stickerCount}`;
	const record: AssetRecord = {
		asset: {
			id: assetId,
			mimeType: 'image/png',
			width: 8,
			height: 8,
			blobKey: assetId,
			provenance: 'test'
		},
		blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
			type: 'image/png'
		})
	};
	const document = createProjectDocument({ id, title });
	await repository.saveProjectWithAssets(
		{
			...document,
			assetIds: [assetId],
			layers: [
				{
					id: `layer-${stickerCount}`,
					kind: 'image',
					name: 'Photo',
					assetId,
					transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
					opacity: 1,
					visible: true,
					locked: false
				}
			]
		},
		[record]
	);
	return document;
}

/**
 * Renders the page the way `src/routes/my-stickers/+page.svelte` does: the URL
 * owns the view, the page reports view picks back through `onselectview`.
 */
async function renderPacks(
	props: {
		repository?: ReturnType<typeof createMemoryRepository>;
		view?: PackView;
		requestedPackId?: string | null;
		hash?: string;
		onselectview?: (view: PackView) => void;
	} = {}
) {
	const repository = props.repository ?? createMemoryRepository();
	/** @type {PackView[]} */
	const views: PackView[] = [];
	/** @type {string[]} */
	const opened: string[] = [];
	const rendered = await render(PacksPage, {
		repository,
		pathname: '/my-stickers',
		search: props.view && props.view !== 'All Packs' ? '?view=mine' : '',
		hash: props.hash ?? '',
		view: props.view ?? 'All Packs',
		requestedPackId: props.requestedPackId ?? null,
		onselectview: (next: PackView) => {
			views.push(next);
			props.onselectview?.(next);
		},
		onopen: (projectId: string) => opened.push(projectId)
	});
	return { repository, rendered, views, opened, container: rendered.container };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
	const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
		(candidate) => candidate.textContent?.trim() === text
	);
	if (!button) throw new Error(`No button labelled "${text}" is mounted`);
	return button;
}

function cardTitles(container: HTMLElement): string[] {
	return [...container.querySelectorAll('.pack-grid .pack-card .pack-card-title b')].map(
		(node) => node.textContent?.trim() ?? ''
	);
}

/** The open dialog, or `null` — a modal opens from an effect, so callers poll. */
function maybeDialog(container: HTMLElement): HTMLDialogElement | null {
	const dialog = container.querySelector('dialog[open]');
	return dialog instanceof HTMLDialogElement ? dialog : null;
}

async function openDialog(
	container: HTMLElement,
	message = 'a dialog'
): Promise<HTMLDialogElement> {
	const dialog = await waitFor(() => maybeDialog(container), message);
	if (!dialog) throw new Error(`Timed out waiting for ${message}`);
	return dialog;
}

function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function createPack(
	container: HTMLElement,
	title: string,
	description = '',
	opener: HTMLElement | null = null
) {
	(opener ?? buttonByText(container, 'New Pack')).click();
	const dialog = await openDialog(container, 'the create-pack dialog');
	type(dialog.querySelector<HTMLInputElement>('#pack-title')!, title);
	type(dialog.querySelector<HTMLInputElement>('#pack-desc')!, description);
	buttonByText(dialog, 'Create Pack').click();
	await waitFor(() => cardTitles(container).includes(title), `the "${title}" pack to appear`);
}

afterEach(() => localStorage.removeItem(FAVORITES_KEY));

describe('my stickers / pack library', () => {
	it('renders the source pack hero, controls and the honest empty library', async () => {
		const { container } = await renderPacks();

		const heading = container.querySelector('h1')?.textContent ?? '';
		expect(heading).toContain('Your little world.');
		expect(heading).toContain('In sticker packs.');
		expect(container.querySelector('.hero-kicker')?.textContent).toContain(
			'COLLECT THE GOOD STUFF'
		);
		expect(container.querySelector('.hero-lead')?.textContent).toContain(
			'Organize saved stickers into packs and export transparent PNG ZIP bundles.'
		);
		expect(container.querySelectorAll('.hero-points li')).toHaveLength(3);
		expect(container.querySelector('.hero:has(.collage-packs)')).not.toBeNull();

		const controls = container.querySelector('.packs-controls');
		expect(controls?.getAttribute('aria-label')).toBe('Pack library controls');
		expect(
			[...container.querySelectorAll('.pills button')].map((pill) => pill.textContent?.trim())
		).toEqual(['All Packs', 'My Packs', 'Favorites', 'Shared with Me', 'Export History']);
		expect(container.querySelector('.pills button[aria-pressed="true"]')?.textContent?.trim()).toBe(
			'All Packs'
		);
		expect(container.querySelector('.pack-search .sr-only')?.textContent?.trim()).toBe(
			'Search packs'
		);
		const search = container.querySelector<HTMLInputElement>('.pack-search input');
		expect(search?.type).toBe('search');
		expect(search?.placeholder).toBe('Search packs…');
		const sort = container.querySelector<HTMLSelectElement>('.pack-sort select');
		expect(sort?.getAttribute('aria-label')).toBe('Sort packs');
		expect([...(sort?.options ?? [])].map((option) => option.value)).toEqual(['recent', 'name']);

		// No packs yet: the source's empty state, not an empty grid.
		expect(container.querySelector('.packs-empty h2')?.textContent).toBe('No local packs yet');
		expect(container.querySelector('.packs-empty-kicker')?.textContent).toBe(
			'Your first collection starts here'
		);
		expect(container.querySelector('.packs-empty p:not(.packs-empty-kicker)')?.textContent).toBe(
			'Packs group stickers into collections and export them as ZIP archives.'
		);
		expect(cardTitles(container)).toEqual([]);

		// The sticker drawer below the library stays part of the page.
		const drawer = container.querySelector('#local-stickers');
		expect(drawer?.querySelector('h2')?.textContent).toBe('All Local Stickers');
		expect(drawer?.querySelector('.section-eyebrow')?.textContent).toBe('YOUR STICKER DRAWER');
		expect(drawer?.textContent).toContain('No local stickers yet');
		expect(drawer?.querySelector('a[href]')?.getAttribute('href')).toContain('/create');
	});

	it('reports a view pick through onselectview instead of owning the URL', async () => {
		const { container, views } = await renderPacks();

		buttonByText(container, 'Favorites').click();
		buttonByText(container, 'Export History').click();
		expect(views).toEqual(['Favorites', 'Export History']);
	});

	it('creates a pack, selects it and shows its detail without stickers', async () => {
		const { container, repository } = await renderPacks();

		await createPack(container, 'My Favorite Cats', 'Playful reactions for chats');

		const packs = await repository.listPacks();
		expect(packs).toHaveLength(1);
		expect(packs[0]!.title).toBe('My Favorite Cats');
		expect(packs[0]!.description).toBe('Playful reactions for chats');
		expect(packs[0]!.visibility).toBe('local');
		expect(packs[0]!.projectIds).toEqual([]);

		expect(cardTitles(container)).toEqual(['My Favorite Cats']);
		expect(container.querySelector('.pack-library-heading > span')?.textContent?.trim()).toBe(
			'1 pack'
		);
		expect(container.querySelector('.pack-library-heading h2')?.textContent).toBe('All Packs');
		expect(container.querySelector('.pack-card .pack-card-copy')?.textContent).toContain(
			'Playful reactions for chats'
		);
		expect(container.querySelector('.pack-card .pack-badge')?.textContent).toBe('Local');
		expect(container.querySelector('.pack-cover-empty b')?.textContent).toBe('Ready for stickers');

		const detail = container.querySelector('aside.pack-detail');
		expect(detail?.getAttribute('aria-label')).toBe('My Favorite Cats pack details');
		expect(detail?.textContent).toContain('SELECTED PACK');
		expect(detail?.textContent).toContain('Stickers (0)');
		expect(detail?.textContent).toContain('No stickers here yet.');
		// Source disables the ZIP download for an empty pack.
		expect(buttonByText(container, 'Download ZIP').disabled).toBe(true);
		expect(container.querySelector('dialog[open]')).toBeNull();
	});

	it('adds saved stickers to a pack, reorders them and removes one without touching the sticker', async () => {
		const repository = createMemoryRepository();
		const first = await seedSticker(repository, 'Sleepy Cat');
		const second = await seedSticker(repository, 'Sunny Day');
		const assetsBefore = (await repository.listAssets()).map((asset) => asset.id);
		const { container } = await renderPacks({ repository });
		await createPack(container, 'Reactions');
		const packId = (await repository.listPacks())[0]!.id;

		// The add-stickers dialog lists saved stickers and toggles membership.
		buttonByText(container, 'Add Stickers').click();
		const dialog = await openDialog(container, 'the add-stickers dialog');
		expect(dialog.textContent).toContain(
			'Check saved local stickers to include them in this pack.'
		);
		const firstBox = dialog.querySelector<HTMLInputElement>(
			'input[aria-label="Include Sleepy Cat"]'
		)!;
		const secondBox = dialog.querySelector<HTMLInputElement>(
			'input[aria-label="Include Sunny Day"]'
		)!;
		firstBox.click();
		await waitFor(
			async () => (await repository.getPack(packId)).projectIds.includes(first.id),
			'the first sticker to be added'
		);
		// The source disables the checkboxes while a pack write is in flight, so the
		// next toggle waits for the settle rather than racing the disabled state.
		await waitFor(() => !secondBox.disabled, 'the first write to settle');
		secondBox.click();
		await waitFor(
			async () => (await repository.getPack(packId)).projectIds.length === 2,
			'the second sticker to be added'
		);
		expect((await repository.getPack(packId)).projectIds).toEqual([first.id, second.id]);

		// Both checkboxes now read as checked (dialog state follows the persisted pack).
		expect(
			dialog.querySelector<HTMLInputElement>('input[aria-label="Include Sleepy Cat"]')?.checked
		).toBe(true);
		buttonByText(dialog, 'Done').click();
		await waitFor(() => container.querySelector('dialog[open]') === null, 'the dialog to close');

		// Reorder: the first tile cannot move up, the last cannot move down.
		const upFirst = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Move Sleepy Cat up"]'
		)!;
		const downLast = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Move Sunny Day down"]'
		)!;
		expect(upFirst.disabled).toBe(true);
		expect(downLast.disabled).toBe(true);
		container
			.querySelector<HTMLButtonElement>('button[aria-label="Move Sleepy Cat down"]')!
			.click();
		await waitFor(
			async () => (await repository.getPack(packId)).projectIds[0] === second.id,
			'the order to persist'
		);
		expect((await repository.getPack(packId)).projectIds).toEqual([second.id, first.id]);

		// Removing a sticker from the pack keeps the sticker and its asset. The tile
		// controls are disabled while a pack write is in flight, so wait for the settle.
		await waitFor(
			() =>
				!container.querySelector<HTMLButtonElement>(
					'button[aria-label="Remove Sunny Day from pack"]'
				)?.disabled,
			'the reorder write to settle'
		);
		container
			.querySelector<HTMLButtonElement>('button[aria-label="Remove Sunny Day from pack"]')!
			.click();
		await waitFor(
			async () => (await repository.getPack(packId)).projectIds.length === 1,
			'the membership to be removed'
		);
		expect((await repository.getPack(packId)).projectIds).toEqual([first.id]);
		expect(await repository.listProjects()).toHaveLength(2);
		expect((await repository.listAssets()).map((asset) => asset.id)).toEqual(assetsBefore);
		await repository.getProject(second.id);
	});

	it('edits a pack, keeping its identity and stickers', async () => {
		const repository = createMemoryRepository();
		const sticker = await seedSticker(repository, 'Sleepy Cat');
		await repository.savePack(packRecord({ projectIds: [sticker.id] }));
		const { container } = await renderPacks({ repository });
		await waitFor(() => cardTitles(container).includes('Cats'), 'the seeded pack to render');

		buttonByText(container, 'Edit pack').click();
		const dialog = await openDialog(container, 'the edit-pack dialog');
		expect(dialog.querySelector('h2')?.textContent).toBe('Edit Pack');
		expect(dialog.querySelector<HTMLInputElement>('#pack-title')?.value).toBe('Cats');
		type(dialog.querySelector<HTMLInputElement>('#pack-title')!, 'Renamed Cats');
		buttonByText(dialog, 'Save Pack').click();
		await waitFor(() => cardTitles(container).includes('Renamed Cats'), 'the rename to persist');

		const saved = await repository.getPack('pack-1');
		expect(saved.id).toBe('pack-1');
		expect(saved.createdAt).toBe('2026-01-01T00:00:00.000Z');
		expect(saved.projectIds).toEqual([sticker.id]);
		expect(saved.updatedAt).not.toBe('2026-01-02T00:00:00.000Z');
	});

	it('duplicates a pack with a fresh id and the same stickers', async () => {
		const repository = createMemoryRepository();
		const sticker = await seedSticker(repository, 'Sleepy Cat');
		await repository.savePack(packRecord({ projectIds: [sticker.id] }));
		const { container } = await renderPacks({ repository });
		await waitFor(() => cardTitles(container).includes('Cats'), 'the seeded pack to render');

		buttonByText(container, 'Duplicate').click();
		await waitFor(() => cardTitles(container).length === 2, 'the duplicate to appear');
		expect(cardTitles(container)).toEqual(['Cats Copy', 'Cats']);

		const packs = await repository.listPacks();
		expect(packs).toHaveLength(2);
		expect(packs[0]!.id).not.toBe('pack-1');
		expect(packs[0]!.title).toBe('Cats Copy');
		expect(packs[0]!.projectIds).toEqual([sticker.id]);
	});

	it('deletes a pack without deleting its stickers, assets or unrelated packs', async () => {
		const repository = createMemoryRepository();
		const member = await seedSticker(repository, 'Sleepy Cat');
		const unrelated = await seedSticker(repository, 'Sunny Day');
		await repository.savePack(
			packRecord({ id: 'pack-member', title: 'Keepers', projectIds: [member.id] })
		);
		await repository.savePack(
			packRecord({ id: 'pack-other', title: 'Others', projectIds: [unrelated.id] })
		);
		const assetsBefore = (await repository.listAssets()).map((asset) => asset.id);
		const { container } = await renderPacks({ repository });
		await waitFor(() => cardTitles(container).length === 2, 'the seeded packs to render');

		const otherCard = [...container.querySelectorAll<HTMLElement>('.pack-card')].find((card) =>
			card.textContent?.includes('Others')
		)!;
		otherCard.click();
		await waitFor(
			() => container.querySelector('aside.pack-detail')?.textContent?.includes('Sunny Day'),
			'the selected pack detail'
		);
		buttonByText(container, 'Delete').click();
		const dialog = await openDialog(container, 'the delete-pack dialog');
		expect(dialog.querySelector('h2')?.textContent).toBe('Delete this pack?');
		expect(dialog.textContent).toContain(
			'“Others” will be removed. Your stickers will be kept, so you can use them in another pack.'
		);
		expect(document.activeElement?.id).toBe('cancel-delete-pack');

		buttonByText(dialog, 'Delete Pack').click();
		await waitFor(
			async () => (await repository.listPacks()).length === 1,
			'the pack to be deleted'
		);
		expect((await repository.listPacks())[0]!.id).toBe('pack-member');
		expect((await repository.listProjects()).map((project) => project.id).sort()).toEqual(
			[member.id, unrelated.id].sort()
		);
		expect((await repository.listAssets()).map((asset) => asset.id)).toEqual(assetsBefore);
		expect(container.querySelector('dialog[open]')).toBeNull();
	});

	it('restores focus to New Pack after deleting the last pack, whose opener is gone', async () => {
		const repository = createMemoryRepository();
		await repository.savePack(packRecord({ id: 'oner', title: 'Only Pack' }));
		const { container } = await renderPacks({ repository });
		await waitFor(() => cardTitles(container).includes('Only Pack'), 'the seeded pack to render');

		buttonByText(container, 'Delete').click();
		const dialog = await openDialog(container, 'the delete-pack dialog');
		buttonByText(dialog, 'Delete Pack').click();
		await waitFor(
			async () => (await repository.listPacks()).length === 0,
			'the pack to be deleted'
		);
		// The source nulls its delete opener and falls back to the New Pack button.
		const newPack = buttonByText(container, 'New Pack');
		await waitFor(() => document.activeElement === newPack, 'focus on New Pack');
		expect(document.activeElement).toBe(newPack);
	});

	it('falls back to New Pack after creating from the empty state', async () => {
		const { container } = await renderPacks();
		buttonByText(container, 'Create a Pack').click();
		const dialog = await openDialog(container, 'the create-pack dialog');
		type(dialog.querySelector<HTMLInputElement>('#pack-title')!, 'First Pack');
		buttonByText(dialog, 'Create Pack').click();
		await waitFor(() => cardTitles(container).includes('First Pack'), 'the created pack to appear');
		const newPack = buttonByText(container, 'New Pack');
		await waitFor(() => document.activeElement === newPack, 'focus on New Pack');
		expect(document.activeElement).toBe(newPack);
	});

	it('opens the messenger notice with the source Got it action and restores focus', async () => {
		const repository = createMemoryRepository();
		await repository.savePack(packRecord({ id: 'pack-1', title: 'Cats' }));
		const { container } = await renderPacks({ repository });
		await waitFor(() => cardTitles(container).includes('Cats'), 'the seeded pack to render');
		const trigger = buttonByText(container, 'WhatsApp / Telegram');
		trigger.click();
		const dialog = await openDialog(container, 'the messenger notice');
		expect(dialog.querySelector('h2')?.textContent).toBe('Messenger packs are unavailable');
		expect(dialog.querySelector('p.muted')?.textContent).toMatch(
			/Download the pack ZIP and add\s+stickers manually\./
		);
		buttonByText(dialog, 'Got it').click();
		await waitFor(() => container.querySelector('dialog[open]') === null, 'the notice to close');
		await waitFor(() => document.activeElement === trigger, 'focus back on the messenger trigger');
		expect(document.activeElement).toBe(trigger);
	});

	it('keeps the pack on screen when a write fails and reports the repository message', async () => {
		const repository = createMemoryRepository();
		repository.injectWriteFailure();
		const { container } = await renderPacks({ repository });

		buttonByText(container, 'New Pack').click();
		const dialog = await openDialog(container, 'the create-pack dialog');
		type(dialog.querySelector<HTMLInputElement>('#pack-title')!, 'Doomed');
		buttonByText(dialog, 'Create Pack').click();
		const alert = await waitFor(
			() => dialog.querySelector('[role="alert"]')?.textContent ?? null,
			'the failure copy'
		);

		expect(alert).toContain('Save failed');
		expect(await repository.listPacks()).toEqual([]);
		expect(container.querySelector('.pack-grid')).toBeNull();
		buttonByText(dialog, 'Cancel').click();
		await waitFor(() => container.querySelector('dialog[open]') === null, 'the dialog to close');
	});

	it('opens the requested pack from a deep link and lets the detail be closed', async () => {
		const repository = createMemoryRepository();
		const member = await seedSticker(repository, 'Sleepy Cat');
		await repository.savePack(packRecord({ id: 'pack-1', title: 'Cats', projectIds: [member.id] }));
		await repository.savePack(packRecord({ id: 'pack-2', title: 'Dogs', projectIds: [] }));
		const { container } = await renderPacks({ repository, requestedPackId: 'pack-2' });

		await waitFor(
			() => container.querySelector('aside.pack-detail')?.textContent?.includes('SELECTED PACK'),
			'the deep-linked pack detail'
		);
		expect(container.querySelector('aside.pack-detail h2')?.textContent).toBe('Dogs');
		expect(container.querySelector('.pack-card.active .pack-card-title')?.textContent).toContain(
			'Dogs'
		);

		container.querySelector<HTMLButtonElement>('button[aria-label="Close pack details"]')!.click();
		await waitFor(
			() => container.querySelector('aside.pack-detail')?.textContent?.includes('Pack details'),
			'the closed detail placeholder'
		);
		expect(container.querySelector('aside.pack-detail')?.textContent).toContain(
			'Select a pack to inspect its stickers or export as ZIP.'
		);
	});

	it('searches and sorts packs, and explains the later-slice views honestly', async () => {
		const repository = createMemoryRepository();
		await repository.savePack(
			packRecord({
				id: 'beta',
				title: 'Beta Cats',
				description: '',
				updatedAt: '2026-02-01T00:00:00.000Z'
			})
		);
		await repository.savePack(
			packRecord({
				id: 'alpha',
				title: 'Alpha Days',
				description: '',
				updatedAt: '2026-01-02T00:00:00.000Z'
			})
		);
		const { container } = await renderPacks({ repository });
		await waitFor(() => cardTitles(container).length === 2, 'the seeded packs to render');
		expect(cardTitles(container)).toEqual(['Beta Cats', 'Alpha Days']);
		expect(container.querySelector('.pack-card .pack-card-copy')?.textContent).toContain(
			'A fresh pack ready for your favorite stickers.'
		);

		const sort = container.querySelector<HTMLSelectElement>('.pack-sort select')!;
		sort.value = 'name';
		sort.dispatchEvent(new Event('change', { bubbles: true }));
		await waitFor(() => cardTitles(container)[0] === 'Alpha Days', 'the name sort to apply');

		const search = container.querySelector<HTMLInputElement>('.pack-search input')!;
		type(search, 'beta');
		await waitFor(() => cardTitles(container).length === 1, 'the search filter to apply');
		expect(cardTitles(container)).toEqual(['Beta Cats']);

		type(search, 'zzz');
		await waitFor(
			() => container.querySelector('.packs-empty h2')?.textContent === 'No packs found',
			'the no-results empty state'
		);
		expect(container.querySelector('.packs-empty p:not(.packs-empty-kicker)')?.textContent).toBe(
			'Nothing matches “zzz”. Try another name or description.'
		);
		buttonByText(container, 'Clear search').click();
		await waitFor(() => cardTitles(container).length === 2, 'the cleared search');
		expect(search.value).toBe('');

		const shared = await renderPacks({ view: 'Shared with Me' });
		expect(shared.container.querySelector('.packs-empty h2')?.textContent).toBe(
			'Sharing is not available yet'
		);
		expect(
			shared.container.querySelector('.packs-empty p:not(.packs-empty-kicker)')?.textContent
		).toBe('Cloud sharing is not set up. Local stickers stay on this device.');

		const history = await renderPacks({ view: 'Export History' });
		expect(history.container.querySelector('.packs-empty h2')?.textContent).toBe('Export History');
		expect(
			history.container.querySelector('.packs-empty p:not(.packs-empty-kicker)')?.textContent
		).toContain('browser controls where files are saved');
	});

	it('shows the favorite templates rail in the Favorites view', async () => {
		const favorite = templateData[0]!;
		localStorage.setItem(FAVORITES_KEY, JSON.stringify([favorite.id]));
		const { container } = await renderPacks({ view: 'Favorites' });

		const rail = await waitFor(() => container.querySelector('.rail'), 'the favorites rail');
		expect(container.querySelector('.section-title h2')?.textContent).toBe('Favorite Templates');
		expect(rail?.textContent).toContain(favorite.title);
		expect(rail?.querySelectorAll('.template-card')).toHaveLength(1);
	});
});
