import { describe, expect, it } from 'vitest';
import { PersistenceError } from '../../persistence/document';
import { assertRevisionWritable } from './revision';

/**
 * The shared revision guard is the single place both repository adapters enforce
 * these rules, so each rule is pinned here as well as through the adapters.
 */
describe('assertRevisionWritable', () => {
	const id = 'deck-1';

	it('allows the first write of a new row', () => {
		expect(() =>
			assertRevisionWritable({ id, incomingRevision: 0, storedRevision: undefined })
		).not.toThrow();
		expect(() =>
			assertRevisionWritable({
				id,
				incomingRevision: 1,
				storedRevision: undefined,
				baseRevision: -1
			})
		).not.toThrow();
	});

	it('allows a newer revision to replace an older one, with or without a baseRevision', () => {
		expect(() =>
			assertRevisionWritable({ id, incomingRevision: 2, storedRevision: 1 })
		).not.toThrow();
		expect(() =>
			assertRevisionWritable({ id, incomingRevision: 2, storedRevision: 1, baseRevision: 1 })
		).not.toThrow();
	});

	it('refuses an older revision written over newer stored work even with no baseRevision', () => {
		// This is the rule the memory adapter used to be missing.
		expect(() => assertRevisionWritable({ id, incomingRevision: 1, storedRevision: 2 })).toThrow(
			PersistenceError
		);
		try {
			assertRevisionWritable({ id, incomingRevision: 1, storedRevision: 2 });
		} catch (error) {
			expect((error as PersistenceError).code).toBe('revision_conflict');
			expect((error as Error).message).toContain('is newer than this save');
		}
	});

	it('refuses a write whose stored revision moved past the baseRevision', () => {
		try {
			assertRevisionWritable({ id, incomingRevision: 5, storedRevision: 3, baseRevision: 2 });
			throw new Error('expected a conflict');
		} catch (error) {
			expect((error as PersistenceError).code).toBe('revision_conflict');
			expect((error as Error).message).toContain('changed after revision 2');
		}
	});

	it('refuses to silently recreate a row that disappeared under a caller that had read one', () => {
		try {
			assertRevisionWritable({
				id,
				incomingRevision: 1,
				storedRevision: undefined,
				baseRevision: 0
			});
			throw new Error('expected a conflict');
		} catch (error) {
			expect((error as PersistenceError).code).toBe('revision_conflict');
			expect((error as Error).message).toContain('no longer exists');
		}
	});

	it('treats an unreadable stored revision as newer rather than overwritable', () => {
		expect(() =>
			assertRevisionWritable({ id, incomingRevision: 1, storedRevision: Number.POSITIVE_INFINITY })
		).toThrow(PersistenceError);
	});
});
