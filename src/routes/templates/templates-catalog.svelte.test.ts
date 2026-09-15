/**
 * Browser regression for the real `/templates` catalog page
 * (port of the source `src/features/templates/TemplatesPage.tsx` +
 * `TemplateRail.tsx` from React main `54eae61c`).
 *
 * Covers the parts of the source page a reader can see and break: the source
 * category pills, the `q` search filter (external, URL-owned state), the count
 * copy, the generated previews, the empty state with `Reset filters`, the
 * localStorage favorite toggle shared by every rail, the preview dialog and —
 * the acceptance contract of this slice — that "Use Template" writes an
 * **independent** copy: new document/layer/asset ids, real bundled artwork blobs,
 * and a catalog that the copies never mutate.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TemplatesPage from '$lib/components/TemplatesPage.svelte';
import { TEMPLATE_CATEGORIES, templateData } from '$lib/editor/templates';
import { createMemoryRepository } from '$lib/persistence/repository';

const FAVORITES_KEY = 'stickerlab_fav_templates';

/** Waits for a condition that depends on effects/async repository work. */
async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 8000
): Promise<T> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/**
 * Renders the catalog the way `src/routes/templates/+page.svelte` does: the URL
 * owns the query, the page reports edits back through `onquery`.
 */
async function renderCatalog(
	props: {
		query?: string;
		onquery?: (value: string) => void;
		onopen?: (projectId: string) => void;
	} = {}
) {
	const repository = createMemoryRepository();
	const opened: string[] = [];
	const queries: string[] = [];
	const rendered = await render(TemplatesPage, {
		repository,
		onopen: (id: string) => {
			opened.push(id);
			props.onopen?.(id);
		},
		pathname: '/templates',
		search: props.query ? `?q=${props.query}` : '',
		query: props.query ?? '',
		onquery: (value: string) => {
			queries.push(value);
			props.onquery?.(value);
		}
	});
	return { repository, rendered, opened, queries, container: rendered.container };
}

function cardTitles(container: HTMLElement): string[] {
	return [...container.querySelectorAll('.rail .template-title-btn b')].map(
		(node) => node.textContent?.trim() ?? ''
	);
}

function cardFor(container: HTMLElement, title: string): HTMLElement {
	const card = [...container.querySelectorAll('.rail .template-card')].find(
		(candidate) => candidate.querySelector('.template-title-btn b')?.textContent?.trim() === title
	);
	if (!(card instanceof HTMLElement)) throw new Error(`No template card for ${title}`);
	return card;
}

function pressedPill(container: HTMLElement): string | undefined {
	return (
		container.querySelector('.pills button[aria-pressed="true"]')?.textContent?.trim() ?? undefined
	);
}

/** The first card's "Use Template" action (cards are in document order). */
function useButton(container: HTMLElement): HTMLButtonElement {
	const button = [...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(
		(candidate) => candidate.textContent?.trim() === 'Use Template'
	);
	if (!button) throw new Error('No Use Template button is mounted');
	return button;
}

afterEach(() => localStorage.removeItem(FAVORITES_KEY));

describe('templates catalog page', () => {
	it('renders the source pills, search, count copy and three preview rails', async () => {
		const { container } = await renderCatalog();

		expect(container.querySelector('h1')?.textContent).toContain('Find your vibe');
		const pills = [...container.querySelectorAll('.pills button')];
		expect(pills.map((pill) => pill.textContent?.trim())).toEqual([...TEMPLATE_CATEGORIES]);
		expect(pressedPill(container)).toBe('All Templates');
		expect(container.querySelector('.filters')?.textContent).toContain(
			'12 editable templates · free to make your own'
		);

		const search = container.querySelector<HTMLInputElement>('.filter-search input');
		expect(search?.getAttribute('aria-label')).toBe('Search sample templates');
		expect(search?.getAttribute('placeholder')).toBe('Find your next idea…');
		expect(search?.value).toBe('');

		const rails = [...container.querySelectorAll('.rail')];
		expect(rails).toHaveLength(3);
		expect(cardTitles(rails[0]! as HTMLElement)).toEqual(templateData.map((item) => item.title));
		expect(cardTitles(rails[1]! as HTMLElement)).toEqual(
			templateData.map((item) => item.title).reverse()
		);
		expect(cardTitles(rails[2]! as HTMLElement)).toEqual(
			templateData.slice(2).map((item) => item.title)
		);
		// Every card renders the generated preview PNG from `/art/templates/`.
		for (const template of templateData.slice(0, 4)) {
			const image = cardFor(container, template.title).querySelector(
				'.template-preview-trigger img.template-preview-image'
			);
			expect(image?.getAttribute('src')).toBe(template.previewImage);
		}
	});

	it('filters the rails from the URL query and reports typing through onquery', async () => {
		const { container, queries } = await renderCatalog({ query: 'pet' });

		expect(new Set(cardTitles(container))).toEqual(new Set(['Pet Bestie']));
		expect(container.querySelector('.filters')?.textContent).toContain('1 editable templates');
		expect(container.querySelector<HTMLInputElement>('.filter-search input')?.value).toBe('pet');

		const search = container.querySelector<HTMLInputElement>('.filter-search input')!;
		search.value = 'cat';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		expect(queries).toEqual(['cat']);
	});

	it('filters by category pill and drops the category when the query changes', async () => {
		const { container, rendered } = await renderCatalog();

		const love = [...container.querySelectorAll<HTMLButtonElement>('.pills button')].find(
			(pill) => pill.textContent?.trim() === 'Love'
		);
		love?.click();
		await waitFor(() => pressedPill(container) === 'Love', 'the Love pill to be pressed');
		expect(pressedPill(container)).toBe('Love');
		expect(new Set(cardTitles(container))).toEqual(new Set(['My Person']));

		// The source resets the picked category whenever `q` changes
		// (`useEffect(() => setCategory('All Templates'), [query])`), so a new query
		// never combines with a stale category.
		await rendered.rerender({ query: 'pet' });
		expect(pressedPill(container)).toBe('All Templates');
		expect(new Set(cardTitles(container))).toEqual(new Set(['Pet Bestie']));

		// A second query change resets again — even back to the empty query, so a
		// category is never revived by returning to a value the query once had.
		await rendered.rerender({ query: '' });
		expect(pressedPill(container)).toBe('All Templates');
		expect(cardTitles(container)).toHaveLength(templateData.length * 3 - 2);
	});

	it('shows the honest empty state and lets Reset filters report an empty query', async () => {
		const { container, queries } = await renderCatalog({ query: 'zzz' });

		expect([...container.querySelectorAll('.rail')]).toHaveLength(0);
		expect(container.querySelector('.empty h2')?.textContent).toBe('No sample templates found');
		expect(pressedPill(container)).toBe('All Templates');

		const reset = [...container.querySelectorAll<HTMLButtonElement>('.empty button')].find(
			(button) => button.textContent?.includes('Reset filters')
		);
		reset?.click();
		expect(queries).toEqual(['']);
	});

	it('toggles a favorite from the card and keeps every rail in sync', async () => {
		const { container } = await renderCatalog();
		expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([]);

		const heartInRail = (index: number) =>
			cardFor(
				container.querySelectorAll('.rail')[index] as HTMLElement,
				'Orbit Pop'
			).querySelector<HTMLButtonElement>('.favorite-button')!;
		const first = heartInRail(0);
		const mirror = heartInRail(1);
		expect(first.getAttribute('aria-label')).toBe('Add Orbit Pop to favorites');
		expect(mirror.getAttribute('aria-label')).toBe('Add Orbit Pop to favorites');

		first.click();
		await waitFor(
			() => first.getAttribute('aria-label') === 'Remove Orbit Pop from favorites',
			'the favorite to fill'
		);
		expect(mirror.getAttribute('aria-label')).toBe('Remove Orbit Pop from favorites');
		expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).toContain('sample-0');

		first.click();
		await waitFor(
			() => first.getAttribute('aria-label') === 'Add Orbit Pop to favorites',
			'the favorite to empty'
		);
		expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).not.toContain('sample-0');
	});

	it('previews a template and clones it into an independent, saved document', async () => {
		const pristineLayers = structuredClone(templateData[0]!.document.layers);
		const pristineAssets = [...templateData[0]!.document.assetIds];
		const { container, repository, opened } = await renderCatalog();

		const card = cardFor(container, 'Orbit Pop');
		card
			.querySelector('.template-title-btn')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		const dialog = await waitFor(
			() => container.querySelector('dialog[open]'),
			'the preview dialog'
		);
		if (!(dialog instanceof HTMLDialogElement)) throw new Error('The preview dialog did not open');
		const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
		expect(title?.textContent).toBe('Orbit Pop');
		const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
		expect(description?.textContent).toBe(
			'Clone this template into an independent editable sticker.'
		);
		expect(dialog.textContent).toContain('Category: Trending');
		expect(dialog.textContent).toContain('Your photo');
		expect(dialog.textContent).toContain('Caption backing');
		// The editor hint names the control that actually exists: `Replace photo` is the
		// image-layer card at the top of the Sticker Properties panel, above the
		// Adjust / Effects / Position / Layers tabs — the source's "Adjust → Replace photo"
		// step is not where that button lives, so the preview must not claim it is.
		expect(dialog.textContent).toMatch(
			/use\s+Replace photo\s+at\s+the top of the Sticker Properties panel/
		);
		expect(dialog.textContent).not.toContain('Adjust →');

		useButton(container).click();
		const projectId = await waitFor(() => opened[0], 'the cloned document to open');
		// `onUse` resolves before the card clears `creating`/`open`, so wait for the card
		// to settle before opening the second preview. (The real page navigates to the
		// editor at this point and unmounts; the test keeps the catalog mounted.)
		await waitFor(
			() => container.querySelector('dialog[open]') === null && !useButton(container).disabled,
			'the first clone to settle'
		);

		const clone = await repository.getProject(projectId);
		expect(clone.id).not.toBe(templateData[0]!.document.id);
		expect(clone.title).toBe('Orbit Pop Copy');
		expect(clone.layers).toHaveLength(pristineLayers.length);
		expect(clone.assetIds).toHaveLength(pristineAssets.length);
		// Fresh layer and asset identity: nothing is shared with the catalog entry.
		expect(clone.layers.map((layer) => layer.id)).not.toEqual(
			pristineLayers.map((layer) => layer.id)
		);
		expect(clone.assetIds.filter((id) => pristineAssets.includes(id))).toEqual([]);
		expect(clone.layers.map((layer) => layer.name)).toEqual(
			pristineLayers.map((layer) => layer.name)
		);
		for (const assetId of clone.assetIds) {
			const record = await repository.getAsset(assetId);
			expect(record.blob.size).toBeGreaterThan(0);
			expect(record.asset.provenance).toMatch(/^bundled-asset:\/art\//);
		}

		// A second copy of the same template is independent of the first one.
		card
			.querySelector('.template-preview-trigger')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		const secondDialog = await waitFor(
			() => container.querySelector('dialog[open]'),
			'the second preview dialog'
		);
		if (!(secondDialog instanceof HTMLDialogElement))
			throw new Error('The second preview dialog did not open');
		useButton(container).click();
		const secondId = await waitFor(() => opened[1], 'the second clone to open');
		const second = await repository.getProject(secondId);
		expect(second.id).not.toBe(clone.id);
		expect(second.assetIds.filter((id) => clone.assetIds.includes(id))).toEqual([]);
		expect(second.layers.some((layer) => clone.layers.some((other) => other.id === layer.id))).toBe(
			false
		);
		expect(await repository.listProjects()).toHaveLength(2);

		// The catalog entry itself is untouched by cloning (`templateData` is a module
		// singleton shared by every rail).
		expect(templateData[0]!.document.layers).toEqual(pristineLayers);
		expect(templateData[0]!.document.assetIds).toEqual(pristineAssets);
	});
});
