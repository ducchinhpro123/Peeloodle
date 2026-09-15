/**
 * The rules of the pack library, without Svelte or a repository.
 *
 * Port of `../Peeloodle/src/features/packs/packActions.ts` (React main `54eae61c`).
 * The page keeps layout, dialogs and busy/error state; which view the URL
 * selects, how packs are filtered and ordered, and how a pack record changes
 * when it is created, duplicated, or has a sticker added/moved/removed all live
 * here so they can be tested without a router.
 */

import type { PackRecord } from '../domain/domain';

export const PACK_VIEWS = [
	'All Packs',
	'My Packs',
	'Favorites',
	'Shared with Me',
	'Export History'
] as const;
export type PackView = (typeof PACK_VIEWS)[number];
export type PackSort = 'recent' | 'name';

const VIEW_PARAM: Record<PackView, string | null> = {
	'All Packs': null,
	'My Packs': 'mine',
	Favorites: 'favorites',
	'Shared with Me': 'shared',
	'Export History': 'export-history'
};

/** Unknown or absent view parameters fall back to All Packs. */
export function packViewFromParams(params: URLSearchParams): PackView {
	const value = params.get('view');
	return PACK_VIEWS.find((view) => VIEW_PARAM[view] === value) ?? 'All Packs';
}

/** The search-param patch that selects a view; All Packs clears the parameter. */
export function packViewParams(view: PackView): Record<string, string> {
	const value = VIEW_PARAM[view];
	return value ? { view: value } : {};
}

/** Search over title and description, then order by recency or name. */
export function visiblePacks(packs: PackRecord[], query: string, sort: PackSort): PackRecord[] {
	const normalized = query.trim().toLocaleLowerCase();
	return packs
		.filter(
			(pack) =>
				!normalized || `${pack.title} ${pack.description}`.toLocaleLowerCase().includes(normalized)
		)
		.slice()
		.sort((left, right) =>
			sort === 'name'
				? left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
				: right.updatedAt.localeCompare(left.updatedAt)
		);
}

/**
 * The next record for the create/edit form. Editing keeps the pack's identity,
 * visibility and stickers; creating starts local with the caller's id and now.
 * A blank title is refused, so the form cannot save an unnamed pack.
 */
export function buildPackRecord(input: {
	existing?: PackRecord | null;
	title: string;
	description: string;
	id: string;
	now: string;
}): PackRecord | null {
	const title = input.title.trim();
	if (!title) return null;
	return {
		id: input.existing?.id ?? input.id,
		title,
		description: input.description.trim(),
		visibility: input.existing?.visibility ?? 'local',
		projectIds: input.existing?.projectIds ?? [],
		createdAt: input.existing?.createdAt ?? input.now,
		updatedAt: input.now
	};
}

export function duplicatePackRecord(
	pack: PackRecord,
	input: { id: string; now: string }
): PackRecord {
	return {
		...pack,
		id: input.id,
		title: `${pack.title} Copy`,
		createdAt: input.now,
		updatedAt: input.now
	};
}

/** Adds the sticker when it is absent, removes it when present. */
export function setProjectInPack(pack: PackRecord, projectId: string, now: string): PackRecord {
	const projectIds = pack.projectIds.includes(projectId)
		? pack.projectIds.filter((id) => id !== projectId)
		: [...pack.projectIds, projectId];
	return { ...pack, projectIds, updatedAt: now };
}

/** Moves one sticker one step; an out-of-range move returns null (no write). */
export function reorderProjectInPack(
	pack: PackRecord,
	index: number,
	direction: 'up' | 'down',
	now: string
): PackRecord | null {
	const projectIds = [...pack.projectIds];
	const target = direction === 'up' ? index - 1 : index + 1;
	if (target < 0 || target >= projectIds.length) return null;
	const [item] = projectIds.splice(index, 1);
	projectIds.splice(target, 0, item!);
	return { ...pack, projectIds, updatedAt: now };
}
