/** Slide actions shared by the ribbon, the slide panel's keys and menus, and Ctrl+M. */

import { PRESENTATION_LIMITS } from '../../model/limits';
import { OK, type Action } from './registry';
import type { SlideEditor } from '../createSlideEditor.svelte';

const slideIndex = (editor: SlideEditor, id = editor.selection.activeSlideId) =>
	editor.doc.document?.slides.findIndex((slide) => slide.id === id) ?? -1;
const canAdd = (editor: SlideEditor) =>
	(editor.doc.document?.slides.length ?? 0) < PRESENTATION_LIMITS.maxSlides;

export const slideActions: Action[] = [
	{
		id: 'slide.add',
		label: 'Add slide',
		shortcuts: [{ key: 'm', mod: true }],
		claimsShortcut: true,
		enabled: canAdd,
		run: (editor) => {
			const id = editor.doc.addSlide();
			if (id) editor.ui.focusSlide(id);
			return OK;
		}
	},
	{
		id: 'slide.duplicate',
		label: 'Duplicate slide',
		enabled: (editor) => editor.selection.activeSlide !== undefined && canAdd(editor),
		run: (editor) => {
			const active = editor.selection.activeSlideId;
			const id = active ? editor.doc.duplicateSlide(active) : null;
			if (id) editor.ui.focusSlide(id);
			return OK;
		}
	},
	{
		id: 'slide.delete',
		label: 'Delete slide',
		enabled: (editor) => (editor.doc.document?.slides.length ?? 0) > 1,
		// A slide's own delete button names it; otherwise the active slide goes.
		run: (editor, args) => {
			const id = typeof args?.slideId === 'string' ? args.slideId : editor.selection.activeSlideId;
			if (id && editor.doc.removeSlide(id) && editor.selection.activeSlideId)
				editor.ui.focusSlide(editor.selection.activeSlideId);
			return OK;
		}
	},
	...(['up', 'down'] as const).map((direction): Action => ({
		id: direction === 'up' ? 'slide.moveUp' : 'slide.moveDown',
		label: direction === 'up' ? 'Move up' : 'Move down',
		enabled: (editor) => {
			const index = slideIndex(editor);
			const count = editor.doc.document?.slides.length ?? 0;
			return index >= 0 && (direction === 'up' ? index > 0 : index < count - 1);
		},
		run: (editor) => {
			const id = editor.selection.activeSlideId;
			const index = slideIndex(editor);
			if (id && index >= 0) {
				editor.doc.reorderSlide(id, index + (direction === 'up' ? -1 : 1));
				editor.ui.focusSlide(id);
			}
			return OK;
		}
	}))
];
