/**
 * Port of `../Peeloodle/src/features/editor/maskStroke.test.ts` (React main
 * `54eae61c`), adapted to the rune editor state. A mask stroke is registered
 * before its canvas work finishes; every reader (save, export, tool switch)
 * awaits the same commit, and a rejected commit stays registered for retry.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorState, type EditorState } from './editorState.svelte';
import type { MaskStroke } from './maskStroke';

let state: EditorState;

beforeEach(() => {
	state = createEditorState();
});

describe('mask stroke session', () => {
	it('registers one stroke and awaits its commit before the reader continues', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const order: string[] = [];
		const stroke: MaskStroke = {
			layerId: 'layer-1',
			commit: async () => {
				order.push('commit');
				await gate;
				order.push('committed');
			}
		};

		state.beginMaskStroke(stroke);
		expect(state.maskStroke).toBe(stroke);

		const committing = state.commitMaskStroke();
		order.push('reader');
		release();
		await committing;

		expect(order).toEqual(['commit', 'reader', 'committed']);
		// The stroke's own commit clears it, exactly like the brush's clean().
		state.abandonMaskStroke();
		expect(state.maskStroke).toBeNull();
	});

	it('keeps a rejected stroke registered so a later save or export can retry', async () => {
		const commit = vi.fn(async () => {
			throw new Error('Encoding failed');
		});
		const stroke: MaskStroke = { layerId: 'layer-1', commit };
		state.beginMaskStroke(stroke);

		await expect(state.commitMaskStroke()).rejects.toThrow('Encoding failed');
		expect(state.maskStroke).toBe(stroke);

		await expect(state.commitMaskStroke()).rejects.toThrow('Encoding failed');
		expect(commit).toHaveBeenCalledTimes(2);
	});

	it('is a no-op when no stroke is open', async () => {
		await expect(state.commitMaskStroke()).resolves.toBeUndefined();
		expect(state.maskStroke).toBeNull();
	});

	it('refuses undo while a stroke is open', () => {
		state.createDraft('draft-a');
		state.updateTitle('Edited');
		const stroke: MaskStroke = { layerId: 'layer-1', commit: async () => {} };
		state.beginMaskStroke(stroke);

		state.undo();
		expect(state.document!.title).toBe('Edited');
		expect(state.past).toHaveLength(1);

		state.abandonMaskStroke();
		state.undo();
		expect(state.document!.title).toBe('Untitled Sticker');
	});
});
