<script>
	import { button, buttonPrimary } from '$lib/ui/styles.js';
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
	<Hero variant="dashboard">
		{#snippet kicker()}
			<p class="hero-kicker tape">YOUR EVERYDAY, REMIXED</p>
		{/snippet}
		{#snippet title()}
			Small stickers.<br /><em>Big personality.</em>
		{/snippet}
		{#snippet action()}
			<div
				class="actions [margin-top:var(--space-5)] [display:flex] [flex-wrap:wrap] [gap:var(--space-3)]"
			>
				<a class={buttonPrimary} href={shellHref('/create')}
					><ImagePlus size={16} />Create a Sticker<ChevronRight size={16} /></a
				>
				<button type="button" class={button} onclick={() => (walkthroughOpen = true)}>
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

	<div
		class="feature-grid [margin:var(--space-5)_0_var(--space-6)] [display:grid] [grid-template-columns:repeat(auto-fit,_minmax(190px,_1fr))] [gap:var(--space-4)]"
	>
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

	<div
		class="split [display:grid] [grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] [gap:var(--space-5)]"
	>
		<section>
			<div
				class="section-title [margin:var(--space-5)_0_var(--space-4)] [display:flex] [align-items:center] [justify-content:space-between] [gap:var(--space-3)]"
			>
				<h2><Clock size={16} aria-hidden="true" /> Recent Projects</h2>
				<a href={shellHref('/my-stickers#local-stickers')}>View all</a>
			</div>
			<LocalProjectList {repository} limit={6} />
		</section>
		<TemplateRail {repository} {onopen} title="🔥 Trending Templates" flushTop />
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
		<div class="banner-copy [margin-left:auto] [text-align:right]">
			<strong>Stick together</strong><small>Connect, create and share with friends.</small>
		</div>
		<a href={shellHref('/create')} class={buttonPrimary}>Start Creating<ChevronRight size={16} /></a
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
		<button type="button" class={buttonPrimary} onclick={() => (walkthroughOpen = false)}
			>Let’s make something</button
		>
	{/snippet}
</Modal>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.bottom-banner .button {
		border-radius: var(--radius-sm);
		min-height: 44px;
		padding: 12px 16px;
		font-size: 13px;
	}
	.feature {
		display: flex;
		position: relative;
		min-height: 196px;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-4) 72px;
		border: 1px solid #08152f06;
		border-radius: 24px;
		background: var(--blush);
		color: var(--ink);
		text-decoration: none;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease;
	}
	.feature:hover {
		transform: translateY(-3px);
		box-shadow: var(--shadow-hover);
	}
	.feature:nth-child(2) {
		background: var(--sky);
	}
	.feature:nth-child(3) {
		background: var(--pale);
	}
	.feature:nth-child(4) {
		background: var(--lav);
	}
	.feature:nth-child(5) {
		background: var(--pale);
		clip-path: polygon(0 0, 100% 0, 100% 78%, 97% 84%, 100% 90%, 94% 100%, 0 100%);
	}
	.feature.torn {
		background: var(--pale);
		clip-path: polygon(0 0, 100% 0, 100% 78%, 97% 84%, 100% 90%, 94% 100%, 0 100%);
	}
	.feature > b {
		display: grid;
		width: 42px;
		height: 42px;
		flex: 0 0 42px;
		place-items: center;
		border-radius: 12px;
		background: var(--icon-pink);
		color: #fff;
	}
	.feature > b.blue {
		background: var(--icon-blue);
	}
	.feature > b.purple {
		background: var(--icon-purple);
	}
	.feature > b.green {
		background: var(--icon-green);
	}
	.feature > b.yellow {
		background: #e0a106;
	}
	.feature span {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.feature strong {
		max-width: 9.5em;
		font-size: 15px;
		font-weight: 700;
		line-height: 1.25;
	}
	.feature small {
		color: var(--muted);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.35;
	}
	.feature::after {
		margin-left: auto;
		content: '›';
		font-size: 22px;
		color: #8aa0b8;
	}
	.feature-doodle {
		position: absolute;
		left: 18px;
		bottom: 12px;
		width: 88px;
		height: 40px;
		pointer-events: none;
	}
	.feature:nth-child(1) .feature-doodle {
		width: 118px;
		height: 42px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 40' fill='none'%3E%3Cpath d='M4 28c10-16 18 10 32-8 12-16 18 12 34-6 12-14 20 10 36-8 10-12 16 8 28-4' stroke='%23ff7eb8' stroke-width='11' stroke-linecap='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		transform: rotate(-8deg);
	}
	.feature:nth-child(2) .feature-doodle {
		left: 18px;
		width: 168px;
		height: 58px;
	}
	.feature:nth-child(2) .feature-doodle::before {
		position: absolute;
		right: 0;
		bottom: 4px;
		color: #1b2438;
		content: '— Aa';
		font-family: Chewy, cursive;
		font-size: 34px;
		font-weight: 400;
		line-height: 1;
	}
	.feature-scrap {
		position: absolute;
		left: 0;
		bottom: 2px;
		padding: 8px 10px 7px;
		background: #e9d7b0;
		box-shadow: 0 3px 8px #08152f14;
		clip-path: polygon(
			6% 10%,
			18% 0,
			42% 8%,
			70% 0,
			96% 12%,
			100% 78%,
			88% 100%,
			52% 92%,
			18% 100%,
			0 82%
		);
		color: #3d3428;
		font-family: Chewy, cursive;
		font-size: 13px;
		transform: rotate(-10deg);
	}
	.feature:nth-child(3) .feature-doodle {
		left: auto;
		right: 16px;
	}
	.feature:nth-child(4) .feature-doodle {
		left: auto;
		right: 16px;
	}
	.feature:nth-child(3) .feature-doodle {
		display: block;
		width: 132px;
		height: 58px;
		transform: none;
	}
	.feature-polaroid {
		position: absolute;
		display: block;
		overflow: hidden;
		padding: 3px 3px 10px;
		background: #fff;
		box-shadow: 0 3px 8px #08152f18;
	}
	.feature-polaroid img {
		display: block;
		width: 52px;
		height: 38px;
		object-fit: cover;
	}
	.feature-polaroid.field {
		left: 0;
		bottom: 4px;
		transform: rotate(-8deg);
	}
	.feature-polaroid.daisy {
		left: 40px;
		bottom: 0;
		transform: rotate(10deg);
	}
	.feature-smiley {
		position: absolute;
		right: -2px;
		bottom: -2px;
		width: 44px;
		height: 44px;
		object-fit: contain;
		transform: rotate(8deg);
	}
	.feature:nth-child(4) .feature-doodle {
		width: 56px;
		height: 56px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'%3E%3Cpath d='M6 22 42 8 22 40l-2-12z' stroke='%231a2744' stroke-width='2.4' stroke-linejoin='round'/%3E%3Cpath d='M20 28 42 8' stroke='%231a2744' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		transform: rotate(14deg);
	}
	.split > section {
		min-width: 0;
	}
	.section-title h2 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 16px;
	}
	.section-title a {
		color: #008dce;
		font-size: 13px;
		font-weight: 600;
	}
	.bottom-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-top: var(--space-5);
		padding: var(--space-4) var(--space-5);
		border: 1px solid #e3dbf1;
		border-radius: var(--radius);
		background: linear-gradient(100deg, #f3e8ff, #e3f8ec);
	}
	.bottom-banner b {
		max-width: 240px;
		font-size: 20px;
		line-height: 1.25;
		letter-spacing: -0.03em;
	}
	.banner-sticker {
		width: 88px;
		height: 64px;
		object-fit: contain;
		transform: rotate(-10deg);
	}
	.banner-copy strong {
		display: block;
		font-size: 14px;
	}
	.banner-copy small {
		color: var(--muted);
		font-size: 12px;
		font-weight: 500;
	}
	.walkthrough {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: steps;
	}
	.walkthrough li {
		position: relative;
		min-height: 36px;
		padding-left: 48px;
		counter-increment: steps;
		font-size: 14px;
		line-height: 1.6;
	}
	.walkthrough li::before {
		content: counter(steps, decimal-leading-zero);
		position: absolute;
		left: 0;
		top: 0;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: var(--pale);
		color: #007b55;
		font-size: 12px;
		font-weight: 800;
	}
	@media (max-width: 1150px) {
		.feature-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (max-width: 720px) {
		.feature:nth-child(2) .feature-doodle {
			width: 124px;
		}
		.feature:nth-child(2) .feature-doodle::before {
			font-size: 26px;
		}
		.feature-grid {
			grid-template-columns: 1fr 1fr;
		}
		.feature {
			min-height: 188px;
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-3);
			padding: var(--space-4) var(--space-4) 68px;
			font-size: 13px;
		}
		.feature:nth-child(3) .feature-doodle {
			width: 110px;
			height: 48px;
		}
		.feature-polaroid img {
			width: 36px;
			height: 26px;
		}
		.feature-smiley {
			width: 32px;
			height: 32px;
		}
		.feature::after {
			display: none;
		}
		.feature strong {
			font-size: 13px;
		}
		.feature > b {
			width: 37px;
			height: 37px;
			flex-basis: 37px;
		}
		.feature small {
			font-size: 12px;
			line-height: 1.5;
		}
		.split {
			/* minmax(0, …) so the single column can shrink below the rail's min-content. */
			grid-template-columns: minmax(0, 1fr);
		}
		.bottom-banner {
			flex-wrap: wrap;
			gap: var(--space-4);
			padding: var(--space-4);
		}
		.banner-copy {
			margin-left: 0;
			text-align: left;
		}
		.bottom-banner .button {
			padding: 9px;
		}

		.banner-copy {
			display: none;
		}
	}
</style>
