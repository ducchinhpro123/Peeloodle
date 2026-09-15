<script>
	/**
	 * Accessible modal built on the native `&lt;dialog&gt;` element, which provides
	 * the focus trap, Escape handling and focus restoration the React source got
	 * from Radix. Markup keeps the source contract (`.dialog`, `.dialog-scroll`,
	 * `data-slot="dialog-title"`) so the shared stylesheet applies unchanged.
	 */
	import { X } from 'lucide-svelte';

	/** @type {{
	 *   open?: boolean,
	 *   title: string,
	 *   description?: string,
	 *   onclose?: () => void,
	 *   onclosed?: () => void,
	 *   children?: import('svelte').Snippet,
	 *   footer?: import('svelte').Snippet,
	 *   focusOnOpen?: () => HTMLElement | null | undefined,
	 * }} */
	let {
		open = false,
		title,
		description = undefined,
		onclose = undefined,
		onclosed = undefined,
		children,
		footer,
		focusOnOpen = undefined
	} = $props();

	// Unique per instance: several modals are mounted at once (navigation, walkthrough,
	// export, properties), so a fixed `dialog-title` id would let a later dialog's
	// aria-labelledby resolve to an earlier dialog's heading.
	const uid = $props.id();
	const titleId = `${uid}-title`;
	const descriptionId = `${uid}-description`;

	/** @type {HTMLDialogElement | undefined} */
	let dialog;

	/**
	 * True between a programmatic `dialog.close()` and the `close` event it queues.
	 * That event is delivered as a task, so without this flag a dialog that is
	 * re-opened in the same tick is dismissed again by the previous close — the
	 * catalog's two quick preview → close → preview cycles hit exactly that, and the
	 * reopened dialog closed itself a moment after appearing.
	 */
	let closingProgrammatically = false;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			focusOnOpen?.()?.focus();
		} else if (!open && dialog.open) {
			closingProgrammatically = true;
			dialog.close();
		}
	});

	function close() {
		// Consume the queued event of our own `dialog.close()`; a user-initiated close
		// (Escape, backdrop, close button) still reaches `onclose`.
		if (closingProgrammatically) {
			// The dialog is gone for both paths here: a programmatic close arrives
			// directly, a user close after its owner applied `open = false`. `onclosed`
			// is therefore the one place a caller can restore fallback focus.
			closingProgrammatically = false;
			onclosed?.();
			return;
		}
		onclose?.();
	}
</script>

<dialog
	bind:this={dialog}
	class="dialog"
	data-slot="dialog-content"
	data-state={open ? 'open' : 'closed'}
	aria-labelledby={titleId}
	aria-describedby={description ? descriptionId : undefined}
	onclose={close}
	onclick={(event) => {
		// Clicking the backdrop (the dialog element itself) dismisses.
		if (event.target === dialog) close();
	}}
>
	<div class="dialog-scroll">
		<h2 data-slot="dialog-title" id={titleId}>{title}</h2>
		{#if description}
			<p data-slot="dialog-description" id={descriptionId}>{description}</p>
		{/if}
		{#if children}
			{@render children()}
		{/if}
		{#if footer}
			<div class="dialog-footer">{@render footer()}</div>
		{/if}
	</div>
	<button
		type="button"
		class="button icon close"
		data-slot="dialog-close"
		aria-label="Close dialog"
		onclick={close}
	>
		<X size={18} />
	</button>
</dialog>

<style>
	dialog.dialog {
		padding: 0;
	}
	dialog.dialog::backdrop {
		background: #102c2866;
		backdrop-filter: blur(5px);
	}
</style>
