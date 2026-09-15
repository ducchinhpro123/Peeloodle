/**
 * Regression for the canvas Space-pan shortcut.
 *
 * The source canvas ignored Space while a dialog was open. The Svelte port kept
 * handling it globally, so pressing Space on a focused dialog button was
 * prevented and switched the canvas into pan mode instead of activating the
 * button. Space must stay with the canvas only when no dialog is open and the
 * focused target is not an interactive control.
 */

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import KonvaArtboard from './KonvaArtboard.svelte';
import Modal from './Modal.svelte';
import { createEditorState } from '$lib/editor/editorState.svelte';

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 4000
): Promise<T> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/** Dispatches a real bubbling Space key event; returns it so `defaultPrevented` is checkable. */
function pressSpace(target: EventTarget, type: 'keydown' | 'keyup' = 'keydown') {
	const event = new KeyboardEvent(type, {
		key: ' ',
		code: 'Space',
		bubbles: true,
		cancelable: true
	});
	target.dispatchEvent(event);
	return event;
}

describe('canvas Space shortcut', () => {
	it('pans for the canvas but leaves Space to dialogs and interactive controls', async () => {
		const editor = createEditorState();
		editor.createDraft('p1');
		const canvas = await render(KonvaArtboard, { editor, urls: {}, domFallback: false });
		const host = await waitFor(
			() =>
				canvas.container.querySelector<HTMLElement>('.artboard-host[data-testid="editor-canvas"]'),
			'the Konva artboard host'
		);
		if (!host) throw new Error('The Konva artboard host is missing');

		// Control: with no dialog and no interactive focus, Space still enters pan mode.
		const canvasPress = pressSpace(document.body);
		expect(canvasPress.defaultPrevented).toBe(true);
		await waitFor(() => host.hasAttribute('data-space-pan'), 'the canvas space-pan state');
		pressSpace(document.body, 'keyup');
		await waitFor(() => !host.hasAttribute('data-space-pan'), 'the released pan state');

		// A plain interactive target outside a dialog keeps its own Space handling.
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		const outsidePress = pressSpace(outside);
		expect(outsidePress.defaultPrevented).toBe(false);
		expect(host.hasAttribute('data-space-pan')).toBe(false);
		outside.remove();

		// Inside an open dialog the shortcut must stand down entirely: this is the
		// export/properties/navigation case that used to steal button activation.
		const modal = await render(Modal, { open: true, title: 'Export & Share' });
		await waitFor(() => modal.container.querySelector('dialog[open]'), 'the open dialog');
		const close = modal.container.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
		if (!close) throw new Error('The dialog close button is missing');
		close.focus();
		const dialogPress = pressSpace(close);
		expect(dialogPress.defaultPrevented).toBe(false);
		expect(host.hasAttribute('data-space-pan')).toBe(false);
		pressSpace(close, 'keyup');
	});
});
