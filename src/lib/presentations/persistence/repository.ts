/**
 * Presentation repository contract (P12).
 *
 * Documents and their media are separate records; a save is atomic from the
 * caller's perspective. Implementations include the IndexedDB adapter and the
 * catalog-backed template draft adapter. Error codes come
 * from the shared `PersistenceError` so UIs can distinguish missing media,
 * quota/transaction failures and revision conflicts.
 */

import type { PresentationAsset, PresentationDocument, PresentationSummary } from '../model/types';

export type PresentationMediaRecord = {
	assetId: string;
	bytes: Uint8Array;
	mimeType: PresentationAsset['mimeType'];
};

export type SavePresentationOptions = {
	/** Revision the caller last read; a newer stored revision is a conflict. */
	baseRevision?: number;
};

export interface PresentationRepository {
	listPresentations(): Promise<PresentationSummary[]>;
	getPresentation(id: string): Promise<PresentationDocument>;
	savePresentation(
		document: PresentationDocument,
		media?: PresentationMediaRecord[],
		options?: SavePresentationOptions
	): Promise<void>;
	deletePresentation(id: string): Promise<void>;
	/** Independent copy with new document/slide/element/asset IDs and copied media. */
	duplicatePresentation(id: string, options?: { title?: string }): Promise<PresentationDocument>;
	getMedia(assetId: string): Promise<PresentationMediaRecord>;
	hasMedia(assetId: string): Promise<boolean>;
}

export function toPresentationSummary(document: PresentationDocument): PresentationSummary {
	return {
		id: document.id,
		title: document.title,
		slideCount: document.slides.length,
		updatedAt: document.updatedAt,
		revision: document.revision
	};
}
