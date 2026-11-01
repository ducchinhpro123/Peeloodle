<script>
	import { asset } from '$app/paths';
	import { ChevronRight, Scissors, SlidersHorizontal, Type, Upload } from 'lucide-svelte';
	import { shellHref, sidebarNavigation } from '#lib/app/navigation.js';
	import {
		appLocalPathname,
		isUnmodifiedPrimaryClick,
		parseToolIntent,
		requestToolIntent,
		shouldReuseCurrentToolRoute,
		toolIntentHref
	} from '#lib/editor/toolIntent.js';

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
		{
			label: 'Filters & Effects',
			icon: SlidersHorizontal,
			intent: /** @type {const} */ ('effects')
		},
		{ label: 'Export & Share', icon: Upload, intent: /** @type {const} */ ('export') }
	];

	let currentIntent = $derived(parseToolIntent(new URLSearchParams(search).get('tool')));

	/** @param {import('#lib/editor/toolIntent.js').ToolIntent} intent */
	function followIntent(intent) {
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
			<img src={asset('art/stickers/04-winking-smiley.webp')} alt="" width="64" height="64" />

			<b>Good ideas stick.</b>
			<p>Create. Customize.<br />Share. Repeat.</p>
			<a href={shellHref('/create')}>Make something fun <ChevronRight size={16} /></a>
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
		inline-size: 220px;
		min-block-size: calc(100vh - var(--header-height));
		padding-block-start: var(--space-4);
		padding-block-end: var(--space-4);
		padding-inline-start: var(--space-3);
		padding-inline-end: var(--space-3);
		border-inline-end: 1px solid oklch(0.959437 0.004191 236.4975);
		background: oklch(1 0 none);
	}
	.side-tools {
		display: grid;
		gap: 4px;
	}
	.sidebar a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-block-start: 9px;
		padding-block-end: 9px;
		padding-inline-start: 12px;
		padding-inline-end: 12px;
		border-radius: 10px;
		font-size: 13.5px;
		font-weight: 500;
	}
	.sidebar a.active {
		background: var(--pale);
		color: oklch(0.551582 0.11869 163.307);
		font-weight: 700;
	}
	.side-tools {
		padding-block-start: 14px;
		border-block-start: 1px solid var(--line);
	}
	.side-tools small {
		padding-block-start: 0;
		padding-block-end: 4px;
		padding-inline-start: 12px;
		padding-inline-end: 12px;
		color: oklch(0.669479 0.033254 258.939);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.card.studio-note {
		position: relative;
		display: grid;
		grid-template-columns: 52px 1fr;
		gap: 2px 10px;
		margin-block-start: auto;
		padding: var(--space-3);
		background: var(--cream);
	}
	.studio-note img {
		grid-row: 1 / span 2;
		inline-size: 52px;
		block-size: 52px;
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
		color: oklch(0.515677 0.11125 163.1262);
		font-size: 12px;
		font-weight: 800;
	}
	.card {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: oklch(1 0 none);
	}
</style>
