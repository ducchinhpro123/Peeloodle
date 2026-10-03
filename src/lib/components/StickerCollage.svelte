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
		min-width: 0;
		height: 320px;
		isolation: isolate;
	}
	.collage img {
		position: absolute;
		object-fit: contain;
		filter: drop-shadow(0 6px 3px #20304a16);
		pointer-events: none;
	}
	.collage-paper {
		position: absolute;
		inset: 12% 8% 6% 12%;
		border: 1px solid #ffffffb3;
		border-radius: 46% 54% 36% 64%;
		background: #c2ebdd;
		transform: rotate(-9deg);
	}
	.collage-cat {
		width: 48%;
		height: 83%;
		left: 1%;
		top: 11%;
		transform: rotate(-12deg);
		z-index: 1;
	}
	.collage-buddy {
		width: 47%;
		height: 84%;
		right: 3%;
		top: 2%;
		transform: rotate(10deg);
	}
	.collage-lettering {
		width: 31%;
		height: 40%;
		right: 29%;
		bottom: 0;
		transform: rotate(-8deg);
		z-index: 2;
	}
	.collage-heart {
		width: 14%;
		height: 24%;
		right: 0;
		bottom: 2%;
		transform: rotate(15deg);
	}
	.collage-sparkle {
		width: 11%;
		height: 20%;
		left: 41%;
		top: 0;
		transform: rotate(12deg);
	}
	.collage-note {
		position: absolute;
		z-index: 3;
		font-size: 10px;
		font-weight: 800;
	}
	.collage-note {
		left: 2%;
		top: 0;
		transform: rotate(-6deg);
		color: #4b6258;
	}
	.collage-stamp {
		bottom: 2%;
		left: 0;
		padding: 6px 10px;
		border: 1px solid #d8c57d;
		background: #fff0a8;
		transform: rotate(5deg);
		border-radius: 4px;
	}
	.collage-studio .collage-paper {
		display: none;
	}
	.collage-studio .collage-grid {
		position: absolute;
		right: -2%;
		bottom: -8%;
		z-index: 0;
		width: 42%;
		height: 46%;
		background:
			repeating-linear-gradient(#0000 0 14px, #d7c9b08c 14px 15px),
			repeating-linear-gradient(90deg, #0000 0 14px, #d7c9b08c 14px 15px), #f4ead6;
		clip-path: polygon(8% 0, 100% 6%, 96% 100%, 0 90%);
		transform: rotate(5deg);
	}
	.collage-polaroid {
		position: absolute;
		z-index: 1;
		padding: 7px 7px 22px;
		background: #fff;
		box-shadow: 0 8px 18px #08152f22;
	}
	.collage-polaroid img {
		position: relative;
		inset: auto;
		width: 100%;
		height: calc(100% - 4px);
		object-fit: cover;
		filter: none;
	}
	.collage-polaroid-field {
		left: 2%;
		top: 22%;
		width: 34%;
		height: 52%;
		transform: rotate(-12deg);
	}
	.collage-polaroid-daisy {
		right: 2%;
		top: -6%;
		width: 28%;
		height: 42%;
		transform: rotate(11deg);
	}
	.collage-studio .collage-cat {
		width: 54%;
		height: 90%;
		left: 8%;
		top: 8%;
		transform: rotate(-6deg);
		z-index: 3;
	}
	.collage-studio .collage-buddy {
		width: 48%;
		height: 88%;
		right: 0;
		top: 4%;
		transform: rotate(7deg);
		z-index: 4;
	}
	.collage-studio .collage-heart {
		display: none;
	}
	.collage-studio .collage-note {
		left: 22%;
		right: auto;
		top: -14%;
		z-index: 6;
		padding: 7px 9px;
		background: #f7f1e4;
		box-shadow: 0 4px 10px #08152f14;
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
		left: 52%;
		right: auto;
		top: 2%;
		z-index: 6;
		width: 58px;
		height: 40px;
		transform: rotate(22deg);
	}
	.collage-tape-gingham {
		position: absolute;
		top: 4%;
		right: 6%;
		width: 26%;
		height: 15px;
		background:
			repeating-linear-gradient(90deg, #ef9aa088 0 8px, transparent 8px 16px),
			repeating-linear-gradient(0deg, #ef9aa088 0 8px, #fde8e4 8px 16px);
		transform: rotate(-16deg);
		z-index: 2;
	}
	.collage-tape-kraft {
		position: absolute;
		z-index: 2;
		height: 16px;
		background: repeating-linear-gradient(#0000 0 3px, #00000012 3px 4px), #e6d3a8;
		box-shadow: 0 2px 6px #08152f14;
	}
	.collage-tape-left {
		left: 6%;
		top: 62%;
		width: 20%;
		transform: rotate(-30deg);
	}
	.collage-tape-bottom {
		left: 40%;
		bottom: 6%;
		width: 24%;
		transform: rotate(10deg);
	}
	.collage-studio .collage-aside-note {
		position: absolute;
		right: 0;
		bottom: 4%;
		z-index: 5;
		max-width: 96px;
		padding: 8px 10px;
		background: #d9c6f5;
		box-shadow: 0 4px 10px #08152f16;
		color: var(--ink);
		font:
			12px/1.25 Chewy,
			cursive;
		transform: rotate(9deg);
	}
	.collage-studio .collage-star {
		width: 13%;
		height: 22%;
		left: auto;
		right: 4%;
		top: auto;
		bottom: 18%;
		transform: rotate(18deg);
		z-index: 5;
	}
	.collage-templates .collage-paper {
		display: none;
	}
	.collage-templates .collage-cat {
		width: 53%;
		height: 87%;
		left: -2%;
		top: 12%;
		transform: rotate(-10deg);
	}
	.collage-templates .collage-buddy {
		width: 48%;
		height: 96%;
		right: 1%;
		top: -4%;
		transform: rotate(9deg);
	}
	.collage-templates .collage-lettering {
		width: 27%;
		height: 36%;
		right: 25%;
		bottom: -4%;
		transform: rotate(-14deg);
	}
	.collage-templates .collage-sparkle {
		left: 33%;
		top: -9%;
	}
	.collage-templates .collage-heart {
		right: -6%;
		bottom: 3%;
	}
	.collage-templates .collage-note {
		left: 2%;
		top: -9%;
		color: var(--ink);
		font-family: 'Chewy', cursive;
		font-size: 13px;
	}
	.collage-templates .collage-stamp {
		left: -20%;
		bottom: -5%;
		background: var(--scrapbook-yellow);
		color: var(--ink);
		border: 0;
		border-radius: 0;
		padding: var(--space-2) var(--space-3);
		font-family: 'Chewy', cursive;
		font-size: 14px;
		box-shadow: var(--shadow);
	}
	.collage-templates .collage-star {
		width: 15%;
		height: 25%;
		left: 42%;
		top: -1%;
		transform: rotate(14deg);
		z-index: 2;
	}
	.collage-tape {
		position: absolute;
		width: 29%;
		height: 30px;
		right: 2%;
		bottom: -7%;
		background:
			repeating-linear-gradient(90deg, #00875e66 0 8px, transparent 8px 16px),
			repeating-linear-gradient(0deg, #00875e66 0 8px, #fff5d8 8px 16px);
		transform: rotate(13deg);
		z-index: 2;
	}
	.collage-margin-note {
		position: absolute;
		right: -4%;
		bottom: 30%;
		transform: rotate(12deg);
		font:
			12px/1.2 'Chewy',
			cursive;
		background: var(--cream);
		padding: var(--space-2);
		z-index: 2;
	}
	.collage-templates {
		height: clamp(240px, 20cqw, 780px);
	}
	.collage-packs {
		flex: 1 1 55%;
		height: clamp(280px, 29cqw, 520px);
	}
	.collage-packs .collage-paper {
		display: none;
	}
	.collage-packs .collage-cat {
		left: -2%;
		top: 13%;
		width: 48%;
		height: 85%;
		transform: rotate(-10deg);
		z-index: 3;
	}
	.collage-packs .collage-buddy {
		right: 4%;
		top: 4%;
		width: 49%;
		height: 85%;
		transform: rotate(9deg);
		z-index: 3;
	}
	.collage-packs .collage-lettering {
		right: 29%;
		bottom: -2%;
		width: 27%;
		height: 40%;
		transform: rotate(8deg);
		z-index: 4;
	}
	.collage-packs .collage-heart {
		right: -3%;
		bottom: 0;
		z-index: 4;
	}
	.collage-packs .collage-sparkle {
		left: 40%;
		top: 24%;
		z-index: 4;
	}
	.collage-packs .collage-polaroid-daisy {
		left: -4%;
		right: auto;
		top: -3%;
		width: 34%;
		height: 52%;
		transform: rotate(-12deg);
	}
	.collage-packs .collage-polaroid-field {
		left: auto;
		right: -7%;
		top: 0;
		width: 29%;
		height: 52%;
		transform: rotate(9deg);
	}
	.collage-packs .collage-tape-gingham {
		left: 0;
		right: auto;
		top: -7%;
		width: 20%;
		height: 8%;
		background:
			repeating-linear-gradient(90deg, #63b78777 0 5px, transparent 5px 10px),
			repeating-linear-gradient(0deg, #63b78777 0 5px, #f5f4d9 5px 10px);
	}
	.collage-packs .collage-tape {
		right: -2%;
		top: -3%;
		bottom: auto;
		width: 18%;
		height: 9%;
		background: repeating-linear-gradient(45deg, transparent 0 10px, #fff8 10px 11px), var(--blush);
		transform: rotate(24deg);
	}
	.collage-packs .collage-note {
		left: 30%;
		top: -6%;
		padding: var(--space-3) var(--space-4);
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
		left: -4%;
		bottom: -5%;
		padding: var(--space-3) var(--space-4);
		border: 0;
		box-shadow: var(--shadow-hover);
		font:
			400 clamp(13px, 1.5cqw, 25px)/1.2 'Chewy',
			cursive;
		transform: rotate(2deg);
	}
	.collage-packs .collage-star {
		right: -8%;
		top: 53%;
		width: 11%;
		height: 18%;
		z-index: 4;
	}
	.collage-packs .collage-aside-note {
		position: absolute;
		right: -8%;
		bottom: -13%;
		color: var(--ink);
		font:
			400 clamp(11px, 1.3cqw, 22px)/1.25 'Chewy',
			cursive;
		text-align: center;
		transform: rotate(-12deg);
	}
	@media (max-width: 1150px) {
		.collage {
			height: 260px;
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
			left: 2%;
			top: 2%;
			width: 58%;
			height: 100%;
		}
		.collage-studio .collage-buddy {
			right: -6%;
			top: 0;
			width: 54%;
			height: 100%;
		}
		.collage-polaroid-field {
			width: 36%;
			height: 48%;
		}
		.collage-polaroid-daisy {
			width: 30%;
			height: 40%;
		}
		.collage {
			flex: none;
			width: 100%;
			height: 210px;
		}
		.collage-templates {
			height: 180px;
		}
		.collage-packs {
			flex: none;
			height: 230px;
			width: 100%;
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
			height: 220px;
		}
		.collage-templates .collage-stamp {
			display: block;
			left: 0;
			bottom: -5%;
			font-size: 12px;
		}
		.collage-studio .collage-cat {
			width: 48%;
			height: 82%;
		}
	}
</style>
