/** Arrange-tab actions for the selected element: stacking order, lock and visibility. */

import { ArrowDown, ArrowUp, Eye, Lock } from 'lucide-svelte';
import { alignToSlide } from '../alignmentGuides';
import { elementGeometry } from '../transformGeometry';
import { OK, type Action } from './registry';
import type { SlideEditor } from '../createSlideEditor.svelte';

function canReorder(editor: SlideEditor, direction: 1 | -1) {
	const elements = editor.selection.activeSlide?.elements ?? [];
	const ids = editor.selection.ids;
	return (
		!editor.selection.editingId &&
		elements.some(
			(element, index) =>
				ids.includes(element.id) &&
				elements[index + direction] &&
				!ids.includes(elements[index + direction]!.id)
		)
	);
}

export const arrangeActions: Action[] = [
	{
		id: 'arrange.bringForward',
		label: 'Bring forward',
		icon: ArrowUp,
		enabled: (editor) => canReorder(editor, 1),
		run: (editor) => {
			editor.doc.reorderElements(editor.selection.ids, 'forward');
			return OK;
		}
	},
	{
		id: 'arrange.sendBackward',
		label: 'Send backward',
		icon: ArrowDown,
		enabled: (editor) => canReorder(editor, -1),
		run: (editor) => {
			editor.doc.reorderElements(editor.selection.ids, 'backward');
			return OK;
		}
	},
	{
		id: 'element.toggleLock',
		label: 'Lock or unlock',
		icon: Lock,
		enabled: (editor) => editor.selection.ids.length === 1 && editor.selection.primary !== null,
		run: (editor) => {
			editor.doc.toggleElementLocked(editor.selection.ids[0]!);
			return OK;
		}
	},
	{
		id: 'element.toggleVisible',
		label: 'Show or hide',
		icon: Eye,
		enabled: (editor) => editor.selection.ids.length === 1 && editor.selection.primary !== null,
		run: (editor) => {
			editor.doc.toggleElementVisible(editor.selection.ids[0]!);
			return OK;
		}
	}
];

/** One element aligns to the slide; several align within the selection frame. */
export const alignmentOptions = [
	{ key: 'left', label: 'Align left' },
	{ key: 'center-horizontal', label: 'Align center' },
	{ key: 'right', label: 'Align right' },
	{ key: 'top', label: 'Align top' },
	{ key: 'middle-vertical', label: 'Align middle' },
	{ key: 'bottom', label: 'Align bottom' }
] as const;

for (const option of alignmentOptions) {
	arrangeActions.push({
		id: `align.${option.key}`,
		label: option.label,
		enabled: (editor, args) =>
			!editor.selection.editingId && targets(editor, args).some((element) => !element.locked),
		run: (editor, args) => {
			const elements = targets(editor, args);
			const page = editor.doc.document?.pageSize;
			if (!page || !elements.length) return OK;
			const x = Math.min(...elements.map((element) => element.x));
			const y = Math.min(...elements.map((element) => element.y));
			const width = Math.max(...elements.map((element) => element.x + element.width)) - x;
			const height = Math.max(...elements.map((element) => element.y + element.height)) - y;
			const toSelection = args?.reference !== 'slide' && elements.length > 1;
			const geometries = Object.fromEntries(
				elements
					.filter((element) => !element.locked)
					.map((element) => {
						const geometry = elementGeometry(element, null);
						const position = alignToSlide(
							toSelection ? { ...geometry, x: geometry.x - x, y: geometry.y - y } : geometry,
							toSelection ? { width, height } : page,
							option.key
						);
						return [
							element.id,
							{
								...geometry,
								x: position.x + (toSelection ? x : 0),
								y: position.y + (toSelection ? y : 0)
							}
						];
					})
			);
			editor.doc.commitTransforms(geometries);
			return OK;
		}
	});
}

function targets(editor: SlideEditor, args?: Record<string, unknown>) {
	const ids = typeof args?.elementId === 'string' ? [args.elementId] : editor.selection.ids;
	return (editor.selection.activeSlide?.elements ?? []).filter((element) =>
		ids.includes(element.id)
	);
}

export const distributionOptions = [
	{ key: 'horizontal', label: 'Distribute horizontally' },
	{ key: 'vertical', label: 'Distribute vertically' }
] as const;

for (const option of distributionOptions) {
	arrangeActions.push({
		id: `distribute.${option.key}`,
		label: option.label,
		enabled: (editor) =>
			!editor.selection.editingId &&
			targets(editor).length >= 3 &&
			targets(editor).some((element) => !element.locked),
		run: (editor) => {
			const axis = option.key === 'horizontal' ? 'x' : 'y';
			const size = option.key === 'horizontal' ? 'width' : 'height';
			const elements = [...targets(editor)].sort((a, b) => a[axis] - b[axis]);
			if (elements.length < 3) return OK;
			// Outer objects and locked objects are anchors. Equal gaps are computed
			// independently between anchors so a locked object never drifts.
			const anchors = elements.flatMap((element, index) =>
				index === 0 || index === elements.length - 1 || element.locked ? [index] : []
			);
			const geometries: Record<string, import('../transformGeometry').TransformGeometry> = {};
			for (let i = 1; i < anchors.length; i++) {
				const start = anchors[i - 1]!,
					end = anchors[i]!;
				const first = elements[start]!,
					last = elements[end]!;
				const occupied = elements
					.slice(start, end)
					.reduce((sum, element) => sum + element[size], 0);
				const gap = (last[axis] - first[axis] - occupied) / (end - start);
				let position = first[axis] + first[size] + gap;
				for (let index = start + 1; index < end; index++) {
					const element = elements[index]!;
					if (Math.abs(element[axis] - position) > 0.0001)
						geometries[element.id] = { ...elementGeometry(element, null), [axis]: position };
					position += element[size] + gap;
				}
			}
			editor.doc.commitTransforms(geometries);
			return OK;
		}
	});
}
