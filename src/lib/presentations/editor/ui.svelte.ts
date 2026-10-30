/**
 * Editor chrome state for one mounted slide editor: the ribbon's tab and
 * collapse, the task pane's sections (remembered on this device) and the open
 * context menu. View state only; nothing here is ever saved in a deck.
 */

import { tick } from 'svelte';
import type { SelectionState } from './selection.svelte';

export type RibbonTab = { id: string; label: string; contextual?: boolean };
export type PaneState = { open: boolean; format: boolean; selection: boolean };
export type ContextMenu = {
	x: number;
	y: number;
	trigger: HTMLElement;
	items: string[];
	label: string;
};

export type EditorUi = {
	ribbon: {
		readonly tab: string;
		readonly collapsed: boolean;
		/** Home, Insert, Design, Arrange, View, plus the contextual tab for the selection. */
		readonly tabs: RibbonTab[];
		/** A tab id, or `toggle:<id>` from a double-click, which also collapses or expands. */
		select(id: string): void;
		toggleCollapsed(): void;
	};
	panes: {
		readonly state: PaneState;
		set(next: PaneState): void;
		/** Shows a closed section, or hides an open one; no sections left closes the pane. */
		toggle(section: 'format' | 'selection'): void;
		/** Opens the Format section and focuses its first field (or the slide background). */
		showFormat(background?: boolean): void;
	};
	/** The slide whose panel button should take focus next (added, moved, survivor). */
	readonly slideFocusRequest: string | null;
	focusSlide(slideId: string): void;
	clearSlideFocus(): void;
	menu: {
		readonly current: ContextMenu | null;
		open(menu: ContextMenu): void;
		/** Closes the menu; `restore` returns focus to where it was opened. */
		close(restore?: boolean): void;
	};
};

export const PANE_KEY = 'stickerlab_slide_editor_pane';

function readPaneState(): PaneState {
	const fallback = { open: true, format: true, selection: true };
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const stored = JSON.parse(localStorage.getItem(PANE_KEY) ?? 'null');
		if (
			stored &&
			typeof stored.open === 'boolean' &&
			typeof stored.format === 'boolean' &&
			typeof stored.selection === 'boolean'
		)
			return stored;
	} catch {
		// A corrupt preference falls back to the default layout.
	}
	return fallback;
}

export function createEditorUi(selection: SelectionState): EditorUi {
	let tab = $state('home');
	let collapsed = $state(false);
	let panes = $state<PaneState>(readPaneState());
	let menu = $state<ContextMenu | null>(null);
	let slideFocus = $state<string | null>(null);

	const setPanes = (next: PaneState) => {
		panes = next;
		try {
			localStorage.setItem(PANE_KEY, JSON.stringify(next));
		} catch {
			// Storage can be unavailable (private mode); the layout still applies now.
		}
	};

	return {
		ribbon: {
			get tab() {
				return tab;
			},
			get collapsed() {
				return collapsed;
			},
			get tabs() {
				return [
					{ id: 'home', label: 'Home' },
					{ id: 'insert', label: 'Insert' },
					{ id: 'design', label: 'Design' },
					{ id: 'arrange', label: 'Arrange' },
					{ id: 'view', label: 'View' },
					...(selection.primary?.kind === 'shape'
						? [{ id: 'shapeFormat', label: 'Shape Format', contextual: true }]
						: []),
					...(selection.primary?.kind === 'image'
						? [{ id: 'pictureFormat', label: 'Picture Format', contextual: true }]
						: [])
				];
			},
			select(id) {
				if (id.startsWith('toggle:')) {
					tab = id.slice('toggle:'.length);
					collapsed = !collapsed;
					return;
				}
				tab = id;
				collapsed = false;
			},
			toggleCollapsed() {
				collapsed = !collapsed;
			}
		},
		panes: {
			get state() {
				return panes;
			},
			set: setPanes,
			toggle(section) {
				if (!panes.open) {
					setPanes({ ...panes, open: true, [section]: true });
					return;
				}
				const next = { ...panes, [section]: !panes[section] };
				setPanes({ ...next, open: next.format || next.selection });
			},
			showFormat(background = false) {
				setPanes({ ...panes, open: true, format: true });
				void tick().then(() => {
					const selector = background
						? '.presentation-slide-background input'
						: '.presentation-geometry-fields input';
					document.querySelector<HTMLInputElement>(selector)?.focus();
				});
			}
		},
		get slideFocusRequest() {
			return slideFocus;
		},
		focusSlide(slideId) {
			slideFocus = slideId;
		},
		clearSlideFocus() {
			slideFocus = null;
		},
		menu: {
			get current() {
				return menu;
			},
			open(next) {
				menu = next;
			},
			close(restore = true) {
				const trigger = menu?.trigger;
				menu = null;
				if (!restore) return;
				if (trigger?.isConnected) trigger.focus();
				else
					document
						.querySelector<HTMLButtonElement>('.presentation-slide-card[aria-current="true"]')
						?.focus();
			}
		}
	};
}
