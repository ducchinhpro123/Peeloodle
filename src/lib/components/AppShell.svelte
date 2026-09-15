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
	 *   pathname?: string,
	 *   search?: string,
	 * }}
	 */
	let { children, editor = false, pathname = '/', search = '' } = $props();
</script>

<Header {pathname} {search} />
<div class={editor ? 'layout editor-layout' : 'layout'}>
	<Sidebar {pathname} {search} />
	<main>
		<CloudBanner />
		{@render children()}
	</main>
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.layout {
		display: flex;
	}

	:global(.layout > .sidebar) {
		position: sticky;
		top: var(--header-height);
		align-self: flex-start;
		height: calc(100dvh - var(--header-height));
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	main {
		min-width: 0;
		flex: 1;
		padding: var(--space-5);
	}
	:global(main > section) {
		min-width: 0;
	}
	:global(main > div) {
		min-width: 0;
	}
	.editor-layout {
		height: calc(100dvh - var(--header-height));
		min-height: 0;
	}
	:global(.editor-layout > .sidebar) {
		display: none;
	}
	.editor-layout main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		padding: 0;
		overflow: hidden;
	}
	:global(.editor-layout .cloud-banner) {
		margin: 8px 12px 0;
	}
	@media (max-width: 1150px) {
		main {
			padding: var(--space-4);
		}
	}
	@media (max-width: 720px) {
		.editor-layout {
			height: auto;
		}
		.editor-layout main {
			overflow: visible;
		}
		:global(.layout > .sidebar) {
			display: none;
		}
		.layout main {
			padding: var(--space-4);
			padding-bottom: var(--space-6);
		}
		.editor-layout main {
			padding: 0;
		}
	}
</style>
