/**
 * Shared IndexedDB plumbing for the sticker and presentation repositories.
 *
 * Version 5 is an additive upgrade over the sticker schema: it creates the
 * `presentations` and `presentationMedia` stores and never rewrites existing
 * `projects`, `assets`, `packs`, `masks` or `sync` rows. Both repositories open
 * the same database name so a presentation transaction can rely on the same
 * connection and upgrade path as sticker data.
 */

import { PersistenceError } from './document';

export const STICKERLAB_DB_NAME = 'stickerlab-local';
/** v5 adds presentation stores. */
export const STICKERLAB_DB_VERSION = 5;

export const STORE_NAMES = {
	projects: 'projects',
	assets: 'assets',
	packs: 'packs',
	masks: 'masks',
	sync: 'sync',
	presentations: 'presentations',
	presentationMedia: 'presentationMedia'
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

const KEY_PATHS: ReadonlyArray<[StoreName, string]> = [
	[STORE_NAMES.projects, 'id'],
	[STORE_NAMES.assets, 'id'],
	[STORE_NAMES.packs, 'id'],
	[STORE_NAMES.masks, 'key'],
	[STORE_NAMES.sync, 'key'],
	[STORE_NAMES.presentations, 'id'],
	[STORE_NAMES.presentationMedia, 'assetId']
];

export function openStickerLabDatabase(name = STICKERLAB_DB_NAME): Promise<IDBDatabase> {
	const factory = globalThis.indexedDB;
	if (!factory) throw new PersistenceError('transaction_failed', 'IndexedDB is not available');
	return new Promise((resolve, reject) => {
		const request = factory.open(name, STICKERLAB_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			for (const [store, keyPath] of KEY_PATHS) {
				if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onerror = () =>
			reject(
				new PersistenceError('transaction_failed', 'Failed to open local database', request.error)
			);
	});
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(
				request.error ?? new PersistenceError('transaction_failed', 'IndexedDB request failed')
			);
	});
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () =>
			reject(
				tx.error ?? new PersistenceError('transaction_failed', 'IndexedDB transaction failed')
			);
		tx.onabort = () =>
			reject(
				tx.error ?? new PersistenceError('transaction_failed', 'IndexedDB transaction aborted')
			);
	});
}

/** Runs work inside one transaction; any throw aborts and rolls back the writes. */
export async function runTransaction<T>(
	db: IDBDatabase,
	storeNames: string[],
	mode: IDBTransactionMode,
	work: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
	const tx = db.transaction(storeNames, mode);
	const done = transactionDone(tx);
	try {
		const result = await work(tx);
		await done;
		return result;
	} catch (error) {
		try {
			tx.abort();
		} catch {
			// Already finished or aborted.
		}
		await done.catch(() => undefined);
		throw error instanceof PersistenceError
			? error
			: new PersistenceError('transaction_failed', 'IndexedDB operation failed', error);
	}
}

export function arrayBufferToBytes(value: unknown): Uint8Array | undefined {
	if (isArrayBuffer(value) && value.byteLength > 0) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value) && value.byteLength > 0) {
		return new Uint8Array(
			value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
		);
	}
	return undefined;
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
	return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
