/** Decorative user-supplied artwork; never a preview of a saved project. */
export function StickerCollage({ variant = 'studio' }: { variant?: 'studio' | 'templates' | 'packs' }) {
  return (
    <div className={`collage collage-${variant}`} aria-hidden="true">
      <span className="collage-note">A little weird.<br />A lot of you. ♡</span>
      {variant === 'studio' ? <svg className="collage-arrow" viewBox="0 0 72 48" fill="none" aria-hidden="true"><path d="M8 8c18 2 38 6 48 22" stroke="#2a3348" strokeWidth="1.6" strokeLinecap="round" /><path d="M46 22c6 4 10 10 12 16" stroke="#2a3348" strokeWidth="1.6" strokeLinecap="round" /><path d="M52 34l10 6-8 4" stroke="#2a3348" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
      <div className="collage-paper" />
      {variant === 'studio' && <>
        <span className="collage-grid" />
        <span className="collage-polaroid collage-polaroid-field"><img src="/art/polaroid-field.svg" alt="" decoding="async" /></span>
        <span className="collage-polaroid collage-polaroid-daisy"><img src="/art/polaroid-daisy.svg" alt="" decoding="async" /></span>
        <span className="collage-tape-gingham" />
        <span className="collage-tape-kraft collage-tape-left" />
        <span className="collage-tape-kraft collage-tape-bottom" />
        <span className="collage-aside-note">Same cats.<br />Brighter days. ♡</span>
        <img className="collage-star" src="/art/stickers/17-yellow-star.webp" alt="" decoding="async" />
      </>}
      {variant === 'templates' && <>
        <span className="collage-tape" />
        <img className="collage-star" src="/art/stickers/07-yellow-sparkle.webp" alt="" decoding="async" />
        <span className="collage-margin-note">STICKERS<br />MAKE PEOPLE<br />HAPPIER ♡</span>
      </>}
      <img className="hero-art collage-cat" src={`/art/stickers/${variant === 'templates' ? '03-white-cat-good-vibes' : '01-orange-cat-meow'}.webp`} alt="" decoding="async" />
      <img className="collage-buddy" src="/art/stickers/02-cat-stay-cool.webp" alt="" decoding="async" />
      {variant !== 'studio' && <img className="collage-lettering" src={`/art/stickers/${variant === 'packs' ? '19-you-got-this' : '18-good-vibes-lettering'}.webp`} alt="" decoding="async" />}
      <img className="collage-heart" src="/art/stickers/14-large-pink-heart.webp" alt="" decoding="async" />
      {variant !== 'studio' && <img className="collage-sparkle" src="/art/stickers/05-mint-sparkle-top.webp" alt="" decoding="async" />}
      {variant !== 'studio' && <span className="collage-stamp">100% your kind of fun{variant === 'templates' ? ' ☺' : ''}</span>}
    </div>
  )
}
