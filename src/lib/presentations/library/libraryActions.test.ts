import { describe, expect, it } from 'vitest';
import { PersistenceError } from '$lib/persistence/document';
import { createPresentationDocument } from '../model/factories';
import {
	RENAME_EMPTY_TITLE_MESSAGE,
	describeLibraryFailure,
	renamedDocument
} from './libraryActions';

describe('presentation library actions', () => {
	it('trims a renamed document and advances its revision and timestamp', () => {
		const document = createPresentationDocument({ id: 'deck', title: 'Before' });
		expect(renamedDocument(document, '  After  ', '2026-09-15T00:00:00.000Z')).toMatchObject({
			id: 'deck',
			title: 'After',
			revision: document.revision + 1,
			updatedAt: '2026-09-15T00:00:00.000Z'
		});
	});

	it('does not construct a nameless presentation', () => {
		expect(renamedDocument(createPresentationDocument(), '  \n ')).toBeNull();
		expect(RENAME_EMPTY_TITLE_MESSAGE).toContain('Enter a name');
	});

	it('explains conflicts and missing artwork without hiding data-loss guarantees', () => {
		expect(
			describeLibraryFailure(new PersistenceError('revision_conflict', 'stale'), 'rename')
		).toContain('newer version was kept');
		expect(
			describeLibraryFailure(new PersistenceError('missing_asset', 'missing'), 'duplicate')
		).toContain('artwork is missing');
	});

	it('uses an action-specific retry message for unexpected failures', () => {
		expect(describeLibraryFailure(new Error('offline'), 'delete')).toBe(
			'Could not delete this presentation. Nothing was changed; please try again.'
		);
	});
});
