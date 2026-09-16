<script>
	/**
	 * Shared administrative chrome: a section heading and the catalog sections that
	 * exist in this milestone. Links are props so the component renders without
	 * `$app` state; the route layout resolves them with the base path.
	 *
	 * @type {{
	 *   collectionsHref: string,
	 *   assetsHref: string,
	 *   uploadsHref: string,
	 *   pathname: string,
	 *   children: import('svelte').Snippet
	 * }}
	 */
	let { collectionsHref, assetsHref, uploadsHref, pathname, children } = $props();

	const sections = $derived([
		{ href: collectionsHref, label: 'Collections' },
		{ href: assetsHref, label: 'Assets' },
		{ href: uploadsHref, label: 'Uploads' }
	]);

	/** @param {string} href */
	function isCurrent(href) {
		return pathname === href || pathname.startsWith(`${href}/`);
	}
</script>

<section class="admin-shell [display:grid] [gap:var(--space-4)]">
	<header class="[display:grid] [gap:4px]">
		<p
			class="[margin:0] [font-size:11px] [font-weight:800] [letter-spacing:0.08em] [color:var(--muted)] [text-transform:uppercase]"
		>
			Catalog administration
		</p>
		<h1 class="[margin:0]">Assets and templates</h1>
		<p class="[margin:0] [max-width:70ch] [font-size:13px] [color:var(--muted)]">
			Draft edits are private until publication. Every operation re-checks administrator membership
			on the server.
		</p>
	</header>
	<nav
		aria-label="Catalog sections"
		class="admin-sections [display:flex] [flex-wrap:wrap] [gap:var(--space-2)]"
	>
		{#each sections as section (section.href)}
			<a
				class="admin-section-link [border-radius:999px] [padding:6px_14px] [font-size:13px] [font-weight:700] [color:var(--ink)] [background:var(--surface)] [border:1px_solid_var(--line)]"
				href={section.href}
				aria-current={isCurrent(section.href) ? 'page' : undefined}>{section.label}</a
			>
		{/each}
	</nav>
	{@render children()}
</section>

<style>
	.admin-section-link[aria-current='page'] {
		border-color: var(--mint);
		background: var(--pale);
	}
</style>
