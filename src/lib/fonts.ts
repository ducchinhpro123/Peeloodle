export const BUNDLED_FONTS = ['Plus Jakarta Sans', 'Fredoka', 'Baloo 2', 'Luckiest Guy', 'Chewy', 'Pacifico', 'Bangers'] as const
export const TEXT_FONTS = [...BUNDLED_FONTS, 'Georgia', 'cursive', 'ui-sans-serif'] as const

export function cssFontFamily(family: string): string {
  return /[^\w-]/.test(family) ? JSON.stringify(family) : family
}

export function cssFont(size: number, family: string): string {
  return `${size}px ${cssFontFamily(family)}`
}

export type TextLayout = { x: number; y: number; width: number; height: number }

/** Ink bounds for multiline text, including glyph overhangs (not just advance width). */
export function measureTextLayout(
  ctx: { font: string; measureText: (text: string) => Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight' | 'actualBoundingBoxAscent' | 'actualBoundingBoxDescent'> },
  content: string,
  family: string,
  fontSize: number,
  lineHeight = 1,
): TextLayout {
  ctx.font = cssFont(fontSize, family)
  const lines = (content || ' ').split('\n')
  const step = fontSize * lineHeight
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.length ? lines[i]! : ' '
    const metrics = ctx.measureText(line)
    const y = i * step
    const inkLeft = Number.isFinite(metrics.actualBoundingBoxLeft) ? -metrics.actualBoundingBoxLeft : 0
    const inkRight = Number.isFinite(metrics.actualBoundingBoxRight) && metrics.actualBoundingBoxRight > 0 ? metrics.actualBoundingBoxRight : metrics.width
    const inkTop = y - (Number.isFinite(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent > 0 ? metrics.actualBoundingBoxAscent : fontSize * 0.8)
    const inkBottom = y + (Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * 0.2)
    left = Math.min(left, inkLeft)
    top = Math.min(top, inkTop)
    right = Math.max(right, inkRight)
    bottom = Math.max(bottom, inkBottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(top) || right <= left || bottom <= top) {
    return { x: 0, y: 0, width: Math.max(1, fontSize), height: Math.max(1, fontSize * Math.max(lines.length, 1) * lineHeight) }
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** DOM textarea size: CSS line boxes, plus ink overhangs on the width. */
export function measureTextEditBox(
  ctx: { font: string; measureText: (text: string) => Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight'> },
  content: string,
  family: string,
  fontSize: number,
): { width: number; height: number } {
  ctx.font = cssFont(fontSize, family)
  const lines = (content || ' ').split('\n')
  let maxAdvance = 0
  let extraLeft = 0
  let extraRight = 0
  for (const raw of lines) {
    const line = raw.length ? raw : ' '
    const metrics = ctx.measureText(line)
    maxAdvance = Math.max(maxAdvance, metrics.width)
    const left = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0
    const right = Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : metrics.width
    extraLeft = Math.max(extraLeft, Math.max(0, left))
    extraRight = Math.max(extraRight, Math.max(0, right - metrics.width))
  }
  const pad = Math.max(2, fontSize * 0.08)
  return {
    width: Math.max(1, maxAdvance + extraLeft + extraRight + pad),
    height: Math.max(fontSize, fontSize * Math.max(lines.length, 1)),
  }
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
