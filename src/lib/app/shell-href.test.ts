/**
 * `/my-stickers` became a real route in this slice, so the last deferred-destination
 * branch of `shellHref` is gone: every shell link — including the dashboard's
 * library card and both "View all" links — now goes through SvelteKit's typed,
 * base-aware `resolve()`, which is the only helper allowed to build an internal
 * href.
 *
 * `$app/paths` is mocked with a base so a lingering `base`-prefix branch would be
 * distinguishable from `resolve()`.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({
	base: '/stickerlab',
	resolve: (pathname: string) => `/RESOLVED${pathname}`
}));

import { primaryNavigation, shellHref, sidebarNavigation } from './navigation';

describe('shellHref', () => {
	it('resolves the sticker library, including its hash, through resolve()', () => {
		expect(shellHref('/my-stickers')).toBe('/RESOLVED/my-stickers');
		expect(shellHref('/my-stickers#local-stickers')).toBe('/RESOLVED/my-stickers#local-stickers');
	});

	it('resolves every implemented route through resolve()', () => {
		expect(shellHref('/')).toBe('/RESOLVED/');
		expect(shellHref('/create')).toBe('/RESOLVED/create');
		expect(shellHref('/create?tool=erase')).toBe('/RESOLVED/create?tool=erase');
		expect(shellHref('/create?tool=text')).toBe('/RESOLVED/create?tool=text');
		expect(shellHref('/create?tool=effects')).toBe('/RESOLVED/create?tool=effects');
		expect(shellHref('/create?tool=export')).toBe('/RESOLVED/create?tool=export');
		expect(shellHref('/templates')).toBe('/RESOLVED/templates');
		expect(shellHref('/presentations')).toBe('/RESOLVED/presentations');
	});

	it('never falls back to a bare base-prefixed pathname', () => {
		for (const link of [
			'/',
			'/create',
			'/templates',
			'/presentations',
			'/my-stickers',
			'/my-stickers#local-stickers'
		] as const) {
			expect(shellHref(link).startsWith('/RESOLVED')).toBe(true);
		}
	});

	it('marks presentation library and editor URLs current in both navigation lists', () => {
		const primary = primaryNavigation.find((item) => item.to === '/presentations');
		const sidebar = sidebarNavigation.find((item) => item.to === '/presentations');
		expect(primary?.active('/presentations', '')).toBe(true);
		expect(primary?.active('/presentations/deck-1', '')).toBe(true);
		expect(sidebar?.active('/presentations/deck-1', '')).toBe(true);
		expect(sidebar?.active('/templates', '')).toBe(false);
	});

	it('marks the sticker library current on its own route in both navigation lists', () => {
		const primary = primaryNavigation.find((item) => item.to === '/my-stickers');
		const sidebar = sidebarNavigation.find((item) => item.to === '/my-stickers');
		expect(primary?.active('/my-stickers', '')).toBe(true);
		expect(primary?.active('/templates', '')).toBe(false);
		expect(sidebar?.active('/my-stickers', '?view=favorites')).toBe(true);
		expect(sidebar?.active('/', '')).toBe(false);
	});

	it('marks Templates current on its own route in both navigation lists', () => {
		const primary = primaryNavigation.find((item) => item.to === '/templates');
		const sidebar = sidebarNavigation.find((item) => item.to === '/templates');
		expect(primary?.active('/templates', '?q=cat')).toBe(true);
		expect(primary?.active('/', '')).toBe(false);
		expect(sidebar?.active('/templates', '')).toBe(true);
		expect(sidebar?.active('/my-stickers', '')).toBe(false);
	});
});
