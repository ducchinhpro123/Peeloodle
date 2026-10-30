/** View-tab and pane actions: fit, ribbon collapse, Format and Selection panes. */

import { OK, type Action } from './registry';

export const viewActions: Action[] = [
	{
		id: 'view.fit',
		label: 'Fit to window',
		enabled: () => true,
		run: (editor) => {
			editor.viewport.setZoom(1);
			editor.viewport.setPan({ x: 0, y: 0 });
			return OK;
		}
	},
	{
		id: 'view.formatPane',
		label: 'Format pane',
		enabled: () => true,
		run: (editor) => {
			editor.ui.panes.toggle('format');
			return OK;
		}
	},
	{
		id: 'view.selectionPane',
		label: 'Selection pane',
		enabled: () => true,
		run: (editor) => {
			editor.ui.panes.toggle('selection');
			return OK;
		}
	},
	{
		id: 'view.toggleRibbon',
		label: 'Collapse ribbon',
		shortLabel: 'Collapse ribbon',
		shortcuts: [{ key: 'F1', mod: true }],
		enabled: () => true,
		run: (editor) => {
			editor.ui.ribbon.toggleCollapsed();
			return OK;
		}
	},
	{
		id: 'element.format',
		label: 'Format…',
		enabled: (editor) => editor.selection.primary !== null,
		run: (editor) => {
			editor.ui.panes.showFormat();
			return OK;
		}
	},
	{
		id: 'slide.formatBackground',
		label: 'Format background…',
		enabled: (editor) => editor.selection.activeSlide !== undefined,
		run: (editor) => {
			editor.ui.panes.showFormat(true);
			return OK;
		}
	}
];
