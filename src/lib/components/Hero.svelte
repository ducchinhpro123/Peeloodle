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
		min-height: 360px;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		margin: 0 auto;
		padding: var(--space-6);
		overflow: hidden;
		position: relative;
		border: 1px solid #d4eddf;
		border-radius: 28px;
		background:
			radial-gradient(ellipse at 30% 110%, #fff4c4 0, transparent 60%),
			linear-gradient(120deg, #def8e9, #edf9f2 48%, #e9e2fc);
	}

	.hero-copy {
		position: relative;
		z-index: 1;
		flex: 0 1 440px;
		min-width: 260px;
		container-type: inline-size;
	}
	.hero :global(.hero-kicker) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-4);
		color: #376856;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.hero :global(.hero-kicker.tape) {
		position: relative;
		padding: 8px 16px 7px;
		border-radius: 0;
		background: #f3b7ae;
		box-shadow:
			0 1px 0 #d7a79a88,
			0 8px 16px #08152f12;
		color: #6a433c;
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
		margin: 0 0 var(--space-4);
		font-size: clamp(1.55rem, 10.5cqi, 3.4rem);
		font-weight: 800;
		line-height: 1.05;
		letter-spacing: -0.04em;
		white-space: nowrap;
	}
	:global(.hero em) {
		color: #008d62;
		font-style: normal;
	}
	.hero-lead {
		max-width: 400px;
		margin: 0;
		color: #405775;
		font-size: 14px;
		font-weight: 500;
		line-height: 1.7;
	}
	:global(.hero .button) {
		border-radius: var(--radius-sm);
		min-height: 44px;
		padding: 12px 16px;
		font-size: 13px;
	}
	.hero :global(.hero-points) {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		margin: 14px 0 0;
		padding: 0;
		list-style: none;
		color: #4a5d78;
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
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--icon-green);
		color: #fff;
		content: '✓';
		font-size: 9px;
		font-weight: 800;
		line-height: 14px;
		text-align: center;
	}
	.hero-dashboard {
		min-height: 390px;
		border: 0;
		background: #bfe8d2 url('/art/dashboard-paper.svg') center / 100% 100% no-repeat;
		padding: var(--space-6) var(--space-7);
	}
	.hero-dashboard h1 {
		position: relative;
		width: max-content;
		max-width: 100%;
		padding: 0 1.4em;
		margin-left: -0.6em;
		font-family: Chewy, cursive;
		font-size: clamp(2.35rem, 4vw, 7.5rem);
		font-weight: 400;
		letter-spacing: 0.01em;
		line-height: 1.12;
	}
	.hero-dashboard h1::before {
		position: absolute;
		width: 28px;
		height: 36px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 36' fill='none'%3E%3Cpath d='M14 2v10M6 6l6 8M22 6l-6 8M4 20l8-2M24 20l-8-2' stroke='%231b2433' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		content: '';
		pointer-events: none;
	}
	.hero-dashboard h1::after {
		position: absolute;
		width: 28px;
		height: 36px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 36' fill='none'%3E%3Cpath d='M14 2v10M6 6l6 8M22 6l-6 8M4 20l8-2M24 20l-8-2' stroke='%231b2433' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		content: '';
		pointer-events: none;
	}
	.hero-dashboard h1::before {
		left: -1.35em;
		top: 0.15em;
		transform: rotate(-22deg);
	}
	.hero-dashboard h1::after {
		right: -1.2em;
		top: -0.1em;
		transform: rotate(18deg) scaleX(-1);
	}
	.hero-dashboard .hero-copy {
		flex: 0 1 42%;
		min-width: 280px;
	}
	:global(.hero-dashboard .actions .button) {
		border-radius: 999px;
		font-size: clamp(13px, 1cqw, 24px);
	}
	.hero-dashboard .hero-lead {
		max-width: max(400px, 28cqw);
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
		height: clamp(340px, 24cqw, 820px);
	}
	.hero.hero-templates {
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--cream) url('/art/scrapbook-paper.svg') center / 100% 100%;
		padding: var(--space-6) var(--space-7);
		gap: 0;
		isolation: isolate;
	}
	.hero-templates .hero-copy {
		flex: 0 0 43%;
		min-width: 0;
		transform: rotate(-3deg);
	}
	:global(.hero-templates .hero-kicker) {
		color: var(--scrapbook-green);
		border-bottom: 1px dashed currentColor;
		padding-bottom: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.hero-templates h1 {
		font-size: clamp(2rem, 3.5vw, 7.5rem);
		line-height: 1.25;
		letter-spacing: -0.05em;
	}
	:global(.hero-templates h1 span) {
		padding: 0 var(--space-2) var(--space-1);
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
		padding: 0 var(--space-2) var(--space-1);
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
		max-width: max(300px, 18cqw);
		padding-left: var(--space-2);
		color: var(--ink);
		font-family: 'Chewy', cursive;
		font-weight: 400;
		font-size: clamp(16px, 1.25cqw, 32px);
		line-height: 1.55;
	}
	.hero.hero-templates {
		min-height: 280px;
	}
	.hero.hero-packs {
		min-height: 360px;
		padding: var(--space-7) 4.6%;
		gap: 2%;
		border: 0;
		background: url('/art/packs-paper.svg') center / 100% 100% no-repeat;
	}
	.hero-packs .hero-copy {
		flex: 0 0 43%;
		min-width: 0;
	}
	.hero-packs h1 {
		font-size: clamp(2rem, 5.4cqw, 5.5rem);
		line-height: 1.04;
		letter-spacing: -0.055em;
	}
	:global(.hero-packs .hero-kicker) {
		font-size: clamp(10px, 1.1cqw, 18px);
		margin-bottom: var(--space-5);
	}
	:global(.hero-packs .hero-kicker svg) {
		width: 1.6em;
		height: 1.6em;
	}
	.hero-packs .hero-lead {
		max-width: none;
		font-size: clamp(13px, 1.45cqw, 25px);
		line-height: 1.45;
	}
	:global(.hero-packs .actions) {
		gap: var(--space-4);
		margin-top: var(--space-6);
	}
	:global(.hero-packs .button) {
		font-size: clamp(13px, 1.4cqw, 24px);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	:global(.hero-packs .button svg) {
		width: 1.4em;
		height: 1.4em;
	}
	@media (max-width: 1150px) {
		.hero {
			padding: var(--space-5);
		}
		.hero-dashboard {
			padding: var(--space-5);
			min-height: 300px;
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
			height: 250px;
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
			min-height: 0;
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-4);
			padding: var(--space-5);
			border-radius: 24px;
		}
		.hero-dashboard {
			min-height: 0;
		}
		:global(.hero-dashboard .collage) {
			flex: none;
			width: 100%;
			height: 250px;
		}
		.hero-copy {
			flex: 1 1 auto;
			min-width: 0;
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
			width: 100%;
			height: 250px;
		}
		.hero-packs {
			padding: var(--space-6) var(--space-5);
			gap: var(--space-6);
			background-size: auto 100%;
			background-position: left;
		}
		.hero-packs .hero-copy {
			flex: none;
			width: 100%;
		}
		.hero-packs h1 {
			font-size: clamp(1.8rem, 8.2vw, 2.8rem);
		}
		:global(.hero-packs .hero-kicker) {
			font-size: 10px;
			margin-bottom: var(--space-4);
		}
		.hero-packs .hero-lead {
			font-size: 14px;
		}
		:global(.hero-packs .actions) {
			margin-top: var(--space-5);
			gap: var(--space-3);
		}
		:global(.hero-packs .button) {
			padding: var(--space-3);
			border-radius: var(--radius-sm);
		}
		.hero-templates {
			padding: var(--space-6) var(--space-5);
			gap: var(--space-5);
		}
		.hero-templates .hero-copy {
			flex: none;
			width: 100%;
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
