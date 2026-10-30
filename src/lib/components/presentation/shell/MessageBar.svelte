<script>
	/**
	 * Office-style message bar under the ribbon: one strip for save failures,
	 * conflicts, refused inserts and other notes, announced to screen readers.
	 *
	 * @type {{
	 *   tone: 'warning' | 'error' | 'info',
	 *   role: 'alert' | 'status',
	 *   class?: string,
	 *   children: import('svelte').Snippet
	 * }}
	 */
	let { tone, role, class: className = '', children } = $props();
</script>

<p class={['message-bar', tone, className]} {role}>{@render children()}</p>

<style>
	.message-bar {
		margin: 0;
		padding: 6px var(--space-4);
		border-block-end: 1px solid oklch(0.9 0.006 264);
		font-size: 12.5px;
		line-height: 1.4;
	}
	.warning {
		background: var(--warning-bg);
		color: var(--warning-ink);
	}
	.error {
		background: var(--danger-tint);
		color: var(--danger-strong);
	}
	.info {
		background: oklch(0.97 0.012 250);
		color: var(--ink);
	}
</style>
