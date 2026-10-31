<script>
	import { asset } from '$app/paths';

	/** Decorative user-supplied artwork; never a preview of a saved project. */
	/** @type {{ variant?: 'studio' | 'templates' | 'packs' }} */
	let { variant = 'studio' } = $props();
</script>

<div class={`collage collage-${variant}`} aria-hidden="true">
	<span class="collage-note">A little weird.<br />A lot of you. ♡</span>
	{#if variant === 'studio'}
		<svg class="collage-arrow" viewBox="0 0 72 48" fill="none" aria-hidden="true"
			><path d="M8 8c18 2 38 6 48 22" stroke="#2a3348" stroke-width="1.6" stroke-linecap="round"
			></path>

			<path d="M46 22c6 4 10 10 12 16" stroke="#2a3348" stroke-width="1.6" stroke-linecap="round"
			></path>

			<path
				d="M52 34l10 6-8 4"
				stroke="#2a3348"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
			></path>
		</svg>
	{/if}
	<div class="collage-paper"></div>
	{#if variant === 'studio'}
		<span class="collage-grid"></span>

		<span class="collage-polaroid collage-polaroid-field">
			<img src={asset('art/polaroid-field.svg')} alt="" decoding="async" />
		</span>

		<span class="collage-polaroid collage-polaroid-daisy">
			<img src={asset('art/polaroid-daisy.svg')} alt="" decoding="async" />
		</span>

		<span class="collage-tape-gingham"></span>
		<span class="collage-tape-kraft collage-tape-left"></span>
		<span class="collage-tape-kraft collage-tape-bottom"></span>
		<span class="collage-aside-note">Same cats.<br />Brighter days. ♡</span>
		<img
			class="collage-star"
			src={asset('art/stickers/17-yellow-star.webp')}
			alt=""
			decoding="async"
		/>
	{/if}
	{#if variant === 'packs'}
		<span class="collage-polaroid collage-polaroid-daisy">
			<img src={asset('art/polaroid-daisy.svg')} alt="" decoding="async" />
		</span>

		<span class="collage-polaroid collage-polaroid-field">
			<img src={asset('art/polaroid-field.svg')} alt="" decoding="async" />
		</span>

		<span class="collage-tape-gingham"></span>
		<span class="collage-tape"></span>
		<img
			class="collage-star"
			src={asset('art/stickers/17-yellow-star.webp')}
			alt=""
			decoding="async"
		/>
		<span class="collage-aside-note">Good stickers.<br />Brighter days.<br />♡</span>
	{/if}
	{#if variant === 'templates'}
		<span class="collage-tape"></span>
		<img
			class="collage-star"
			src={asset('art/stickers/07-yellow-sparkle.webp')}
			alt=""
			decoding="async"
		/>
		<span class="collage-margin-note">STICKERS<br />MAKE PEOPLE<br />HAPPIER ♡</span>
	{/if}
	<img
		class="hero-art collage-cat"
		src={asset(
			`art/stickers/${variant === 'templates' ? '03-white-cat-good-vibes' : '01-orange-cat-meow'}.webp`
		)}
		alt=""
		decoding="async"
	/>
	<img
		class="collage-buddy"
		src={asset('art/stickers/02-cat-stay-cool.webp')}
		alt=""
		decoding="async"
	/>
	{#if variant !== 'studio'}
		<img
			class="collage-lettering"
			src={asset(
				`art/stickers/${variant === 'packs' ? '19-you-got-this' : '18-good-vibes-lettering'}.webp`
			)}
			alt=""
			decoding="async"
		/>
	{/if}
	<img
		class="collage-heart"
		src={asset('art/stickers/14-large-pink-heart.webp')}
		alt=""
		decoding="async"
	/>
	{#if variant !== 'studio'}
		<img
			class="collage-sparkle"
			src={asset('art/stickers/05-mint-sparkle-top.webp')}
			alt=""
			decoding="async"
		/>
	{/if}
	{#if variant !== 'studio'}
		<span class="collage-stamp [position:absolute] [z-index:3] [font-size:10px] [font-weight:800]"
			>100% your kind of fun{variant === 'templates' ? ' ☺' : ''}</span
		>
	{/if}
</div>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.collage {
		position: relative;
		flex: 1 1 50%;
		min-inline-size: 0;
		block-size: 320px;
		isolation: isolate;
	}
	.collage img {
		position: absolute;
		object-fit: contain;
		filter: drop-shadow(
			0 6px 3px color-mix(in oklch, oklch(0.30833 0.051822 259.7795) 8.6275%, transparent)
		);
		pointer-events: none;
	}
	.collage-paper {
		position: absolute;
		inset-block-start: 12%;
		inset-block-end: 6%;
		inset-inline-start: 12%;
		inset-inline-end: 8%;
		border: 1px solid color-mix(in oklch, oklch(1 0 none) 70.1961%, transparent);
		border-radius: 46% 54% 36% 64%;
		background: oklch(0.90708 0.04661 172.5003);
		transform: rotate(-9deg);
	}
	.collage-cat {
		inline-size: 48%;
		block-size: 83%;
		inset-inline-start: 1%;
		inset-block-start: 11%;
		transform: rotate(-12deg);
		z-index: 1;
	}
	.collage-buddy {
		inline-size: 47%;
		block-size: 84%;
		inset-inline-end: 3%;
		inset-block-start: 2%;
		transform: rotate(10deg);
	}
	.collage-lettering {
		inline-size: 31%;
		block-size: 40%;
		inset-inline-end: 29%;
		inset-block-end: 0;
		transform: rotate(-8deg);
		z-index: 2;
	}
	.collage-heart {
		inline-size: 14%;
		block-size: 24%;
		inset-inline-end: 0;
		inset-block-end: 2%;
		transform: rotate(15deg);
	}
	.collage-sparkle {
		inline-size: 11%;
		block-size: 20%;
		inset-inline-start: 41%;
		inset-block-start: 0;
		transform: rotate(12deg);
	}
	.collage-note {
		position: absolute;
		z-index: 3;
		font-size: 10px;
		font-weight: 800;
	}
	.collage-note {
		inset-inline-start: 2%;
		inset-block-start: 0;
		transform: rotate(-6deg);
		color: oklch(0.474182 0.032035 166.6032);
	}
	.collage-stamp {
		inset-block-end: 2%;
		inset-inline-start: 0;
		padding-block-start: 6px;
		padding-block-end: 6px;
		padding-inline-start: 10px;
		padding-inline-end: 10px;
		border: 1px solid oklch(0.823236 0.094208 95.0895);
		background: oklch(0.950685 0.091931 97.8146);
		transform: rotate(5deg);
		border-radius: 4px;
	}
	.collage-studio .collage-paper {
		display: none;
	}
	.collage-studio .collage-grid {
		position: absolute;
		inset-inline-end: -2%;
		inset-block-end: -8%;
		z-index: 0;
		inline-size: 42%;
		block-size: 46%;
		background:
			repeating-linear-gradient(
				color-mix(in oklch, oklch(0 0 none) 0%, transparent) 0 14px,
				color-mix(in oklch, oklch(0.840761 0.037232 82.158) 54.902%, transparent) 14px 15px
			),
			repeating-linear-gradient(
				90deg,
				color-mix(in oklch, oklch(0 0 none) 0%, transparent) 0 14px,
				color-mix(in oklch, oklch(0.840761 0.037232 82.158) 54.902%, transparent) 14px 15px
			),
			oklch(0.939609 0.028607 84.5929);
		clip-path: polygon(8% 0, 100% 6%, 96% 100%, 0 90%);
		transform: rotate(5deg);
	}
	.collage-polaroid {
		position: absolute;
		z-index: 1;
		padding-block-start: 7px;
		padding-block-end: 22px;
		padding-inline-start: 7px;
		padding-inline-end: 7px;
		background: oklch(1 0 none);
		box-shadow: 0 8px 18px
			color-mix(in oklch, oklch(0.201186 0.055198 262.3998) 13.3333%, transparent);
	}
	.collage-polaroid img {
		position: relative;
		inset: auto;
		inline-size: 100%;
		block-size: calc(100% - 4px);
		object-fit: cover;
		filter: none;
	}
	.collage-polaroid-field {
		inset-inline-start: 2%;
		inset-block-start: 22%;
		inline-size: 34%;
		block-size: 52%;
		transform: rotate(-12deg);
	}
	.collage-polaroid-daisy {
		inset-inline-end: 2%;
		inset-block-start: -6%;
		inline-size: 28%;
		block-size: 42%;
		transform: rotate(11deg);
	}
	.collage-studio .collage-cat {
		inline-size: 54%;
		block-size: 90%;
		inset-inline-start: 8%;
		inset-block-start: 8%;
		transform: rotate(-6deg);
		z-index: 3;
	}
	.collage-studio .collage-buddy {
		inline-size: 48%;
		block-size: 88%;
		inset-inline-end: 0;
		inset-block-start: 4%;
		transform: rotate(7deg);
		z-index: 4;
	}
	.collage-studio .collage-heart {
		display: none;
	}
	.collage-studio .collage-note {
		inset-inline-start: 22%;
		inset-inline-end: auto;
		inset-block-start: -14%;
		z-index: 6;
		padding-block-start: 7px;
		padding-block-end: 7px;
		padding-inline-start: 9px;
		padding-inline-end: 9px;
		background: oklch(0.959285 0.01838 86.1469);
		box-shadow: 0 4px 10px
			color-mix(in oklch, oklch(0.201186 0.055198 262.3998) 7.8431%, transparent);
		color: var(--ink);
		font-family: Chewy, cursive;
		font-size: 13px;
		font-weight: 400;
		line-height: 1.2;
		text-align: center;
		transform: rotate(7deg);
	}
	.collage-studio .collage-arrow {
		position: absolute;
		inset-inline-start: 52%;
		inset-inline-end: auto;
		inset-block-start: 2%;
		z-index: 6;
		inline-size: 58px;
		block-size: 40px;
		transform: rotate(22deg);
	}
	.collage-tape-gingham {
		position: absolute;
		inset-block-start: 4%;
		inset-inline-end: 6%;
		inline-size: 26%;
		block-size: 15px;
		background:
			repeating-linear-gradient(
				90deg,
				color-mix(in oklch, oklch(0.773069 0.10222 15.1171) 53.3333%, transparent) 0 8px,
				transparent 8px 16px
			),
			repeating-linear-gradient(
				0deg,
				color-mix(in oklch, oklch(0.773069 0.10222 15.1171) 53.3333%, transparent) 0 8px,
				oklch(0.946741 0.023669 30.4883) 8px 16px
			);
		transform: rotate(-16deg);
		z-index: 2;
	}
	.collage-tape-kraft {
		position: absolute;
		z-index: 2;
		block-size: 16px;
		background:
			repeating-linear-gradient(
				color-mix(in oklch, oklch(0 0 none) 0%, transparent) 0 3px,
				color-mix(in oklch, oklch(0 0 none) 7.0588%, transparent) 3px 4px
			),
			oklch(0.871817 0.060321 86.9607);
		box-shadow: 0 2px 6px
			color-mix(in oklch, oklch(0.201186 0.055198 262.3998) 7.8431%, transparent);
	}
	.collage-tape-left {
		inset-inline-start: 6%;
		inset-block-start: 62%;
		inline-size: 20%;
		transform: rotate(-30deg);
	}
	.collage-tape-bottom {
		inset-inline-start: 40%;
		inset-block-end: 6%;
		inline-size: 24%;
		transform: rotate(10deg);
	}
	.collage-studio .collage-aside-note {
		position: absolute;
		inset-inline-end: 0;
		inset-block-end: 4%;
		z-index: 5;
		max-inline-size: 96px;
		padding-block-start: 8px;
		padding-block-end: 8px;
		padding-inline-start: 10px;
		padding-inline-end: 10px;
		background: oklch(0.857358 0.06731 303.406);
		box-shadow: 0 4px 10px
			color-mix(in oklch, oklch(0.201186 0.055198 262.3998) 8.6275%, transparent);
		color: var(--ink);
		font:
			12px/1.25 Chewy,
			cursive;
		transform: rotate(9deg);
	}
	.collage-studio .collage-star {
		inline-size: 13%;
		block-size: 22%;
		inset-inline-start: auto;
		inset-inline-end: 4%;
		inset-block-start: auto;
		inset-block-end: 18%;
		transform: rotate(18deg);
		z-index: 5;
	}
	.collage-templates .collage-paper {
		display: none;
	}
	.collage-templates .collage-cat {
		inline-size: 53%;
		block-size: 87%;
		inset-inline-start: -2%;
		inset-block-start: 12%;
		transform: rotate(-10deg);
	}
	.collage-templates .collage-buddy {
		inline-size: 48%;
		block-size: 96%;
		inset-inline-end: 1%;
		inset-block-start: -4%;
		transform: rotate(9deg);
	}
	.collage-templates .collage-lettering {
		inline-size: 27%;
		block-size: 36%;
		inset-inline-end: 25%;
		inset-block-end: -4%;
		transform: rotate(-14deg);
	}
	.collage-templates .collage-sparkle {
		inset-inline-start: 33%;
		inset-block-start: -9%;
	}
	.collage-templates .collage-heart {
		inset-inline-end: -6%;
		inset-block-end: 3%;
	}
	.collage-templates .collage-note {
		inset-inline-start: 2%;
		inset-block-start: -9%;
		color: var(--ink);
		font-family: 'Chewy', cursive;
		font-size: 13px;
	}
	.collage-templates .collage-stamp {
		inset-inline-start: -20%;
		inset-block-end: -5%;
		background: var(--scrapbook-yellow);
		color: var(--ink);
		border: 0;
		border-radius: 0;
		padding-block-start: var(--space-2);
		padding-block-end: var(--space-2);
		padding-inline-start: var(--space-3);
		padding-inline-end: var(--space-3);
		font-family: 'Chewy', cursive;
		font-size: 14px;
		box-shadow: var(--shadow);
	}
	.collage-templates .collage-star {
		inline-size: 15%;
		block-size: 25%;
		inset-inline-start: 42%;
		inset-block-start: -1%;
		transform: rotate(14deg);
		z-index: 2;
	}
	.collage-tape {
		position: absolute;
		inline-size: 29%;
		block-size: 30px;
		inset-inline-end: 2%;
		inset-block-end: -7%;
		background:
			repeating-linear-gradient(
				90deg,
				color-mix(in oklch, oklch(0.551582 0.11869 163.307) 40%, transparent) 0 8px,
				transparent 8px 16px
			),
			repeating-linear-gradient(
				0deg,
				color-mix(in oklch, oklch(0.551582 0.11869 163.307) 40%, transparent) 0 8px,
				oklch(0.97048 0.03932 91.1964) 8px 16px
			);
		transform: rotate(13deg);
		z-index: 2;
	}
	.collage-margin-note {
		position: absolute;
		inset-inline-end: -4%;
		inset-block-end: 30%;
		transform: rotate(12deg);
		font:
			12px/1.2 'Chewy',
			cursive;
		background: var(--cream);
		padding: var(--space-2);
		z-index: 2;
	}
	.collage-templates {
		block-size: clamp(240px, 20cqw, 780px);
	}
	.collage-packs {
		flex: 1 1 55%;
		block-size: clamp(280px, 29cqw, 520px);
	}
	.collage-packs .collage-paper {
		display: none;
	}
	.collage-packs .collage-cat {
		inset-inline-start: -2%;
		inset-block-start: 13%;
		inline-size: 48%;
		block-size: 85%;
		transform: rotate(-10deg);
		z-index: 3;
	}
	.collage-packs .collage-buddy {
		inset-inline-end: 4%;
		inset-block-start: 4%;
		inline-size: 49%;
		block-size: 85%;
		transform: rotate(9deg);
		z-index: 3;
	}
	.collage-packs .collage-lettering {
		inset-inline-end: 29%;
		inset-block-end: -2%;
		inline-size: 27%;
		block-size: 40%;
		transform: rotate(8deg);
		z-index: 4;
	}
	.collage-packs .collage-heart {
		inset-inline-end: -3%;
		inset-block-end: 0;
		z-index: 4;
	}
	.collage-packs .collage-sparkle {
		inset-inline-start: 40%;
		inset-block-start: 24%;
		z-index: 4;
	}
	.collage-packs .collage-polaroid-daisy {
		inset-inline-start: -4%;
		inset-inline-end: auto;
		inset-block-start: -3%;
		inline-size: 34%;
		block-size: 52%;
		transform: rotate(-12deg);
	}
	.collage-packs .collage-polaroid-field {
		inset-inline-start: auto;
		inset-inline-end: -7%;
		inset-block-start: 0;
		inline-size: 29%;
		block-size: 52%;
		transform: rotate(9deg);
	}
	.collage-packs .collage-tape-gingham {
		inset-inline-start: 0;
		inset-inline-end: auto;
		inset-block-start: -7%;
		inline-size: 20%;
		block-size: 8%;
		background:
			repeating-linear-gradient(
				90deg,
				color-mix(in oklch, oklch(0.713103 0.109036 157.0733) 46.6667%, transparent) 0 5px,
				transparent 5px 10px
			),
			repeating-linear-gradient(
				0deg,
				color-mix(in oklch, oklch(0.713103 0.109036 157.0733) 46.6667%, transparent) 0 5px,
				oklch(0.960859 0.035399 105.3136) 5px 10px
			);
	}
	.collage-packs .collage-tape {
		inset-inline-end: -2%;
		inset-block-start: -3%;
		inset-block-end: auto;
		inline-size: 18%;
		block-size: 9%;
		background:
			repeating-linear-gradient(
				45deg,
				transparent 0 10px,
				color-mix(in oklch, oklch(1 0 none) 53.3333%, transparent) 10px 11px
			),
			var(--blush);
		transform: rotate(24deg);
	}
	.collage-packs .collage-note {
		inset-inline-start: 30%;
		inset-block-start: -6%;
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		color: var(--ink);
		background: var(--canvas);
		box-shadow: var(--shadow-hover);
		font:
			400 clamp(12px, 1.5cqw, 25px)/1.3 'Chewy',
			cursive;
		transform: rotate(-9deg);
		z-index: 5;
	}
	.collage-packs .collage-stamp {
		inset-inline-start: -4%;
		inset-block-end: -5%;
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		border: 0;
		box-shadow: var(--shadow-hover);
		font:
			400 clamp(13px, 1.5cqw, 25px)/1.2 'Chewy',
			cursive;
		transform: rotate(2deg);
	}
	.collage-packs .collage-star {
		inset-inline-end: -8%;
		inset-block-start: 53%;
		inline-size: 11%;
		block-size: 18%;
		z-index: 4;
	}
	.collage-packs .collage-aside-note {
		position: absolute;
		inset-inline-end: -8%;
		inset-block-end: -13%;
		color: var(--ink);
		font:
			400 clamp(11px, 1.3cqw, 22px)/1.25 'Chewy',
			cursive;
		text-align: center;
		transform: rotate(-12deg);
	}
	@media (max-width: 1150px) {
		.collage {
			block-size: 260px;
		}
		.collage-note {
			display: none;
		}
		.collage-stamp {
			display: none;
		}
		.collage-arrow {
			display: none;
		}
		.collage-margin-note {
			display: none;
		}
		.collage-aside-note {
			display: none;
		}
	}
	@media (max-width: 720px) {
		.collage-studio .collage-cat {
			inset-inline-start: 2%;
			inset-block-start: 2%;
			inline-size: 58%;
			block-size: 100%;
		}
		.collage-studio .collage-buddy {
			inset-inline-end: -6%;
			inset-block-start: 0;
			inline-size: 54%;
			block-size: 100%;
		}
		.collage-polaroid-field {
			inline-size: 36%;
			block-size: 48%;
		}
		.collage-polaroid-daisy {
			inline-size: 30%;
			block-size: 40%;
		}
		.collage {
			flex: none;
			inline-size: 100%;
			block-size: 210px;
		}
		.collage-templates {
			block-size: 180px;
		}
		.collage-packs {
			flex: none;
			block-size: 230px;
			inline-size: 100%;
		}
		.collage-packs .collage-note {
			display: block;
			font-size: 12px;
		}
		.collage-packs .collage-stamp {
			display: block;
			font-size: 13px;
		}
		.collage-templates {
			block-size: 220px;
		}
		.collage-templates .collage-stamp {
			display: block;
			inset-inline-start: 0;
			inset-block-end: -5%;
			font-size: 12px;
		}
		.collage-studio .collage-cat {
			inline-size: 48%;
			block-size: 82%;
		}
	}
	/*
	 * Motion uses the independent `scale` / `translate` / `rotate` properties so it
	 * stacks on top of each element's own `transform: rotate(...)` instead of
	 * replacing it.
	 */
	@media (prefers-reduced-motion: no-preference) {
		.collage-cat,
		.collage-buddy,
		.collage-heart,
		.collage-sparkle,
		.collage-lettering,
		.collage-note,
		.collage-stamp,
		.collage-polaroid,
		.collage-star {
			animation: sticker-pop 560ms var(--ease-pop) backwards;
		}
		.collage-cat {
			animation-delay: 120ms;
		}
		.collage-buddy {
			animation-delay: 220ms;
		}
		.collage-polaroid-field {
			animation-delay: 180ms;
		}
		.collage-polaroid-daisy {
			animation-delay: 280ms;
		}
		.collage-heart {
			animation-delay: 340ms;
		}
		.collage-sparkle,
		.collage-star {
			animation-delay: 420ms;
		}
		.collage-lettering,
		.collage-note,
		.collage-stamp {
			animation-delay: 380ms;
		}
		/* Ambient drift starts after the entrance so the two never fight. */
		.collage-cat {
			animation:
				sticker-pop 560ms var(--ease-pop) 120ms backwards,
				drift 6s ease-in-out 700ms infinite;
		}
		.collage-heart,
		.collage-sparkle {
			animation:
				sticker-pop 560ms var(--ease-pop) 340ms backwards,
				drift 4.5s ease-in-out 900ms infinite;
		}
		.collage-sparkle {
			animation-direction: normal, reverse;
		}
		@keyframes sticker-pop {
			from {
				opacity: 0;
				scale: 0.5;
				rotate: -10deg;
			}
			to {
				opacity: 1;
				scale: 1;
				rotate: 0deg;
			}
		}
		@keyframes drift {
			0%,
			100% {
				translate: 0 0;
			}
			50% {
				translate: 0 -8px;
			}
		}
	}
	@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
		.collage-polaroid,
		.collage-buddy {
			transition:
				rotate var(--dur-base) var(--ease-pop),
				scale var(--dur-base) var(--ease-pop);
		}
		.collage:hover .collage-polaroid {
			rotate: 2deg;
			scale: 1.03;
		}
		.collage:hover .collage-buddy {
			rotate: -6deg;
			scale: 1.08;
		}
	}
</style>
