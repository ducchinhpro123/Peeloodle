/** Element actions offered from menus: edit a text box, replace a picture. */

import { OK, type Action } from './registry';

export const contentActions: Action[] = [
	{
		id: 'element.editText',
		label: 'Edit text',
		available: (editor) =>
			editor.selection.ids.length === 1 && editor.selection.primary?.kind === 'text',
		enabled: (editor) => !editor.selection.primary?.locked && !editor.selection.editingId,
		run: (editor) => {
			if (editor.selection.primary) editor.selection.startTextEdit(editor.selection.primary.id);
			return OK;
		}
	},
	{
		id: 'element.replacePicture',
		label: 'Replace picture',
		available: (editor) =>
			editor.policy.capabilities.localMedia &&
			editor.selection.ids.length === 1 &&
			editor.selection.primary?.kind === 'image',
		enabled: (editor) => !editor.selection.primary?.locked && !editor.inserts.inserting,
		run: (editor) => {
			if (editor.selection.primary) editor.inserts.beginReplaceImage(editor.selection.primary.id);
			return OK;
		}
	}
];
