/**
 * Svelte port of the source draft-save coordinator
 * (`src/features/editor/draftSaving.ts`).
 *
 * Still a coordinator, not a hook: `save()` queues one captured write, `flush()`
 * reports whether it is safe to replace the open document, and `sync()` is the
 * debounce scheduler. In the React source a store subscription called the
 * scheduler; here the editor route's `$effect` calls `sync()` exactly when the
 * fields it reads change — the debounce window, the automatic-save gate and the
 * "status and view changes must not restart a timer" rule are unchanged.
 *
 * This instance outlives the editor route, so unload protection is app-level too:
 * the root layout calls `pageHideApp()`/`hasUnprotectedWork()`, which cover the
 * mounted editor and a draft the editor route left behind. The editor-scoped
 * `pageHide()`/`shouldWarnBeforeUnload()` remain the primitives behind them.
 *
 * Capture happens before entering the queue, so a later edit cannot change a
 * write that is already in flight, and completion only clears the revision that
 * was actually persisted.
 */

import {
	serializeProjectDocument,
	type StickerLabRepository
} from '#lib/persistence/repository.js';
import type { EditorState } from './editorState.svelte';

export type SaveOutcome =
	| { kind: 'saved'; projectId: string; revision: number }
	| { kind: 'skipped' | 'superseded' | 'stroke-pending' }
	| { kind: 'save-failed'; message: string };

export type FlushOutcome =
	| { kind: 'ready' | 'superseded' }
	| {
			kind: 'blocked';
			projectId: string;
			reason: 'save-failed' | 'stroke-pending' | 'newer-edits';
	  };

type Origin = { projectId: string | undefined; workspaceEpoch: number };

export const AUTOSAVE_DEBOUNCE_MS = 800;

function originOf(state: EditorState): Origin {
	return { projectId: state.document?.id, workspaceEpoch: state.workspaceEpoch };
}

export function hasPendingWork(state: EditorState): boolean {
	return !!state.document && (state.dirty || state.gestureActive || !!state.maskStroke);
}

export type DraftSaving = {
	save(repo: StickerLabRepository): Promise<SaveOutcome>;
	flush(repo: StickerLabRepository, options?: { projectId: string }): Promise<FlushOutcome>;
	/** Editor route entered: autosave is allowed to schedule again. */
	attach(): void;
	/** Dependency-change callback for the editor route's `$effect`. */
	sync(repo: StickerLabRepository): void;
	/** Editor-scoped `pagehide` handler (the editor route itself). */
	pageHide(repo: StickerLabRepository): void;
	/** Editor-scoped `beforeunload` guard for the route that is showing the draft. */
	shouldWarnBeforeUnload(): boolean;
	/**
	 * Last-chance write for the whole app, including a draft whose editor route
	 * has already unmounted. The root layout owns this handler.
	 */
	pageHideApp(repo: StickerLabRepository): void;
	/** True while this coordinator still owes a write for work held only in memory. */
	hasUnprotectedWork(): boolean;
	/** The failed draft no editor is showing, for the root layout's recovery status. */
	recoveryDraft(): { projectId: string; title: string } | null;
	detach(): void;
};

/** One coordinator per editor state, surviving route and repository changes. */
export function createDraftSaving(
	state: EditorState,
	debounceMs = AUTOSAVE_DEBOUNCE_MS
): DraftSaving {
	let tail: Promise<void> = Promise.resolve();
	let timer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * The coordinator's own gate. Deliberately non-reactive: the autosave effect both
	 * writes this (via `attach`/`detach`) and reads it (via `sync`), so making it the
	 * reactive flag would make that effect re-invalidate itself forever. The reactive
	 * mirror below is only read by the root layout.
	 */
	let active = true;
	const attachedEpoch = state.workspaceEpoch;

	const matches = (origin: Origin) =>
		state.document?.id === origin.projectId && state.workspaceEpoch === origin.workspaceEpoch;

	/** Scheduling/last-chance gate for this coordinator (non-reactive, see `active`). */
	function belongsToAttachment(): boolean {
		return active && state.workspaceEpoch === attachedEpoch;
	}

	/**
	 * The same question as `belongsToAttachment`, read from the editor state so the
	 * root layout's recovery banner re-renders when the route detaches: the detached
	 * flag and the departure write's failure can settle in either order, and a plain
	 * local would leave the layout's `$derived` holding a stale `null`.
	 */
	function routeStillAttached(): boolean {
		return state.editorAttached && state.workspaceEpoch === attachedEpoch;
	}

	async function requestSave(repo: StickerLabRepository, automatic = false): Promise<SaveOutcome> {
		const origin = originOf(state);
		if (
			!state.document ||
			(automatic && (!state.dirty || state.gestureActive || state.maskStroke))
		) {
			return { kind: 'skipped' };
		}
		if (state.maskStroke) {
			try {
				await state.commitMaskStroke();
			} catch {
				// The brush owns its recoverable error and unfinished work.
				return { kind: matches(origin) ? 'stroke-pending' : 'superseded' };
			}
		}
		if (!matches(origin)) return { kind: 'superseded' };
		if (state.maskStroke) return { kind: 'stroke-pending' };
		if (state.gestureActive) state.commitGesture();

		try {
			if (!matches(origin) || !state.document) return { kind: 'superseded' };
			// Capture before entering the queue: later edits cannot change this write.
			const document = serializeProjectDocument(state.document);
			const assetIds = new Set(document.assetIds);
			const maskKeys = new Set<string>();
			for (const layer of document.layers) {
				if (layer.kind !== 'image') continue;
				assetIds.add(layer.assetId);
				if (layer.maskKey) maskKeys.add(layer.maskKey);
			}
			const assets = [...assetIds].flatMap((id) => (state.assets[id] ? [state.assets[id]!] : []));
			const masks = [...maskKeys].flatMap((key) =>
				state.masks[key] ? [{ key, blob: state.masks[key]! }] : []
			);
			const write = async (): Promise<SaveOutcome> => {
				if (matches(origin)) state.setSaveStatus('saving');
				try {
					await repo.saveProjectWithAssets(document, assets, masks);
					if (matches(origin)) state.markSaved(document.revision);
					return { kind: 'saved', projectId: document.id, revision: document.revision };
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Save failed';
					if (matches(origin)) state.setSaveStatus('save-failed', message);
					return { kind: 'save-failed', message };
				}
			};
			const result = tail.then(write, write);
			tail = result.then(
				() => undefined,
				() => undefined
			);
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Save failed';
			if (matches(origin)) state.setSaveStatus('save-failed', message);
			return { kind: 'save-failed', message };
		}
	}

	async function flush(
		repo: StickerLabRepository,
		options?: { projectId: string }
	): Promise<FlushOutcome> {
		const origin = originOf(state);
		if (options && options.projectId !== origin.projectId) return { kind: 'superseded' };
		const result = hasPendingWork(state) ? await requestSave(repo) : null;
		// Include writes already queued by manual save or route cleanup.
		await tail;
		if (!matches(origin)) return { kind: 'superseded' };
		if (!state.document) return { kind: 'ready' };
		if (state.maskStroke || result?.kind === 'stroke-pending') {
			return { kind: 'blocked', projectId: state.document.id, reason: 'stroke-pending' };
		}
		if (state.saveStatus === 'save-failed') {
			return { kind: 'blocked', projectId: state.document.id, reason: 'save-failed' };
		}
		if (hasPendingWork(state))
			return { kind: 'blocked', projectId: state.document.id, reason: 'newer-edits' };
		return { kind: 'ready' };
	}

	/**
	 * Work this coordinator still owes a write for, whether or not the editor route
	 * is mounted. Work from a workspace it never attached to is ignored: claiming it
	 * would resurrect a document the app already replaced.
	 */
	function ownsProtectedWork(): boolean {
		return state.workspaceEpoch === attachedEpoch && hasPendingWork(state);
	}

	function pageHide(repo: StickerLabRepository): void {
		if (belongsToAttachment()) void requestSave(repo);
	}

	function shouldWarnBeforeUnload(): boolean {
		return belongsToAttachment() && hasPendingWork(state);
	}

	/**
	 * The root layout's `pagehide` handler. While the editor route is mounted this
	 * is the editor-scoped behaviour; after an internal route change that route's
	 * own wiring is gone, so the same last-chance write is still made for the draft
	 * the app holds. It never cancels the queued write it is waiting on.
	 */
	function pageHideApp(repo: StickerLabRepository): void {
		if (belongsToAttachment()) pageHide(repo);
		else if (ownsProtectedWork()) void requestSave(repo);
	}

	/**
	 * App-level "is anything only in memory?" query for the root layout's
	 * `beforeunload` guard: the mounted editor's pending work, or a draft the editor
	 * route left behind. The editor route's own guard is the same condition.
	 */
	function hasUnprotectedWork(): boolean {
		if (routeStillAttached()) return shouldWarnBeforeUnload();
		return ownsProtectedWork();
	}

	/**
	 * The draft the root layout should offer to reopen: a write that actually failed
	 * for work no mounted editor is showing. The mounted editor reports its own
	 * status, so this stays null while the editor route owns the draft — and while a
	 * departure flush is still in flight, so the happy path never flashes a banner.
	 */
	function recoveryDraft(): { projectId: string; title: string } | null {
		if (!state.document || routeStillAttached() || state.saveStatus !== 'save-failed') return null;
		if (!ownsProtectedWork()) return null;
		return { projectId: state.document.id, title: state.document.title };
	}

	function sync(repo: StickerLabRepository): void {
		clearTimeout(timer);
		if (
			!belongsToAttachment() ||
			!state.document ||
			!state.dirty ||
			state.gestureActive ||
			state.maskStroke
		)
			return;
		const origin = originOf(state);
		timer = setTimeout(() => {
			if (belongsToAttachment() && matches(origin)) void requestSave(repo, true);
		}, debounceMs);
	}

	return {
		save: (repo) => requestSave(repo),
		flush,
		sync,
		attach: () => {
			active = true;
			// Unconditional write: reading the field here would make the autosave effect
			// (which calls `attach` in its body and `detach` in its teardown) depend on a
			// value it also writes, and invalidate itself forever.
			state.editorAttached = true;
		},
		pageHide,
		shouldWarnBeforeUnload,
		pageHideApp,
		hasUnprotectedWork,
		recoveryDraft,
		detach: () => {
			active = false;
			state.editorAttached = false;
			clearTimeout(timer);
		}
	};
}
