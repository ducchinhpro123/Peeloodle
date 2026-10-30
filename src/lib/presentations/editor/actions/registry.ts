/**
 * One registry for every editor command that a button, a keyboard shortcut or
 * (later) a context menu can trigger, so all three share the same label,
 * shortcut and enabled state.
 */

import type { Icon as LucideIcon } from 'lucide-svelte';
import type { SlideEditor } from '../createSlideEditor.svelte';

/** `mod` is Ctrl, or Cmd on Apple platforms. Unset modifiers must not be held. */
export type Shortcut = { key: string; mod?: boolean; shift?: boolean; alt?: boolean };

export type ActionResult = { ok: true } | { ok: false; reason: string; message: string };

export const OK: ActionResult = { ok: true };

export type Action = {
	id: string;
	/** Accessible name; also the tooltip text before the shortcut. */
	label: string;
	/** Visible button text when it differs from the accessible name. */
	shortLabel?: string;
	icon?: typeof LucideIcon;
	/** The first shortcut is the one shown in tooltips. */
	shortcuts?: Shortcut[];
	/**
	 * Keep the browser from handling the shortcut even while the action is
	 * disabled (Ctrl+Y and Ctrl+Z have no useful default in the editor).
	 */
	claimsShortcut?: boolean;
	/** Hidden when false: the editor's policy does not offer it. */
	available?(editor: SlideEditor): boolean;
	/** Disabled when false: not possible in the current state. */
	enabled(editor: SlideEditor, args?: Record<string, unknown>): boolean;
	run(editor: SlideEditor, args?: Record<string, unknown>): ActionResult;
};

export type ActionRegistry = {
	get(id: string): Action;
	isAvailable(id: string): boolean;
	isEnabled(id: string, args?: Record<string, unknown>): boolean;
	/** Runs an available, enabled action; a refusal is reported to the message bar. */
	run(id: string, args?: Record<string, unknown>): ActionResult;
	/** The action whose shortcut this key event presses, if any. */
	match(event: KeyboardEvent): Action | undefined;
};

const isApple = () =>
	typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Ctrl+Shift+Z" on Windows/Linux, "⌘⇧Z" on Apple platforms. */
export function formatShortcut(shortcut: Shortcut): string {
	const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
	if (isApple()) {
		return `${shortcut.mod ? '⌘' : ''}${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${key}`;
	}
	return [shortcut.mod && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', key]
		.filter(Boolean)
		.join('+');
}

function pressed(shortcut: Shortcut, event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === shortcut.key.toLowerCase() &&
		(event.ctrlKey || event.metaKey) === Boolean(shortcut.mod) &&
		event.shiftKey === Boolean(shortcut.shift) &&
		event.altKey === Boolean(shortcut.alt)
	);
}

export function createActionRegistry(
	editor: SlideEditor,
	actions: Action[],
	report: (message: string) => void
): ActionRegistry {
	const byId = new Map(actions.map((action) => [action.id, action]));
	const get = (id: string) => {
		const action = byId.get(id);
		if (!action) throw new Error(`Unknown editor action: ${id}`);
		return action;
	};
	const isAvailable = (id: string) => get(id).available?.(editor) ?? true;
	const isEnabled = (id: string, args?: Record<string, unknown>) =>
		isAvailable(id) && get(id).enabled(editor, args);
	return {
		get,
		isAvailable,
		isEnabled,
		run(id, args) {
			if (!isEnabled(id, args)) return { ok: false, reason: 'disabled', message: '' };
			const result = get(id).run(editor, args);
			if (!result.ok && result.message) report(result.message);
			return result;
		},
		match(event) {
			return actions.find((action) => action.shortcuts?.some((s) => pressed(s, event)));
		}
	};
}
