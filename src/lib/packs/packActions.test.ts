/**
 * Port of `../Peeloodle/src/features/packs/packActions.test.ts` (React main
 * `54eae61c`). The source asserts the pack library's rules without a router: view
 * parameters, search/sort, and the create/duplicate/membership/reorder record
 * edits. The contracts (and the "caller's array is not reordered" case) are kept
 * unchanged.
 */

import { describe, expect, it } from 'vitest';
import {
	buildPackRecord,
	duplicatePackRecord,
	packViewFromParams,
	packViewParams,
	reorderProjectInPack,
	setProjectInPack,
	visiblePacks
} from './packActions';
import type { PackRecord } from '../domain/domain';

function pack(overrides: Partial<PackRecord> = {}): PackRecord {
	return {
		id: 'pack-1',
		title: 'Cats',
		description: 'Sleepy friends',
		visibility: 'local',
		projectIds: ['a', 'b'],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

describe('pack view parameters', () => {
	it('maps known view parameters and falls back on unknown ones', () => {
		expect(packViewFromParams(new URLSearchParams('view=mine'))).toBe('My Packs');
		expect(packViewFromParams(new URLSearchParams('view=favorites'))).toBe('Favorites');
		expect(packViewFromParams(new URLSearchParams('view=shared'))).toBe('Shared with Me');
		expect(packViewFromParams(new URLSearchParams('view=export-history'))).toBe('Export History');
		expect(packViewFromParams(new URLSearchParams('view=anything'))).toBe('All Packs');
		expect(packViewFromParams(new URLSearchParams())).toBe('All Packs');
	});

	it('clears the parameter for All Packs and sets it otherwise', () => {
		expect(packViewParams('All Packs')).toEqual({});
		expect(packViewParams('My Packs')).toEqual({ view: 'mine' });
		expect(packViewParams('Export History')).toEqual({ view: 'export-history' });
	});

	it('reads the view from a query string, so a reload keeps the selected view', () => {
		expect(packViewFromParams(new URLSearchParams(packViewParams('Favorites')))).toBe('Favorites');
		expect(packViewFromParams(new URLSearchParams('pack=pack-1&view=shared'))).toBe(
			'Shared with Me'
		);
	});
});

describe('visible packs', () => {
	it('searches title and description case-insensitively and sorts', () => {
		const beta = pack({
			id: 'beta',
			title: 'Beta Cats',
			description: 'Sleepy afternoon friends',
			updatedAt: '2026-02-01T00:00:00.000Z'
		});
		const alpha = pack({
			id: 'alpha',
			title: 'Alpha Days',
			description: 'Sunny little reactions',
			updatedAt: '2026-01-02T00:00:00.000Z'
		});
		const list = [alpha, beta];

		expect(visiblePacks(list, '', 'recent').map((item) => item.id)).toEqual(['beta', 'alpha']);
		expect(visiblePacks(list, 'sunny little', 'recent').map((item) => item.id)).toEqual(['alpha']);
		expect(visiblePacks(list, '', 'name').map((item) => item.id)).toEqual(['alpha', 'beta']);
		// The caller's array is not reordered.
		expect(list.map((item) => item.id)).toEqual(['alpha', 'beta']);
	});
});

describe('pack record edits', () => {
	it('creates a local pack and refuses a blank title', () => {
		expect(buildPackRecord({ title: '  ', description: 'x', id: 'new', now: 'now' })).toBeNull();
		expect(
			buildPackRecord({ title: ' New Pack ', description: ' desc ', id: 'new', now: 'now' })
		).toEqual({
			id: 'new',
			title: 'New Pack',
			description: 'desc',
			visibility: 'local',
			projectIds: [],
			createdAt: 'now',
			updatedAt: 'now'
		});
	});

	it('edits a pack without changing its identity, creation time or stickers', () => {
		const existing = pack();
		expect(
			buildPackRecord({ existing, title: 'Renamed', description: '', id: 'ignored', now: 'later' })
		).toEqual({
			...existing,
			title: 'Renamed',
			description: '',
			updatedAt: 'later'
		});
	});

	it('duplicates with a fresh id and the caller’s time', () => {
		expect(duplicatePackRecord(pack(), { id: 'copy', now: 'now' })).toEqual({
			...pack(),
			id: 'copy',
			title: 'Cats Copy',
			createdAt: 'now',
			updatedAt: 'now'
		});
	});

	it('toggles membership and moves a sticker one step', () => {
		expect(setProjectInPack(pack(), 'c', 'now').projectIds).toEqual(['a', 'b', 'c']);
		expect(setProjectInPack(pack(), 'a', 'now').projectIds).toEqual(['b']);

		expect(reorderProjectInPack(pack(), 1, 'up', 'now')?.projectIds).toEqual(['b', 'a']);
		expect(reorderProjectInPack(pack(), 0, 'down', 'now')?.projectIds).toEqual(['b', 'a']);
		expect(reorderProjectInPack(pack(), 0, 'up', 'now')).toBeNull();
		expect(reorderProjectInPack(pack(), 1, 'down', 'now')).toBeNull();
	});
});
