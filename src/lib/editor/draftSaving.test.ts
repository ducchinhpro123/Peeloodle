/**
 * Ported from `src/features/editor/draftSaving.test.ts`.
 *
 * Adaptations: an `EditorState` instance replaces the zustand singleton, and
 * the autosave cases call `drive()` after each state change. `drive()` is
 * exactly what the editor route's `$effect` does — it runs when the fields the
 * effect reads (document id/revision, dirty, gesture, mask stroke) change — so
 * the debounce, gating and page-lifecycle assertions are the source's.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRepository, type AssetRecord } from '../persistence/repository';
import { createDraftSaving } from './draftSaving';
import { createEditorState, type EditorState } from './editorState.svelte';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function blockNextWrite(repo: ReturnType<typeof createMemoryRepository>) {
	const started = deferred();
	const release = deferred();
	const write = repo.saveProjectWithAssets.bind(repo);
	const spy = vi.spyOn(repo, 'saveProjectWithAssets').mockImplementationOnce(async (...args) => {
		started.resolve();
		await release.promise;
		return write(...args);
	});
	return { started: started.promise, release: release.resolve, spy };
}

let state: EditorState;
let saving: ReturnType<typeof createDraftSaving>;
let repo: ReturnType<typeof createMemoryRepository>;

/** Mimics the route `$effect`: re-run the debounce scheduler after a change. */
const drive = () => saving.sync(repo);

beforeEach(() => {
	vi.useFakeTimers();
	state = createEditorState();
	state.createDraft('draft-a');
	saving = createDraftSaving(state);
	repo = createMemoryRepository();
});
afterEach(() => {
	saving.detach();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('draft saving', () => {
	it('writes a clean draft when explicitly saved, but a clean flush does not create a project', async () => {
		expect(await saving.flush(repo)).toEqual({ kind: 'ready' });
		expect(await repo.listProjects()).toEqual([]);
		expect(await saving.save(repo)).toMatchObject({
			kind: 'saved',
			projectId: 'draft-a',
			revision: 0
		});
		expect((await repo.getProject('draft-a')).revision).toBe(0);
		expect(state).toMatchObject({ dirty: false, saveStatus: 'saved-locally' });
	});

	it('commits a gesture before capture and retains one undo entry', async () => {
		state.beginGesture();
		state.updateTitle('First frame');
		state.updateTitle('Final frame');
		expect(await saving.flush(repo)).toEqual({ kind: 'ready' });
		expect((await repo.getProject('draft-a')).title).toBe('Final frame');
		expect(state.past).toHaveLength(1);
		state.undo();
		expect(state.document?.title).toBe('Untitled Sticker');
	});

	it('does not let an earlier saved revision clear newer edits', async () => {
		state.updateTitle('Before');
		const gate = blockNextWrite(repo);
		const first = saving.save(repo);
		await gate.started;
		state.updateTitle('After');
		gate.release();
		expect(await first).toMatchObject({ kind: 'saved' });
		expect((await repo.getProject('draft-a')).title).toBe('Before');
		expect(state).toMatchObject({ dirty: true, saveStatus: 'unsaved' });
		await saving.save(repo);
		expect((await repo.getProject('draft-a')).title).toBe('After');
	});

	it('captures queued content before waiting and keeps writes ordered', async () => {
		state.updateTitle('First');
		const gate = blockNextWrite(repo);
		const first = saving.save(repo);
		await gate.started;
		state.updateTitle('Second');
		const second = saving.save(repo);
		state.updateTitle('Not requested');
		gate.release();
		await Promise.all([first, second]);
		expect(gate.spy.mock.calls.map(([document]) => document.title)).toEqual(['First', 'Second']);
		expect((await repo.getProject('draft-a')).title).toBe('Second');
		expect(state.dirty).toBe(true);
	});

	it('retains originating repositories across workspace reset without changing the new draft status', async () => {
		state.updateTitle('Old workspace');
		const gate = blockNextWrite(repo);
		const first = saving.save(repo);
		await gate.started;
		state.reset();
		state.createDraft('draft-a');
		state.updateTitle('New workspace');
		const other = createMemoryRepository();
		gate.release();
		await first;
		expect(state).toMatchObject({ dirty: true, saveStatus: 'unsaved' });
		await saving.save(other);
		expect((await repo.getProject('draft-a')).title).toBe('Old workspace');
		expect((await other.getProject('draft-a')).title).toBe('New workspace');
	});

	it('finishes a delayed mask stroke and persists the captured image and mask', async () => {
		const record: AssetRecord = {
			asset: {
				id: 'photo',
				blobKey: 'photo',
				mimeType: 'image/png',
				width: 20,
				height: 20,
				provenance: 'test'
			},
			blob: new Blob(['original'], { type: 'image/png' })
		};
		state.addImageLayer(record);
		const layerId = state.selectedLayerId!;
		const gate = deferred();
		const mask = new Blob(['mask'], { type: 'image/png' });
		state.beginMaskStroke({
			layerId,
			commit: async () => {
				await gate.promise;
				state.applyMask(layerId, 'mask-a', mask);
				state.abandonMaskStroke();
			}
		});
		const result = saving.flush(repo);
		expect(await repo.listProjects()).toEqual([]);
		gate.resolve();
		expect(await result).toEqual({ kind: 'ready' });
		expect((await repo.getProject('draft-a')).layers[0]).toMatchObject({ maskKey: 'mask-a' });
		expect((await repo.getAsset('photo')).blob).toBe(record.blob);
		expect(await repo.getMask('mask-a')).toBe(mask);
	});

	it.each(['project', 'workspace'] as const)(
		'does not capture a replacement %s after delayed stroke completion',
		async (replacement) => {
			const gate = deferred();
			state.beginMaskStroke({ layerId: 'layer', commit: () => gate.promise });
			const result = saving.flush(repo);
			if (replacement === 'workspace') state.reset();
			state.createDraft(replacement === 'workspace' ? 'draft-a' : 'draft-b');
			state.updateTitle('Replacement');
			gate.resolve();
			expect(await result).toEqual({ kind: 'superseded' });
			expect(await repo.listProjects()).toEqual([]);
			expect(state).toMatchObject({ dirty: true, saveStatus: 'unsaved' });
		}
	);

	it('preserves a rejected stroke and its recoverable error', async () => {
		const stroke = {
			layerId: 'layer',
			commit: async () => {
				throw new Error('Encoding failed');
			}
		};
		state.beginMaskStroke(stroke);
		state.uploadError = 'Encoding failed';
		expect(await saving.flush(repo)).toEqual({
			kind: 'blocked',
			projectId: 'draft-a',
			reason: 'stroke-pending'
		});
		expect(state.maskStroke).toBe(stroke);
		expect(state.uploadError).toBe('Encoding failed');
		expect(await repo.listProjects()).toEqual([]);
	});

	it('retains failed work and permits a later retry', async () => {
		state.updateTitle('Keep me');
		repo.injectWriteFailure();
		expect(await saving.flush(repo)).toEqual({
			kind: 'blocked',
			projectId: 'draft-a',
			reason: 'save-failed'
		});
		expect(state).toMatchObject({ dirty: true, saveStatus: 'save-failed' });
		expect(state.document?.title).toBe('Keep me');
		expect(await saving.flush(repo)).toEqual({ kind: 'ready' });
		expect((await repo.getProject('draft-a')).title).toBe('Keep me');
	});

	it('does not poison an already queued save when the preceding write fails', async () => {
		state.updateTitle('First');
		repo.injectWriteFailure();
		const gate = blockNextWrite(repo);
		const first = saving.save(repo);
		await gate.started;
		state.updateTitle('Second');
		const second = saving.save(repo);
		gate.release();
		expect(await first).toMatchObject({ kind: 'save-failed' });
		expect(await second).toMatchObject({ kind: 'saved' });
		expect((await repo.getProject('draft-a')).title).toBe('Second');
		expect(state).toMatchObject({ dirty: false, saveStatus: 'saved-locally' });
	});

	it('waits for an in-flight manual save even when the draft is clean', async () => {
		const gate = blockNextWrite(repo);
		const manual = saving.save(repo);
		await gate.started;
		let flushed = false;
		const result = saving.flush(repo).then((outcome) => {
			flushed = true;
			return outcome;
		});
		await Promise.resolve();
		expect(flushed).toBe(false);
		gate.release();
		await manual;
		expect(await result).toEqual({ kind: 'ready' });
		expect(gate.spy).toHaveBeenCalledTimes(1);
	});

	it('persists only referenced blobs while history keeps removed images and masks available', async () => {
		const record: AssetRecord = {
			asset: {
				id: 'removed',
				blobKey: 'removed',
				mimeType: 'image/png',
				width: 20,
				height: 20,
				provenance: 'test'
			},
			blob: new Blob(['original'], { type: 'image/png' })
		};
		state.addImageLayer(record);
		state.applyMask(state.selectedLayerId!, 'removed-mask', new Blob(['mask']));
		state.removeSelected();
		state.addTextLayer({ content: 'Only text' });
		expect(state.assets.removed).toBeDefined();
		expect(state.masks['removed-mask']).toBeDefined();
		expect(await saving.flush(repo)).toEqual({ kind: 'ready' });
		expect(await repo.listAssets()).toEqual([]);
		await expect(repo.getMask('removed-mask')).rejects.toThrow();
		expect((await repo.getProject('draft-a')).layers).toHaveLength(1);
	});

	it('blocks replacement when edits arrive during a flush', async () => {
		state.updateTitle('Captured');
		const gate = blockNextWrite(repo);
		const result = saving.flush(repo);
		await gate.started;
		state.updateTitle('Still editing');
		gate.release();
		expect(await result).toEqual({ kind: 'blocked', projectId: 'draft-a', reason: 'newer-edits' });
		expect(state.document?.title).toBe('Still editing');
	});

	it('blocks replacement when an unchanged-revision gesture begins during a flush', async () => {
		state.updateTitle('Captured');
		const gate = blockNextWrite(repo);
		const result = saving.flush(repo);
		await gate.started;
		state.beginGesture();
		state.updateTitle('Uncommitted');
		gate.release();
		expect(await result).toMatchObject({ kind: 'blocked', reason: 'newer-edits' });
		expect(state.gestureActive).toBe(true);
	});

	it('ignores cleanup for a departed project', async () => {
		state.createDraft('draft-b');
		state.updateTitle('Replacement');
		expect(await saving.flush(repo, { projectId: 'draft-a' })).toEqual({ kind: 'superseded' });
		expect(await repo.listProjects()).toEqual([]);
	});

	it('reports superseded when the project changes after capture but still completes its write', async () => {
		state.updateTitle('Original');
		const gate = blockNextWrite(repo);
		const result = saving.flush(repo);
		await gate.started;
		state.createDraft('draft-b');
		gate.release();
		expect(await result).toEqual({ kind: 'superseded' });
		expect((await repo.getProject('draft-a')).title).toBe('Original');
		expect(state.saveStatus).toBe('idle');
	});
});

describe('autosave wiring', () => {
	it('debounces edits for 800 ms without restarting for view or status changes', async () => {
		const write = vi.spyOn(repo, 'saveProjectWithAssets');
		state.updateTitle('First');
		drive();
		await vi.advanceTimersByTimeAsync(500);
		state.updateTitle('Second');
		drive();
		await vi.advanceTimersByTimeAsync(500);
		state.setViewport({ zoom: 2, panX: 5 });
		state.selectLayer(null);
		state.setSaveStatus('unsaved');
		await vi.advanceTimersByTimeAsync(299);
		expect(write).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(write).toHaveBeenCalledTimes(1);
		expect((await repo.getProject('draft-a')).title).toBe('Second');
		await vi.advanceTimersByTimeAsync(5000);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it('waits for gesture completion and mask completion', async () => {
		state.beginGesture();
		state.updateTitle('Gesture');
		drive();
		await vi.advanceTimersByTimeAsync(1000);
		expect(await repo.listProjects()).toEqual([]);
		state.commitGesture();
		drive();
		state.beginMaskStroke({ layerId: 'layer', commit: async () => {} });
		drive();
		await vi.advanceTimersByTimeAsync(1000);
		expect(await repo.listProjects()).toEqual([]);
		state.abandonMaskStroke();
		drive();
		await vi.advanceTimersByTimeAsync(800);
		expect((await repo.getProject('draft-a')).title).toBe('Gesture');
	});

	it('does not retry failed autosaves from status updates', async () => {
		const write = vi.spyOn(repo, 'saveProjectWithAssets');
		repo.injectWriteFailure();
		state.updateTitle('Keep me');
		drive();
		await vi.advanceTimersByTimeAsync(800);
		expect(state.saveStatus).toBe('save-failed');
		await vi.advanceTimersByTimeAsync(10000);
		expect(write).toHaveBeenCalledTimes(1);
		state.updateTitle('Retry after edit');
		drive();
		await vi.advanceTimersByTimeAsync(800);
		expect((await repo.getProject('draft-a')).title).toBe('Retry after edit');
	});

	it('cancels timers on detach and safely reattaches', async () => {
		const write = vi.spyOn(repo, 'saveProjectWithAssets');
		state.updateTitle('Pending');
		drive();
		saving.detach();
		saving.pageHide(repo);
		expect(saving.shouldWarnBeforeUnload()).toBe(false);
		await vi.advanceTimersByTimeAsync(800);
		expect(write).not.toHaveBeenCalled();
		saving.attach();
		drive();
		await vi.advanceTimersByTimeAsync(800);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it('keeps captured writes alive after detach', async () => {
		const gate = blockNextWrite(repo);
		state.updateTitle('Captured');
		drive();
		await vi.advanceTimersByTimeAsync(800);
		await gate.started;
		saving.detach();
		gate.release();
		await vi.advanceTimersByTimeAsync(0);
		expect((await repo.getProject('draft-a')).title).toBe('Captured');
	});

	it('does not use a departed workspace repository for timers or page hide', async () => {
		state.updateTitle('Old workspace');
		drive();
		state.reset();
		state.createDraft('draft-a');
		state.updateTitle('New workspace');
		saving.pageHide(repo);
		drive();
		await vi.advanceTimersByTimeAsync(800);
		expect(await repo.listProjects()).toEqual([]);
		expect(saving.shouldWarnBeforeUnload()).toBe(false);
	});

	it('warns about unsaved work and saves it on page hide before the debounce', async () => {
		expect(saving.shouldWarnBeforeUnload()).toBe(false);
		state.updateTitle('Leaving');
		expect(saving.shouldWarnBeforeUnload()).toBe(true);
		saving.pageHide(repo);
		await vi.advanceTimersByTimeAsync(0);
		expect((await repo.getProject('draft-a')).title).toBe('Leaving');
		expect(saving.shouldWarnBeforeUnload()).toBe(false);
	});
});

/**
 * The root layout owns `pagehide`/`beforeunload` because the editor route's own
 * wiring disappears with the route. These cases hold the app-level guard to the
 * same contract the editor-scoped one had: retain the draft, never replace or
 * cancel the queued write, and never touch a workspace this coordinator left.
 */
describe('app-level unload protection after leaving the editor', () => {
	it('still reports and warns about the mounted editor draft', () => {
		state.updateTitle('Editing');
		expect(saving.hasUnprotectedWork()).toBe(true);
		expect(saving.shouldWarnBeforeUnload()).toBe(true);
		// The editor is showing this draft, so it is not a recovery case yet.
		expect(saving.recoveryDraft()).toBeNull();
	});

	it('protects a failed draft the editor route no longer owns', async () => {
		state.updateTitle('Keep me');
		repo.injectWriteFailure();
		expect(await saving.flush(repo)).toEqual({
			kind: 'blocked',
			projectId: 'draft-a',
			reason: 'save-failed'
		});

		// The editor route unmounts; the draft it left behind is still only in memory.
		saving.detach();
		expect(saving.shouldWarnBeforeUnload()).toBe(false);
		expect(saving.hasUnprotectedWork()).toBe(true);
		expect(saving.recoveryDraft()).toEqual({ projectId: 'draft-a', title: 'Keep me' });

		// Last-chance write on page hide, not a cancellation of the queued work.
		const write = vi.spyOn(repo, 'saveProjectWithAssets');
		repo.injectWriteFailure();
		saving.pageHideApp(repo);
		await vi.advanceTimersByTimeAsync(0);
		expect(write).toHaveBeenCalledTimes(1);
		expect(saving.hasUnprotectedWork()).toBe(true);

		// Storage recovers: the retained revision saves and the guard stands down.
		expect(await saving.flush(repo)).toEqual({ kind: 'ready' });
		expect((await repo.getProject('draft-a')).title).toBe('Keep me');
		expect(saving.hasUnprotectedWork()).toBe(false);
		expect(saving.recoveryDraft()).toBeNull();
	});

	it('keeps pending work protected and writes it on page hide after detach', async () => {
		state.updateTitle('Pending');
		saving.detach();
		expect(saving.hasUnprotectedWork()).toBe(true);
		// Not advertised as a recovery case until a write has actually failed.
		expect(saving.recoveryDraft()).toBeNull();

		saving.pageHideApp(repo);
		await vi.advanceTimersByTimeAsync(0);
		expect((await repo.getProject('draft-a')).title).toBe('Pending');
		expect(saving.hasUnprotectedWork()).toBe(false);
	});

	it('ignores work from a workspace this coordinator no longer owns', async () => {
		state.reset();
		state.createDraft('draft-b');
		state.updateTitle('Other workspace');
		saving.detach();
		const write = vi.spyOn(repo, 'saveProjectWithAssets');

		expect(saving.hasUnprotectedWork()).toBe(false);
		expect(saving.recoveryDraft()).toBeNull();
		saving.pageHideApp(repo);
		await vi.advanceTimersByTimeAsync(0);
		expect(write).not.toHaveBeenCalled();
	});
});
