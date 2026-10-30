<script>
	import Header from './Header.svelte';
	import Sidebar from './Sidebar.svelte';
	import CloudBanner from './CloudBanner.svelte';

	/**
	 * The app chrome: header, sidebar and the routed page. Deliberately takes the
	 * current URL as props so it renders (and is testable) without SvelteKit's
	 * `$app/state`.
	 *
	 * @type {{
	 *   children: import('svelte').Snippet,
	 *   editor?: boolean,
	 *   fullscreen?: boolean,
	 *   pathname?: string,
	 *   search?: string,
	 * }}
	 */
	let { children, editor = false, fullscreen = false, pathname = '/', search = '' } = $props();
</script>

{#if fullscreen}
	<!-- Full-screen editors bring their own title bar and way back; the site
	     header and sidebar would only take space from the canvas. -->
	<main class="fullscreen-main">
		{@render children()}
	</main>
{:else}
	<Header {pathname} {search} />
	<div class={editor ? 'layout editor-layout' : 'layout'}>
		<Sidebar {pathname} {search} />
		<main>
			<CloudBanner />
			{@render children()}
		</main>
	</div>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.layout {
		display: flex;
	}

	:global(.layout > .sidebar) {
		position: sticky;
		inset-block-start: var(--header-height);
		align-self: flex-start;
		block-size: calc(100dvh - var(--header-height));
		min-block-size: 0;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	main {
		min-inline-size: 0;
		flex: 1;
		padding: var(--page-gutter);
	}
	.fullscreen-main {
		display: flex;
		block-size: 100dvh;
		min-block-size: 0;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}
	:global(main > section) {
		min-inline-size: 0;
	}
	:global(main > div) {
		min-inline-size: 0;
	}
	.editor-layout {
		block-size: calc(100dvh - var(--header-height));
		min-block-size: 0;
	}
	:global(.editor-layout > .sidebar) {
		display: none;
	}
	.editor-layout main {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
		padding: 0;
		overflow: clip;
	}
	:global(.editor-layout .cloud-banner) {
		margin-block-start: 8px;
		margin-block-end: 0;
		margin-inline-start: 12px;
		margin-inline-end: 12px;
	}
	@media (max-width: 720px) {
		.editor-layout {
			block-size: auto;
		}
		.editor-layout main {
			overflow: visible;
		}
		:global(.layout > .sidebar) {
			display: none;
		}
		.layout main {
			padding-block-end: var(--space-6);
		}
		.editor-layout main {
			padding: 0;
		}
	}
</style>
