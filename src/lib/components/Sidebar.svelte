<script>
	import { asset } from '$app/paths';
	import { ChevronRight, Scissors, Sparkles, Type, Upload } from 'lucide-svelte';
	import { shellHref, sidebarNavigation } from '$lib/app/navigation';
	import {
		appLocalPathname,
		isUnmodifiedPrimaryClick,
		parseToolIntent,
		requestToolIntent,
		shouldReuseCurrentToolRoute,
		toolIntentHref
	} from '$lib/editor/toolIntent';

	/** @type {{ pathname?: string, search?: string, mobile?: boolean, onnavigate?: () => void }} */
	let { pathname = '/', search = '', mobile = false, onnavigate = undefined } = $props();

	/**
	 * The single base/strip boundary for this component. Production forwards the raw
	 * `page.url.pathname`, which carries `kit.paths.base`, while route recognition and
	 * the navigation `active` checks speak app-local pathnames. Links stay base-aware
	 * because `toolIntentHref()`/`shellHref()` put the base back through `resolve()`.
	 */
	let appPathname = $derived(appLocalPathname(pathname));

	const sidebarTools = [
		{ label: 'Background Eraser', icon: Scissors, intent: /** @type {const} */ ('erase') },
		{ label: 'Text & Emoji', icon: Type, intent: /** @type {const} */ ('text') },
		{ label: 'Filters & Effects', icon: Sparkles, intent: /** @type {const} */ ('effects') },
		{ label: 'Export & Share', icon: Upload, intent: /** @type {const} */ ('export') }
	];

	let currentIntent = $derived(parseToolIntent(new URLSearchParams(search).get('tool')));

	function followIntent(/** @type {import('$lib/editor/toolIntent').ToolIntent} */ intent) {
		onnavigate?.();
		if (!shouldReuseCurrentToolRoute(appPathname, search, intent)) return;
		requestToolIntent(intent);
	}
</script>

<aside class="sidebar">
	<div class="side-links [display:grid] [gap:4px]">
		{#each sidebarNavigation as item (item.to)}
			{@const active = item.active(appPathname, search)}
			<a
				href={shellHref(item.to)}
				class={active ? 'active' : undefined}
				aria-current={active ? 'page' : undefined}
				onclick={() => onnavigate?.()}
			>
				{#if item.icon}
					<item.icon size={18} />
				{/if}{item.label}
			</a>
		{/each}
	</div>
	<div class="side-tools">
		<small>TOOLS</small>
		{#each sidebarTools as { label, icon: Icon, intent } (intent)}
			{@const active =
				currentIntent === intent &&
				(appPathname === '/create' || appPathname.startsWith('/editor/'))}
			{@const toolHref = toolIntentHref(intent, appPathname)}
			<a
				href={toolHref}
				class={active ? 'active' : undefined}
				aria-current={active ? 'page' : undefined}
				onclick={(event) => {
					// Modifier and non-primary clicks keep native link behaviour (new tab
					// above all): never call preventDefault for them.
					if (!isUnmodifiedPrimaryClick(event)) return;
					// Same tool, same document: re-open the chrome without a navigation that
					// would only rewrite the same URL.
					if (shouldReuseCurrentToolRoute(appPathname, search, intent)) {
						event.preventDefault();
						followIntent(intent);
						return;
					}
					onnavigate?.();
				}}
			>
				<Icon size={18} />{label}
			</a>
		{/each}
	</div>
	{#if !mobile}
		<section class="card studio-note">
			<img src={asset('/art/stickers/04-winking-smiley.webp')} alt="" width="64" height="64" />
			<b>Good ideas stick.</b>
			<p>Create. Customize.<br />Share. Repeat.</p>
			<a href={shellHref('/create')}>Make something fun <ChevronRight size={14} /></a>
		</section>
	{/if}
</aside>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.sidebar a {
		color: var(--ink);
		text-decoration: none;
	}
	.sidebar {
		display: flex;
		flex: 0 0 220px;
		flex-direction: column;
		gap: 16px;
		width: 220px;
		min-height: calc(100vh - var(--header-height));
		padding: var(--space-4) var(--space-3);
		border-right: 1px solid #eff2f4;
		background: #fff;
	}
	.side-tools {
		display: grid;
		gap: 4px;
	}
	.sidebar a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 12px;
		border-radius: 10px;
		font-size: 13.5px;
		font-weight: 500;
	}
	.sidebar a.active {
		background: var(--pale);
		color: #00875e;
		font-weight: 700;
	}
	.side-tools {
		padding-top: 14px;
		border-top: 1px solid var(--line);
	}
	.side-tools small {
		padding: 0 12px 4px;
		color: #8996aa;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.card.studio-note {
		position: relative;
		display: grid;
		grid-template-columns: 52px 1fr;
		gap: 2px 10px;
		margin-top: auto;
		padding: var(--space-3);
		background: var(--cream);
	}
	.studio-note img {
		grid-row: 1 / span 2;
		width: 52px;
		height: 52px;
		margin: 0;
		transform: rotate(-8deg);
	}
	.studio-note b {
		display: block;
		font-size: 13px;
	}
	.studio-note p {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
	}
	.studio-note a {
		grid-column: 1 / -1;
		display: flex;
		gap: 4px;
		padding: 0;
		color: #007b55;
		font-size: 12px;
		font-weight: 800;
	}
	.card {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: #fff;
	}
</style>
