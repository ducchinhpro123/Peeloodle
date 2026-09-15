/**
 * Regression for base-path-safe internal navigation, at runtime.
 *
 * `$app/paths` is mocked with a non-empty base, so every app-owned anchor in the
 * shell and dashboard must carry that prefix. A hard-coded root-relative href
 * would stay unprefixed (`/create`) while the resolved ones become
 * `/stickerlab/create`, which is exactly the base-path deployment defect that
 * `docs/migration-progress.md` recorded as open. Pathnames with search and hash
 * (`/create?tool=erase`, `/my-stickers#local-stickers`) must be resolved too.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({
	base: '/stickerlab',
	assets: '/stickerlab',
	asset: (file: string) => `/stickerlab${file}`,
	resolve: (pathname: string) => `/stickerlab${pathname}`
}));

import { render } from 'vitest-browser-svelte';
import DashboardPage from '$lib/components/DashboardPage.svelte';
import Sidebar from '$lib/components/Sidebar.svelte';
import { appLocalPathname, subscribeToolIntent } from '$lib/editor/toolIntent';
import { createMemoryRepository, createProjectDocument } from '$lib/persistence/repository';

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 4000
): Promise<T> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

describe('dashboard links under a configured base path', () => {
	it('prefixes every app-owned anchor and leaves no base-less internal href', async () => {
		const repository = createMemoryRepository();
		await repository.saveProjectWithAssets(
			createProjectDocument({ id: 'saved-1', title: 'Saved sticker' }),
			[]
		);

		const { container } = await render(DashboardPage, {
			repository,
			pathname: '/',
			search: '',
			onopen: () => {}
		});
		await waitFor(
			() => container.querySelector('a.project-card-link'),
			'the saved project card link'
		);

		const hrefs = [...container.querySelectorAll('a[href]')].map((anchor) =>
			anchor.getAttribute('href')
		);
		const internal = hrefs.filter(
			(href): href is string => !!href && href.startsWith('/') && !href.startsWith('//')
		);

		expect(internal.length).toBeGreaterThan(0);
		expect(internal.filter((href) => !href.startsWith('/stickerlab'))).toEqual([]);
		expect(internal).toContain('/stickerlab/');
		expect(internal).toContain('/stickerlab/create');
		expect(internal).toContain('/stickerlab/create?tool=erase');
		expect(internal).toContain('/stickerlab/templates');
		expect(internal).toContain('/stickerlab/presentations');
		expect(internal).toContain('/stickerlab/my-stickers#local-stickers');
		expect(internal).toContain('/stickerlab/editor/saved-1');

		// Sidebar tool links specifically: the dashboard feature cards also carry
		// `?tool=` URLs, so a global "contains" check cannot see a Sidebar link that
		// dropped its intent query on the way to being base-aware. The mobile drawer's
		// Sidebar copy lives inside the always-mounted nav dialog, so it is filtered out.
		const sidebarHrefs = [...container.querySelectorAll('.side-tools a')]
			.filter((anchor) => !anchor.closest('dialog'))
			.map((anchor) => anchor.getAttribute('href'));
		expect(sidebarHrefs).toEqual([
			'/stickerlab/create?tool=erase',
			'/stickerlab/create?tool=text',
			'/stickerlab/create?tool=effects',
			'/stickerlab/create?tool=export'
		]);
	});
});

/**
 * The Sidebar is the one shell surface whose route recognition runs on the raw URL
 * pathname production hands it: the editor and create routes forward
 * `page.url.pathname`, which under a configured base is `/stickerlab/editor/<id>`,
 * while `toolIntentPath()`/`shouldReuseCurrentToolRoute()` and the active-state
 * checks speak app-local pathnames (`/editor/<id>`). The base therefore has to be
 * normalized once at that boundary. Without it, an open editor's tool links fall
 * back to `/stickerlab/create?tool=…`, no tool looks current, and a repeated
 * same-tool click navigates instead of re-opening the current document.
 */
describe('sidebar route recognition under a configured base path', () => {
	/** Clicks an anchor, reports whether the component cancelled it, and blocks real navigation. */
	function click(container: HTMLElement, anchor: HTMLAnchorElement, modifiers = {}) {
		let prevented = false;
		const guard = (event: Event) => {
			prevented = event.defaultPrevented;
			event.preventDefault();
		};
		container.addEventListener('click', guard);
		try {
			anchor.dispatchEvent(
				new MouseEvent('click', {
					bubbles: true,
					cancelable: true,
					button: 0,
					...modifiers
				})
			);
		} finally {
			container.removeEventListener('click', guard);
		}
		return prevented;
	}

	function toolAnchor(container: HTMLElement, label: string) {
		const anchor = [...container.querySelectorAll('.side-tools a')].find((candidate) =>
			candidate.textContent?.includes(label)
		);
		if (!(anchor instanceof HTMLAnchorElement))
			throw new Error(`No sidebar tool link for ${label}`);
		return anchor;
	}

	function toolHrefs(container: HTMLElement) {
		return [...container.querySelectorAll('.side-tools a')].map((anchor) =>
			anchor.getAttribute('href')
		);
	}

	it('keeps the current document id and re-opens the same tool for a base-prefixed editor URL', async () => {
		const requested: string[] = [];
		let drawerCloses = 0;
		const unsubscribe = subscribeToolIntent((intent) => requested.push(intent));
		try {
			// Exactly what `src/routes/editor/[projectId]/+page.svelte` forwards: the raw
			// URL pathname (base included) plus its search.
			const { container } = await render(Sidebar, {
				pathname: '/stickerlab/editor/sticker-1',
				search: '?tool=text',
				onnavigate: () => drawerCloses++
			});

			expect(toolHrefs(container)).toEqual([
				'/stickerlab/editor/sticker-1?tool=erase',
				'/stickerlab/editor/sticker-1?tool=text',
				'/stickerlab/editor/sticker-1?tool=effects',
				'/stickerlab/editor/sticker-1?tool=export'
			]);

			const textLink = toolAnchor(container, 'Text & Emoji');
			expect(textLink.getAttribute('aria-current')).toBe('page');
			expect(toolAnchor(container, 'Filters & Effects').getAttribute('aria-current')).toBeNull();

			// Re-clicking the current document's tool: cancel the no-op navigation, close
			// the drawer and re-open the chrome through the intent listener instead.
			expect(click(container, textLink)).toBe(true);
			expect(requested).toEqual(['text']);
			expect(drawerCloses).toBe(1);

			// Modifier clicks stay native (new tab above all): never cancelled, no intent.
			expect(click(container, textLink, { ctrlKey: true })).toBe(false);
			expect(click(container, textLink, { metaKey: true })).toBe(false);
			expect(requested).toEqual(['text']);
			expect(drawerCloses).toBe(1);

			// A different tool still follows its real (base-aware) URL.
			expect(click(container, toolAnchor(container, 'Export & Share'))).toBe(false);
			expect(drawerCloses).toBe(2);
			expect(requested).toEqual(['text']);
		} finally {
			unsubscribe();
		}
	});

	it('reads the base root as the dashboard and the base-prefixed create/editor routes as active', async () => {
		const atBaseRoot = await render(Sidebar, { pathname: '/stickerlab', search: '' });
		expect(toolHrefs(atBaseRoot.container)).toEqual([
			'/stickerlab/create?tool=erase',
			'/stickerlab/create?tool=text',
			'/stickerlab/create?tool=effects',
			'/stickerlab/create?tool=export'
		]);
		// The base root is the dashboard, so no tool is current and no editor chrome
		// is implied; the base-prefixed create route is the one that is current.
		const oneTool = toolAnchor(atBaseRoot.container, 'Text & Emoji');
		expect(oneTool.getAttribute('aria-current')).toBeNull();
		const dashboardNav = [...atBaseRoot.container.querySelectorAll('.side-links a')].find(
			(anchor) => anchor.textContent?.includes('Dashboard')
		);
		expect(dashboardNav?.getAttribute('aria-current')).toBe('page');

		const atCreate = await render(Sidebar, { pathname: '/stickerlab/create', search: '' });
		const createNav = [...atCreate.container.querySelectorAll('.side-links a')].find((anchor) =>
			anchor.textContent?.includes('Create Sticker')
		);
		expect(createNav?.getAttribute('aria-current')).toBe('page');

		// An already app-local pathname (no base) keeps working: the normalization
		// boundary must preserve inputs that were never base-prefixed.
		const appLocal = await render(Sidebar, { pathname: '/editor/sticker-1', search: '' });
		expect(toolHrefs(appLocal.container)[0]).toBe('/stickerlab/editor/sticker-1?tool=erase');
	});
});

/**
 * Unit contract of the normalization boundary itself: which inputs are stripped
 * (exact base, base + `/`), which are preserved (root/default base, already
 * app-local, segment-prefix collisions) and why a base that looks like a route
 * cannot double-strip.
 */
describe('appLocalPathname boundary', () => {
	it('leaves the root/default base and already app-local pathnames alone', () => {
		expect(appLocalPathname('/editor/sticker-1', '')).toBe('/editor/sticker-1');
		expect(appLocalPathname('/', '')).toBe('/');
		expect(appLocalPathname('/editor/sticker-1', '/stickerlab')).toBe('/editor/sticker-1');
		expect(appLocalPathname('/', '/stickerlab')).toBe('/');
	});

	it('strips only an exact base or base + slash, never a segment-prefix match', () => {
		expect(appLocalPathname('/stickerlab/editor/sticker-1', '/stickerlab')).toBe(
			'/editor/sticker-1'
		);
		expect(appLocalPathname('/stickerlab/create', '/stickerlab')).toBe('/create');
		expect(appLocalPathname('/stickerlab', '/stickerlab')).toBe('/');
		expect(appLocalPathname('/stickerlab/', '/stickerlab')).toBe('/');
		expect(appLocalPathname('/stickerlabs/editor/sticker-1', '/stickerlab')).toBe(
			'/stickerlabs/editor/sticker-1'
		);
		expect(appLocalPathname('/stickerlab-extra/editor/sticker-1', '/stickerlab')).toBe(
			'/stickerlab-extra/editor/sticker-1'
		);
	});

	it('does not double-strip when the base itself looks like a route', () => {
		// Base `/editor`: the raw `/editor/editor/<id>` strips exactly once…
		expect(appLocalPathname('/editor/editor/sticker-1', '/editor')).toBe('/editor/sticker-1');
		// …applying the boundary again is a no-op (the remainder is no longer a route)…
		expect(
			appLocalPathname(appLocalPathname('/editor/editor/sticker-1', '/editor'), '/editor')
		).toBe('/editor/sticker-1');
		// …and a genuinely app-local input under that base is preserved.
		expect(appLocalPathname('/editor/sticker-1', '/editor')).toBe('/editor/sticker-1');
		// Base `/create` behaves the same for the editor route and its base root.
		expect(appLocalPathname('/create/editor/sticker-1', '/create')).toBe('/editor/sticker-1');
		expect(appLocalPathname('/create', '/create')).toBe('/');
	});

	it('normalizes the deployment base the production routes report', () => {
		expect(appLocalPathname('/stickerlab/editor/sticker-1')).toBe('/editor/sticker-1');
		expect(appLocalPathname('/stickerlab')).toBe('/');
	});
});
