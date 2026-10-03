/** Download receipts are device-only hints, not proof that a file was retained.
 * No document schema changes: losing/denying this small preference only brings
 * the reminder back. Hash content, not just revision (concurrent inserts can
 * produce different documents at the same revision).
 */
import { sha256Hex } from '$lib/hash';
import { presentationDocumentToJson } from '../model/parse';
import type { PresentationDocument } from '../model/types';

export type BackupDownloadReceipt = {
	documentId: string;
	documentSha256: string;
	downloadedAt: string;
};

const key = (id: string) => `stickerlab:presentation-backup-download:${id}`;

export function backupDocumentFingerprint(document: PresentationDocument): Promise<string> {
	return sha256Hex(new TextEncoder().encode(presentationDocumentToJson(document)));
}

export function readBackupDownloadReceipt(id: string): BackupDownloadReceipt | null {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key(id)) ?? 'null');
		if (!value || typeof value !== 'object') return null;
		const receipt = value as Partial<BackupDownloadReceipt>;
		return receipt.documentId === id &&
			typeof receipt.documentSha256 === 'string' &&
			/^[a-f0-9]{64}$/.test(receipt.documentSha256) &&
			typeof receipt.downloadedAt === 'string' &&
			Number.isFinite(Date.parse(receipt.downloadedAt))
			? (receipt as BackupDownloadReceipt)
			: null;
	} catch {
		return null;
	}
}

export function rememberBackupDownload(receipt: BackupDownloadReceipt): void {
	try {
		localStorage.setItem(key(receipt.documentId), JSON.stringify(receipt));
	} catch {
		/* A blocked preference must never turn a completed export into a failure. */
	}
}
