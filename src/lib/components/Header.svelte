<script>
	import { asset } from '$app/paths';
	import { Menu } from 'lucide-svelte';
	import Modal from './Modal.svelte';
	import Sidebar from './Sidebar.svelte';
	import AccountDialog from './AccountDialog.svelte';
	import { primaryNavigation, shellHref } from '$lib/app/navigation';

	/** @type {{ pathname?: string, search?: string }} */
	let { pathname = '/', search = '' } = $props();

	let mobileNavOpen = $state(false);
</script>

<header class="header">
	<button
		type="button"
		class="button icon mobile-only"
		aria-label="Open navigation"
		onclick={() => (mobileNavOpen = true)}
	>
		<Menu size={20} />
	</button>
	<a href={shellHref('/')} class="brand" aria-label="StickerLab home">
		<img src={asset('/art/logo-wordmark.webp')} width="500" height="224" alt="StickerLab" />
	</a>
	<nav class="topnav" aria-label="Primary navigation">
		{#each primaryNavigation as item (item.to)}
			{@const active = item.active(pathname, search)}
			<a
				href={shellHref(item.to)}
				class={active ? 'active' : undefined}
				aria-current={active ? 'page' : undefined}>{item.label}</a
			>
		{/each}
	</nav>
	<AccountDialog />
</header>

<Modal open={mobileNavOpen} title="Navigation" onclose={() => (mobileNavOpen = false)}>
	<Sidebar {pathname} {search} mobile onnavigate={() => (mobileNavOpen = false)} />
</Modal>
