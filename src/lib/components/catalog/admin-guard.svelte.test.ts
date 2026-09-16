/**
 * Browser contract for the catalog access gate (P51): every state it can show,
 * including the membership refusal and a transport failure. The server re-checks
 * membership on every RPC, so these assertions pin the honest messaging, not
 * authorization.
 */
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import AdminGuard from './AdminGuard.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import type { CatalogAdminRepository } from '$lib/catalog/repository';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const content = createRawSnippet(() => ({ render: () => '<p>Collections workspace</p>' }));

describe('admin guard', () => {
	it('explains when the catalog is not configured', () => {
		const page = render(AdminGuard, {
			configured: false,
			sessionEmail: null,
			repository: null,
			homeHref: '/',
			children: content
		});
		expect(page.container.textContent).toContain('Catalog is not configured');
	});

	it('asks a signed-out visitor to sign in', () => {
		const page = render(AdminGuard, {
			configured: true,
			sessionEmail: null,
			repository: null,
			homeHref: '/',
			children: content
		});
		expect(page.container.textContent).toContain('Sign in to open the catalog');
	});

	it('refuses an account without membership', async () => {
		const catalog = new MemoryCatalog({ admins: [] }, 'other-account');
		const page = render(AdminGuard, {
			configured: true,
			sessionEmail: 'other@example.test',
			repository: catalog,
			homeHref: '/',
			children: content
		});
		await waitForText(page.container, 'not a catalog administrator');
		expect(page.container.textContent).not.toContain('Collections workspace');
	});

	it('renders the workspace for an administrator', async () => {
		const catalog = new MemoryCatalog({ admins: [ADMIN] }, ADMIN);
		const page = render(AdminGuard, {
			configured: true,
			sessionEmail: 'admin@example.test',
			repository: catalog,
			homeHref: '/',
			children: content
		});
		await waitForText(page.container, 'Collections workspace');
		expect(page.container.textContent).toContain('Collections workspace');
	});

	it('offers a retry when the membership check fails', async () => {
		const failing = {
			isAdmin: async () => {
				throw new Error('The catalog could not be checked: network unreachable');
			}
		} as unknown as CatalogAdminRepository;
		const page = render(AdminGuard, {
			configured: true,
			sessionEmail: 'admin@example.test',
			repository: failing,
			homeHref: '/',
			children: content
		});
		await waitForText(page.container, 'network unreachable');
		expect(page.container.textContent).toContain('Try again');
	});
});

async function waitForText(container: HTMLElement, text: string) {
	const start = Date.now();
	for (;;) {
		if (container.textContent?.includes(text)) return;
		if (Date.now() - start > 8000) throw new Error(`Timed out waiting for “${text}”`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
