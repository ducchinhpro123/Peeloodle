/**
 * Global search over the template catalog and the user's packs.
 *
 * Matching and result links are pure rules, so the search dialog stays a view
 * and the behavior can be tested without a repository or a router.
 */

import type { PackRecord, Template } from '../../types/domain'

/** Templates match on title, category and tags. */
export function matchTemplates(templates: Template[], query: string): Template[] {
  const needle = query.trim().toLowerCase()
  return templates.filter((item) => `${item.title} ${item.category} ${item.tags.join(' ')}`.toLowerCase().includes(needle))
}

/** Packs match on title and description. */
export function matchPacks(packs: PackRecord[], query: string): PackRecord[] {
  const needle = query.trim().toLowerCase()
  return packs.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(needle))
}

export function templateSearchHref(title: string): string {
  return `/templates?q=${encodeURIComponent(title)}`
}

export function packSearchHref(id: string): string {
  return `/my-stickers?pack=${encodeURIComponent(id)}`
}
