/**
 * Ported from `src/features/editor/toolIntent.test.ts`. The only adaptation is
 * the state seam: an `EditorState` instance is created per case instead of the
 * zustand singleton, and `applyToolIntent` takes it explicitly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectDocument } from '../persistence/repository';
import { createEditorState, type EditorState } from './editorState.svelte';
import {
	applyToolIntent,
	isUnmodifiedPrimaryClick,
	parseToolIntent,
	requestToolIntent,
	shouldReuseCurrentToolRoute,
	subscribeToolIntent,
	toolEmptyCopy,
	toolIntentHref,
	isReusableOpenDocument,
	type ToolIntentUi
} from './toolIntent';

let state: EditorState;

beforeEach(() => {
	state = createEditorState();
});

afterEach(() => {
	state.reset();
});

describe('toolIntent', () => {
	it('parses only the four advertised tools', () => {
		expect(parseToolIntent('erase')).toBe('erase');
		expect(parseToolIntent('text')).toBe('text');
		expect(parseToolIntent('effects')).toBe('effects');
		expect(parseToolIntent('export')).toBe('export');
		expect(parseToolIntent('/create')).toBeNull();
		expect(parseToolIntent('select')).toBeNull();
		expect(parseToolIntent(null)).toBeNull();
	});

	it('keeps an open editor document in the href and uses /create off the editor', () => {
		expect(toolIntentHref('erase', '/editor/abc-123')).toBe('/editor/abc-123?tool=erase');
		expect(toolIntentHref('text', '/')).toBe('/create?tool=text');
		expect(toolIntentHref('export', '/create')).toBe('/create?tool=export');
	});

	it('treats populated or dirty documents as reusable open work', () => {
		const blank = createProjectDocument({ id: 'blank', title: 'Untitled Sticker' });
		expect(isReusableOpenDocument(blank)).toBe(false);
		expect(isReusableOpenDocument(blank, { dirty: true })).toBe(true);
		expect(isReusableOpenDocument({ ...blank, revision: 1 })).toBe(true);
		expect(
			isReusableOpenDocument({
				...blank,
				layers: [
					{
						id: 't',
						name: 'Text',
						kind: 'text',
						content: 'Hi',
						fontFamily: 'Georgia',
						fontSize: 24,
						color: '#000',
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
						opacity: 1,
						visible: true,
						locked: false
					}
				]
			})
		).toBe(true);
	});

	it('asks for a photo instead of claiming the eraser is unavailable', () => {
		// Source copy: the brush exists, only the empty-state prompt is needed.
		expect(toolEmptyCopy('erase', false, false)).toEqual({
			title: 'Upload a photo to erase the background',
			body: 'Background Eraser needs an image layer. Automatic removal is not available — use Erase and Restore after you add a photo.'
		});
		expect(toolEmptyCopy('erase', true, false)).toBeNull();
	});

	it('activates erase without inserting layers', () => {
		state.createDraft('p1');
		const ui: ToolIntentUi & { inspector: string; exportOpen: boolean } = {
			inspector: '',
			exportOpen: true,
			setInspectorTab: (tab) => {
				ui.inspector = tab;
			},
			setAssetTab: () => {},
			setExportOpen: (open) => {
				ui.exportOpen = open;
			},
			setRailFocus: () => {}
		};
		applyToolIntent('erase', ui, state);
		expect(state.activeTool).toBe('erase');
		expect(state.document?.layers).toEqual([]);
		expect(ui.inspector).toBe('adjust');
		expect(ui.exportOpen).toBe(false);
	});

	it('re-dispatches the same tool when the current editor route already has that intent', () => {
		expect(shouldReuseCurrentToolRoute('/editor/abc', '?tool=export', 'export')).toBe(true);
		expect(shouldReuseCurrentToolRoute('/editor/abc', 'tool=export', 'export')).toBe(true);
		expect(shouldReuseCurrentToolRoute('/editor/abc', '?tool=text', 'export')).toBe(false);
		expect(shouldReuseCurrentToolRoute('/create', '?tool=export', 'export')).toBe(false);
		const click = { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false };
		expect(isUnmodifiedPrimaryClick(click)).toBe(true);
		expect(isUnmodifiedPrimaryClick({ ...click, ctrlKey: true })).toBe(false);
		expect(isUnmodifiedPrimaryClick({ ...click, metaKey: true })).toBe(false);
		expect(isUnmodifiedPrimaryClick({ ...click, shiftKey: true })).toBe(false);
		expect(isUnmodifiedPrimaryClick({ ...click, altKey: true })).toBe(false);
		expect(isUnmodifiedPrimaryClick({ ...click, button: 1 })).toBe(false);
		const seen: string[] = [];
		const stop = subscribeToolIntent((intent) => {
			seen.push(intent);
		});
		requestToolIntent('export');
		requestToolIntent('text');
		stop();
		requestToolIntent('erase');
		expect(seen).toEqual(['export', 'text']);
	});

	it('activates text without inserting a layer', () => {
		state.createDraft('p1');
		const ui: ToolIntentUi & { asset: string } = {
			asset: '',
			setInspectorTab: () => {},
			setAssetTab: (tab) => {
				ui.asset = tab;
			},
			setExportOpen: () => {},
			setRailFocus: () => {}
		};
		applyToolIntent('text', ui, state);
		expect(state.activeTool).toBe('text');
		expect(state.document?.layers).toEqual([]);
		expect(ui.asset).toBe('stickers');
	});
});
