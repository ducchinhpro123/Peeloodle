/**
 * The shell's navigation, in one place.
 *
 * The header and the sidebar show different labels for the same routes on
 * purpose ("Home" vs "Dashboard"), so they stay two lists. Only routes this
 * slice actually implements are listed. Favorites and Shared are later slices.
 */

import { resolve } from '$app/paths';
import { Home, ImagePlus, LayoutGrid, LayoutTemplate, Plus, Presentation } from 'lucide-svelte';

/**
 * The shell's internal link targets. Every one of them is a real route now that
 * the sticker library landed.
 * @typedef {'/' | '/create' | '/templates' | '/presentation-templates' | '/my-stickers' | '/presentations' | '/my-stickers#local-stickers'
 *   | '/presentations?task=class' | '/presentations?task=research-defense' | '/presentations?task=club-pitch'
 *   | '/create?tool=erase' | '/create?tool=text' | '/create?tool=effects' | '/create?tool=export'} ShellLink
 */

/**
 * Base-aware href for a shell link.
 *
 * Every implemented route — `/my-stickers` included since its route file
 * landed — goes through `resolve()` from `$app/paths`, which is typed against
 * this app's real route manifest and handles `?search`/`#hash` pathnames. The
 * temporary `base`-prefix branch for the not-yet-existing library route is gone;
 * there is no remaining deferred destination in this helper.
 * @param {ShellLink} link
 */
export function shellHref(link) {
	if (link === '/') return resolve('/');
	if (link === '/create') return resolve('/create');
	if (link === '/create?tool=erase') return resolve('/create?tool=erase');
	if (link === '/create?tool=text') return resolve('/create?tool=text');
	if (link === '/create?tool=effects') return resolve('/create?tool=effects');
	if (link === '/create?tool=export') return resolve('/create?tool=export');
	if (link === '/templates') return resolve('/templates');
	if (link === '/presentation-templates') return resolve('/presentation-templates');
	if (link === '/presentations') return resolve('/presentations');
	if (link === '/presentations?task=class') return resolve('/presentations?task=class');
	if (link === '/presentations?task=research-defense')
		return resolve('/presentations?task=research-defense');
	if (link === '/presentations?task=club-pitch') return resolve('/presentations?task=club-pitch');
	if (link === '/my-stickers') return resolve('/my-stickers');
	return resolve('/my-stickers#local-stickers');
}

/** @typedef {{ to: ShellLink, label: string, icon?: typeof Home, active: (pathname: string, search: string) => boolean }} NavigationItem */

const view = (/** @type {string} */ search) => new URLSearchParams(search).get('view');
const inEditor = (/** @type {string} */ pathname) =>
	pathname === '/create' || pathname.startsWith('/editor/');

/** @type {NavigationItem[]} */
export const primaryNavigation = [
	{ to: '/', label: 'Home', active: (pathname, search) => pathname === '/' && !view(search) },
	{ to: '/create', label: 'Create', active: (pathname) => inEditor(pathname) },
	{ to: '/templates', label: 'Templates', active: (pathname) => pathname === '/templates' },
	{
		to: '/presentation-templates',
		label: 'Deck Templates',
		active: (pathname) => pathname === '/presentation-templates'
	},
	{
		to: '/presentations',
		label: 'Presentations',
		active: (pathname) => pathname === '/presentations' || pathname.startsWith('/presentations/')
	},
	{ to: '/my-stickers', label: 'My Stickers', active: (pathname) => pathname === '/my-stickers' }
];

/** @type {NavigationItem[]} */
export const sidebarNavigation = [
	{ to: '/', label: 'Dashboard', icon: Home, active: (pathname) => pathname === '/' },
	{ to: '/create', label: 'Create Sticker', icon: Plus, active: (pathname) => inEditor(pathname) },
	{
		to: '/presentations',
		label: 'Presentations',
		icon: Presentation,
		active: (pathname) => pathname === '/presentations' || pathname.startsWith('/presentations/')
	},
	{
		to: '/presentation-templates',
		label: 'Deck Templates',
		icon: LayoutTemplate,
		active: (pathname) => pathname === '/presentation-templates'
	},
	{
		to: '/templates',
		label: 'Templates',
		icon: LayoutGrid,
		active: (pathname) => pathname === '/templates'
	},
	{
		to: '/my-stickers',
		label: 'My Stickers',
		icon: ImagePlus,
		active: (pathname) => pathname === '/my-stickers'
	}
];
