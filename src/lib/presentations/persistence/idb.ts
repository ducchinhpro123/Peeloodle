/**
 * IndexedDB presentation repository (P13/P14).
 *
 * Documents live in the `presentations` store and media in
 * `presentationMedia`, both added by the additive v5 upgrade of the existing
 * `stickerlab-local` database (sticker stores are never rewritten).
 *
 * A save validates the document, checks revisions against the stored row and
 * writes media plus document inside a single transaction: a failure aborts the
 * whole transaction, so the previous save and its media remain intact. Stored
 * media is immutable — later saves may not replace its bytes or metadata.
 */

import { PersistenceError } from '../../persistence/document';
import { assertPresentationMediaWritable } from './mediaPolicy';
import { byUpdatedAtDescending } from '../../persistence/order';
import { assertRevisionWritable } from './revision';
import {
	arrayBufferToBytes,
	idbRequest,
	openStickerLabDatabase,
	runTransaction,
	STICKERLAB_DB_NAME,
	STORE_NAMES
} from '../../persistence/idb';
import { clonePresentationDocumentWithNewIds } from '../model/factories';
import { serializePresentationDocument } from '../model/parse';
import type { PresentationAsset, PresentationDocument, PresentationSummary } from '../model/types';
import {
	toPresentationSummary,
	type PresentationMediaRecord,
	type PresentationRepository,
	type SavePresentationOptions
} from './repository';

type StoredPresentationMedia = {
	assetId: string;
	mimeType: PresentationAsset['mimeType'];
	bytes: ArrayBuffer;
};

const MIME_TYPES: PresentationAsset['mimeType'][] = ['image/png', 'image/jpeg', 'image/webp'];

function storedMediaToRecord(
	assetId: string,
	row: StoredPresentationMedia
): PresentationMediaRecord {
	const bytes = arrayBufferToBytes(row.bytes);
	if (!bytes)
		throw new PersistenceError('invalid_asset', `Stored media ${assetId} is missing bytes`);
	if (!MIME_TYPES.includes(row.mimeType))
		throw new PersistenceError('invalid_asset', `Stored media ${assetId} has an unsupported type`);
	return { assetId, mimeType: row.mimeType, bytes };
}

function toStoredMedia(record: PresentationMediaRecord): StoredPresentationMedia {
	// Copy into an ArrayBuffer-backed view. Under TypeScript 6, slicing the
	// incoming ArrayBufferLike can retain a SharedArrayBuffer type, which is not
	// a valid value for this IndexedDB row contract.
	const bytes = new Uint8Array(record.bytes);
	return { assetId: record.assetId, mimeType: record.mimeType, bytes: bytes.buffer };
}

export class IdbPresentationRepository implements PresentationRepository {
	private openPromise: Promise<IDBDatabase> | undefined;

	constructor(private readonly dbName = STICKERLAB_DB_NAME) {}

	async listPresentations(): Promise<PresentationSummary[]> {
		const rows = await this.transact([STORE_NAMES.presentations], 'readonly', (tx) =>
			idbRequest<unknown[]>(tx.objectStore(STORE_NAMES.presentations).getAll())
		);
		const summaries: PresentationSummary[] = [];
		for (const row of rows ?? []) {
			try {
				summaries.push(toPresentationSummary(serializePresentationDocument(row)));
			} catch {
				// One unreadable row must not hide the rest of the library.
			}
		}
		return summaries.sort(byUpdatedAtDescending);
	}

	async getPresentation(id: string): Promise<PresentationDocument> {
		const row = await this.transact([STORE_NAMES.presentations], 'readonly', (tx) =>
			idbRequest<unknown>(tx.objectStore(STORE_NAMES.presentations).get(id))
		);
		if (row === undefined)
			throw new PersistenceError('not_found', `Presentation ${id} was not found`);
		return serializePresentationDocument(row);
	}

	async savePresentation(
		document: PresentationDocument,
		media: PresentationMediaRecord[] = [],
		options: SavePresentationOptions = {}
	): Promise<void> {
		const clean = serializePresentationDocument(document);
		const db = await this.open();
		await runTransaction(
			db,
			[STORE_NAMES.presentations, STORE_NAMES.presentationMedia],
			'readwrite',
			async (tx) => {
				const documents = tx.objectStore(STORE_NAMES.presentations);
				const mediaStore = tx.objectStore(STORE_NAMES.presentationMedia);

				const existingRaw = await idbRequest<unknown>(documents.get(clean.id));
				let storedRevision: number | undefined;
				if (existingRaw !== undefined) {
					try {
						storedRevision = serializePresentationDocument(existingRaw).revision;
					} catch {
						throw new PersistenceError(
							'invalid_document',
							`Stored presentation ${clean.id} is unreadable`
						);
					}
				}
				assertRevisionWritable({
					id: clean.id,
					incomingRevision: clean.revision,
					storedRevision,
					baseRevision: options.baseRevision
				});

				const storedMedia = new Map<string, StoredPresentationMedia>();
				for (const asset of clean.assets) {
					const row = await idbRequest<StoredPresentationMedia | undefined>(
						mediaStore.get(asset.id)
					);
					if (row) storedMedia.set(asset.id, row);
				}
				assertPresentationMediaWritable({
					documentId: clean.id,
					assets: clean.assets,
					submitted: media,
					stored: [...storedMedia.values()].map((row) => ({
						assetId: row.assetId,
						mimeType: row.mimeType,
						bytes: arrayBufferToBytes(row.bytes) ?? null
					}))
				});

				for (const record of media) {
					await idbRequest(mediaStore.put(toStoredMedia(record)));
				}
				await idbRequest(documents.put(clean));
			}
		);
	}

	async deletePresentation(id: string): Promise<void> {
		await this.transact([STORE_NAMES.presentations], 'readwrite', (tx) =>
			idbRequest(tx.objectStore(STORE_NAMES.presentations).delete(id))
		);
	}

	async duplicatePresentation(
		id: string,
		options: { title?: string } = {}
	): Promise<PresentationDocument> {
		const source = await this.getPresentation(id);
		const rows = await this.transact([STORE_NAMES.presentationMedia], 'readonly', async (tx) => {
			const store = tx.objectStore(STORE_NAMES.presentationMedia);
			const result: PresentationMediaRecord[] = [];
			for (const asset of source.assets) {
				const row = await idbRequest<StoredPresentationMedia | undefined>(store.get(asset.id));
				if (!row)
					throw new PersistenceError(
						'missing_asset',
						`Cannot duplicate ${id}: media for ${asset.id} is missing`
					);
				result.push(storedMediaToRecord(asset.id, row));
			}
			return result;
		});
		const copy = clonePresentationDocumentWithNewIds(source, {
			title: options.title ?? `${source.title} copy`
		});
		// Assets are cloned in source order, so the media records map by index.
		const media = rows.map((record, index) => ({ ...record, assetId: copy.assets[index]!.id }));
		await this.savePresentation(copy, media);
		return copy;
	}

	async getMedia(assetId: string): Promise<PresentationMediaRecord> {
		const row = await this.transact([STORE_NAMES.presentationMedia], 'readonly', (tx) =>
			idbRequest<StoredPresentationMedia | undefined>(
				tx.objectStore(STORE_NAMES.presentationMedia).get(assetId)
			)
		);
		if (!row) throw new PersistenceError('not_found', `Media ${assetId} was not found`);
		return storedMediaToRecord(assetId, row);
	}

	async hasMedia(assetId: string): Promise<boolean> {
		const key = await this.transact([STORE_NAMES.presentationMedia], 'readonly', (tx) =>
			idbRequest<IDBValidKey | undefined>(
				tx.objectStore(STORE_NAMES.presentationMedia).getKey(assetId)
			)
		);
		return key !== undefined;
	}

	private async transact<T>(
		storeNames: string[],
		mode: IDBTransactionMode,
		work: (tx: IDBTransaction) => Promise<T>
	): Promise<T> {
		const db = await this.open();
		return runTransaction(db, storeNames, mode, work);
	}

	private open(): Promise<IDBDatabase> {
		if (!this.openPromise) {
			this.openPromise = openStickerLabDatabase(this.dbName).catch((error) => {
				this.openPromise = undefined;
				throw error;
			});
		}
		return this.openPromise;
	}
}
