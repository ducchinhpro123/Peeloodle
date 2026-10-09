<script>
	import { buttonIconLarge } from '#lib/ui/styles.js';
	import { asset } from '$app/paths';
	import { Menu } from 'lucide-svelte';
	import Modal from './Modal.svelte';
	import Sidebar from './Sidebar.svelte';
	import AccountDialog from './AccountDialog.svelte';
	import { primaryNavigation, shellHref } from '#lib/app/navigation.js';

	/** @type {{ pathname?: string, search?: string }} */
	let { pathname = '/', search = '' } = $props();

	let mobileNavOpen = $state(false);
</script>

<header class="header">
	<button
		type="button"
		class={[buttonIconLarge, 'mobile-only']}
		aria-label="Open navigation"
		onclick={() => (mobileNavOpen = true)}><Menu size={20} /></button
	>

	<a href={shellHref('/')} class="brand" aria-label="StickerLab home">
		<img src={asset('art/logo-wordmark.webp')} width="500" height="224" alt="StickerLab" />
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
		inset-block-start: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--space-5);
		block-size: var(--header-height);
		padding-block-start: var(--space-1);
		padding-block-end: var(--space-1);
		padding-inline-start: clamp(12px, 1.6vw, 20px);
		padding-inline-end: clamp(12px, 1.6vw, 20px);
		border-block-end: 1px solid oklch(0.923899 0.03234 161.2503);
		background: var(--pale) url('/art/header-paper.svg') center / 100% 100% no-repeat;
		overflow-x: clip;
	}

	.brand {
		display: flex;
		align-items: center;
		flex: none;
		min-inline-size: 0;
		color: var(--ink);
		text-decoration: none;
	}
	.brand img {
		display: block;
		block-size: 72px;
		inline-size: auto;
		max-inline-size: min(280px, 100%);
		object-fit: contain;
	}
	.topnav {
		position: relative;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		padding-block-start: var(--space-1);
		padding-block-end: var(--space-1);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
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
		min-block-size: 44px;
		padding-block-start: var(--space-2);
		padding-block-end: var(--space-2);
		padding-inline-start: clamp(12px, 1.15vw, 20px);
		padding-inline-end: clamp(12px, 1.15vw, 20px);
		font-size: clamp(14px, 1.08vw, 18px);
		font-weight: 500;
		white-space: nowrap;
	}
	.topnav a.active {
		color: oklch(0.551582 0.11869 163.307);
		font-weight: 800;
	}
	.topnav a.active::before {
		position: absolute;
		z-index: -1;
		inset-block-start: -7px;
		inset-block-end: 2px;
		inset-inline-start: 0;
		inset-inline-end: 0;
		background: color-mix(in oklch, oklch(0.902782 0.053476 169.3001) 74.1176%, transparent);
		box-shadow: var(--shadow);
		transform: rotate(-4deg);
		content: '';
	}
	.topnav a.active::after {
		position: absolute;
		inset-inline-end: 17%;
		inset-block-end: 0;
		inset-inline-start: 17%;
		block-size: 6px;
		border-block-start: 3px solid oklch(0.589646 0.127269 163.0923);
		border-block-end: 1px solid
			color-mix(in oklch, oklch(0.589646 0.127269 163.0923) 53.3333%, transparent);
		transform: rotate(-6deg);
		content: '';
	}
	@media (hover: hover) and (pointer: fine) {
		.topnav a:hover {
			color: oklch(0.551582 0.11869 163.307);
		}
	}
	.mobile-only {
		display: none;
	}
	@media (max-width: 1150px) {
		.header {
			gap: var(--space-3);
			padding-block-start: var(--space-1);
			padding-block-end: var(--space-1);
			padding-inline-start: var(--space-3);
			padding-inline-end: var(--space-3);
		}
		.brand {
			flex-basis: auto;
		}
		.brand img {
			block-size: 64px;
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
			padding-block-start: var(--space-1);
			padding-block-end: var(--space-1);
			padding-inline-start: var(--space-3);
			padding-inline-end: var(--space-3);
		}
		.mobile-only {
			display: inline-flex;
		}
		.header > .mobile-only {
			grid-area: 1 / 1;
			background: color-mix(in oklch, oklch(1 0 none) 60%, transparent);
		}
		.brand {
			grid-area: 1 / 2;
			justify-content: center;
		}
		.brand img {
			block-size: 40px;
		}
		.topnav {
			display: none;
		}
	}
</style>
