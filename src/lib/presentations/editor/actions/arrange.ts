/** Arrange-tab actions for the selected element: stacking order, lock and visibility. */

import { ArrowDown, ArrowUp, Eye, Lock } from 'lucide-svelte';
import { OK, type Action } from './registry';
import type { SlideEditor } from '../createSlideEditor.svelte';

const stackIndex = (editor: SlideEditor) => {
	const slide = editor.selection.activeSlide;
	const id = editor.selection.ids[0];
	return slide && id ? slide.elements.findIndex((element) => element.id === id) : -1;
};

export const arrangeActions: Action[] = [
	{
		id: 'arrange.bringForward',
		label: 'Bring forward',
		icon: ArrowUp,
		enabled: (editor) => {
			const index = stackIndex(editor);
			return index !== -1 && index < (editor.selection.activeSlide?.elements.length ?? 0) - 1;
		},
		run: (editor) => {
			editor.doc.reorderElement(editor.selection.ids[0]!, stackIndex(editor) + 1);
			return OK;
		}
	},
	{
		id: 'arrange.sendBackward',
		label: 'Send backward',
		icon: ArrowDown,
		enabled: (editor) => stackIndex(editor) > 0,
		run: (editor) => {
			editor.doc.reorderElement(editor.selection.ids[0]!, stackIndex(editor) - 1);
			return OK;
		}
	},
	{
		id: 'element.toggleLock',
		label: 'Lock or unlock',
		icon: Lock,
		enabled: (editor) => editor.selection.primary !== null,
		run: (editor) => {
			editor.doc.toggleElementLocked(editor.selection.ids[0]!);
			return OK;
		}
	},
	{
		id: 'element.toggleVisible',
		label: 'Show or hide',
		icon: Eye,
		enabled: (editor) => editor.selection.primary !== null,
		run: (editor) => {
			editor.doc.toggleElementVisible(editor.selection.ids[0]!);
			return OK;
		}
	}
];
