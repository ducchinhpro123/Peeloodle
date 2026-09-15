/**
 * Browser regression for the shared dialog primitive's open/close cycle.
 *
 * A programmatic `dialog.close()` queues its `close` event as a task. When a dialog
 * is re-opened in the same tick — the catalog does exactly that when a card's
 * preview is closed and the next preview is opened immediately, or when the same
 * preview is re-opened right after "Use Template" — that late event used to reach
 * the owning component's `onclose`, which dismissed the *new* opening a moment after
 * it appeared (`TemplateCard.svelte`, reproduced as an intermittent timeout in
 * `src/routes/templates/templates-catalog.svelte.test.ts`). `Modal.svelte` now
 * consumes the queued event of its own close, and this file pins both halves of
 * that contract: the late event is ignored, a user close is still reported, and the
 * programmatic close that follows it is not reported twice.
 */

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Modal from '$lib/components/Modal.svelte';

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

/** Lets the browser deliver the macrotask a native `close` event is queued on. */
const settleCloseEvents = () => new Promise((resolve) => setTimeout(resolve, 120));

describe('modal open/close cycle', () => {
	it('never reports the programmatic close of a dialog it has already re-opened', async () => {
		const closes: string[] = [];
		const rendered = await render(Modal, {
			open: true,
			title: 'Preview',
			onclose: () => closes.push('close')
		});
		const dialog = await waitFor(
			() => rendered.container.querySelector('dialog[open]'),
			'the dialog'
		);

		// Programmatic close, then re-open before the queued `close` event is delivered.
		await rendered.rerender({ open: false });
		await rendered.rerender({ open: true });
		await settleCloseEvents();

		expect(closes).toEqual([]);
		expect(rendered.container.querySelector('dialog[open]')).not.toBeNull();
		expect(dialog).not.toBeNull();
	});

	it('still reports a user close exactly once, not the programmatic close behind it', async () => {
		const closes: string[] = [];
		const rendered = await render(Modal, {
			open: true,
			title: 'Preview',
			onclose: () => closes.push('close')
		});
		await waitFor(() => rendered.container.querySelector('dialog[open]'), 'the dialog');

		const closeButton = rendered.container.querySelector('[data-slot="dialog-close"]');
		if (!(closeButton instanceof HTMLButtonElement)) throw new Error('No close button');
		closeButton.click();
		await waitFor(() => closes.length === 1, 'the user close to reach the owner');

		// The owner's response, as every real caller does it: drive `open` back to false.
		await rendered.rerender({ open: false });
		await settleCloseEvents();

		expect(closes).toEqual(['close']);
		expect(rendered.container.querySelector('dialog[open]')).toBeNull();
	});
});
