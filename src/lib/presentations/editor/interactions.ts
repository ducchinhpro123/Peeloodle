/**
 * The editor's document-level wiring: native copy/cut/paste (which carry
 * system clipboard formats without read permission), right-click and keyboard
 * context menus for slides and the element list, F6 region navigation, and
 * what pasted text or pictures become.
 */

import { attachFocusNavigation } from './focusNavigation';
import { createPresetText } from './textPresets';
import type { SlideEditor } from './createSlideEditor.svelte';

/** Typing here keeps the browser's own keys; native <dialog> has no role, so it is listed by tag. */
export const SHORTCUT_EXEMPT =
	'input, textarea, select, [contenteditable="true"], [role="slider"], [data-slot="slider"], [role="dialog"], dialog, [role="menu"]';

export const ELEMENT_MENU_ITEMS = [
	'clipboard.cut',
	'clipboard.copy',
	'clipboard.paste',
	'element.duplicate',
	'element.delete',
	'arrange.bringForward',
	'arrange.sendBackward',
	'element.toggleLock',
	'element.editText',
	'element.replacePicture',
	'element.format',
	'align.left',
	'align.center-horizontal',
	'align.right',
	'align.top',
	'align.middle-vertical',
	'align.bottom',
	'distribute.horizontal',
	'distribute.vertical'
];
const CANVAS_MENU_ITEMS = [
	'clipboard.paste',
	'selection.selectAll',
	'slide.add',
	'slide.formatBackground'
];
const SLIDE_MENU_ITEMS = [
	'slide.add',
	'slide.duplicate',
	'slide.delete',
	'slide.moveUp',
	'slide.moveDown'
];

/** The canvas's menu: element actions with a selection, canvas actions without. */
export function openCanvasMenu(editor: SlideEditor, x: number, y: number, trigger: HTMLElement) {
	const elements = editor.selection.ids.length > 0;
	editor.ui.menu.open({
		x,
		y,
		trigger,
		items: elements ? ELEMENT_MENU_ITEMS : CANVAS_MENU_ITEMS,
		label: elements ? 'Element actions' : 'Canvas actions'
	});
}

/** Pasted plain text becomes a body text box; a pasted picture is inserted like an upload. */
export function configureClipboardPaste(editor: SlideEditor) {
	const { doc, selection, messages, policy, inserts } = editor;
	editor.clipboard.configure({
		text(value) {
			const document = doc.document;
			if (!document || !selection.activeSlide) return;
			try {
				const id = doc.addElement(createPresetText('body', document.theme, value));
				if (!id) messages.show('This slide cannot hold another text box. Remove an element first.');
			} catch {
				messages.show('This text could not be pasted. Try copying a shorter passage.');
			}
		},
		image(file) {
			if (!policy.capabilities.localMedia) {
				messages.show('Paste images from the catalog when editing a template.');
				return;
			}
			return inserts.addImage(file);
		}
	});
}

export function attachEditorInteractions(root: HTMLElement, editor: SlideEditor): () => void {
	const { ui, selection, text, messages, clipboard } = editor;
	const detachFocus = attachFocusNavigation(root, () => {
		ui.menu.close(false);
		text.flush();
		selection.endTextEdit();
	});
	const belongsToEditor = (target: EventTarget | null) =>
		target instanceof Node && (target === document.body || root.contains(target));
	const exempt = (target: EventTarget | null) =>
		target instanceof HTMLElement && target.closest(SHORTCUT_EXEMPT) !== null;

	const paste = (event: ClipboardEvent) => {
		if (event.defaultPrevented || !belongsToEditor(event.target) || exempt(event.target)) return;
		if (!event.clipboardData) return;
		event.preventDefault();
		messages.clear();
		clipboard.pasteData(event.clipboardData);
	};
	const copy = (event: ClipboardEvent) => {
		if (event.defaultPrevented || !belongsToEditor(event.target) || exempt(event.target)) return;
		if (event.clipboardData && clipboard.copy(event.type === 'cut', event.clipboardData))
			event.preventDefault();
	};
	const menu = (event: MouseEvent | KeyboardEvent) => {
		if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
		if (
			event instanceof KeyboardEvent &&
			event.key !== 'ContextMenu' &&
			!(event.key === 'F10' && event.shiftKey)
		)
			return;
		const slide = event.target.closest('.presentation-slide-card');
		const layer = event.target.closest('.presentation-layer-item');
		if (!slide && !layer) return;
		event.preventDefault();
		const trigger = (slide ?? layer?.querySelector('.presentation-layer-select')) as HTMLElement;
		if (slide) {
			const id = slide.getAttribute('data-slide-id');
			if (id) selection.selectSlide(id);
		} else {
			const id = layer?.getAttribute('data-element-id');
			if (id && !selection.ids.includes(id)) selection.select([id]);
		}
		const rect = trigger.getBoundingClientRect();
		const pointer = event instanceof MouseEvent && event.button === 2;
		ui.menu.open({
			x: pointer ? event.clientX : rect.left + 12,
			y: pointer ? event.clientY : rect.top + 12,
			trigger,
			items: slide ? SLIDE_MENU_ITEMS : ELEMENT_MENU_ITEMS,
			label: slide ? 'Slide actions' : 'Element actions'
		});
	};

	document.addEventListener('copy', copy);
	document.addEventListener('cut', copy);
	document.addEventListener('paste', paste);
	root.addEventListener('contextmenu', menu);
	root.addEventListener('keydown', menu);
	return () => {
		detachFocus();
		document.removeEventListener('copy', copy);
		document.removeEventListener('cut', copy);
		document.removeEventListener('paste', paste);
		root.removeEventListener('contextmenu', menu);
		root.removeEventListener('keydown', menu);
	};
}
