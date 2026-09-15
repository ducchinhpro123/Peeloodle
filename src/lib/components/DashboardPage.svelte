<script>
	import { asset } from '$app/paths';
	import {
		ChevronRight,
		Clock,
		ImagePlus,
		LayoutGrid,
		Play,
		Scissors,
		Sparkles,
		Type,
		Upload
	} from 'lucide-svelte';
	import AppShell from './AppShell.svelte';
	import Hero from './Hero.svelte';
	import StickerCollage from './StickerCollage.svelte';
	import LocalProjectList from './LocalProjectList.svelte';
	import TemplateRail from './TemplateRail.svelte';
	import Modal from './Modal.svelte';
	import { shellHref } from '$lib/app/navigation';

	/**
	 * @type {{
	 *   repository: import('$lib/persistence/repository').StickerLabRepository,
	 *   onopen: (projectId: string) => void,
	 *   pathname?: string,
	 *   search?: string,
	 * }}
	 */
	let { repository, onopen, pathname = '/', search = '' } = $props();

	let walkthroughOpen = $state(false);

	/**
	 * `to` stays a literal shell target so the shared `shellHref` helper (and typed
	 * `resolve()`) can check it; every destination here is a real route, including
	 * `/my-stickers` since its route file landed.
	 * @type {Array<{
	 *   icon: typeof Scissors,
	 *   title: string,
	 *   to: import('$lib/app/navigation').ShellLink,
	 *   detail: string,
	 *   tone: string,
	 *   torn?: boolean,
	 * }>}
	 */
	const dashboardFeatures = [
		{
			icon: Scissors,
			title: 'Background Eraser',
			to: '/create?tool=erase',
			detail: 'Brush away the background. Keep the good bits.',
			tone: 'pink'
		},
		{
			icon: Type,
			title: 'Text & Emoji',
			to: '/create?tool=text',
			detail: 'Say it your way with editable text.',
			tone: 'blue'
		},
		{
			icon: Sparkles,
			title: 'Filters & Effects',
			to: '/create?tool=effects',
			detail: 'Tune brightness, contrast, and grayscale on a photo.',
			tone: 'yellow'
		},
		{
			icon: LayoutGrid,
			title: 'Templates',
			to: '/templates',
			detail: 'A little inspiration. A lot of possibilities.',
			tone: 'purple'
		},
		{
			icon: Upload,
			title: 'Share & Export',
			to: '/create?tool=export',
			detail: 'Made it? Take it with you as a transparent PNG.',
			tone: 'green',
			torn: true
		}
	];
</script>

<AppShell {pathname} {search}>
	<Hero class="hero-dashboard">
		{#snippet kicker()}
			<p class="hero-kicker tape">YOUR EVERYDAY, REMIXED</p>
		{/snippet}
		{#snippet title()}
			Small stickers.<br /><em>Big personality.</em>
		{/snippet}
		{#snippet action()}
			<div class="actions">
				<a class="button primary" href={shellHref('/create')}
					><ImagePlus size={16} />Create a Sticker<ChevronRight size={16} /></a
				>
				<button type="button" class="button" onclick={() => (walkthroughOpen = true)}>
					<Play size={16} />Watch how it works
				</button>
			</div>
		{/snippet}
		{#snippet points()}
			<ul class="hero-points">
				<li>No account needed</li>
				<li>Saved on your device</li>
				<li>Made by you</li>
			</ul>
		{/snippet}
		{#snippet art()}
			<StickerCollage />
		{/snippet}
		Your cat. Your chaos. Your favorite face. Turn everyday photos into little things worth sending.
	</Hero>

	<div class="feature-grid">
		{#each dashboardFeatures as feature (feature.title)}
			<a class={`feature${feature.torn ? ' torn' : ''}`} href={shellHref(feature.to)}>
				<b class={feature.tone}><feature.icon size={18} /></b>
				<span><strong>{feature.title}</strong><small>{feature.detail}</small></span>
				<i class="feature-doodle" aria-hidden="true">
					{#if feature.title === 'Text & Emoji'}
						<span class="feature-scrap">Make it yours!</span>
					{:else if feature.title === 'Templates'}
						<span class="feature-polaroid field"
							><img src={asset('/art/polaroid-field.svg')} alt="" /></span
						>
						<span class="feature-polaroid daisy"
							><img src={asset('/art/polaroid-daisy.svg')} alt="" /></span
						>
						<img
							class="feature-smiley"
							src={asset('/art/stickers/04-winking-smiley.webp')}
							alt=""
						/>
					{/if}
				</i>
			</a>
		{/each}
	</div>

	<div class="split">
		<section>
			<div class="section-title">
				<h2><Clock size={16} aria-hidden="true" /> Recent Projects</h2>
				<a href={shellHref('/my-stickers#local-stickers')}>View all</a>
			</div>
			<LocalProjectList {repository} limit={6} />
		</section>
		<TemplateRail {repository} {onopen} title="🔥 Trending Templates" />
	</div>

	<section class="bottom-banner">
		<img
			class="banner-sticker"
			src={asset('/art/stickers/16-rainbow.webp')}
			alt=""
			width="96"
			height="72"
		/>
		<b>Less ordinary.<br />More you.</b>
		<div class="banner-copy">
			<strong>Stick together</strong><small>Connect, create and share with friends.</small>
		</div>
		<a href={shellHref('/create')} class="button primary"
			>Start Creating<ChevronRight size={16} /></a
		>
	</section>
</AppShell>

<Modal
	open={walkthroughOpen}
	title="How StickerLab works"
	description="From camera roll to conversation starter."
	onclose={() => (walkthroughOpen = false)}
>
	<ol class="walkthrough">
		<li>Create a sticker from the dashboard or Create page.</li>
		<li>Upload a PNG, JPEG, or static WebP photo.</li>
		<li>Move, resize, and rotate it, then add text.</li>
		<li>Save locally, reopen from Dashboard or My Stickers, and export a transparent PNG.</li>
	</ol>
	{#snippet footer()}
		<button type="button" class="button primary" onclick={() => (walkthroughOpen = false)}
			>Let’s make something</button
		>
	{/snippet}
</Modal>
