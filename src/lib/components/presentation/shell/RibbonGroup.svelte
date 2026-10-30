<script>
	/**
	 * One labelled group of ribbon controls ("Clipboard", "Slides"…), with the
	 * group name under its controls as in PowerPoint.
	 *
	 * @type {{ label: string, children: import('svelte').Snippet }}
	 */
	let { label, children } = $props();
</script>

<div class="ribbon-group" role="group" aria-label={label}>
	<div class="ribbon-group-controls">{@render children()}</div>
	<span class="ribbon-group-label" aria-hidden="true">{label}</span>
</div>

<style>
	.ribbon-group {
		display: flex;
		flex: none;
		flex-direction: column;
		justify-content: space-between;
		gap: 4px;
		padding-inline: 10px;
		border-inline-end: 1px solid oklch(0.9 0.006 264);
	}
	.ribbon-group:last-child {
		border-inline-end: 0;
	}
	.ribbon-group-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		max-inline-size: 360px;
	}
	.ribbon-group-controls :global(select) {
		min-block-size: 28px;
		font-size: 12px;
	}
	.ribbon-group-label {
		color: var(--muted);
		font-size: 10px;
		text-align: center;
	}
	.ribbon-group-controls :global(.button) {
		min-block-size: 28px;
		padding-block: 2px;
		padding-inline: 7px;
		gap: 5px;
		font-weight: 600;
		border-radius: 5px;
		font-size: 12px;
		box-shadow: none;
	}
	.ribbon-group-controls :global(.button.icon) {
		inline-size: 28px;
		padding: 0;
	}
	/* Narrow ribbons keep every control: icon buttons drop their visible text
	 * (the accessible name stays) and hints give way, as PowerPoint's ribbon
	 * scales its groups down. */
	@container (max-width: 1300px) {
		.ribbon-group-controls :global(.ribbon-label),
		.ribbon-group-controls :global(.ribbon-hint) {
			display: none;
		}
		.ribbon-group-controls {
			max-inline-size: 380px;
		}
	}
</style>
