<script>
	import { buttonIconLarge } from '$lib/ui/styles.js';
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
		class={[buttonIconLarge, 'mobile-only']}
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
	<AccountDialog header />
</header>

<Modal open={mobileNavOpen} title="Navigation" onclose={() => (mobileNavOpen = false)}>
	<Sidebar {pathname} {search} mobile onnavigate={() => (mobileNavOpen = false)} />
</Modal>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.header {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--space-5);
		height: var(--header-height);
		padding: var(--space-1) clamp(12px, 1.6vw, 20px);
		border-bottom: 1px solid #d4eddf;
		background: var(--pale) url('/art/header-paper.svg') center / 100% 100% no-repeat;
		overflow-x: clip;
	}

	.brand {
		display: flex;
		align-items: center;
		flex: none;
		min-width: 0;
		color: var(--ink);
		text-decoration: none;
	}
	.brand img {
		display: block;
		height: 72px;
		width: auto;
		max-width: min(280px, 100%);
		object-fit: contain;
	}
	.topnav {
		position: relative;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		padding: var(--space-1) var(--space-4);
		background: url('/art/header-scrap.svg') center / 100% 100% no-repeat;
	}
	.topnav a {
		color: var(--ink);
		text-decoration: none;
	}
	.topnav a {
		position: relative;
		isolation: isolate;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-2) clamp(12px, 1.15vw, 20px);
		font-size: clamp(14px, 1.08vw, 18px);
		font-weight: 500;
		white-space: nowrap;
	}
	.topnav a.active {
		color: #00875e;
		font-weight: 800;
	}
	.topnav a.active::before {
		position: absolute;
		z-index: -1;
		inset: -7px 0 2px;
		background: #bdebd9bd;
		box-shadow: var(--shadow);
		transform: rotate(-4deg);
		content: '';
	}
	.topnav a.active::after {
		position: absolute;
		right: 17%;
		bottom: 0;
		left: 17%;
		height: 6px;
		border-top: 3px solid #009467;
		border-bottom: 1px solid #00946788;
		transform: rotate(-6deg);
		content: '';
	}
	.topnav a:hover {
		color: #00875e;
	}
	.mobile-only {
		display: none;
	}
	@media (max-width: 1150px) {
		.header {
			gap: var(--space-3);
			padding: var(--space-1) var(--space-3);
		}
		.brand {
			flex-basis: auto;
		}
		.brand img {
			height: 64px;
		}
		.topnav {
			padding: var(--space-1);
		}
		.topnav a {
			padding: var(--space-3);
			font-size: 14px;
		}
	}
	@media (min-width: 721px) and (max-width: 900px) {
		.header > .mobile-only {
			display: inline-flex;
		}
		.topnav {
			display: none;
		}
	}
	@media (max-width: 720px) {
		.header {
			display: grid;
			grid-template-columns: 44px minmax(0, 1fr) 44px;
			grid-template-rows: 44px 44px;
			gap: var(--space-2);
			padding: var(--space-1) var(--space-3);
		}
		.mobile-only {
			display: inline-flex;
		}
		.header > .mobile-only {
			grid-area: 1 / 1;
			background: #fff9;
		}
		.brand {
			grid-area: 1 / 2;
			justify-content: center;
		}
		.brand img {
			height: 40px;
		}
		.topnav {
			display: none;
		}
	}
</style>
