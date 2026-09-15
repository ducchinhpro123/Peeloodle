import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PresentationsPage from './PresentationsPage.svelte';
import PresentationThumb from './PresentationThumb.svelte';
import {
	createMemoryPresentationRepository,
	type MemoryPresentationRepository
} from '$lib/presentations/persistence/repository';
import { createPresentationDocument } from '$lib/presentations/model/factories';
import type { PresentationThumbnailSource } from '$lib/presentations/library/presentationThumbnails';

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 5000
): Promise<T> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

async function renderLibrary(repository: MemoryPresentationRepository) {
	const opened: string[] = [];
	const rendered = await render(PresentationsPage, {
		repository,
		pathname: '/presentations',
		search: '',
		openhref: (id: string) => `/presentations/${encodeURIComponent(id)}`,
		onopen: (id: string) => {
			opened.push(id);
		}
	});
	await waitFor(
		() => !rendered.container.textContent?.includes('Loading local presentations…'),
		'the library to load'
	);
	return { ...rendered, opened };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
	const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
	if (!found) throw new Error(`No button labelled ${label}`);
	return found;
}

describe('presentation library', () => {
	it('shows the honest empty state and creates a persisted blank presentation once', async () => {
		const repository = createMemoryPresentationRepository();
		const { container, opened } = await renderLibrary(repository);

		expect(container.querySelector('.presentation-library-controls h2')?.textContent).toContain(
			'Your presentations'
		);
		expect(container.textContent).toContain('No presentations yet');
		const create = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
			candidate.textContent?.includes('Create your first presentation')
		);
		create?.click();

		await waitFor(() => opened.length === 1, 'the new presentation to open');
		expect(await repository.listPresentations()).toHaveLength(1);
		expect(opened[0]).toBe((await repository.listPresentations())[0]?.id);
	});

	it('starts and reports the offline warm-up for the session', async () => {
		const repository = createMemoryPresentationRepository();
		const { container } = await renderLibrary(repository);

		// Opening the library starts the shared warm-up; the line only ever states one
		// of the readiness module's own texts, never a promise readiness cannot keep.
		const status = await waitFor(
			() =>
				[...container.querySelectorAll<HTMLParagraphElement>('p[role="status"]')].find(
					(candidate) => /offline use/i.test(candidate.textContent ?? '')
				),
			'the offline readiness status',
			15000
		);
		expect(status?.textContent).toMatch(
			/^(Preparing offline use…|Ready for offline use\.|Offline use (needs one online load|could not be prepared))/
		);
	});

	it('filters, duplicates, renames, and deletes persisted presentations', async () => {
		const repository = createMemoryPresentationRepository();
		await repository.savePresentation(
			createPresentationDocument({ id: 'alpha', title: 'Alpha deck' })
		);
		await repository.savePresentation(
			createPresentationDocument({ id: 'beta', title: 'Beta deck' })
		);
		const { container } = await renderLibrary(repository);

		const search = container.querySelector<HTMLInputElement>('#presentation-library-search')!;
		search.value = 'beta';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		await waitFor(
			() => container.querySelectorAll('.presentation-card').length === 1,
			'the filter'
		);
		expect(container.querySelector('.presentation-card-title')?.textContent).toContain('Beta deck');

		search.value = '';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		await waitFor(
			() => container.querySelectorAll('.presentation-card').length === 2,
			'the full grid'
		);
		button(container, 'Duplicate Alpha deck').click();
		await waitFor(async () => (await repository.listPresentations()).length === 3, 'the duplicate');
		expect((await repository.listPresentations()).map((item) => item.title)).toContain(
			'Alpha deck copy'
		);

		button(container, 'Rename Beta deck').click();
		await waitFor(
			() => container.querySelector<HTMLInputElement>('#rename-presentation-title'),
			'the rename dialog'
		);
		const rename = container.querySelector<HTMLInputElement>('#rename-presentation-title')!;
		rename.value = 'Beta launch';
		rename.dispatchEvent(new Event('input', { bubbles: true }));
		container.querySelector<HTMLFormElement>('#rename-presentation-form')?.requestSubmit();
		await waitFor(
			async () => (await repository.getPresentation('beta')).title === 'Beta launch',
			'the renamed document'
		);

		button(container, 'Delete Beta launch').click();
		await waitFor(
			() => container.querySelector<HTMLDialogElement>('dialog[open] button.danger'),
			'the delete dialog'
		);
		const confirmDelete = container.querySelector<HTMLButtonElement>('dialog[open] button.danger')!;
		confirmDelete.click();
		await waitFor(
			async () => !(await repository.listPresentations()).some((item) => item.id === 'beta'),
			'the deletion'
		);
	});

	it('loads a real thumbnail source only when its preview is mounted', async () => {
		const repository = createMemoryPresentationRepository();
		const source = vi.fn<PresentationThumbnailSource>(async () => ({
			url: 'data:image/png;base64,render'
		}));
		const { container } = await render(PresentationThumb, {
			repository,
			documentId: 'thumb-deck',
			revision: 0,
			source
		});

		await waitFor(
			() => container.querySelector('[data-testid="presentation-card-thumb"]'),
			'the thumbnail'
		);
		expect(source).toHaveBeenCalledTimes(1);
		expect(container.querySelector('img')?.getAttribute('src')).toBe(
			'data:image/png;base64,render'
		);
	});
});
