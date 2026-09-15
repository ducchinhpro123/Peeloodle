/**
 * Browser regression for the app shell and dashboard, as planned: `/` is real,
 * the Create affordances point at `/create`, and the local-first promises the
 * shell makes ("No account needed", "Saved on your device") are actually shown.
 */

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DashboardPage from '$lib/components/DashboardPage.svelte';
import Sidebar from '$lib/components/Sidebar.svelte';
import { createMemoryRepository } from '$lib/persistence/repository';
import { subscribeToolIntent } from '$lib/editor/toolIntent';

/** Waits for a condition that depends on effects/async repository work. */
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

describe('sidebar tool links', () => {
	/**
	 * Clicks an anchor and reports whether the component cancelled the click, while
	 * never letting the harness navigate away from the test page.
	 */
	function clickAnchor(container: HTMLElement, anchor: HTMLAnchorElement, modifiers = {}) {
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
		if (!anchor) throw new Error(`No sidebar tool link for ${label}`);
		return anchor as HTMLAnchorElement;
	}

	it('keeps the ?tool= intent on every tool link, on the dashboard and in an editor', async () => {
		const dashboard = await render(Sidebar, { pathname: '/', search: '' });
		const dashboardHrefs = [...dashboard.container.querySelectorAll('.side-tools a')].map(
			(anchor) => anchor.getAttribute('href')
		);
		expect(dashboardHrefs).toEqual([
			'/create?tool=erase',
			'/create?tool=text',
			'/create?tool=effects',
			'/create?tool=export'
		]);

		// An open editor document keeps its id and gains the requested intent.
		const editor = await render(Sidebar, { pathname: '/editor/sticker-1', search: '' });
		const editorHrefs = [...editor.container.querySelectorAll('.side-tools a')].map((anchor) =>
			anchor.getAttribute('href')
		);
		expect(editorHrefs).toEqual([
			'/editor/sticker-1?tool=erase',
			'/editor/sticker-1?tool=text',
			'/editor/sticker-1?tool=effects',
			'/editor/sticker-1?tool=export'
		]);
	});

	it('follows the intent link from the dashboard and from a plain editor URL', async () => {
		const seen: string[] = [];
		const dashboard = await render(Sidebar, {
			pathname: '/',
			search: '',
			onnavigate: () => seen.push('/')
		});
		const fromDashboard = toolAnchor(dashboard.container, 'Filters & Effects');
		expect(fromDashboard.getAttribute('href')).toBe('/create?tool=effects');
		expect(clickAnchor(dashboard.container, fromDashboard)).toBe(false);
		expect(seen).toEqual(['/']);

		// From an editor with no intent the link navigates to the intent URL; it does
		// not reuse the route (the current search has no matching tool).
		seen.length = 0;
		const requested: string[] = [];
		const unsubscribe = subscribeToolIntent((intent) => requested.push(intent));
		try {
			const editor = await render(Sidebar, {
				pathname: '/editor/sticker-1',
				search: '',
				onnavigate: () => seen.push('/editor')
			});
			const exportLink = toolAnchor(editor.container, 'Export & Share');
			expect(exportLink.getAttribute('href')).toBe('/editor/sticker-1?tool=export');
			expect(clickAnchor(editor.container, exportLink)).toBe(false);
			expect(seen).toEqual(['/editor']);
			expect(requested).toEqual([]);
		} finally {
			unsubscribe();
		}
	});

	it('re-opens the same intent without navigating and keeps modifier clicks native', async () => {
		let closed = 0;
		const requested: string[] = [];
		const unsubscribe = subscribeToolIntent((intent) => requested.push(intent));
		try {
			const editor = await render(Sidebar, {
				pathname: '/editor/sticker-1',
				search: '?tool=effects',
				onnavigate: () => closed++
			});
			const effectsLink = toolAnchor(editor.container, 'Filters & Effects');
			expect(effectsLink.getAttribute('href')).toBe('/editor/sticker-1?tool=effects');
			expect(effectsLink.getAttribute('aria-current')).toBe('page');

			// Same tool, same document: cancel the navigation, dismiss any open drawer
			// (`onnavigate`) and re-open the chrome through the intent listener.
			expect(clickAnchor(editor.container, effectsLink)).toBe(true);
			expect(requested).toEqual(['effects']);
			expect(closed).toBe(1);

			// A modifier click belongs to the browser (new tab), never to the app.
			requested.length = 0;
			expect(clickAnchor(editor.container, effectsLink, { ctrlKey: true })).toBe(false);
			expect(requested).toEqual([]);
			expect(closed).toBe(1);
		} finally {
			unsubscribe();
		}
	});
});

describe('app shell and dashboard', () => {
	it('links Create to /create and states the local-first promises', async () => {
		const repository = createMemoryRepository();
		const { container } = await render(DashboardPage, {
			repository,
			pathname: '/',
			search: '',
			onopen: () => {}
		});

		const createLinks = [...container.querySelectorAll('a')].filter((anchor) =>
			anchor.textContent?.includes('Create a Sticker')
		);
		expect(createLinks.length).toBeGreaterThan(0);
		expect(createLinks[0]!.getAttribute('href')).toBe('/create');

		const navCreate = [...container.querySelectorAll('nav a')].find(
			(anchor) => anchor.textContent?.trim() === 'Create'
		);
		expect(navCreate?.getAttribute('href')).toBe('/create');

		expect(container.textContent).toContain('No account needed');
		expect(container.textContent).toContain('Saved on your device');

		// Tool intents stay real URLs the editor understands.
		const toolLinks = [...container.querySelectorAll('a')].map((anchor) =>
			anchor.getAttribute('href')
		);
		expect(toolLinks).toContain('/create?tool=text');
		expect(toolLinks).toContain('/create?tool=erase');
		expect(toolLinks).toContain('/create?tool=effects');
		expect(toolLinks).toContain('/create?tool=export');
	});

	it('offers the background eraser with the source copy now that the mask brush exists', async () => {
		const repository = createMemoryRepository();
		const { container } = await render(DashboardPage, {
			repository,
			pathname: '/',
			search: '',
			onopen: () => {}
		});

		const eraser = [...container.querySelectorAll('a.feature')].find((anchor) =>
			anchor.textContent?.includes('Background Eraser')
		);
		expect(eraser?.textContent).toContain('Brush away the background. Keep the good bits.');
		expect(eraser?.getAttribute('href')).toBe('/create?tool=erase');
	});

	it('gives every mounted dialog its own accessible name and description', async () => {
		const repository = createMemoryRepository();
		const { container } = await render(DashboardPage, {
			repository,
			pathname: '/',
			search: '',
			onopen: () => {}
		});

		// Navigation, walkthrough and delete dialogs are all mounted at once, so a
		// shared `dialog-title` id would let a later dialog resolve its label to the
		// first dialog's heading.
		const dialogs = [...container.querySelectorAll('dialog')];
		expect(dialogs.length).toBeGreaterThan(1);
		const labelledBy = dialogs.map((dialog) => dialog.getAttribute('aria-labelledby'));
		expect(new Set(labelledBy).size).toBe(dialogs.length);

		for (const dialog of dialogs) {
			const id = dialog.getAttribute('aria-labelledby');
			const heading = id ? document.getElementById(id) : null;
			expect(heading).not.toBeNull();
			expect(dialog.contains(heading)).toBe(true);

			const describedBy = dialog.getAttribute('aria-describedby');
			if (describedBy) {
				const description = document.getElementById(describedBy);
				expect(description).not.toBeNull();
				expect(dialog.contains(description)).toBe(true);
			}
		}

		// The opened walkthrough announces its own title, not another dialog's.
		const opener = [...container.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('Watch how it works')
		);
		opener?.click();
		const openDialog = await waitFor(
			() => /** @type {HTMLDialogElement | null} */ container.querySelector('dialog[open]'),
			'the walkthrough dialog'
		);
		if (!openDialog) throw new Error('The walkthrough dialog did not open');
		const ownTitle = document.getElementById(openDialog.getAttribute('aria-labelledby') ?? '');
		expect(ownTitle?.textContent).toContain('How StickerLab works');
		expect(openDialog.contains(ownTitle)).toBe(true);
		const ownDescription = document.getElementById(
			openDialog.getAttribute('aria-describedby') ?? ''
		);
		expect(ownDescription?.textContent).toContain('From camera roll to conversation starter.');
		expect(openDialog.contains(ownDescription)).toBe(true);
	});

	it('shows the honest empty state and a real template rail', async () => {
		const repository = createMemoryRepository();
		const { container } = await render(DashboardPage, {
			repository,
			pathname: '/',
			search: '',
			onopen: () => {}
		});

		await waitFor(
			() => container.textContent?.includes('No projects yet'),
			'the empty project state'
		);
		expect(container.textContent).toContain('Create your first sticker');
		const templateTitles = [...container.querySelectorAll('.template-card .template-title-btn b')];
		expect(templateTitles.length).toBe(4);
	});

	it('lists a saved project as a real, reopenable link', async () => {
		const repository = createMemoryRepository();
		const { createProjectDocument } = await import('$lib/persistence/repository');
		const saved = createProjectDocument({ id: 'saved-1', title: 'Saved sticker' });
		await repository.saveProjectWithAssets(saved, []);

		const { container } = await render(DashboardPage, {
			repository,
			pathname: '/',
			search: '',
			onopen: () => {}
		});

		const link = await waitFor(
			() => container.querySelector('a.project-card-link[href="/editor/saved-1"]'),
			'the saved project card'
		);
		expect(link!.textContent).toContain('Saved sticker');
		expect(link!.textContent).toContain('Saved locally');
	});
});
