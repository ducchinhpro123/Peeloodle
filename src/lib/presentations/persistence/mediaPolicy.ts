/**
 * The media half of a presentation write, shared by both adapters.
 *
 * `revision.ts` exists because the revision checks once drifted between the
 * memory and IndexedDB adapters. Media rules are the second such class: a save
 * may only submit media the document references, with the declared MIME type
 * and non-empty bytes; stored media is immutable, so identical bytes may be
 * re-submitted but different bytes or metadata may not; and every document
 * asset must be resolvable from the submitted plus stored records. Keeping the
 * rule here means an adapter can change how it stores bytes without changing
 * what a legal write is.
 */

import { PersistenceError } from '../../persistence/document';
import type { PresentationAsset } from '../model/types';
import type { PresentationMediaRecord } from './repository';

/** Stored bytes may be unreadable (`null`), which counts as different bytes. */
export type StoredPresentationMedia = {
	assetId: string;
	mimeType: PresentationAsset['mimeType'];
	bytes: Uint8Array | null;
};

export function assertPresentationMediaWritable(input: {
	documentId: string;
	assets: PresentationAsset[];
	submitted: PresentationMediaRecord[];
	stored: StoredPresentationMedia[];
}): void {
	// One map of "what this write will leave stored": stored rows first, then each
	// submitted record, so a duplicate submission is checked against the one before
	// it instead of silently letting the last win.
	const seen = new Map(input.stored.map((record) => [record.assetId, record]));

	for (const record of input.submitted) {
		const asset = input.assets.find((candidate) => candidate.id === record.assetId);
		if (!asset) {
			throw new PersistenceError(
				'invalid_asset',
				`Media ${record.assetId} is not referenced by presentation ${input.documentId}`
			);
		}
		if (asset.mimeType !== record.mimeType) {
			throw new PersistenceError(
				'invalid_asset',
				`Media ${record.assetId} type does not match the document asset`
			);
		}
		if (!record.bytes || record.bytes.length === 0)
			throw new PersistenceError('invalid_asset', `Media for ${record.assetId} is empty`);
		const existing = seen.get(record.assetId);
		if (existing) {
			if (existing.mimeType !== record.mimeType) {
				// Stored metadata is part of the immutable identity: identical-looking
				// bytes may not be re-declared as another format.
				throw new PersistenceError(
					'invalid_asset',
					`Media ${record.assetId} is already stored as ${existing.mimeType}`
				);
			}
			if (!existing.bytes || !bytesEqual(existing.bytes, record.bytes)) {
				// Media is immutable document-local artwork; never let one presentation
				// replace another's bytes.
				throw new PersistenceError(
					'invalid_asset',
					`Refusing to replace media ${record.assetId} with different bytes`
				);
			}
		}
		seen.set(record.assetId, {
			assetId: record.assetId,
			mimeType: record.mimeType,
			bytes: record.bytes
		});
	}

	for (const asset of input.assets) {
		const record = seen.get(asset.id);
		if (!record)
			throw new PersistenceError(
				'missing_asset',
				`Presentation ${input.documentId} references missing media ${asset.id}`
			);
		if (record.mimeType !== asset.mimeType) {
			// Even a save that supplies no media must not leave the stored record
			// describing a different type than the document declares.
			throw new PersistenceError(
				'invalid_asset',
				`Stored media ${asset.id} is ${record.mimeType}, but the document declares ${asset.mimeType}`
			);
		}
	}
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
