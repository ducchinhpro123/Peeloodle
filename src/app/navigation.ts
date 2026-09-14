/**
 * The shell's navigation, in one place.
 *
 * The header and the sidebar show different labels for the same routes on
 * purpose ("Home" vs "Dashboard"), so they stay two lists — but both live here
 * with their active predicates, which are app-level URL rules and are unit
 * tested rather than inferred from a full route render.
 */

import { Heart, Home, ImagePlus, LayoutGrid, Plus, Presentation as PresentationIcon, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavigationItem = {
  to: string
  label: string
  /** Sidebar items render an icon; header items do not. */
  icon?: LucideIcon
  active: (pathname: string, search: string) => boolean
}

const view = (search: string) => new URLSearchParams(search).get('view')
const inEditor = (pathname: string) => pathname === '/create' || pathname.startsWith('/editor/')
const isFavorites = (pathname: string, search: string) => pathname === '/my-stickers' && view(search) === 'favorites'
const isShared = (pathname: string, search: string) => pathname === '/my-stickers' && view(search) === 'shared'

export const primaryNavigation: NavigationItem[] = [
  { to: '/', label: 'Home', active: (pathname, search) => pathname === '/' && !view(search) },
  { to: '/create', label: 'Create', active: (pathname) => inEditor(pathname) },
  { to: '/templates', label: 'Templates', active: (pathname, search) => pathname === '/templates' && view(search) !== 'explore' },
  { to: '/my-stickers', label: 'My Stickers', active: (pathname, search) => pathname === '/my-stickers' && view(search) !== 'favorites' },
  { to: '/templates?view=explore', label: 'Explore', active: (pathname, search) => pathname === '/templates' && view(search) === 'explore' },
]

export const sidebarNavigation: NavigationItem[] = [
  { to: '/', label: 'Dashboard', icon: Home, active: (pathname) => pathname === '/' },
  { to: '/create', label: 'Create Sticker', icon: Plus, active: (pathname) => inEditor(pathname) },
  { to: '/my-stickers', label: 'My Stickers', icon: ImagePlus, active: (pathname, search) => pathname === '/my-stickers' && !isFavorites(pathname, search) && !isShared(pathname, search) },
  { to: '/presentations', label: 'Presentations', icon: PresentationIcon, active: (pathname) => pathname.startsWith('/presentations') },
  { to: '/templates', label: 'Templates', icon: LayoutGrid, active: (pathname) => pathname === '/templates' },
  { to: '/my-stickers?view=favorites', label: 'Favorites', icon: Heart, active: isFavorites },
  { to: '/my-stickers?view=shared', label: 'Shared with Me', icon: UserRound, active: isShared },
]
