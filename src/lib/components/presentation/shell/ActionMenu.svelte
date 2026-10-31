<script>
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import { formatShortcut } from '#lib/presentations/editor/actions/registry.js';

	/** @type {{ items: string[], x: number, y: number, label: string, trigger?: HTMLElement, args?: Record<string, unknown>, onclose: (restore?: boolean) => void }} */
	let { items, x, y, label, trigger = undefined, args = undefined, onclose } = $props();
	const { actions } = getSlideEditor();

	/** @param {HTMLDivElement} node */
	function mount(node) {
		const rect = node.getBoundingClientRect();
		node.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
		node.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
		/** @type {HTMLButtonElement | null} */ (node.querySelector('button:not(:disabled)'))?.focus();
		/** @param {PointerEvent} event */
		const outside = (event) => {
			if (
				event.target instanceof Node &&
				!node.contains(event.target) &&
				!trigger?.contains(event.target)
			)
				onclose(false);
		};
		const dismiss = () => onclose(false);
		window.addEventListener('pointerdown', outside, true);
		window.addEventListener('resize', dismiss);
		window.addEventListener('blur', dismiss);
		return () => {
			window.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('resize', dismiss);
			window.removeEventListener('blur', dismiss);
		};
	}

	/** @param {KeyboardEvent} event */
	function keydown(event) {
		if (event.key === 'F6') {
			onclose(false);
			return;
		}
		if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			onclose();
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const root = /** @type {HTMLDivElement} */ (event.currentTarget);
		const buttons = /** @type {HTMLButtonElement[]} */ (
			Array.from(root.querySelectorAll('button:not(:disabled)'))
		);
		const index = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? buttons.length - 1
					: (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
		buttons[next]?.focus();
	}
</script>

<div
	class="action-menu"
	role="menu"
	aria-label={label}
	tabindex="-1"
	onkeydown={keydown}
	{@attach mount}
>
	{#each items as id (id)}
		{@const action = actions.get(id)}
		{#if actions.isAvailable(id)}
			<button
				type="button"
				role="menuitem"
				disabled={!actions.isEnabled(id, args)}
				onclick={() => {
					actions.run(id, args);
					onclose();
				}}
			>
				<span>{action.shortLabel ?? action.label}</span>
				{#if action.shortcuts?.[0]}<kbd>{formatShortcut(action.shortcuts[0])}</kbd>{/if}
			</button>
		{/if}
	{/each}
</div>

<style>
	.action-menu {
		position: fixed;
		z-index: 100;
		min-inline-size: 220px;
		max-inline-size: calc(100vw - 16px);
		max-block-size: calc(100vh - 16px);
		overflow-y: auto;
		padding: 4px;
		border-radius: 6px;
		background: var(--surface);
		box-shadow: 0 8px 28px oklch(0.2 0.02 264 / 0.22);
		color: var(--ink);
		transform-origin: top left;
	}
	@media (prefers-reduced-motion: no-preference) {
		.action-menu {
			animation: menu-pop var(--dur-fast) var(--ease-out);
		}
		@keyframes menu-pop {
			from {
				opacity: 0;
				transform: scale(0.94) translateY(-4px);
			}
			to {
				opacity: 1;
				transform: none;
			}
		}
	}
	button {
		display: flex;
		inline-size: 100%;
		min-block-size: 32px;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 6px 10px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 12px;
		text-align: start;
		cursor: pointer;
	}
	button:hover,
	button:focus-visible {
		background: var(--pale);
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}
	button:disabled {
		color: var(--muted);
		opacity: 0.6;
		cursor: default;
	}
	kbd {
		color: var(--muted);
		font: inherit;
		font-size: 11px;
		white-space: nowrap;
	}
</style>
