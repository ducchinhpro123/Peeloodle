<script>
	import { X } from 'lucide-svelte';

	/**
	 * The editor's right-hand task pane, like PowerPoint's Format and Selection
	 * panes. Both sections can be shown together; each is toggled from the View
	 * tab and the whole pane closes with ✕.
	 *
	 * @type {{
	 *   showFormat: boolean,
	 *   showSelection: boolean,
	 *   onclose: () => void,
	 *   format: import('svelte').Snippet,
	 *   selection: import('svelte').Snippet
	 * }}
	 */
	let { showFormat, showSelection, onclose, format, selection } = $props();
</script>

<aside class="task-pane" aria-label="Task pane">
	<div class="task-pane-header">
		<span>{showFormat ? 'Format' : 'Selection'}</span>
		<button type="button" class="task-pane-close" aria-label="Close task pane" onclick={onclose}
			><X size={16} aria-hidden="true" /></button
		>
	</div>
	{#if showFormat}
		<section class="task-pane-section" aria-label="Format">
			{@render format()}
		</section>
	{/if}
	{#if showSelection}
		<section class="task-pane-section" aria-label="Selection">
			<h2>Selection</h2>
			{@render selection()}
		</section>
	{/if}
</aside>

<style>
	.task-pane {
		display: flex;
		min-block-size: 0;
		flex-direction: column;
		border-inline-start: 1px solid oklch(0.9 0.006 264);
		background: var(--surface);
		overflow-y: auto;
		scrollbar-width: thin;
		scroll-padding-block-start: 44px;
	}
	@media (prefers-reduced-motion: no-preference) {
		.task-pane {
			animation: pane-in var(--dur-base) var(--ease-out);
		}
		@keyframes pane-in {
			from {
				opacity: 0;
				transform: translateX(14px);
			}
			to {
				opacity: 1;
				transform: none;
			}
		}
	}
	.task-pane-header {
		position: sticky;
		z-index: 1;
		inset-block-start: 0;
		display: flex;
		min-block-size: 36px;
		align-items: center;
		justify-content: space-between;
		padding-inline: var(--space-3) var(--space-2);
		border-block-end: 1px solid oklch(0.9 0.006 264);
		background: var(--surface);
		font-size: 13px;
		font-weight: 700;
	}
	.task-pane-close {
		display: inline-flex;
		inline-size: 28px;
		block-size: 28px;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.task-pane-close:hover {
		background: oklch(0.94 0.004 264);
		color: var(--ink);
	}
	.task-pane-section {
		padding: var(--space-3);
	}
	.task-pane-section + .task-pane-section {
		border-block-start: 1px solid oklch(0.9 0.006 264);
	}
	.task-pane-section h2 {
		margin: 0 0 var(--space-2);
		color: var(--muted);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
</style>
