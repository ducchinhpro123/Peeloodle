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
	<div class="side-links">
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
