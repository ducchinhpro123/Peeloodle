import { describe, expect, it } from 'vitest'
import { primaryNavigation, sidebarNavigation } from './navigation'

function activeItems(items: typeof primaryNavigation, pathname: string, search: string): string[] {
  return items.filter((item) => item.active(pathname, search)).map((item) => item.label)
}

describe('primary navigation predicates', () => {
  it('marks Home only on the bare dashboard URL', () => {
    expect(activeItems(primaryNavigation, '/', '')).toEqual(['Home'])
    expect(activeItems(primaryNavigation, '/', '?view=explore')).toEqual([])
    expect(activeItems(primaryNavigation, '/templates', '?view=explore')).toEqual(['Explore'])
  })

  it('keeps Create active inside the sticker editor', () => {
    expect(activeItems(primaryNavigation, '/create', '')).toEqual(['Create'])
    expect(activeItems(primaryNavigation, '/editor/sticker-1', '')).toEqual(['Create'])
    expect(activeItems(primaryNavigation, '/editor/sticker-1', '?tool=erase')).toEqual(['Create'])
  })

  it('splits Templates and Explore by the view parameter', () => {
    expect(activeItems(primaryNavigation, '/templates', '')).toEqual(['Templates'])
    expect(activeItems(primaryNavigation, '/templates', '?view=explore')).toEqual(['Explore'])
    expect(activeItems(primaryNavigation, '/templates', '?view=other')).toEqual(['Templates'])
  })

  it('keeps My Stickers distinct from Favorites and Shared', () => {
    expect(activeItems(primaryNavigation, '/my-stickers', '')).toEqual(['My Stickers'])
    // Favorites moves the primary highlight away; the sidebar owns the rest.
    expect(activeItems(primaryNavigation, '/my-stickers', '?view=favorites')).toEqual([])
    expect(activeItems(primaryNavigation, '/my-stickers', '?view=shared')).toEqual(['My Stickers'])
  })
})

describe('sidebar navigation predicates', () => {
  it('marks the library views the shell knows', () => {
    expect(activeItems(sidebarNavigation, '/', '')).toEqual(['Dashboard'])
    expect(activeItems(sidebarNavigation, '/editor/sticker-1', '')).toEqual(['Create Sticker'])
    expect(activeItems(sidebarNavigation, '/presentations', '')).toEqual(['Presentations'])
    expect(activeItems(sidebarNavigation, '/presentations/deck-1', '')).toEqual(['Presentations'])
    expect(activeItems(sidebarNavigation, '/templates', '')).toEqual(['Templates'])
  })

  it('separates My Stickers, Favorites and Shared with Me', () => {
    expect(activeItems(sidebarNavigation, '/my-stickers', '')).toEqual(['My Stickers'])
    expect(activeItems(sidebarNavigation, '/my-stickers', '?view=favorites')).toEqual(['Favorites'])
    expect(activeItems(sidebarNavigation, '/my-stickers', '?view=shared')).toEqual(['Shared with Me'])
    expect(activeItems(sidebarNavigation, '/my-stickers', '?view=other')).toEqual(['My Stickers'])
  })
})
