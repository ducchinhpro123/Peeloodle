/**
 * The saver owns this lifecycle; the document owns revisions, content and dirty state.
 * A saved write can coexist with newer unsaved edits. Recovery is one serialized
 * operation, with a persisted copy required before reopening the winning version.
 */
import type { PresentationDocument } from '../../model/types';

type RecoveryCheckpoint =
	{ step: 'copy' } | { step: 'reopen'; document: PresentationDocument; copyId: string };

export type PresentationSaveState = Readonly<
	| { status: 'clean' | 'saving' | 'saved'; message: null }
	| { status: 'failed'; message: string }
	| { status: 'conflict'; message: string; recovery: RecoveryCheckpoint }
	| { status: 'recovering'; stage: 'copying'; document: PresentationDocument; message: null }
	| {
			status: 'recovering';
			stage: 'reopening';
			document: PresentationDocument;
			copyId: string;
			message: null;
	  }
>;

export type PresentationSaveStatus = PresentationSaveState['status'];

export type SaveEvent =
	| { type: 'save-started' | 'save-skipped' | 'save-succeeded' }
	| { type: 'save-failed'; reason: 'failed' | 'conflict'; message: string }
	| { type: 'recovery-started'; document: PresentationDocument }
	| { type: 'copy-saved'; copyId: string }
	| { type: 'recovery-failed'; message: string }
	| { type: 'recovery-edited'; message: string }
	| { type: 'recovery-succeeded' };

export const INITIAL_SAVE_STATE: PresentationSaveState = { status: 'clean', message: null };

/** Illegal or obsolete completions cannot change the current operation. */
export function transitionSave(
	state: PresentationSaveState,
	event: SaveEvent
): PresentationSaveState {
	switch (event.type) {
		case 'save-started':
			return state.status === 'recovering' ? state : { status: 'saving', message: null };
		case 'save-skipped':
			return state.status === 'recovering' ? state : { status: 'saved', message: null };
		case 'save-succeeded':
			return state.status === 'saving' ? { status: 'saved', message: null } : state;
		case 'save-failed':
			if (state.status !== 'saving') return state;
			return event.reason === 'conflict'
				? { status: 'conflict', message: event.message, recovery: { step: 'copy' } }
				: { status: 'failed', message: event.message };
		case 'recovery-started':
			if (state.status !== 'conflict') return state;
			// Content can change without advancing the revision during a persisted
			// insertion rebase. Only the exact immutable snapshot can reuse this copy.
			if (state.recovery.step === 'reopen' && state.recovery.document === event.document)
				return {
					status: 'recovering',
					stage: 'reopening',
					document: event.document,
					copyId: state.recovery.copyId,
					message: null
				};
			return { status: 'recovering', stage: 'copying', document: event.document, message: null };
		case 'copy-saved':
			return state.status === 'recovering' && state.stage === 'copying'
				? { ...state, stage: 'reopening', copyId: event.copyId }
				: state;
		case 'recovery-failed':
			return state.status === 'recovering'
				? {
						status: 'conflict',
						message: event.message,
						recovery:
							state.stage === 'reopening'
								? { step: 'reopen', document: state.document, copyId: state.copyId }
								: { step: 'copy' }
					}
				: state;
		case 'recovery-edited':
			return state.status === 'recovering'
				? { status: 'conflict', message: event.message, recovery: { step: 'copy' } }
				: state;
		case 'recovery-succeeded':
			return state.status === 'recovering' && state.stage === 'reopening'
				? { status: 'clean', message: null }
				: state;
	}
}

/** One observable lifecycle per mounted editor; subscribers do not own state. */
export function createSaveLifecycle() {
	let current: PresentationSaveState = INITIAL_SAVE_STATE;
	const listeners = new Set<() => void>();
	return {
		getState: (): PresentationSaveState => current,
		dispatch(event: SaveEvent) {
			const next = transitionSave(current, event);
			if (next === current) return;
			current = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}
