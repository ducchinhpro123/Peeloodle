/**
 * Safe hyperlink policy shared by the document parser and the DOM bridge.
 * Document data may only carry absolute http/https/mailto URLs; anything else
 * (javascript:, data:, relative paths, malformed input) is dropped.
 */

const SAFE_LINK_SCHEMES = ['http:', 'https:', 'mailto:']

export function safeLink(href: string | null | undefined): string | undefined {
  if (!href) return undefined
  const trimmed = href.trim()
  if (!trimmed) return undefined
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return undefined
  try {
    const url = new URL(trimmed)
    return SAFE_LINK_SCHEMES.includes(url.protocol) ? trimmed : undefined
  } catch {
    return undefined
  }
}
