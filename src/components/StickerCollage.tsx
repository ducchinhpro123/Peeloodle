/** Decorative user-supplied artwork; never a preview of a saved project. */
export function StickerCollage({ variant = 'studio' }: { variant?: 'studio' | 'templates' | 'packs' }) {
  return (
    <div className={`collage collage-${variant}`} aria-hidden="true">
      <span className="collage-note">a little weird. a lot of you.</span>
      <div className="collage-paper" />
      <img className="hero-art collage-cat" src={`/art/stickers/${variant === 'templates' ? '03-white-cat-good-vibes' : '01-orange-cat-meow'}.webp`} alt="" decoding="async" />
      <img className="collage-buddy" src="/art/stickers/02-cat-stay-cool.webp" alt="" decoding="async" />
      <img className="collage-lettering" src={`/art/stickers/${variant === 'packs' ? '19-you-got-this' : '18-good-vibes-lettering'}.webp`} alt="" decoding="async" />
      <img className="collage-heart" src="/art/stickers/14-large-pink-heart.webp" alt="" decoding="async" />
      <img className="collage-sparkle" src="/art/stickers/05-mint-sparkle-top.webp" alt="" decoding="async" />
      <span className="collage-stamp">100% your kind of fun</span>
    </div>
  )
}
