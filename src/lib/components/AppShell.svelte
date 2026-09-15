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
