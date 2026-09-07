export const BUNDLED_FONTS = ['Plus Jakarta Sans', 'Fredoka', 'Baloo 2', 'Luckiest Guy', 'Chewy', 'Pacifico', 'Bangers'] as const
export const TEXT_FONTS = [...BUNDLED_FONTS, 'Georgia', 'cursive', 'ui-sans-serif'] as const

export function cssFontFamily(family: string): string {
  return /[^\w-]/.test(family) ? JSON.stringify(family) : family
}

export function cssFont(size: number, family: string): string {
  return `${size}px ${cssFontFamily(family)}`
}

/** The browser caches font files. Never export a silently substituted bundled font. */
export async function loadFont(family: string): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts) return
  try {
    const faces = await fonts.load(cssFont(16, family))
    if (BUNDLED_FONTS.some((name) => name === family) && faces.length === 0) throw new Error('Missing font face')
  } catch {
    throw new Error(`Could not load ${family}. Choose another font or reload to retry. Your text is unchanged.`)
  }
}

export async function waitForFonts(families: string[]): Promise<void> {
  await Promise.all([...new Set(families)].map(loadFont))
}
