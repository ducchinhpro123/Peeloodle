import { describe, expect, it } from 'vitest';
import { assertPresentationMediaWritable, type StoredPresentationMedia } from './mediaPolicy';
import type { PresentationAsset } from '../model/types';
import type { PresentationMediaRecord } from './repository';

function asset(
	id: string,
	mimeType: PresentationAsset['mimeType'] = 'image/png'
): PresentationAsset {
	return {
		id,
		blobKey: `uploads/${id}`,
		mimeType,
		width: 8,
		height: 8,
		sha256: 'a'.repeat(64),
		byteLength: 2,
		provenance: { source: 'upload', label: `${id}.png` }
	};
}

function submitted(
	id: string,
	bytes: number[] = [1, 2],
	mimeType: PresentationAsset['mimeType'] = 'image/png'
): PresentationMediaRecord {
	return { assetId: id, bytes: new Uint8Array(bytes), mimeType };
}

function stored(
	id: string,
	bytes: number[] = [1, 2],
	mimeType: PresentationAsset['mimeType'] = 'image/png'
): StoredPresentationMedia {
	return { assetId: id, mimeType, bytes: new Uint8Array(bytes) };
}

function check(input: Partial<Parameters<typeof assertPresentationMediaWritable>[0]> = {}): void {
	assertPresentationMediaWritable({
		documentId: 'deck',
		assets: [],
		submitted: [],
		stored: [],
		...input
	});
}

describe('presentation media policy', () => {
	it('accepts a stored-only asset and identical re-submitted bytes', () => {
		expect(() => check({ assets: [asset('a')], stored: [stored('a')] })).not.toThrow();
		expect(() =>
			check({ assets: [asset('a')], stored: [stored('a')], submitted: [submitted('a')] })
		).not.toThrow();
	});

	it('rejects media the document does not reference, MIME mismatches and empty bytes', () => {
		expect(() => check({ assets: [asset('a')], submitted: [submitted('b')] })).toThrow(
			/not referenced/
		);
		expect(() =>
			check({ assets: [asset('a')], submitted: [submitted('a', [1, 2], 'image/jpeg')] })
		).toThrow(/does not match/);
		expect(() => check({ assets: [asset('a')], submitted: [submitted('a', [])] })).toThrow(
			/is empty/
		);
	});

	it('treats stored media as immutable bytes and metadata', () => {
		expect(() =>
			check({ assets: [asset('a')], stored: [stored('a', [9, 9])], submitted: [submitted('a')] })
		).toThrow(/different bytes/);
		expect(() =>
			check({
				assets: [asset('a')],
				stored: [stored('a', [1, 2], 'image/jpeg')],
				submitted: [submitted('a')]
			})
		).toThrow(/already stored as/);
		// Unreadable stored bytes count as different bytes, not as a match.
		expect(() =>
			check({
				assets: [asset('a')],
				stored: [{ ...stored('a'), bytes: null }],
				submitted: [submitted('a')]
			})
		).toThrow(/different bytes/);
	});

	it('rejects two submissions of the same asset with different bytes', () => {
		expect(() =>
			check({ assets: [asset('a')], submitted: [submitted('a'), submitted('a', [3, 4])] })
		).toThrow(/different bytes/);
	});

	it('requires every document asset to resolve, with matching declared type', () => {
		expect(() => check({ assets: [asset('a')] })).toThrow(/missing media/);
		expect(() => check({ assets: [asset('a', 'image/webp')], stored: [stored('a')] })).toThrow(
			/declares image\/webp/
		);
	});
});
