import { beforeEach, describe, expect, it } from 'vitest';
import {
	coverCrop,
	imageReplaceRefusal,
	planImageInsert,
	planImageReplacement,
	planSlideInsertion,
	createPresentationStore
} from './store.svelte';

const presentationStore = createPresentationStore();
import {
	createPresentationDocument,
	createShapeElement,
	createSlide,
	createTextElement
} from '../model/factories';
import { PRESENTATION_LIMITS } from '../model/limits';
import { MIN_ELEMENT_SIZE } from './transformGeometry';
import type { PreparedPresentationImage } from './insertImageAsset';
import type { PresentationAsset, PresentationDocument } from '../model/types';

function reset(
	document: PresentationDocument = createPresentationDocument({
		id: 'doc-1',
		title: 'Deck',
		now: '2026-09-10T00:00:00.000Z'
	})
): PresentationDocument {
	presentationStore.getState().loadDocument(document, { saved: true });
	return document;
}

function state() {
	return presentationStore.getState();
}

/** Stored bytes the document itself accounts for. */
function storedBytes(): number {
	return state().document!.assets.reduce((sum, asset) => sum + asset.byteLength, 0);
}

/** A document holding exactly one stored asset of `byteLength` bytes. */
function documentWithStoredAsset(byteLength: number, sha: string): PresentationDocument {
	const document = createPresentationDocument({
		id: 'doc-1',
		title: 'Deck',
		now: '2026-09-10T00:00:00.000Z'
	});
	document.assets = [
		{
			id: `asset-${sha}`,
			blobKey: `uploads/${sha}`,
			mimeType: 'image/png',
			width: 4,
			height: 4,
			sha256: sha,
			byteLength,
			provenance: { source: 'upload', label: 'stored.png' }
		}
	];
	return document;
}

describe('presentation command store', () => {
	beforeEach(() => {
		reset();
	});

	it('loads a validated document and tracks saved/dirty state', () => {
		expect(state().document?.title).toBe('Deck');
		expect(state().dirty).toBe(false);
		expect(state().view.activeSlideId).toBe(state().document!.slides[0]!.id);

		state().loadDocument(createPresentationDocument({ id: 'doc-2', title: 'New' }), {
			saved: false
		});
		expect(state().dirty).toBe(true);
		expect(state().savedRevision).toBe(-1);

		state().markSaving();
		expect(state().saving).toBe(true);
		state().markSaved(state().document!.revision);
		expect(state().dirty).toBe(false);
		expect(state().saving).toBe(false);

		state().setSlideBackground(state().document!.slides[0]!.id, '#123456');
		expect(state().dirty).toBe(true);
		state().markSaveFailed('disk full');
		expect(state().saveError).toBe('disk full');
		expect(state().document?.slides[0]!.background).toBe('#123456');
	});

	it('keeps view actions out of the document and history', () => {
		const before = state().document!;
		state().selectSlide(before.slides[0]!.id);
		state().setZoom(2);
		state().setPan({ x: 10, y: 20 });
		state().selectElements([]);
		expect(state().document).toBe(before);
		expect(state().dirty).toBe(false);
		expect(state().past).toHaveLength(0);
		expect(state().view.zoom).toBe(2);
		expect(state().view.pan).toEqual({ x: 10, y: 20 });
	});

	it('keeps a live transform preview in view state only', () => {
		state().addElement(createShapeElement({ id: 'preview-me' }));
		const before = state().document!;
		const history = state().past.length;
		const dirty = state().dirty;

		state().setTransformPreview({
			elementId: 'preview-me',
			x: 300,
			y: 90,
			width: 600,
			height: 160,
			rotation: 30
		});
		expect(state().view.transformPreview).toEqual({
			elementId: 'preview-me',
			x: 300,
			y: 90,
			width: 600,
			height: 160,
			rotation: 30
		});
		// Nothing is written while the gesture is still in progress.
		expect(state().document).toBe(before);
		expect(state().past).toHaveLength(history);
		expect(state().dirty).toBe(dirty);

		state().setTransformPreview(null);
		expect(state().view.transformPreview).toBeNull();
		expect(state().document).toBe(before);
	});

	it('shows alignment guides without touching the document', () => {
		state().addElement(createShapeElement({ id: 'dragged' }));
		const before = state().document;
		const history = state().past.length;
		const revision = state().document!.revision;
		const dirty = state().dirty;

		state().setGuides([
			{ axis: 'x', position: 400 },
			{ axis: 'y', position: 225 }
		]);

		expect(state().view.guides).toEqual([
			{ axis: 'x', position: 400 },
			{ axis: 'y', position: 225 }
		]);
		expect(state().document).toBe(before);
		expect(state().document!.revision).toBe(revision);
		expect(state().past).toHaveLength(history);
		expect(state().dirty).toBe(dirty);

		state().setGuides([]);
		expect(state().view.guides).toEqual([]);
	});

	it('gives a new slide the document theme background', () => {
		const theme = state().document!.theme;
		state().setTheme({ ...theme, colors: { ...theme.colors, background: '#123456' } });
		const id = state().addSlide()!;
		const slide = state().document!.slides.find((candidate) => candidate.id === id)!;
		expect(slide.background).toBe('#123456');
	});

	it('changes theme defaults without restyling existing elements', () => {
		const styled = createTextElement({
			id: 'styled',
			fontId: 'spectral',
			size: 30,
			color: '#111111',
			text: 'Keep me'
		});
		state().addElement(styled);
		const before = structuredClone(state().document!.slides[0]!.elements[0]!);

		const theme = state().document!.theme;
		state().setTheme({
			...theme,
			bodyFontId: 'spectral',
			colors: { ...theme.colors, text: '#ff0000', accent: '#00ff00' }
		});

		expect(state().document!.slides[0]!.elements[0]!).toEqual(before);
		expect(state().document!.theme).toMatchObject({
			bodyFontId: 'spectral',
			colors: { text: '#ff0000', accent: '#00ff00' }
		});
	});

	it('groups slide background changes into one undo entry', () => {
		const slideId = state().document!.slides[0]!.id;
		const history = state().past.length;
		state().setSlideBackground(slideId, '#111111', { historyGroup: `slide-bg:${slideId}` });
		state().setSlideBackground(slideId, '#222222', { historyGroup: `slide-bg:${slideId}` });
		expect(state().past).toHaveLength(history + 1);
		state().endHistoryGroup();
		state().setSlideBackground(slideId, '#333333');
		expect(state().past).toHaveLength(history + 2);
		state().undo();
		expect(state().document!.slides[0]!.background).toBe('#222222');
	});

	it('commits one completed gesture as one history entry and clears the preview', () => {
		state().addElement(
			createShapeElement({ id: 'drag-me', x: 80, y: 80, width: 600, height: 160 })
		);
		const history = state().past.length;

		state().setTransformPreview({
			elementId: 'drag-me',
			x: 300,
			y: 90,
			width: 600,
			height: 160,
			rotation: 0
		});
		state().commitTransform('drag-me', { x: 300, y: 90, width: 600, height: 160, rotation: 0 });
		const element = state().document!.slides[0]!.elements[0]!;
		expect({
			x: element.x,
			y: element.y,
			width: element.width,
			height: element.height,
			rotation: element.rotation
		}).toEqual({ x: 300, y: 90, width: 600, height: 160, rotation: 0 });
		expect(state().past).toHaveLength(history + 1);
		expect(state().view.transformPreview).toBeNull();
		expect(state().dirty).toBe(true);

		// The next gesture is its own entry, and undo restores the pre-gesture state.
		state().commitTransform('drag-me', { x: 320, y: 90, width: 600, height: 160, rotation: 0 });
		expect(state().past).toHaveLength(history + 2);
		state().undo();
		expect(state().document!.slides[0]!.elements[0]!.x).toBe(300);
	});

	it('refuses to commit transforms for locked elements or unusable geometry', () => {
		state().addElement(
			createShapeElement({ id: 'locked', locked: true, x: 40, y: 40, width: 200, height: 100 })
		);
		const history = state().past.length;

		state().commitTransform('locked', { x: 500, y: 500, width: 200, height: 100, rotation: 0 });
		state().commitTransform('missing', { x: 500, y: 500, width: 200, height: 100, rotation: 0 });
		state().commitTransform('locked', {
			x: Number.NaN,
			y: 0,
			width: 200,
			height: 100,
			rotation: 0
		});
		state().toggleElementLocked('locked');
		// Unlocking is a document command of its own; the refused transforms below add nothing.
		expect(state().past).toHaveLength(history + 1);
		state().commitTransform('locked', {
			x: 500,
			y: 500,
			width: Number.POSITIVE_INFINITY,
			height: 100,
			rotation: 0
		});
		state().commitTransform('locked', { x: 500, y: 500, width: 2, height: 100, rotation: 0 });

		const element = state().document!.slides[0]!.elements[0]!;
		// Only the last call was a usable transform, and its tiny width was clamped.
		expect({ x: element.x, y: element.y, width: element.width, height: element.height }).toEqual({
			x: 500,
			y: 500,
			width: MIN_ELEMENT_SIZE,
			height: 100
		});
		expect(state().past).toHaveLength(history + 2);
	});

	it('opens and closes the text editor as view state only', () => {
		const slideId = state().document!.slides[0]!.id;
		const text = createTextElement({ id: 'text-1' });
		state().addElement(text);
		const revisions = state().document!.revision;
		const history = state().past.length;
		const dirty = state().dirty;

		state().startTextEdit('text-1');
		expect(state().view.editingElementId).toBe('text-1');
		expect(state().view.selectedElementIds).toEqual(['text-1']);
		expect(state().dirty).toBe(dirty);
		expect(state().document!.revision).toBe(revisions);

		state().endTextEdit();
		expect(state().view.editingElementId).toBeNull();

		// Non-text and unknown elements cannot be opened, and switching slides closes the editor.
		state().addElement(createShapeElement({ id: 'shape-1' }));
		state().startTextEdit('shape-1');
		expect(state().view.editingElementId).toBeNull();
		state().startTextEdit('missing');
		expect(state().view.editingElementId).toBeNull();
		state().startTextEdit('text-1');
		state().selectSlide(slideId);
		expect(state().view.editingElementId).toBeNull();
		expect(state().past).toHaveLength(history + 1);
	});

	it('drops a stale editing target when undo removes the element', () => {
		state().addElement(createTextElement({ id: 'text-1' }));
		state().startTextEdit('text-1');
		state().undo();
		expect(state().view.editingElementId).toBeNull();
		expect(state().document!.slides[0]!.elements).toHaveLength(0);
	});

	it('clears the editing target when its element or slide goes away', () => {
		const first = state().document!.slides[0]!.id;
		state().addElement(createTextElement({ id: 'text-1' }));
		state().startTextEdit('text-1');
		state().removeElement('text-1');
		expect(state().view.editingElementId).toBeNull();

		state().addElement(createTextElement({ id: 'text-2' }));
		state().startTextEdit('text-2');
		const second = state().addSlide(first);
		expect(state().view.editingElementId).toBeNull();
		expect(state().view.activeSlideId).toBe(second);

		// Removing the slide that holds the edited element drops the target too.
		state().selectSlide(second!);
		state().startTextEdit('text-2');
		state().removeSlide(second!);
		expect(state().view.activeSlideId).toBe(first);
		expect(state().view.editingElementId).toBeNull();
	});

	it('adds, duplicates, reorders and removes slides', () => {
		const first = state().document!.slides[0]!.id;
		const element = createShapeElement({ id: 'shape-1' });
		state().addElement(element);
		const second = state().addSlide(first);
		expect(second).not.toBeNull();
		expect(state().document!.slides).toHaveLength(2);
		expect(state().view.activeSlideId).toBe(second);

		const copy = state().duplicateSlide(first);
		expect(copy).not.toBeNull();
		expect(state().document!.slides).toHaveLength(3);
		const source = state().document!.slides.find((slide) => slide.id === first)!;
		const duplicated = state().document!.slides.find((slide) => slide.id === copy)!;
		expect(duplicated.elements[0]!.id).not.toBe(source.elements[0]!.id);
		expect(duplicated.name).toContain('copy');

		state().reorderSlide(copy!, 0);
		expect(state().document!.slides[0]!.id).toBe(copy);

		expect(state().removeSlide(copy!)).toBe(true);
		expect(state().document!.slides).toHaveLength(2);
		expect(state().view.activeSlideId).toBe(state().document!.slides[0]!.id);
	});

	it('selects the adjacent slide when the active slide is removed', () => {
		const first = state().document!.slides[0]!.id;
		const second = state().addSlide(first)!;
		const third = state().addSlide(second)!;

		state().selectSlide(second);
		state().removeSlide(second);
		expect(state().view.activeSlideId).toBe(third);

		state().removeSlide(third);
		expect(state().view.activeSlideId).toBe(first);
	});

	it('refuses to remove the last slide', () => {
		const only = state().document!.slides[0]!.id;
		expect(state().removeSlide(only)).toBe(false);
		expect(state().document!.slides).toHaveLength(1);
	});

	it('duplicates an element with a fresh id, an offset and one undo entry', () => {
		state().addElement(
			createShapeElement({ id: 'original', x: 100, y: 80, width: 200, height: 120 })
		);
		const history = state().past.length;

		const copyId = state().duplicateElement('original')!;

		expect(copyId).not.toBe('original');
		const elements = state().document!.slides[0]!.elements;
		expect(elements.map((element) => element.id)).toEqual(['original', copyId]);
		expect(elements[1]!).toMatchObject({
			name: 'Element 1 copy',
			x: 124,
			y: 104,
			width: 200,
			height: 120
		});
		expect(state().view.selectedElementIds).toEqual([copyId]);
		expect(state().past).toHaveLength(history + 1);

		state().undo();
		expect(state().document!.slides[0]!.elements.map((element) => element.id)).toEqual([
			'original'
		]);
	});

	it('refuses to duplicate a missing element', () => {
		expect(state().duplicateElement('missing')).toBeNull();
	});

	it('inserts, updates, reorders and removes elements', () => {
		const a = createShapeElement({ id: 'a' });
		const b = createShapeElement({ id: 'b' });
		state().addElement(a);
		state().addElement(b);
		expect(state().view.selectedElementIds).toEqual(['b']);
		expect(state().document!.slides[0]!.elements.map((element) => element.id)).toEqual(['a', 'b']);

		state().reorderElement('b', 0);
		expect(state().document!.slides[0]!.elements.map((element) => element.id)).toEqual(['b', 'a']);

		state().updateElement('a', { x: 200, opacity: 0.5 });
		const updated = state().document!.slides[0]!.elements.find((element) => element.id === 'a');
		expect(updated?.x).toBe(200);
		expect(updated?.opacity).toBe(0.5);

		state().removeElement('a');
		expect(state().view.selectedElementIds).toEqual(['b']);
		expect(state().document!.slides[0]!.elements).toHaveLength(1);

		state().toggleElementLocked('b');
		expect(state().document!.slides[0]!.elements[0]!.locked).toBe(true);
		state().transformElement('b', { x: 999 });
		expect(state().document!.slides[0]!.elements[0]!.x).not.toBe(999);
		state().toggleElementVisible('b');
		expect(state().document!.slides[0]!.elements[0]!.visible).toBe(false);
	});

	it('updates rich text and restores it with undo', () => {
		const text = createTextElement({ id: 't', text: 'before' });
		state().addElement(text);
		state().updateText('t', [
			{
				runs: [
					{ text: 'xin chào', fontId: 'be-vietnam-pro', size: 28, color: '#08152f', bold: true },
					{ text: ' thế giới', fontId: 'be-vietnam-pro', size: 28, color: '#08152f' }
				],
				alignment: 'center',
				bullet: 'none',
				bulletLevel: 0
			}
		]);
		const element = state().document!.slides[0]!.elements[0]!;
		expect(element.kind).toBe('text');
		if (element.kind !== 'text') throw new Error('expected text');
		expect(element.paragraphs[0]!.runs[0]!.bold).toBe(true);
		state().undo();
		const restored = state().document!.slides[0]!.elements[0]!;
		if (restored.kind !== 'text') throw new Error('expected text');
		expect(restored.paragraphs[0]!.runs[0]!.text).toBe('before');
	});

	it('groups one gesture into one undo entry', () => {
		const element = createShapeElement({ id: 'drag-me' });
		state().addElement(element);
		const afterInsert = state().past.length;
		state().transformElement('drag-me', { x: 100 });
		state().transformElement('drag-me', { x: 140 });
		state().transformElement('drag-me', { x: 180 });
		expect(state().past.length).toBe(afterInsert + 1);
		state().endHistoryGroup();
		state().transformElement('drag-me', { x: 200 });
		expect(state().past.length).toBe(afterInsert + 2);
		state().undo();
		expect(state().document!.slides[0]!.elements[0]!.x).toBe(180);
		state().undo();
		expect(state().document!.slides[0]!.elements[0]!.x).toBe(80);
	});

	it('undoes across slides and keeps history when switching slides', () => {
		const first = state().document!.slides[0]!.id;
		state().addElement(createShapeElement({ id: 's1' }));
		const second = state().addSlide(first)!;
		state().addElement(createShapeElement({ id: 's2' }));
		state().undo(); // remove s2
		expect(state().document!.slides.find((slide) => slide.id === second)!.elements).toHaveLength(0);
		state().undo(); // remove slide 2
		expect(state().document!.slides).toHaveLength(1);
		expect(state().past.length).toBe(1);
		state().undo(); // remove s1
		expect(state().document!.slides[0]!.elements).toHaveLength(0);
		expect(state().past).toHaveLength(0);
		state().redo();
		expect(state().document!.slides[0]!.elements).toHaveLength(1);
		state().selectSlide(first);
		expect(state().past.length).toBeGreaterThan(0);
	});

	it('bounds history entries and clears redo on a new edit', () => {
		for (let i = 0; i < PRESENTATION_LIMITS.historyEntries + 10; i += 1) {
			state().addSlide();
		}
		expect(state().past.length).toBeLessThanOrEqual(PRESENTATION_LIMITS.historyEntries);
		state().undo();
		expect(state().future.length).toBe(1);
		state().addSlide();
		expect(state().future).toHaveLength(0);
	});

	it('does not erase redo history on a no-op command', () => {
		state().addElement(createShapeElement({ id: 'x' }));
		state().undo();
		expect(state().future).toHaveLength(1);
		const revision = state().document!.revision;
		const pastLength = state().past.length;
		const slideId = state().document!.slides[0]!.id;
		// Reordering the only slide to its current position must not dirty the document.
		state().reorderSlide(slideId, 0);
		expect(state().document!.revision).toBe(revision);
		expect(state().past).toHaveLength(pastLength);
		expect(state().future).toHaveLength(1);
		// Redo still works after the no-op.
		state().redo();
		expect(state().document!.slides[0]!.elements).toHaveLength(1);
	});

	it('ignores commands that change nothing', () => {
		state().addElement(createShapeElement({ id: 'x', x: 80 }));
		const revision = state().document!.revision;
		const pastLength = state().past.length;
		const dirty = state().dirty;
		const slide = state().document!.slides[0]!;
		state().updateElement('x', { x: 80 });
		state().setSlideBackground(slide.id, slide.background);
		state().renameSlide(slide.id, slide.name);
		state().removeElement('missing-element');
		state().reorderElement('x', 0);
		state().setTheme(state().document!.theme);
		expect(state().document!.revision).toBe(revision);
		expect(state().past).toHaveLength(pastLength);
		expect(state().dirty).toBe(dirty);
	});

	it('treats structurally identical nested patches as no-ops', () => {
		const text = createTextElement({ id: 'text-keep', text: 'giữ nguyên' });
		state().addElement(text);
		const revision = state().document!.revision;
		const pastLength = state().past.length;
		const current = state().document!.slides[0]!.elements.find(
			(element) => element.id === 'text-keep'
		)!;
		if (current.kind !== 'text') throw new Error('expected text');
		state().updateElement('text-keep', { paragraphs: structuredClone(current.paragraphs) });
		state().updateElement('text-keep', { crop: undefined });
		expect(state().document!.revision).toBe(revision);
		expect(state().past).toHaveLength(pastLength);
	});

	it('removing an unknown slide is a no-op that preserves redo', () => {
		state().addElement(createShapeElement({ id: 'x' }));
		state().undo();
		expect(state().future).toHaveLength(1);
		const revision = state().document!.revision;
		const pastLength = state().past.length;
		expect(state().removeSlide('missing-slide')).toBe(false);
		expect(state().document!.revision).toBe(revision);
		expect(state().past).toHaveLength(pastLength);
		expect(state().future).toHaveLength(1);
	});

	it('refuses to add an element with an id that already exists', () => {
		state().addElement(createShapeElement({ id: 'dup' }));
		const revision = state().document!.revision;
		const pastLength = state().past.length;
		expect(state().addElement(createShapeElement({ id: 'dup' }))).toBeNull();
		expect(state().document!.revision).toBe(revision);
		expect(state().past).toHaveLength(pastLength);
	});

	it('keeps one history entry when a grouped update changes nothing on the last frame', () => {
		state().addElement(createShapeElement({ id: 'drag', x: 80 }));
		const before = state().past.length;
		state().transformElement('drag', { x: 100 });
		state().transformElement('drag', { x: 100 });
		state().transformElement('drag', { x: 100 });
		expect(state().past).toHaveLength(before + 1);
	});

	it('validates documents on load and never stores raw input', () => {
		const bad = { ...createPresentationDocument(), schemaVersion: 99 };
		expect(() => state().loadDocument(bad as unknown as PresentationDocument)).toThrow();
	});

	it('keeps selection valid when undoing element removal', () => {
		const element = createShapeElement({ id: 'keep' });
		state().addElement(element);
		state().selectElements(['keep']);
		expect(state().view.selectedElementIds).toEqual(['keep']);
		state().removeElement('keep');
		expect(state().view.selectedElementIds).toEqual([]);
		state().undo();
		expect(state().document!.slides[0]!.elements[0]!.id).toBe('keep');
		// Undo restores content; selection is allowed to stay empty rather than resurrecting stale ids.
		expect(state().view.selectedElementIds).toEqual([]);
	});
});

describe('presentation image insertion', () => {
	function preparedImage(
		imageSha = 'a'.repeat(64),
		width = 400,
		height = 300
	): PreparedPresentationImage {
		const asset: PresentationAsset = {
			id: `asset-${imageSha}`,
			blobKey: `uploads/${imageSha}`,
			mimeType: 'image/png',
			width,
			height,
			sha256: imageSha,
			byteLength: 4,
			provenance: { source: 'upload', label: 'photo.png' }
		};
		return {
			asset,
			media: { assetId: asset.id, bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' }
		};
	}

	/**
	 * Simulates the production persist-first insert: the caller checks, plans, and
	 * writes the plan before adopting it here, so the document is never shown with
	 * bytes that are not stored.
	 */
	function persistedInsert(
		image: PreparedPresentationImage,
		options?: { slideId?: string }
	): string | null {
		const document = state().document;
		if (!document || !state().checkImageInsert(image, options).ok) return null;
		const plan = planImageInsert(document, image, {
			slideId: options?.slideId ?? state().view.activeSlideId
		});
		if (!plan) return null;
		state().adoptPersistedInsert(plan, image);
		return plan.elementId;
	}

	/** The replacement counterpart of `persistedInsert`. */
	function persistedReplace(elementId: string, image: PreparedPresentationImage): boolean {
		const document = state().document;
		if (!document || imageReplaceRefusal(document, image, elementId)) return false;
		const plan = planImageReplacement(document, elementId, image);
		if (!plan) return false;
		state().adoptPersistedReplacement(plan, image);
		return true;
	}

	beforeEach(() => {
		reset();
	});

	it('adopts a persisted image as one history entry, placement, and asset record', () => {
		const prepared = preparedImage();
		const before = state().past.length;

		const id = persistedInsert(prepared);

		expect(id).toBeTruthy();
		expect(state().past).toHaveLength(before + 1);
		// The plan's revision was written before it was shown, so it is clean.
		expect(state().dirty).toBe(false);
		expect(state().savedRevision).toBe(state().document!.revision);
		expect(state().view.selectedElementIds).toEqual([id]);
		expect(state().document!.slides[0]!.elements[0]!).toMatchObject({
			kind: 'image',
			assetId: prepared.asset.id,
			name: 'Image',
			// 400×300 at its own size, centred on the 1280×720 page.
			x: 440,
			y: 210,
			width: 400,
			height: 300,
			crop: { x: 0, y: 0, width: 1, height: 1 }
		});
		expect(state().document!.assets).toEqual([prepared.asset]);
		expect(JSON.stringify(state().document)).not.toContain('bytes');
	});

	it('removes the element and asset with undo, and restores both with redo', () => {
		const prepared = preparedImage();
		const id = persistedInsert(prepared)!;

		state().undo();
		expect(state().document!.slides[0]!.elements).toHaveLength(0);
		// Undo restores the pre-insert snapshot, so the asset record goes with it.
		expect(state().document!.assets).toHaveLength(0);

		state().redo();
		expect(state().document!.slides[0]!.elements[0]!.id).toBe(id);
		expect(state().document!.assets.map((asset) => asset.id)).toEqual([prepared.asset.id]);
	});

	it('replays a persisted insert on a live document that moved on during the write', () => {
		const image = preparedImage('7'.repeat(64));
		const plan = planImageInsert(state().document!, image)!;
		// A command lands while the write is in flight.
		state().addElement(createShapeElement({ id: 'landed-during-write' }));
		const liveRevision = state().document!.revision;

		state().adoptPersistedInsert(plan, image);

		// The stored revision becomes the new base and the insert is replayed on the
		// live document, which therefore still needs a write.
		expect(state().savedRevision).toBe(plan.document.revision);
		expect(state().dirty).toBe(true);
		expect(state().document!.revision).toBeGreaterThan(liveRevision);
		expect(
			state().document!.slides[0]!.elements.some((element) => element.id === 'landed-during-write')
		).toBe(true);
		expect(
			state().document!.slides[0]!.elements.some(
				(element) => element.kind === 'image' && element.assetId === image.asset.id
			)
		).toBe(true);
	});

	it('reuses one asset record for identical bytes without charging the document twice', () => {
		const prepared = preparedImage();
		const first = persistedInsert(prepared)!;
		const second = persistedInsert(prepared)!;

		expect(first).not.toBe(second);
		expect(state().document!.assets).toHaveLength(1);
		expect(state().document!.slides[0]!.elements).toHaveLength(2);
		expect(state().past).toHaveLength(2);
		expect(storedBytes()).toBe(4);
	});

	it('names each further image on the slide', () => {
		persistedInsert(preparedImage('b'.repeat(64)));
		persistedInsert(preparedImage('c'.repeat(64)));

		expect(state().document!.slides[0]!.elements.map((element) => element.name)).toEqual([
			'Image',
			'Image 2'
		]);
	});

	it('refuses to insert without an open document', () => {
		state().closeDocument();

		expect(state().checkImageInsert(preparedImage()).ok).toBe(false);
		expect(persistedInsert(preparedImage())).toBeNull();
	});

	it('refuses a new asset at the asset limit but still allows one the document holds', () => {
		const full = createPresentationDocument({ id: 'full', now: '2026-09-10T00:00:00.000Z' });
		full.assets = Array.from({ length: PRESENTATION_LIMITS.maxAssets }, (_, index) => ({
			id: `asset-${index.toString(16).padStart(64, '0')}`,
			blobKey: `uploads/${index}`,
			mimeType: 'image/png' as const,
			width: 4,
			height: 4,
			sha256: index.toString(16).padStart(64, '0'),
			byteLength: 4,
			provenance: { source: 'upload' as const, label: 'seeded' }
		}));
		reset(full);

		expect(state().checkImageInsert(preparedImage('d'.repeat(64))).ok).toBe(false);
		expect(persistedInsert(preparedImage('d'.repeat(64)))).toBeNull();
		expect(state().document!.assets).toHaveLength(PRESENTATION_LIMITS.maxAssets);
		expect(persistedInsert(preparedImage('0'.repeat(64)))).toBeTruthy();
	});

	it('refuses an image that would exceed the media budget, before mutating anything', () => {
		// The artwork already stored fills almost the whole budget.
		reset(documentWithStoredAsset(PRESENTATION_LIMITS.maxMediaBytes - 1, '1'.repeat(64)));

		const document = state().document!;
		const history = state().past.length;

		const check = state().checkImageInsert(preparedImage('2'.repeat(64)));
		expect(check.ok).toBe(false);
		if (check.ok) throw new Error('expected a refusal');
		expect(check.reason).toBe('media-limit');
		// The message has to be actionable: the limit, what is stored, and the file.
		expect(check.message).toContain(`${PRESENTATION_LIMITS.maxMediaBytes / (1024 * 1024)}.0 MB`);
		expect(check.message).toContain('photo.png');

		// The command refuses for the same reason, and nothing moved.
		expect(persistedInsert(preparedImage('2'.repeat(64)))).toBeNull();
		expect(state().document).toBe(document);
		expect(state().past).toHaveLength(history);
	});

	it('still accepts re-inserting artwork the presentation already holds when the budget is full', () => {
		// The whole budget is accounted for by that one stored asset.
		reset(documentWithStoredAsset(PRESENTATION_LIMITS.maxMediaBytes, '5'.repeat(64)));

		// A genuinely new asset has no room.
		const refused = state().checkImageInsert(preparedImage('6'.repeat(64)));
		expect(refused.ok).toBe(false);
		if (refused.ok) throw new Error('expected a refusal');
		expect(refused.reason).toBe('media-limit');

		// The same bytes again add no storage, so refusing it would be wrong: this is
		// what the known-asset exemption in the byte budget exists for.
		expect(state().checkImageInsert(preparedImage('5'.repeat(64))).ok).toBe(true);
		expect(persistedInsert(preparedImage('5'.repeat(64)))).not.toBeNull();
		expect(state().document!.assets).toHaveLength(1);
	});

	it('never charges the media budget twice for identical content', () => {
		persistedInsert(preparedImage('3'.repeat(64)));
		expect(state().document!.assets).toHaveLength(1);
		expect(storedBytes()).toBe(4);

		persistedInsert(preparedImage('3'.repeat(64)));

		expect(state().document!.assets).toHaveLength(1);
		expect(storedBytes()).toBe(4);
	});

	it('plans a replacement that keeps placement and flips and center-crops the new image', () => {
		persistedInsert(preparedImage());
		const element = state().document!.slides[0]!.elements[0]!;
		if (element.kind !== 'image') throw new Error('expected image');
		state().updateElement(element.id, { flipX: true, x: 100, y: 50, width: 300, height: 300 });

		const replacement = preparedImage('b'.repeat(64), 400, 300);
		const plan = planImageReplacement(state().document!, element.id, replacement)!;

		const replaced = plan.document.slides[0]!.elements[0]!;
		if (replaced.kind !== 'image') throw new Error('expected image');
		expect(replaced).toMatchObject({
			x: 100,
			y: 50,
			width: 300,
			height: 300,
			flipX: true,
			assetId: replacement.asset.id,
			alt: 'photo.png'
		});
		// The 4:3 image is cover-cropped to the square box, not stretched.
		expect(replaced.crop).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
		expect(plan.document.assets.map((asset) => asset.id)).toContain(replacement.asset.id);
		// The original document is untouched: the plan is what gets persisted first.
		expect(element.assetId).not.toBe(replacement.asset.id);
	});

	it('cover-crops a wider image to the box aspect instead of stretching it', () => {
		const wide = preparedImage('c'.repeat(64), 800, 200);
		expect(coverCrop(wide, { width: 300, height: 300 })).toEqual({
			x: 0.375,
			y: 0,
			width: 0.25,
			height: 1
		});
	});

	it('replaces an image as one undo entry and restores the original with undo/redo', () => {
		const first = preparedImage();
		persistedInsert(first);
		const element = state().document!.slides[0]!.elements[0]!;
		if (element.kind !== 'image') throw new Error('expected image');
		const history = state().past.length;

		const second = preparedImage('d'.repeat(64), 200, 400);
		expect(persistedReplace(element.id, second)).toBe(true);
		expect(state().past).toHaveLength(history + 1);
		const replaced = state().document!.slides[0]!.elements[0]!;
		if (replaced.kind !== 'image') throw new Error('expected image');
		expect(replaced.assetId).toBe(second.asset.id);
		// A portrait image is cropped to the 400×300 box, not squashed into it.
		expect(replaced.crop).toEqual({ x: 0, y: 0.3125, width: 1, height: 0.375 });
		// The new artwork is part of the document now; its bytes were written with
		// the replacement, so the document carries both asset records over history.
		expect(state().document!.assets.map((asset) => asset.id)).toContain(second.asset.id);

		state().undo();
		const restored = state().document!.slides[0]!.elements[0]!;
		if (restored.kind !== 'image') throw new Error('expected image');
		expect(restored.assetId).toBe(first.asset.id);
		expect(restored.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });

		state().redo();
		const again = state().document!.slides[0]!.elements[0]!;
		if (again.kind !== 'image') throw new Error('expected image');
		expect(again.assetId).toBe(second.asset.id);
	});

	it('replays a persisted replacement on a live document that moved on during the write', () => {
		persistedInsert(preparedImage('8'.repeat(64)));
		const element = state().document!.slides[0]!.elements[0]!;
		if (element.kind !== 'image') throw new Error('expected image');
		const replacement = preparedImage('9'.repeat(64));
		const plan = planImageReplacement(state().document!, element.id, replacement)!;
		// A command lands while the write is in flight.
		state().addElement(createShapeElement({ id: 'landed-during-replace' }));

		state().adoptPersistedReplacement(plan, replacement);

		expect(state().savedRevision).toBe(plan.document.revision);
		expect(state().dirty).toBe(true);
		expect(
			state().document!.slides[0]!.elements.some(
				(candidate) => candidate.id === 'landed-during-replace'
			)
		).toBe(true);
		const replaced = state().document!.slides[0]!.elements.find(
			(candidate) => candidate.id === element.id
		);
		expect(replaced?.kind === 'image' && replaced.assetId).toBe(replacement.asset.id);
	});

	it('refuses to replace anything that is not a selected image', () => {
		const text = createTextElement({ id: 'not-an-image' });
		state().addElement(text);
		const document = state().document!;
		const history = state().past.length;
		expect(imageReplaceRefusal(document, preparedImage(), 'not-an-image')).not.toBeNull();
		expect(imageReplaceRefusal(document, preparedImage(), 'missing')).not.toBeNull();
		expect(persistedReplace('not-an-image', preparedImage())).toBe(false);
		expect(persistedReplace('missing', preparedImage())).toBe(false);
		expect(state().past).toHaveLength(history);
	});

	it('plans an insert without mutating the document or the store', () => {
		const before = state().document!;

		const plan = planImageInsert(before, preparedImage('5'.repeat(64)));

		expect(plan).not.toBeNull();
		expect(plan!.document.revision).toBe(before.revision + 1);
		expect(plan!.document.assets[0]!.byteLength).toBe(4);
		// The plan is what gets persisted first, so building it must change nothing.
		expect(before.slides[0]!.elements).toHaveLength(0);
		expect(before.assets).toHaveLength(0);
		expect(state().document).toBe(before);
		expect(state().past).toHaveLength(0);
	});

	it('adopts an already-persisted insert without leaving the editor dirty', () => {
		const document = state().document!;
		const image = preparedImage('6'.repeat(64));
		const plan = planImageInsert(document, image)!;
		const history = state().past.length;

		state().adoptPersistedInsert(plan, image);

		// The revision the plan carries is the one that was written.
		expect(state().document!.revision).toBe(plan.document.revision);
		expect(state().savedRevision).toBe(plan.document.revision);
		expect(state().dirty).toBe(false);
		expect(state().saving).toBe(false);
		expect(state().saveError).toBeNull();
		expect(state().past).toHaveLength(history + 1);
		expect(state().view.selectedElementIds).toEqual([plan.elementId]);
		expect(state().document!.assets[0]!.byteLength).toBe(4);
	});
});

describe('slide insertion planning', () => {
	beforeEach(() => {
		reset();
	});

	it('inserts fresh slides after the anchor as one undo entry', () => {
		const document = reset();
		const incoming = {
			...structuredClone(document.slides[0]!),
			id: 'inserted-slide',
			name: 'Agenda'
		};
		const plan = planSlideInsertion(document, [incoming], []);
		expect(plan).not.toBeNull();
		if (!plan) throw new Error('expected a plan');

		state().adoptPersistedSlideInsertion(plan);
		expect(state().document!.slides.map((slide) => slide.name)).toEqual(['Slide 1', 'Agenda']);
		expect(state().view.activeSlideId).toBe('inserted-slide');
		expect(state().dirty).toBe(false);
		expect(state().past).toHaveLength(1);

		state().undo();
		expect(state().document!.slides).toHaveLength(1);
	});

	it('carries prepared assets into the document and refuses past the caps', () => {
		const document = reset();
		const incoming = {
			...structuredClone(document.slides[0]!),
			id: 'inserted-slide',
			name: 'Agenda'
		};
		const asset: PresentationAsset = {
			id: 'asset-catalog',
			blobKey: `catalog/${'a'.repeat(64)}`,
			mimeType: 'image/png',
			width: 8,
			height: 8,
			sha256: 'a'.repeat(64),
			byteLength: 10,
			provenance: { source: 'catalog', label: 'Art' }
		};
		const plan = planSlideInsertion(document, [incoming], [asset]);
		expect(plan).not.toBeNull();
		if (!plan) throw new Error('expected a plan');
		state().adoptPersistedSlideInsertion(plan);
		expect(state().document!.assets.map((entry) => entry.id)).toContain('asset-catalog');

		const full = createPresentationDocument({ id: 'full', title: 'Full' });
		full.slides = Array.from({ length: PRESENTATION_LIMITS.maxSlides }, (_, index) => ({
			...structuredClone(full.slides[0]!),
			id: `slide-${index}`
		}));
		expect(planSlideInsertion(full, [incoming], [])).toBeNull();
	});

	it('groups typing and automatic geometry into one undo entry', () => {
		const store = createPresentationStore({
			measureText: (text, spec) => (text.length * spec.size) / 2
		});
		const document = createPresentationDocument();
		const text = createTextElement({
			id: 'grow',
			autoGrow: true,
			x: 80,
			y: 80,
			width: 200,
			height: 40,
			text: 'Hello'
		});
		document.slides[0]!.elements = [text];
		store.getState().loadDocument(document);
		const paragraphs = structuredClone(text.paragraphs);
		paragraphs[0]!.runs[0]!.text = 'Many words across multiple lines '.repeat(3);
		store.getState().updateText(text.id, paragraphs, { historyGroup: 'text:grow' });
		const grown = store.getState().document!.slides[0]!.elements[0]!;
		expect(grown.height).toBeGreaterThan(40);
		expect(store.getState().past).toHaveLength(1);
		store.getState().endHistoryGroup();
		store.getState().undo();
		expect(store.getState().document!.slides[0]!.elements[0]).toEqual(text);
		store.getState().redo();
		expect(store.getState().document!.slides[0]!.elements[0]).toEqual(grown);
	});

	it('does not reflow legacy text on load or on unrelated edits', () => {
		const store = createPresentationStore();
		const document = createPresentationDocument();
		const text = createTextElement({ text: 'Overflow '.repeat(100), height: 20 });
		document.slides[0]!.elements = [text];
		store.getState().loadDocument(document);
		expect(store.getState().dirty).toBe(false);
		store.getState().renameSlide(document.slides[0]!.id, 'Renamed');
		expect(store.getState().document!.slides[0]!.elements[0]).toEqual(text);
	});

	it('fits width, formatting, line-height and padding changes in the same command', () => {
		const store = createPresentationStore({
			measureText: (text, spec) => (text.length * spec.size) / 2
		});
		const document = createPresentationDocument();
		const text = createTextElement({
			id: 'grow',
			autoGrow: true,
			width: 600,
			height: 40,
			text: 'note'
		});
		document.slides[0]!.elements = [text];
		store.getState().loadDocument(document);
		const history = store.getState().past.length;

		store.getState().updateElement('grow', { width: 120 });
		const afterWidth = store.getState().document!.slides[0]!.elements[0]!;
		expect(afterWidth.height).toBeGreaterThan(40);
		expect(store.getState().past).toHaveLength(history + 1);

		const edited = structuredClone(text.paragraphs);
		edited[0]!.runs[0]!.size = 56;
		store.getState().updateElement('grow', { paragraphs: edited });
		const afterSize = store.getState().document!.slides[0]!.elements[0]!;
		expect(afterSize.height).toBeGreaterThan(afterWidth.height);
		expect(store.getState().past).toHaveLength(history + 2);

		store.getState().updateElement('grow', { lineHeight: 2 });
		const afterLineHeight = store.getState().document!.slides[0]!.elements[0]!;
		expect(afterLineHeight.height).toBeGreaterThan(afterSize.height);
		expect(store.getState().past).toHaveLength(history + 3);

		store.getState().updateElement('grow', { padding: 24 });
		expect(store.getState().document!.slides[0]!.elements[0]!.height).toBeGreaterThan(
			afterLineHeight.height
		);
		expect(store.getState().past).toHaveLength(history + 4);
	});

	it('leaves fixed and locked text untouched by fitting', () => {
		const store = createPresentationStore({
			measureText: (text, spec) => (text.length * spec.size) / 2
		});
		const document = createPresentationDocument();
		const fixed = createTextElement({ id: 'fixed', width: 120, height: 40, text: 'Hello' });
		const explicit = createTextElement({
			id: 'explicit',
			autoGrow: false,
			width: 120,
			height: 40,
			text: 'Hello'
		});
		const locked = createTextElement({
			id: 'locked',
			autoGrow: true,
			locked: true,
			width: 120,
			height: 40,
			text: 'Hello'
		});
		document.slides[0]!.elements = [fixed, explicit, locked];
		store.getState().loadDocument(document);

		store.getState().updateElement('fixed', { width: 80 });
		store.getState().updateElement('explicit', { width: 80 });
		expect(store.getState().document!.slides[0]!.elements[0]!.height).toBe(40);
		expect(store.getState().document!.slides[0]!.elements[1]!.height).toBe(40);

		store.getState().updateElement('locked', { width: 80 });
		expect(store.getState().document!.slides[0]!.elements[2]).toEqual(locked);
		expect(store.getState().shrinkText('locked')).toBe(false);
		expect(store.getState().document!.slides[0]!.elements[2]).toEqual(locked);
	});

	it('rejects an invalid sizing patch before changing document or history', () => {
		const store = createPresentationStore({
			measureText: (text, spec) => (text.length * spec.size) / 2
		});
		const document = createPresentationDocument();
		const text = createTextElement({
			id: 'grow',
			autoGrow: true,
			width: 200,
			height: 40,
			text: 'Hello'
		});
		document.slides[0]!.elements = [text];
		store.getState().loadDocument(document);
		store.getState().updateElement('grow', { width: 120 });
		const before = store.getState().document;
		const history = store.getState().past;
		expect(() => store.getState().updateElement('grow', { width: NaN })).toThrow();
		expect(store.getState().document).toBe(before);
		expect(store.getState().past).toBe(history);
	});

	it('inserts one asset-free layout after the active slide as one undo entry', () => {
		const document = reset();
		const first = document.slides[0]!.id;
		const incoming = createSlide({ name: 'Layout' });
		incoming.elements = [createTextElement({ text: 'Heading' })];
		const before = structuredClone(state().document);
		const id = state().insertSlide(incoming);
		expect(state().document!.slides.map((slide) => slide.id)).toEqual([first, id]);
		expect(state().view.activeSlideId).toBe(id);
		expect(state().past).toHaveLength(1);
		expect(state().dirty).toBe(true);
		state().undo();
		expect(state().document!.slides).toEqual(before!.slides);
		state().redo();
		expect(state().document!.slides[1]).toEqual(incoming);
	});

	it('inserts after a requested slide instead of the active one', () => {
		const document = reset();
		document.slides.push({ ...structuredClone(document.slides[0]!), id: 'second-slide' });
		presentationStore.getState().loadDocument(document, { saved: true });
		state().selectSlide('second-slide');
		const incoming = createSlide({ name: 'Between' });
		const id = state().insertSlide(incoming, document.slides[0]!.id);
		expect(state().document!.slides.map((slide) => slide.id)).toEqual([
			document.slides[0]!.id,
			id,
			'second-slide'
		]);
	});

	it('refuses a slide insertion at the cap without changing document or history', () => {
		const document = reset();
		document.slides = Array.from({ length: PRESENTATION_LIMITS.maxSlides }, (_, index) => ({
			...structuredClone(document.slides[0]!),
			id: `slide-${index}`
		}));
		presentationStore.getState().loadDocument(document, { saved: true });
		const before = state().document;
		const history = state().past;
		expect(state().insertSlide(createSlide({ name: 'Overflow' }))).toBeNull();
		expect(state().document).toBe(before);
		expect(state().past).toBe(history);
	});

	it('throws on invalid slide data before changing document or history', () => {
		const document = reset();
		const before = state().document;
		const history = state().past;
		const duplicate = createSlide({ id: document.slides[0]!.id });
		expect(() => state().insertSlide(duplicate)).toThrow();
		expect(state().document).toBe(before);
		expect(state().past).toBe(history);
	});
});
