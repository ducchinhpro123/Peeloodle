<script>
	import { buttonIconLarge } from '#lib/ui/styles.js';
	/**
	 * Accessible modal built on the native `&lt;dialog&gt;` element, which provides
	 * the focus trap, Escape handling and focus restoration the React source got
	 * from Radix. Markup keeps the source contract (`.dialog`, `.dialog-scroll`,
	 * `data-slot="dialog-title"`) so the shared stylesheet applies unchanged.
	 */
	import { X } from 'lucide-svelte';

	/** @type {{
	 *   open?: boolean,
	 *   closeDisabled?: boolean,
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
		closeDisabled = false,
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
		if (!closeDisabled) onclose?.();
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
	oncancel={(event) => {
		if (closeDisabled) event.preventDefault();
	}}
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
			<div
				class="dialog-footer [display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:var(--space-3)] [padding-top:var(--space-5)] [border-top:1px_solid_var(--line)]"
			>
				{@render footer()}
			</div>
		{/if}
	</div>
	<button
		type="button"
		class={[buttonIconLarge, 'close']}
		data-slot="dialog-close"
		aria-label="Close dialog"
		disabled={closeDisabled}
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

	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.dialog {
		position: fixed;
		z-index: 21;
		background: #fff;
		box-shadow: 0 24px 80px #08152f33;
	}
	.dialog {
		top: 50%;
		left: 50%;
		width: calc(100% - 32px);
		max-width: 520px;
		max-height: calc(100dvh - 32px);
		overflow: hidden;
		border: 1px solid #fff;
		border-radius: 24px;
		transform: translate(-50%, -50%);
	}
	.dialog-scroll {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		overflow-wrap: anywhere;
		max-height: calc(100dvh - 34px);
		padding: var(--space-6);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		background: linear-gradient(#eefaf3, #fff 120px);
	}
	.dialog [data-slot='dialog-title'] {
		margin: 0;
		padding-right: 40px;
		color: var(--ink);
		font-size: 24px;
		line-height: 1.25;
		letter-spacing: -0.04em;
		overflow-wrap: anywhere;
	}
	.dialog [data-slot='dialog-description'] {
		margin: -12px 0 0;
		color: var(--muted);
		font-size: 14px;
		line-height: 1.65;
	}
	:global(.dialog form) {
		display: grid;
		gap: var(--space-5);
	}
	:global(.dialog [role='alert']) {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--cream);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	:global(.dialog [role='status']) {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--cream);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.dialog .pack-stickers-list {
		max-height: 300px;
		margin: 0;
	}
	.dialog .pack-sticker-row {
		min-height: 48px;
	}
	.dialog .inspector {
		padding: 0;
		border: 0;
	}
	:global(.dialog .inspector > h2) {
		display: none;
	}
	.close {
		position: absolute;
		top: 12px;
		right: 12px;
	}
	.dialog .button.icon.close {
		background: #fff;
		border: 1px solid var(--line);
		border-radius: 50%;
	}
	@media (prefers-reduced-motion: no-preference) {
		.dialog[data-state='open'] {
			animation: reveal 180ms ease-out;
		}
		@keyframes -global-reveal {
			from {
				opacity: 0;
			}
			to {
				opacity: 1;
			}
		}
	}
	@media (max-width: 720px) {
		.dialog-scroll {
			padding: var(--space-5);
		}
		.dialog [data-slot='dialog-title'] {
			font-size: 22px;
		}
		:global(.dialog-footer .button) {
			flex: 1 1 auto;
		}
	}
</style>
