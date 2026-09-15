/**
 * Undo/redo bookkeeping for the presentation editor (P25), free of Zustand and
 * of the store's command surface.
 *
 * History is whole-document snapshots: each entry is a revision that already
 * existed, and stepping restores it as a *new* revision so a later save can
 * always tell the stored revision apart. One completed gesture is one entry —
 * commands that share an open `historyGroup` merge into the previous entry
 * instead of pushing a new one. History is bounded by entry count and by a soft
 * byte budget, oldest first, so a long session cannot grow without limit;
 * document bounds are enforced separately when a document is serialized.
 */

import { PRESENTATION_LIMITS } from '../model/limits';
import type { PresentationDocument } from '../model/types';

export type HistoryEntry = { document: PresentationDocument; bytes: number };

export type PresentationHistory = {
	past: HistoryEntry[];
	future: HistoryEntry[];
	/** Open gesture that subsequent records merge into; null means no open group. */
	lastHistoryGroup: string | null;
};

export function estimateBytes(document: PresentationDocument): number {
	try {
		return JSON.stringify(document).length;
	} catch {
		return 0;
	}
}

/** Restores a snapshot as the next revision of the current document. */
export function withRevision(
	current: PresentationDocument,
	next: PresentationDocument
): PresentationDocument {
	next.revision = current.revision + 1;
	next.updatedAt = new Date().toISOString();
	return next;
}

/** One place that bounds undo history, so every push trims identically. */
function boundedHistory(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
	let next = [...past, entry];
	while (
		next.length > PRESENTATION_LIMITS.historyEntries ||
		(next.length > 1 &&
			next.reduce((sum, item) => sum + item.bytes, 0) > PRESENTATION_LIMITS.historySoftBytes)
	) {
		next = next.slice(1);
	}
	return next;
}

/**
 * Records the current document before a change replaces it. A new change clears
 * the redo stack; a change inside the open group merges into the entry already
 * recorded for that gesture.
 */
export function recordHistory(
	history: PresentationHistory,
	current: PresentationDocument,
	group?: string
): PresentationHistory {
	if (group !== undefined && group === history.lastHistoryGroup) {
		return { past: history.past, future: [], lastHistoryGroup: group };
	}
	return {
		past: boundedHistory(history.past, { document: current, bytes: estimateBytes(current) }),
		future: [],
		lastHistoryGroup: group ?? null
	};
}

/**
 * One undo step: the previous snapshot becomes the live revision and the
 * document being left becomes the newest redo entry.
 */
export function stepBack(
	history: PresentationHistory,
	current: PresentationDocument
): { history: PresentationHistory; restored: PresentationDocument } | null {
	const entry = history.past.at(-1);
	if (!entry) return null;
	return {
		history: {
			past: history.past.slice(0, -1),
			future: [...history.future, { document: current, bytes: estimateBytes(current) }].slice(
				-PRESENTATION_LIMITS.historyEntries
			),
			lastHistoryGroup: null
		},
		restored: withRevision(current, structuredClone(entry.document))
	};
}

/** The redo counterpart of `stepBack`. */
export function stepForward(
	history: PresentationHistory,
	current: PresentationDocument
): { history: PresentationHistory; restored: PresentationDocument } | null {
	const entry = history.future.at(-1);
	if (!entry) return null;
	return {
		history: {
			past: [...history.past, { document: current, bytes: estimateBytes(current) }].slice(
				-PRESENTATION_LIMITS.historyEntries
			),
			future: history.future.slice(0, -1),
			lastHistoryGroup: null
		},
		restored: withRevision(current, structuredClone(entry.document))
	};
}
