<script>
	/**
	 * Resets the `/admin` layout: the template draft editor is a full-height
	 * workspace like `/presentations/<id>`, so it carries its own `AppShell` and
	 * `AdminGuard` instead of the catalog section chrome. The backend still
	 * re-checks administrator membership on every catalog call.
	 *
	 * @type {{ children: import('svelte').Snippet }}
	 */
	const { children } = $props();
</script>

{@render children()}
