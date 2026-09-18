/**
 * Truthful save/autosave rules for the presentation editor (P19), free of React.
 *
 * The store owns the document; one saver turns completed commands into writes
 * and reports what really happened. Every write passes the revision the editor
 * last persisted as `baseRevision`, so a newer revision written by another tab is
 * reported as a conflict instead of being overwritten.
 *
 * Autosave waits for a *completed* command: a new document revision with the
 * history group closed. A drag, a slider gesture, or an open text session holds
 * one history group, so nothing is written mid-gesture.
 *
 * Insertion and conflict recovery go through the same single write path
 * (`serialize`), so there is never a second, concurrent writer. The hook
 * `usePresentationSave` connects status and lifecycle to React; `attachAutosave`
 * is the lifecycle edge, like `draftSaving.attachAutosave` for stickers.
 *
 * Image insertion is persist-first: the document and the new bytes are written
 * in one transaction, so a normal save never carries media and the store holds
 * no pending bytes. A write omits a media record only when the repository
 * already stores it (a content-addressed asset inserted or restored before).
 */

import { isPersistenceError } from '$lib/persistence/repository';
import type { PresentationMediaRecord, PresentationRepository } from '../persistence/repository';
import { clonePresentationDocumentWithNewIds } from '../model/factories';
import { PRESENTATION_LIMITS } from '../model/limits';
import type { PresentationDocument } from '../model/types';
import type { PreparedPresentationImage } from './insertImageAsset';
import {
	imageReplaceRefusal,
	planImageInsert,
	planImageReplacement,
	type PresentationStore,
	type ImageInsertRefusalReason
} from './store.svelte';

export type PresentationSaveStatus = 'clean' | 'saving' | 'saved' | 'failed' | 'conflict';
export type PresentationSaveState = { status: PresentationSaveStatus; message: string | null };

export type PersistOutcome =
	{ ok: true } | { ok: false; reason: 'failed' | 'conflict'; message: string };
export type PersistInsertOutcome =
	| { ok: true; elementId: string }
	| { ok: false; reason: ImageInsertRefusalReason | 'failed' | 'conflict'; message: string };
export type ConflictRecoveryOutcome = { ok: true; copyId: string } | { ok: false; message: string };

export type SaveResult = 'saved' | 'skipped' | 'failed' | 'conflict';

/** Quiet time after the last completed command before an automatic save. */
export const AUTOSAVE_DELAY_MS = 750;

const SAVE_FAILED_MESSAGE =
	'This presentation could not be written to local storage. Your changes are still here and stay editable — press Save to try again.';
const SAVE_CONFLICT_MESSAGE =
	'A newer version of this presentation was saved in another tab or window after you opened it. Your changes are still here and were not overwritten.';

const CONFLICT_COPY_SUFFIX = ' (conflict copy)';

type PresentationStoreSource = Pick<PresentationStore, 'getState' | 'subscribe'>;

export type PresentationSaving = ReturnType<typeof createPresentationSaving>;

export function createPresentationSaving(input: {
	repository: PresentationRepository;
	documentId: string | null;
	/** Commits text that is still only on screen before a save reads the store. */
	flushText: () => void;
	store: PresentationStoreSource;
	/** Overrides the local-storage failure copy (template mode supplies one). */
	describeFailure?: (error: unknown) => string;
	/** The message a revision conflict is reported with. */
	conflictMessage?: string;
}) {
	const { repository, documentId, flushText } = input;
	const store = input.store;
	const conflictMessage = input.conflictMessage ?? SAVE_CONFLICT_MESSAGE;
	const describeFailure = input.describeFailure ?? describeSaveFailure;

	let status: PresentationSaveState = { status: 'clean', message: null };
	const statusListeners = new Set<() => void>();
	let pendingWrites = 0;
	let chain: Promise<unknown> = Promise.resolve();

	const publish = (next: PresentationSaveState) => {
		if (status.status === next.status && status.message === next.message) return;
		status = next;
		for (const listener of statusListeners) listener();
	};

	/**
	 * One serialization point for every write. A write starts immediately when
	 * nothing is in flight, so the visible 'saving' state is not deferred, and is
	 * queued behind the current one otherwise: two writers can never overlap.
	 */
	const serialize = <T>(task: () => Promise<T>): Promise<T> => {
		pendingWrites += 1;
		const start = () =>
			task().finally(() => {
				pendingWrites -= 1;
			});
		if (pendingWrites === 1) {
			const run = start();
			chain = run.then(
				() => undefined,
				() => undefined
			);
			return run;
		}
		const run = chain.then(start, start);
		chain = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	};

	const stillCurrent = () => documentId !== null && store.getState().document?.id === documentId;

	const performSave = async (): Promise<SaveResult> => {
		// Commit anything still on screen before the clean check, so an explicit Save can
		// never report "saved" for text the user can see but that was never written.
		flushText();
		const start = store.getState();
		if (documentId === null || start.document?.id !== documentId) return 'skipped';
		// An unchanged revision is never re-submitted, so a clean document is not re-written.
		if (!start.dirty || start.document.revision === start.savedRevision) {
			publish({ status: 'saved', message: null });
			return 'skipped';
		}

		const pending = store.getState();
		const document = pending.document;
		if (!document || document.id !== documentId) return 'skipped';
		if (!pending.dirty || document.revision === pending.savedRevision) {
			publish({ status: 'saved', message: null });
			return 'skipped';
		}

		const baseRevision = pending.savedRevision;
		pending.markSaving();
		publish({ status: 'saving', message: null });

		try {
			// Persist-first: every asset the document references was written with the
			// insert or replacement that introduced it, so a document save carries no
			// media of its own.
			await repository.savePresentation(document, [], { baseRevision });
		} catch (error) {
			if (!stillCurrent()) return 'skipped';
			const failed = store.getState();
			if (isPersistenceError(error) && error.code === 'revision_conflict') {
				failed.markSaveFailed(conflictMessage);
				publish({ status: 'conflict', message: conflictMessage });
				return 'conflict';
			}
			const message = describeFailure(error);
			failed.markSaveFailed(message);
			publish({ status: 'failed', message });
			return 'failed';
		}

		if (!stillCurrent()) return 'saved';
		const stored = store.getState();
		// The revision that was written, not the latest one: edits made while the
		// write was in flight must keep the document dirty.
		stored.markSaved(document.revision);
		publish({ status: 'saved', message: null });
		return 'saved';
	};

	const save = (): Promise<SaveResult> => serialize(performSave);

	/**
	 * Writes an explicit document through the same single write path. Store
	 * bookkeeping belongs to the caller: a caller that is adopting a persisted
	 * document owns the saved revision, and one that is only probing must not
	 * clear `dirty` for work that was not part of this revision.
	 */
	const persistDocument = (
		next: PresentationDocument,
		media: PresentationMediaRecord[]
	): Promise<PersistOutcome> =>
		serialize(async () => {
			if (documentId === null || next.id !== documentId) {
				return { ok: false as const, reason: 'failed' as const, message: SAVE_FAILED_MESSAGE };
			}
			// Read the base revision here, inside the serialized task, not at click time:
			// a save that completes while this task waits in the queue advances the stored
			// revision, and a stale base would then report a conflict for our own write.
			const baseRevision = store.getState().savedRevision;
			store.getState().markSaving();
			publish({ status: 'saving', message: null });
			try {
				await repository.savePresentation(next, media, { baseRevision });
				return { ok: true as const };
			} catch (error) {
				if (isPersistenceError(error) && error.code === 'revision_conflict') {
					store.getState().markSaveFailed(conflictMessage);
					publish({ status: 'conflict', message: conflictMessage });
					return {
						ok: false as const,
						reason: 'conflict' as const,
						message: conflictMessage
					};
				}
				const message = describeFailure(error);
				store.getState().markSaveFailed(message);
				publish({ status: 'failed', message });
				return { ok: false as const, reason: 'failed' as const, message };
			}
		});

	/**
	 * Persist first, then adopt: an inserted image is never presented as added
	 * before the document and its bytes are committed together. On any failure the
	 * document, its assets, held media and history are all left untouched, so there
	 * is no half-inserted element and no orphaned media to clean up.
	 */
	const persistInsert = async (
		image: PreparedPresentationImage,
		options?: { slideId?: string }
	): Promise<PersistInsertOutcome> => {
		const current = store.getState();
		const document = current.document;
		if (!document || document.id !== documentId) {
			return {
				ok: false,
				reason: 'no-slide',
				message: 'Open a presentation before adding an image.'
			};
		}
		const check = current.checkImageInsert(image, options);
		if (!check.ok) return { ok: false, reason: check.reason, message: check.message };

		const plan = planImageInsert(document, image, {
			slideId: options?.slideId ?? store.getState().view.activeSlideId
		});
		if (!plan)
			return { ok: false, reason: 'no-slide', message: 'There is no slide to add this image to.' };

		const media = await mediaToPersist(repository, image);
		const outcome = await persistDocument(plan.document, media);
		if (!outcome.ok) return { ok: false, reason: outcome.reason, message: outcome.message };

		store.getState().adoptPersistedInsert(plan, image);
		publish({ status: 'saved', message: null });
		return { ok: true, elementId: plan.elementId };
	};

	/**
	 * The replacement counterpart of `persistInsert`: the new artwork and the
	 * document are written in one transaction before the element switches asset,
	 * so a failure leaves the old photo in place and no orphaned element.
	 */
	const persistReplace = async (
		elementId: string,
		image: PreparedPresentationImage
	): Promise<PersistInsertOutcome> => {
		const current = store.getState();
		const document = current.document;
		if (!document || document.id !== documentId) {
			return {
				ok: false,
				reason: 'no-slide',
				message: 'Open a presentation before replacing an image.'
			};
		}
		const refusal = imageReplaceRefusal(document, image, elementId);
		if (refusal) return { ok: false, reason: refusal.reason, message: refusal.message };

		const plan = planImageReplacement(document, elementId, image);
		if (!plan)
			return { ok: false, reason: 'no-image', message: 'Select an image before replacing it.' };

		const media = await mediaToPersist(repository, image);
		const outcome = await persistDocument(plan.document, media);
		if (!outcome.ok) return { ok: false, reason: outcome.reason, message: outcome.message };

		store.getState().adoptPersistedReplacement(plan, image);
		publish({ status: 'saved', message: null });
		return { ok: true, elementId: plan.elementId };
	};

	/**
	 * A stale revision must not dead-end the editor. Keep the local work as an
	 * independent copy, then load the newer stored revision so the user is no
	 * longer editing something that can never be written.
	 */
	const keepMineAsCopy = async (): Promise<ConflictRecoveryOutcome> => {
		const source = store.getState().document;
		if (!source || source.id !== documentId)
			return { ok: false, message: 'There is no open presentation to copy.' };
		flushText();

		const local = store.getState().document;
		if (!local || local.id !== documentId)
			return { ok: false, message: 'There is no open presentation to copy.' };
		const copy = clonePresentationDocumentWithNewIds(local, {
			title: conflictCopyTitle(local.title)
		});

		const outcome = await serialize(async (): Promise<ConflictRecoveryOutcome> => {
			// The copy uses new asset ids, so its media must be re-keyed by content.
			const media = await mediaForCopy(repository, local, copy);
			if (!media.ok) return { ok: false, message: media.message };
			try {
				await repository.savePresentation(copy, media.records);
			} catch (error) {
				return { ok: false, message: describeFailure(error) };
			}
			return { ok: true, copyId: copy.id };
		});

		if (!outcome.ok) {
			store.getState().markSaveFailed(outcome.message);
			publish({ status: 'failed', message: outcome.message });
			return outcome;
		}

		// Reopen the newer stored revision; the user's own work is safe in the copy.
		try {
			const newer = await repository.getPresentation(documentId!);
			if (store.getState().document?.id === documentId) {
				store.getState().loadDocument(newer, { saved: true });
				publish({ status: 'clean', message: null });
			}
		} catch (error) {
			const message = describeFailure(error);
			store.getState().markSaveFailed(message);
			publish({ status: 'failed', message });
			return { ok: false, message };
		}
		return outcome;
	};

	/**
	 * Used by the editor's leave block: commit anything still on screen, wait for
	 * the write rather than scheduling one, and report whether it is safe to leave.
	 * A clean document reports true without writing anything.
	 */
	const saveBeforeLeave = async (): Promise<boolean> => {
		flushText();
		// At most two passes: the first writes what is committed, the second writes an
		// edit that landed while the first was in flight. A clean document writes nothing.
		for (let pass = 0; pass < 2; pass += 1) {
			const result = await save();
			if (result === 'failed' || result === 'conflict') return false;
			const current = store.getState();
			// Nothing open: leaving cannot lose this document's work.
			if (documentId === null || current.document?.id !== documentId) return true;
			// An edit that landed while the write was in flight keeps this dirty; one
			// more pass writes it instead of refusing to leave with unsaved work.
			if (!current.dirty) return true;
		}
		return false;
	};

	/**
	 * The lifecycle edge the hook attaches: schedules a save after the debounce
	 * once a command completes, and reports whether unload should warn. Detaching
	 * cancels the timer and the store subscription.
	 */
	const attachAutosave = () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const schedule = () => {
			clearTimeout(timer);
			const current = store.getState();
			if (current.document?.id !== documentId || !current.dirty) return;
			// An open history group is a gesture in progress (a text session today).
			if (current.lastHistoryGroup !== null) return;
			timer = setTimeout(() => {
				void save();
			}, AUTOSAVE_DELAY_MS);
		};
		const unsubscribe = store.subscribe((next, previous) => {
			if (
				next.document?.id !== previous.document?.id ||
				next.document?.revision !== previous.document?.revision ||
				next.dirty !== previous.dirty ||
				next.lastHistoryGroup !== previous.lastHistoryGroup
			) {
				schedule();
			}
		});
		schedule();
		return {
			shouldWarnBeforeUnload: () => {
				const current = store.getState();
				return current.dirty && current.document?.id === documentId;
			},
			detach: () => {
				clearTimeout(timer);
				unsubscribe();
			}
		};
	};

	return {
		getStatus: () => status,
		subscribeStatus: (listener: () => void) => {
			statusListeners.add(listener);
			return () => {
				statusListeners.delete(listener);
			};
		},
		save,
		saveBeforeLeave,
		persistInsert,
		persistReplace,
		keepMineAsCopy,
		attachAutosave
	};
}

/**
 * The bytes to submit with a persist-first write. An asset that was inserted or
 * restored before is already stored, so its bytes are omitted to avoid
 * rewriting an immutable record. The probe must be answered by storage, not by
 * the document's asset list: a document can reference an asset whose bytes were
 * never written only if the write that introduced it failed, and that write
 * never exposed its document. If the probe itself fails, the bytes are
 * submitted: the repository accepts identical bytes, and a genuine mismatch
 * still surfaces as `invalid_asset`.
 */
async function mediaToPersist(
	repository: PresentationRepository,
	image: PreparedPresentationImage
): Promise<PresentationMediaRecord[]> {
	try {
		return (await repository.hasMedia(image.media.assetId)) ? [] : [image.media];
	} catch {
		return [image.media];
	}
}

/**
 * Media for the conflict copy. The clone gets new asset ids, so every record has
 * to be re-keyed by content: each copy asset is matched back to the source asset
 * it was cloned from, and that asset's stored bytes are fetched for the copy id.
 */
async function mediaForCopy(
	repository: PresentationRepository,
	source: PresentationDocument,
	copy: PresentationDocument
): Promise<{ ok: true; records: PresentationMediaRecord[] } | { ok: false; message: string }> {
	const sourceBySha = new Map(source.assets.map((asset) => [asset.sha256, asset]));

	// One pass over the copy's assets, fetching missing bytes concurrently, so a
	// copy with many images waits for a single round trip rather than a series.
	const outcomes = await Promise.all(
		copy.assets.map(
			async (
				asset
			): Promise<
				{ ok: true; record: PresentationMediaRecord } | { ok: false; message: string }
			> => {
				const original = sourceBySha.get(asset.sha256);
				if (!original)
					return {
						ok: false,
						message:
							'The copy could not be prepared because its artwork no longer matches the original.'
					};
				try {
					const stored = await repository.getMedia(original.id);
					return {
						ok: true,
						record: { assetId: asset.id, bytes: stored.bytes, mimeType: stored.mimeType }
					};
				} catch {
					return {
						ok: false,
						message:
							'The copy could not be prepared because some of its artwork could not be read back.'
					};
				}
			}
		)
	);

	const failed = outcomes.find((outcome) => !outcome.ok);
	if (failed) return { ok: false, message: failed.message };
	return { ok: true, records: outcomes.flatMap((outcome) => (outcome.ok ? [outcome.record] : [])) };
}

function conflictCopyTitle(title: string): string {
	const room = PRESENTATION_LIMITS.maxTitleLength - CONFLICT_COPY_SUFFIX.length;
	return `${title.slice(0, Math.max(0, room))}${CONFLICT_COPY_SUFFIX}`;
}

function describeSaveFailure(error: unknown): string {
	if (isPersistenceError(error) && error.code === 'not_found') {
		return 'This presentation was removed from this browser. Your changes are still here — copy them out before closing this tab.';
	}
	return SAVE_FAILED_MESSAGE;
}
