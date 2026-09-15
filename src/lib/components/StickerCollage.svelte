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
			><path
				d="M8 8c18 2 38 6 48 22"
				stroke="#2a3348"
				stroke-width="1.6"
				stroke-linecap="round"
			/><path
				d="M46 22c6 4 10 10 12 16"
				stroke="#2a3348"
				stroke-width="1.6"
				stroke-linecap="round"
			/><path
				d="M52 34l10 6-8 4"
				stroke="#2a3348"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
			/></svg
		>
	{/if}
	<div class="collage-paper"></div>
	{#if variant === 'studio'}
		<span class="collage-grid"></span>
		<span class="collage-polaroid collage-polaroid-field"
			><img src={asset('/art/polaroid-field.svg')} alt="" decoding="async" /></span
		>
		<span class="collage-polaroid collage-polaroid-daisy"
			><img src={asset('/art/polaroid-daisy.svg')} alt="" decoding="async" /></span
		>
		<span class="collage-tape-gingham"></span>
		<span class="collage-tape-kraft collage-tape-left"></span>
		<span class="collage-tape-kraft collage-tape-bottom"></span>
		<span class="collage-aside-note">Same cats.<br />Brighter days. ♡</span>
		<img
			class="collage-star"
			src={asset('/art/stickers/17-yellow-star.webp')}
			alt=""
			decoding="async"
		/>
	{/if}
	{#if variant === 'packs'}
		<span class="collage-polaroid collage-polaroid-daisy"
			><img src={asset('/art/polaroid-daisy.svg')} alt="" decoding="async" /></span
		>
		<span class="collage-polaroid collage-polaroid-field"
			><img src={asset('/art/polaroid-field.svg')} alt="" decoding="async" /></span
		>
		<span class="collage-tape-gingham"></span>
		<span class="collage-tape"></span>
		<img
			class="collage-star"
			src={asset('/art/stickers/17-yellow-star.webp')}
			alt=""
			decoding="async"
		/>
		<span class="collage-aside-note">Good stickers.<br />Brighter days.<br />♡</span>
	{/if}
	{#if variant === 'templates'}
		<span class="collage-tape"></span>
		<img
			class="collage-star"
			src={asset('/art/stickers/07-yellow-sparkle.webp')}
			alt=""
			decoding="async"
		/>
		<span class="collage-margin-note">STICKERS<br />MAKE PEOPLE<br />HAPPIER ♡</span>
	{/if}
	<img
		class="hero-art collage-cat"
		src={asset(
			`/art/stickers/${variant === 'templates' ? '03-white-cat-good-vibes' : '01-orange-cat-meow'}.webp`
		)}
		alt=""
		decoding="async"
	/>
	<img
		class="collage-buddy"
		src={asset('/art/stickers/02-cat-stay-cool.webp')}
		alt=""
		decoding="async"
	/>
	{#if variant !== 'studio'}
		<img
			class="collage-lettering"
			src={asset(
				`/art/stickers/${variant === 'packs' ? '19-you-got-this' : '18-good-vibes-lettering'}.webp`
			)}
			alt=""
			decoding="async"
		/>
	{/if}
	<img
		class="collage-heart"
		src={asset('/art/stickers/14-large-pink-heart.webp')}
		alt=""
		decoding="async"
	/>
	{#if variant !== 'studio'}
		<img
			class="collage-sparkle"
			src={asset('/art/stickers/05-mint-sparkle-top.webp')}
			alt=""
			decoding="async"
		/>
	{/if}
	{#if variant !== 'studio'}
		<span class="collage-stamp">100% your kind of fun{variant === 'templates' ? ' ☺' : ''}</span>
	{/if}
</div>
