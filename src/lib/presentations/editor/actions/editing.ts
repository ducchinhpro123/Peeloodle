/** History, clipboard and element actions shared by the toolbar, the layer list and the keyboard. */

import { ClipboardPaste, Copy, Redo2, Trash2, Undo2 } from 'lucide-svelte';
import { OK, type Action } from './registry';

const targetId = (args: Record<string, unknown> | undefined, fallback: string | undefined) =>
	typeof args?.elementId === 'string' ? args.elementId : fallback;

export const editingActions: Action[] = [
	{
		id: 'history.undo',
		label: 'Undo',
		icon: Undo2,
		shortcuts: [{ key: 'z', mod: true }],
		claimsShortcut: true,
		enabled: (editor) => editor.doc.canUndo,
		run: (editor) => {
			editor.doc.undo();
			return OK;
		}
	},
	{
		id: 'history.redo',
		label: 'Redo',
		icon: Redo2,
		shortcuts: [
			{ key: 'z', mod: true, shift: true },
			{ key: 'y', mod: true },
			{ key: 'y', mod: true, shift: true }
		],
		claimsShortcut: true,
		enabled: (editor) => editor.doc.canRedo,
		run: (editor) => {
			editor.doc.redo();
			return OK;
		}
	},
	{
		id: 'clipboard.copy',
		label: 'Copy element',
		shortLabel: 'Copy',
		icon: Copy,
		shortcuts: [{ key: 'c', mod: true }],
		enabled: (editor) => editor.selection.primary !== null && !editor.selection.editingId,
		run: (editor) => {
			editor.clipboard.copy();
			return OK;
		}
	},
	{
		id: 'clipboard.paste',
		label: 'Paste element',
		shortLabel: 'Paste',
		icon: ClipboardPaste,
		shortcuts: [{ key: 'v', mod: true }],
		enabled: (editor) => editor.clipboard.canPaste && !editor.selection.editingId,
		run: (editor) => {
			const result = editor.clipboard.paste();
			if (result.ok) editor.messages.clear();
			return result;
		}
	},
	{
		id: 'element.duplicate',
		label: 'Duplicate element',
		icon: Copy,
		shortcuts: [{ key: 'd', mod: true }],
		enabled: (editor, args) => targetId(args, editor.selection.ids[0]) !== undefined,
		run: (editor, args) => {
			// A layer row names its own element; the keyboard and ribbon act on the
			// whole selection.
			if (typeof args?.elementId === 'string') editor.doc.duplicateElement(args.elementId);
			else if (editor.selection.ids.length > 1) editor.doc.duplicateElements(editor.selection.ids);
			else if (editor.selection.ids[0]) editor.doc.duplicateElement(editor.selection.ids[0]);
			return OK;
		}
	},
	{
		id: 'element.delete',
		label: 'Delete element',
		icon: Trash2,
		shortcuts: [{ key: 'Delete' }, { key: 'Backspace' }],
		// The keyboard acts on the selection, never while text is being edited; a layer
		// row names its own element.
		enabled: (editor, args) =>
			typeof args?.elementId === 'string' ||
			(editor.selection.ids.length > 0 && !editor.selection.editingId),
		run: (editor, args) => {
			if (typeof args?.elementId === 'string') editor.doc.removeElement(args.elementId);
			else if (editor.selection.ids.length > 1) editor.doc.removeElements(editor.selection.ids);
			else if (editor.selection.ids[0]) editor.doc.removeElement(editor.selection.ids[0]);
			return OK;
		}
	},
	{
		id: 'selection.selectAll',
		label: 'Select all',
		shortcuts: [{ key: 'a', mod: true }],
		enabled: (editor) =>
			(editor.selection.activeSlide?.elements.length ?? 0) > 0 && !editor.selection.editingId,
		run: (editor) => {
			editor.selection.select(
				(editor.selection.activeSlide?.elements ?? [])
					.filter((element) => element.visible)
					.map((element) => element.id)
			);
			return OK;
		}
	},
	{
		id: 'selection.clear',
		label: 'Clear selection',
		shortcuts: [{ key: 'Escape' }],
		enabled: (editor) => editor.selection.ids.length > 0,
		run: (editor) => {
			editor.selection.clear();
			return OK;
		}
	}
];
