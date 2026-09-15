/**
 * Regression tests for the rune editor state port of
 * `src/features/editor/store.ts`. Covers the document invariants the source
 * relies on: versioned documents, one history entry per completed gesture,
 * revisions preserved through undo/redo, view state never dirtying the
 * document, and save completion clearing only the persisted revision.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ARTBOARD_SIZE, DOCUMENT_SCHEMA_VERSION } from '../domain/domain';
import type { AssetRecord } from '../persistence/repository';
import type { ImageLayer, TextLayer, Transform } from '../domain/domain';
import { createEditorState, saveStatusLabel, type EditorState } from './editorState.svelte';

let state: EditorState;

function photo(overrides: Partial<AssetRecord['asset']> = {}): AssetRecord {
	const asset = {
		id: 'photo-1',
		blobKey: 'photo-1',
		mimeType: 'image/png',
		width: 512,
		height: 256,
		provenance: 'test',
		...overrides
	};
	return { asset, blob: new Blob(['bytes'], { type: 'image/png' }) };
}

/** Where the image's own center lands after translate → rotate → scale. */
function visibleCenter(transform: Transform, width: number, height: number) {
	const radians = (transform.rotation * Math.PI) / 180;
	const halfWidth = (width * transform.scaleX) / 2;
	const halfHeight = (height * transform.scaleY) / 2;
	return {
		x: transform.x + halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians),
		y: transform.y + halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians)
	};
}

beforeEach(() => {
	state = createEditorState();
	state.createDraft('draft-a');
});

describe('editor state', () => {
	it('creates a versioned transparent 1024 artboard draft', () => {
		expect(state.document).toMatchObject({
			id: 'draft-a',
			title: 'Untitled Sticker',
			schemaVersion: DOCUMENT_SCHEMA_VERSION,
			artboard: { width: ARTBOARD_SIZE, height: ARTBOARD_SIZE, background: 'transparent' },
			layers: [],
			assetIds: [],
			revision: 0
		});
		expect(state.past).toEqual([]);
		expect(state.dirty).toBe(false);
	});

	it('hydrates a saved document with its assets and masks and selects the top layer', () => {
		state.createDraft('draft-a');
		state.addTextLayer({ content: 'Saved' });
		const document = state.document!;
		const record = photo();
		state.hydrate(document, [record], [{ key: 'mask-1', blob: new Blob(['m']) }]);

		expect(state.document?.layers).toHaveLength(1);
		expect(state.document?.layers[0]).toMatchObject({ kind: 'text', content: 'Saved' });
		expect(state.assets[record.asset.id]?.asset.id).toBe('photo-1');
		expect(state.masks['mask-1']).toBeInstanceOf(Blob);
		expect(state.selectedLayerId).toBe(document.layers[0]!.id);
		expect(state.saveStatus).toBe('saved-locally');
		expect(state.dirty).toBe(false);
		// Hydration must not share the caller's object.
		expect(state.document).not.toBe(document);
	});

	it('fits an uploaded image to the artboard, records one entry, and tracks its asset id', () => {
		state.addImageLayer(photo(), 'My photo');
		const layer = state.document!.layers[0] as ImageLayer;
		expect(layer).toMatchObject({ kind: 'image', name: 'My photo', assetId: 'photo-1' });
		expect(layer.transform.scaleX).toBeCloseTo(1);
		expect(layer.transform.x).toBeCloseTo((ARTBOARD_SIZE - 512) / 2);
		expect(layer.transform.y).toBeCloseTo((ARTBOARD_SIZE - 256) / 2);
		expect(state.document?.assetIds).toEqual(['photo-1']);
		expect(state.past).toHaveLength(1);
		expect(state.selectedLayerId).toBe(layer.id);
		expect(state.dirty).toBe(true);
		expect(state.saveStatus).toBe('unsaved');
	});

	it('records one undo entry for a whole title gesture and preserves revisions through undo/redo', () => {
		state.beginGesture();
		state.updateTitle('First frame');
		state.updateTitle('Final frame');
		state.commitGesture();

		expect(state.past).toHaveLength(1);
		const committed = state.document!;
		expect(committed.title).toBe('Final frame');
		expect(committed.revision).toBe(1);

		state.undo();
		expect(state.document?.title).toBe('Untitled Sticker');
		expect(state.document?.revision).toBe(2);
		expect(state.future).toHaveLength(1);

		state.redo();
		expect(state.document?.title).toBe('Final frame');
		expect(state.document?.revision).toBe(3);
		expect(state.past).toHaveLength(1);
	});

	it('keeps selection, zoom, pan and tool changes out of the document and history', () => {
		state.addImageLayer(photo());
		const revision = state.document!.revision;
		const past = state.past.length;
		state.markSaved(revision);
		expect(state.dirty).toBe(false);

		state.selectLayer(null);
		state.setViewport({ zoom: 2.5, panX: 30, panY: -12 });
		state.setTool('pan');
		state.setBrushSize(999);
		state.setUploadError('ignored');
		state.setViewport({ zoom: 12 });

		expect(state.document?.revision).toBe(revision);
		expect(state.past).toHaveLength(past);
		expect(state.dirty).toBe(false);
		expect(state.viewport).toEqual({ zoom: 4, panX: 30, panY: -12 });
		expect(state.brushSize).toBe(120);
		expect(state.activeTool).toBe('pan');
	});

	it('defers text edits inside a gesture and commits them as one entry', () => {
		state.addTextLayer();
		const layer = state.document!.layers[0] as TextLayer;
		const afterInsert = state.document!.revision;

		state.beginGesture();
		state.updateText(layer.id, { content: 'Hello' });
		state.updateText(layer.id, { content: 'Hello there' });
		state.updateText(layer.id, { fontSize: 96 });
		expect(state.document!.revision).toBe(afterInsert);
		state.commitGesture();

		expect(state.document!.revision).toBe(afterInsert + 1);
		expect(state.document!.layers[0] as TextLayer).toMatchObject({
			content: 'Hello there',
			fontSize: 96
		});
		expect(state.past).toHaveLength(2);
	});

	it('ignores transforms on a locked layer and keeps the visible center through a quarter turn', () => {
		state.addImageLayer(photo());
		const layerId = state.selectedLayerId!;
		state.toggleLayerLock(layerId);
		state.selectLayer(layerId);
		state.applyTransform(layerId, { x: 5, y: 5, rotation: 45, scaleX: 2, scaleY: 2 });
		expect((state.document!.layers[0] as ImageLayer).transform.x).toBeCloseTo(
			(ARTBOARD_SIZE - 512) / 2
		);

		state.toggleLayerLock(layerId);
		state.selectLayer(layerId);
		const before = (state.document!.layers[0] as ImageLayer).transform;
		const centerBefore = visibleCenter(before, 512, 256);
		state.rotateSelected90();
		const after = (state.document!.layers[0] as ImageLayer).transform;
		expect(after.rotation).toBe(before.rotation + 90);
		expect(visibleCenter(after, 512, 256).x).toBeCloseTo(centerBefore.x, 5);
		expect(visibleCenter(after, 512, 256).y).toBeCloseTo(centerBefore.y, 5);
	});

	it('mirrors the flip axis without moving the artwork', () => {
		state.addImageLayer(photo());
		const before = (state.document!.layers[0] as ImageLayer).transform;
		state.flipSelected('horizontal');
		const flipped = (state.document!.layers[0] as ImageLayer).transform;
		expect(flipped.scaleX).toBeCloseTo(-before.scaleX);
		expect(flipped.scaleY).toBeCloseTo(before.scaleY);
		expect(visibleCenter(flipped, 512, 256).x).toBeCloseTo(visibleCenter(before, 512, 256).x, 5);
	});

	it('keeps a removed image reachable through history, then prunes stale assets', () => {
		const record = photo();
		state.addImageLayer(record);
		expect(state.assets['photo-1']).toBeDefined();

		state.removeSelected();
		// Undo can still reach the removed image, so the blob stays cached.
		expect(state.assets['photo-1']).toBeDefined();
		expect(state.document?.assetIds).toEqual([]);

		state.undo();
		expect(state.document?.layers).toHaveLength(1);
		expect(state.assets['photo-1']).toBeDefined();

		// An asset no reachable document references is dropped by the next commit.
		state.assets = { ...state.assets, stale: photo({ id: 'stale', blobKey: 'stale' }) };
		state.addTextLayer({ content: 'prune now' });
		expect(state.assets['stale']).toBeUndefined();
	});

	it('clears only the revision that was actually persisted', () => {
		state.addTextLayer({ content: 'one' });
		const persisted = state.document!.revision;
		state.setSaveStatus('saving');
		state.addTextLayer({ content: 'two' });
		state.markSaved(persisted);
		expect(state.dirty).toBe(true);
		expect(state.saveStatus).not.toBe('saved-locally');

		state.markSaved(state.document!.revision);
		expect(state.dirty).toBe(false);
		expect(state.saveStatus).toBe('saved-locally');
		expect(state.saveError).toBeNull();
	});

	it('resets state and bumps the workspace epoch so stale writers stand down', () => {
		state.addImageLayer(photo());
		const epoch = state.workspaceEpoch;
		state.reset();
		expect(state.workspaceEpoch).toBe(epoch + 1);
		expect(state.document).toBeNull();
		expect(state.assets).toEqual({});
		expect(state.saveStatus).toBe('idle');
	});

	it('labels save status honestly for each state', () => {
		expect(saveStatusLabel('saved-locally', false)).toBe('Saved locally');
		expect(saveStatusLabel('saving', true)).toBe('Saving');
		expect(saveStatusLabel('save-failed', true)).toBe('Save failed');
		expect(saveStatusLabel('unsaved', true)).toBe('Unsaved changes');
		expect(saveStatusLabel('idle', false)).toBe('Not saved yet');
	});
});
