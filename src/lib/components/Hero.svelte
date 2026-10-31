<script>
	/**
	 * @type {{
	 *   title: import('svelte').Snippet,
	 *   children: import('svelte').Snippet,
	 *   action?: import('svelte').Snippet,
	 *   art?: import('svelte').Snippet,
	 *   kicker?: import('svelte').Snippet,
	 *   points?: import('svelte').Snippet,
	 *   variant?: 'dashboard' | 'templates' | 'packs',
	 * }}
	 */
	let {
		title,
		children,
		action = undefined,
		art = undefined,
		kicker = undefined,
		points = undefined,
		variant = 'dashboard'
	} = $props();
</script>

<section class={`hero hero-${variant}`}>
	<div class="hero-copy">
		{#if kicker}{@render kicker()}{/if}
		<h1>{@render title()}</h1>
		<p class="hero-lead">{@render children()}</p>
		{#if action}{@render action()}{/if}
		{#if points}{@render points()}{/if}
	</div>
	{#if art}{@render art()}{/if}
</section>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.hero {
		container-type: inline-size;
		display: flex;
		min-block-size: 360px;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		margin-block-start: 0;
		margin-block-end: 0;
		margin-inline-start: auto;
		margin-inline-end: auto;
		padding: var(--space-6);
		overflow: clip;
		position: relative;
		border: 1px solid oklch(0.923899 0.03234 161.2503);
		border-radius: 28px;
		background:
			radial-gradient(ellipse at 30% 110%, oklch(0.964036 0.062858 96.6267) 0, transparent 60%),
			linear-gradient(
				120deg,
				oklch(0.95611 0.033692 160.4532),
				oklch(0.971238 0.015645 160.6295) 48%,
				oklch(0.926099 0.03569 298.0065)
			);
	}

	.hero-copy {
		position: relative;
		z-index: 1;
		flex: 0 1 440px;
		min-inline-size: 260px;
		container-type: inline-size;
	}
	.hero :global(.hero-kicker) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-block-start: 0;
		margin-block-end: var(--space-4);
		margin-inline-start: 0;
		margin-inline-end: 0;
		color: oklch(0.476969 0.061443 167.8899);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.hero :global(.hero-kicker.tape) {
		position: relative;
		padding-block-start: 8px;
		padding-block-end: 7px;
		padding-inline-start: 16px;
		padding-inline-end: 16px;
		border-radius: 0;
		background: oklch(0.831921 0.071316 28.3745);
		box-shadow:
			0 1px 0 color-mix(in oklch, oklch(0.768967 0.059944 35.6549) 53.3333%, transparent),
			0 8px 16px color-mix(in oklch, oklch(0.201186 0.055198 262.3998) 7.0588%, transparent);
		color: oklch(0.425972 0.055886 30.6612);
		font-family: Chewy, cursive;
		font-size: 12px;
		font-weight: 400;
		letter-spacing: 0.16em;
		white-space: nowrap;
		transform: rotate(-6deg);
		clip-path: polygon(
			1% 18%,
			4% 0,
			28% 6%,
			62% 0,
			96% 8%,
			100% 28%,
			98% 82%,
			92% 100%,
			58% 94%,
			22% 100%,
			0 78%
		);
	}
	.hero h1 {
		margin-block-start: 0;
		margin-block-end: var(--space-4);
		margin-inline-start: 0;
		margin-inline-end: 0;
		font-size: clamp(1.55rem, 10.5cqi, 3.4rem);
		font-weight: 800;
		line-height: 1.05;
		letter-spacing: -0.04em;
		white-space: nowrap;
	}
	:global(.hero em) {
		color: oklch(0.569191 0.122802 163.1218);
		font-style: normal;
	}
	.hero-lead {
		max-inline-size: 400px;
		margin: 0;
		color: oklch(0.451 0.056971 255.3385);
		font-size: 14px;
		font-weight: 500;
		line-height: 1.7;
	}
	:global(.hero .button) {
		border-radius: var(--radius-sm);
		min-block-size: 44px;
		padding-block-start: 12px;
		padding-block-end: 12px;
		padding-inline-start: 16px;
		padding-inline-end: 16px;
		font-size: 13px;
	}
	.hero :global(.hero-points) {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		margin-block-start: 14px;
		margin-block-end: 0;
		margin-inline-start: 0;
		margin-inline-end: 0;
		padding: 0;
		list-style: none;
		color: oklch(0.473699 0.049807 257.1724);
		font-size: 11.5px;
		font-weight: 600;
	}
	.hero :global(.hero-points li) {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.hero :global(.hero-points li)::before {
		inline-size: 14px;
		block-size: 14px;
		border-radius: 50%;
		background: var(--icon-green);
		color: oklch(1 0 none);
		content: '✓';
		font-size: 9px;
		font-weight: 800;
		line-height: 14px;
		text-align: center;
	}
	.hero-dashboard {
		min-block-size: 390px;
		border: 0;
		background: #bfe8d2 url('/art/dashboard-paper.svg') center / 100% 100% no-repeat;
		padding-block-start: var(--space-6);
		padding-block-end: var(--space-6);
		padding-inline-start: var(--space-7);
		padding-inline-end: var(--space-7);
	}
	.hero-dashboard h1 {
		position: relative;
		inline-size: max-content;
		max-inline-size: 100%;
		padding-block-start: 0;
		padding-block-end: 0;
		padding-inline-start: 1.4em;
		padding-inline-end: 1.4em;
		margin-inline-start: -0.6em;
		font-family: Chewy, cursive;
		font-size: clamp(2.35rem, 4vw, 7.5rem);
		font-weight: 400;
		letter-spacing: 0.01em;
		line-height: 1.12;
	}
	.hero-dashboard h1::before {
		position: absolute;
		inline-size: 28px;
		block-size: 36px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 36' fill='none'%3E%3Cpath d='M14 2v10M6 6l6 8M22 6l-6 8M4 20l8-2M24 20l-8-2' stroke='%231b2433' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		content: '';
		pointer-events: none;
	}
	.hero-dashboard h1::after {
		position: absolute;
		inline-size: 28px;
		block-size: 36px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 36' fill='none'%3E%3Cpath d='M14 2v10M6 6l6 8M22 6l-6 8M4 20l8-2M24 20l-8-2' stroke='%231b2433' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		content: '';
		pointer-events: none;
	}
	.hero-dashboard h1::before {
		inset-inline-start: -1.35em;
		inset-block-start: 0.15em;
		transform: rotate(-22deg);
	}
	.hero-dashboard h1::after {
		inset-inline-end: -1.2em;
		inset-block-start: -0.1em;
		transform: rotate(18deg) scaleX(-1);
	}
	.hero-dashboard .hero-copy {
		flex: 0 1 42%;
		min-inline-size: 280px;
	}
	:global(.hero-dashboard .actions .button) {
		border-radius: 999px;
		font-size: clamp(13px, 1cqw, 24px);
	}
	.hero-dashboard .hero-lead {
		max-inline-size: max(400px, 28cqw);
		font-size: clamp(14px, 1.1cqw, 28px);
	}
	:global(.hero-dashboard .hero-kicker) {
		font-size: clamp(12px, 1cqw, 22px);
	}
	:global(.hero-dashboard .hero-points) {
		font-size: clamp(11.5px, 0.9cqw, 20px);
	}
	:global(.hero-dashboard .collage) {
		flex: 1 1 55%;
		block-size: clamp(340px, 24cqw, 820px);
	}
	.hero.hero-templates {
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--cream) url('/art/scrapbook-paper.svg') center / 100% 100%;
		padding-block-start: var(--space-6);
		padding-block-end: var(--space-6);
		padding-inline-start: var(--space-7);
		padding-inline-end: var(--space-7);
		gap: 0;
		isolation: isolate;
	}
	.hero-templates .hero-copy {
		flex: 0 0 43%;
		min-inline-size: 0;
		transform: rotate(-3deg);
	}
	:global(.hero-templates .hero-kicker) {
		color: var(--scrapbook-green);
		border-block-end: 1px dashed currentColor;
		padding-block-end: var(--space-2);
		margin-block-end: var(--space-3);
	}
	.hero-templates h1 {
		font-size: clamp(2rem, 3.5vw, 7.5rem);
		line-height: 1.25;
		letter-spacing: -0.05em;
	}
	:global(.hero-templates h1 span) {
		padding-block-start: 0;
		padding-block-end: var(--space-1);
		padding-inline-start: var(--space-2);
		padding-inline-end: var(--space-2);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
		background: var(--surface);
		clip-path: polygon(
			1% 5%,
			18% 2%,
			30% 6%,
			52% 0,
			72% 5%,
			96% 0,
			100% 86%,
			92% 97%,
			64% 93%,
			40% 100%,
			19% 94%,
			0 100%
		);
	}
	:global(.hero-templates h1 em) {
		padding-block-start: 0;
		padding-block-end: var(--space-1);
		padding-inline-start: var(--space-2);
		padding-inline-end: var(--space-2);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
		background: var(--surface);
		clip-path: polygon(
			1% 5%,
			18% 2%,
			30% 6%,
			52% 0,
			72% 5%,
			96% 0,
			100% 86%,
			92% 97%,
			64% 93%,
			40% 100%,
			19% 94%,
			0 100%
		);
	}
	:global(.hero-templates h1 em) {
		background: var(--scrapbook-yellow);
		color: var(--scrapbook-green);
	}
	.hero-templates .hero-lead {
		max-inline-size: max(300px, 18cqw);
		padding-inline-start: var(--space-2);
		color: var(--ink);
		font-family: 'Chewy', cursive;
		font-weight: 400;
		font-size: clamp(16px, 1.25cqw, 32px);
		line-height: 1.55;
	}
	.hero.hero-templates {
		min-block-size: 280px;
	}
	.hero.hero-packs {
		min-block-size: 360px;
		padding-block-start: var(--space-7);
		padding-block-end: var(--space-7);
		padding-inline-start: 4.6%;
		padding-inline-end: 4.6%;
		gap: 2%;
		border: 0;
		background: url('/art/packs-paper.svg') center / 100% 100% no-repeat;
	}
	.hero-packs .hero-copy {
		flex: 0 0 43%;
		min-inline-size: 0;
	}
	.hero-packs h1 {
		font-size: clamp(2rem, 5.4cqw, 5.5rem);
		line-height: 1.04;
		letter-spacing: -0.055em;
	}
	:global(.hero-packs .hero-kicker) {
		font-size: clamp(10px, 1.1cqw, 18px);
		margin-block-end: var(--space-5);
	}
	:global(.hero-packs .hero-kicker svg) {
		inline-size: 1.6em;
		block-size: 1.6em;
	}
	.hero-packs .hero-lead {
		max-inline-size: none;
		font-size: clamp(13px, 1.45cqw, 25px);
		line-height: 1.45;
	}
	:global(.hero-packs .actions) {
		gap: var(--space-4);
		margin-block-start: var(--space-6);
	}
	:global(.hero-packs .button) {
		font-size: clamp(13px, 1.4cqw, 24px);
		padding-block-start: var(--space-4);
		padding-block-end: var(--space-4);
		padding-inline-start: var(--space-5);
		padding-inline-end: var(--space-5);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	:global(.hero-packs .button svg) {
		inline-size: 1.4em;
		block-size: 1.4em;
	}
	@media (prefers-reduced-motion: no-preference) {
		.hero-copy > :global(*) {
			animation: rise-in var(--dur-slow) var(--ease-pop) backwards;
		}
		.hero-copy > :global(:nth-child(2)) {
			animation-delay: 70ms;
		}
		.hero-copy > :global(:nth-child(3)) {
			animation-delay: 140ms;
		}
		.hero-copy > :global(:nth-child(4)) {
			animation-delay: 210ms;
		}
		.hero-copy > :global(:nth-child(n + 5)) {
			animation-delay: 280ms;
		}
	}
	@media (max-width: 1150px) {
		.hero {
			padding: var(--space-5);
		}
		.hero-dashboard {
			padding: var(--space-5);
			min-block-size: 300px;
		}
		.hero-dashboard h1::before {
			display: none;
		}
		.hero-dashboard h1::after {
			display: none;
		}
		.hero-copy {
			flex-basis: 320px;
		}
		:global(.hero-dashboard .collage) {
			block-size: 250px;
		}
		.hero-templates {
			padding: var(--space-6);
		}
		.hero-templates .hero-copy {
			flex-basis: 47%;
		}
		.hero-templates h1 {
			font-size: 2rem;
		}
	}
	@media (max-width: 720px) {
		.hero {
			min-block-size: 0;
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-4);
			padding: var(--space-5);
			border-radius: 24px;
		}
		.hero-dashboard {
			min-block-size: 0;
		}
		:global(.hero-dashboard .collage) {
			flex: none;
			inline-size: 100%;
			block-size: 250px;
		}
		.hero-copy {
			flex: 1 1 auto;
			min-inline-size: 0;
		}
		.hero h1 {
			font-size: clamp(1.55rem, 10cqi, 2.3rem);
			letter-spacing: -0.04em;
		}
		.hero-lead {
			font-size: 13px;
		}
		:global(.hero-dashboard .collage) {
			flex: none;
			inline-size: 100%;
			block-size: 250px;
		}
		.hero-packs {
			padding-block-start: var(--space-6);
			padding-block-end: var(--space-6);
			padding-inline-start: var(--space-5);
			padding-inline-end: var(--space-5);
			gap: var(--space-6);
			background-size: auto 100%;
			background-position: left;
		}
		.hero-packs .hero-copy {
			flex: none;
			inline-size: 100%;
		}
		.hero-packs h1 {
			font-size: clamp(1.8rem, 8.2vw, 2.8rem);
		}
		:global(.hero-packs .hero-kicker) {
			font-size: 10px;
			margin-block-end: var(--space-4);
		}
		.hero-packs .hero-lead {
			font-size: 14px;
		}
		:global(.hero-packs .actions) {
			margin-block-start: var(--space-5);
			gap: var(--space-3);
		}
		:global(.hero-packs .button) {
			padding: var(--space-3);
			border-radius: var(--radius-sm);
		}
		.hero-templates {
			padding-block-start: var(--space-6);
			padding-block-end: var(--space-6);
			padding-inline-start: var(--space-5);
			padding-inline-end: var(--space-5);
			gap: var(--space-5);
		}
		.hero-templates .hero-copy {
			flex: none;
			inline-size: 100%;
		}
		.hero-templates h1 {
			font-size: clamp(1.65rem, 8.2vw, 2.3rem);
		}
		.hero-templates .hero-lead {
			font-size: 15px;
		}
		.hero :global(.hero-points) {
			gap: 8px 12px;
			font-size: 10px;
		}
		:global(.hero .actions .button) {
			flex: 1 1 auto;
		}
		.hero :global(.hero-kicker) {
			font-size: 9px;
			letter-spacing: 0.08em;
		}
	}
</style>
