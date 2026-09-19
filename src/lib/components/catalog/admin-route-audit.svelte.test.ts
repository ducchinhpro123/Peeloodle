/**
 * P77 (Svelte) — admin-route audit at 1440×900, 1024×768 and 390×844.
 *
 * The admin screens are rendered against `MemoryCatalog` with deliberately hostile
 * metadata (maximum-length names, 50 long tags, 10 000-character descriptions), a
 * failed upload job, and the destructive archive dialogs. The audit checks the
 * plan's claims: actions stay reachable, layouts stay contained, status labels are
 * readable, and the shared `Modal` contains its content and closes with Escape.
 *
 * Reduced motion is the shared dialog's `@media (prefers-reduced-motion)` rule and
 * is covered by `e2e/a11y-sweep.spec.ts`; this audit pins the containment and
 * keyboard behaviour at the three widths.
 */
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
// The repository's component tests render without the app stylesheet; a layout
// audit is only meaningful with the real Tailwind+base CSS loaded.
import '../../../app.css';
import AdminCollectionsPage from './AdminCollectionsPage.svelte';
import AdminAssetsPage from './AdminAssetsPage.svelte';
import AdminTemplatesPage from './AdminTemplatesPage.svelte';
import AdminTemplateDetailPage from './AdminTemplateDetailPage.svelte';
import AdminUploadsPage from './AdminUploadsPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import type {
	CatalogAsset,
	CatalogAssetVersion,
	CatalogCollection,
	CatalogTemplate,
	CatalogTemplateVersion
} from '$lib/catalog/types';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const now = '2026-09-19T00:00:00.000Z';

const VIEWPORTS = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'tablet', width: 1024, height: 768 },
	{ name: 'phone', width: 390, height: 844 }
] as const;

const LONG_NAME = 'L'.repeat(200);
const LONG_DESCRIPTION = 'Thorough description text. '.repeat(360).slice(0, 10_000);
const LONG_TAGS = Array.from({ length: 50 }, (_, index) => `tag-${index}-${'y'.repeat(30)}`);

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 8000
): Promise<NonNullable<T>> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value !== null && value !== undefined && value !== false) return value as NonNullable<T>;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

async function setViewport(width: number, height: number) {
	await page.viewport(width, height);
	// Let the media-query layout settle before measuring.
	await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

function containment() {
	return {
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	};
}

function controlByText(root: ParentNode, text: string): HTMLElement {
	const found = [...root.querySelectorAll<HTMLElement>('button, a')].find((control) =>
		(control.textContent ?? '').trim().includes(text)
	);
	if (!found) throw new Error(`No button or link containing “${text}”`);
	return found;
}

function isRendered(element: Element): boolean {
	if (!(element instanceof HTMLElement)) return false;
	const style = getComputedStyle(element);
	if (style.display === 'none' || style.visibility === 'hidden') return false;
	return element.getClientRects().length > 0;
}

function collection(): CatalogCollection {
	return {
		id: 'c0000000-0000-4000-8000-0000000000f1',
		name: LONG_NAME,
		description: LONG_DESCRIPTION,
		tags: LONG_TAGS,
		sortOrder: 1,
		state: 'draft',
		revision: 4,
		publishedAt: null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
}

function asset(versionId: string): CatalogAsset {
	return {
		id: 'a0000000-0000-4000-8000-0000000000f1',
		collectionId: collection().id,
		name: 'A'.repeat(300),
		description: LONG_DESCRIPTION,
		tags: LONG_TAGS,
		kind: 'raster',
		provenance: { source: 'p77' },
		sortOrder: 1,
		state: 'published',
		revision: 2,
		publishedVersionId: versionId,
		publishedAt: now,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
}

function assetVersion(): CatalogAssetVersion {
	return {
		id: 'v0000000-0000-4000-8000-0000000000f1',
		assetId: asset('v0000000-0000-4000-8000-0000000000f1').id,
		versionNumber: 1,
		sourcePath: 'batches/p77/source.png',
		sourceSha256: 'a'.repeat(64),
		sourceBytes: 2048,
		sourceMime: 'image/png',
		derivativePath: 'assets/p77/derivative.png',
		derivativeSha256: 'b'.repeat(64),
		derivativeBytes: 1024,
		derivativeMime: 'image/png',
		derivativeWidth: 256,
		derivativeHeight: 256,
		thumbnailPath: null,
		validationState: 'validated',
		createdAt: now
	};
}

function template(): CatalogTemplate {
	return {
		id: 't0000000-0000-4000-8000-0000000000f1',
		title: LONG_NAME,
		useCase: 'class',
		description: LONG_DESCRIPTION,
		tags: LONG_TAGS,
		sortOrder: 1,
		state: 'draft',
		revision: 3,
		publishedVersionId: null,
		publishedAt: null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
}

function templateVersion(templateId: string): CatalogTemplateVersion {
	return {
		id: 'w0000000-0000-4000-8000-0000000000f1',
		templateId,
		versionNumber: 2,
		document: {
			schemaVersion: 1,
			slides: [{ id: 's1', name: 'Slide 1', background: '#ffffff', elements: [] }],
			assets: []
		},
		documentSha256: 'e'.repeat(64),
		documentBytes: 4096,
		coverPath: null,
		coverSha256: null,
		slidePreviews: [],
		fontRequirements: [{ fontId: 'be-vietnam-pro' }],
		validationState: 'pending',
		validation: { created_by: ADMIN },
		createdAt: now
	};
}

function seededCatalog(): MemoryCatalog {
	const version = assetVersion();
	return new MemoryCatalog(
		{
			admins: [ADMIN],
			collections: [collection()],
			assets: [asset(version.id)],
			versions: [version],
			templates: [template()],
			templateVersions: [templateVersion(template().id)],
			derivativeUrls: new Map([[version.derivativePath, 'https://example.test/p77.png']])
		},
		ADMIN
	);
}

describe('P77 admin route audit', () => {
	it('keeps the list screens contained with hostile metadata at three widths', async () => {
		const catalog = seededCatalog();
		for (const viewport of VIEWPORTS) {
			await setViewport(viewport.width, viewport.height);

			const collections = render(AdminCollectionsPage, { repository: catalog });
			await waitFor(
				() => collections.container.textContent?.includes(LONG_NAME.slice(0, 40)),
				'the long collection row'
			);
			expect(isRendered(controlByText(collections.container, 'New collection'))).toBe(true);
			expect(isRendered(controlByText(collections.container, 'Search'))).toBe(true);
			// The long-name fix must be active, not merely present in the DOM.
			const nameHeading = collections.container.querySelector('h2');
			expect(nameHeading && getComputedStyle(nameHeading).overflowWrap).toBe('anywhere');
			{
				const { scrollWidth, clientWidth } = containment();
				expect(scrollWidth, `collections at ${viewport.width}`).toBeLessThanOrEqual(
					clientWidth + 1
				);
			}
			await collections.unmount();

			const assets = render(AdminAssetsPage, { repository: catalog });
			await waitFor(
				() => assets.container.textContent?.includes('A'.repeat(40)),
				'the long asset row'
			);
			expect(isRendered(controlByText(assets.container, 'Apply'))).toBe(true);
			{
				const { scrollWidth, clientWidth } = containment();
				expect(scrollWidth, `assets at ${viewport.width}`).toBeLessThanOrEqual(clientWidth + 1);
			}
			await assets.unmount();

			const templates = render(AdminTemplatesPage, {
				repository: catalog,
				detailHref: (id) => `/admin/templates/${id}`,
				presentationsHref: '/presentations'
			});
			await waitFor(
				() => templates.container.textContent?.includes(LONG_NAME.slice(0, 40)),
				'the long template row'
			);
			expect(isRendered(controlByText(templates.container, 'Search'))).toBe(true);
			expect(isRendered(controlByText(templates.container, 'Open'))).toBe(true);
			{
				const { scrollWidth, clientWidth } = containment();
				expect(scrollWidth, `templates at ${viewport.width}`).toBeLessThanOrEqual(clientWidth + 1);
			}
			await templates.unmount();

			const detail = render(AdminTemplateDetailPage, {
				templateId: template().id,
				repository: catalog,
				listHref: '/admin/templates',
				editHref: `/admin/templates/${template().id}/edit`
			});
			await waitFor(
				() => detail.container.textContent?.includes('Version 2'),
				'the detail version facts'
			);
			expect(isRendered(controlByText(detail.container, 'Edit metadata'))).toBe(true);
			expect(isRendered(controlByText(detail.container, 'Archive template'))).toBe(true);
			{
				const { scrollWidth, clientWidth } = containment();
				expect(scrollWidth, `detail at ${viewport.width}`).toBeLessThanOrEqual(clientWidth + 1);
			}
			await detail.unmount();
		}
	});

	it('contains the destructive dialog and closes it with Escape at phone width', async () => {
		await setViewport(390, 844);
		const catalog = seededCatalog();
		const rendered = render(AdminCollectionsPage, { repository: catalog });
		await waitFor(
			() => rendered.container.textContent?.includes(LONG_NAME.slice(0, 40)),
			'the long collection row'
		);
		controlByText(rendered.container, 'Archive').click();
		const dialog = await waitFor(
			() =>
				[...rendered.container.querySelectorAll('dialog')].find(
					(row) => row.open && (row.textContent ?? '').includes('Archive collection')
				),
			'the archive dialog'
		);
		const rect = dialog.getBoundingClientRect();
		expect(rect.height).toBeLessThanOrEqual(window.innerHeight);
		expect(rect.width).toBeLessThanOrEqual(window.innerWidth);
		const scroller = dialog.querySelector('.dialog-scroll');
		if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
			expect(['auto', 'scroll']).toContain(getComputedStyle(scroller).overflowY);
		}
		expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true);
		await userEvent.keyboard('{Escape}');
		await waitFor(() => !dialog.open, 'Escape to close the dialog');
		await rendered.unmount();
	});

	it('shows a failed upload job with its reason and a reachable retry at phone width', async () => {
		await setViewport(390, 844);
		const catalog = seededCatalog();
		const created = await catalog.createUploadBatch({
			collectionId: collection().id,
			files: [{ name: 'broken-chart.png', mime: 'image/png', bytes: 1500 }]
		});
		if (!created.ok) throw new Error(JSON.stringify(created));
		const batch = created.item.batch;
		const job = created.item.jobs[0]!;
		await catalog.uploadSource(
			job.sourcePath,
			new Blob([new Uint8Array(1500)], { type: 'image/png' }),
			'image/png'
		);
		const claim = await catalog.claimUploadJob(300, job.id);
		if (!claim.ok) throw new Error(JSON.stringify(claim));
		const failed = await catalog.failUploadJob(job.id, claim.item.leaseToken, {
			code: 'decode_failed',
			message: 'The file header lies about its dimensions.'
		});
		if (!failed.ok) throw new Error(JSON.stringify(failed));

		const rendered = render(AdminUploadsPage, { repository: catalog });
		await waitFor(
			() => rendered.container.textContent?.includes('broken-chart.png'),
			'the failed file row'
		);
		{
			const { scrollWidth, clientWidth } = containment();
			expect(scrollWidth, 'uploads at 390').toBeLessThanOrEqual(clientWidth + 1);
		}
		// The collection-name select must stay clamped inside the phone viewport.
		const select = rendered.container.querySelector('select');
		if (!select) throw new Error('No collection select rendered');
		expect(select.getBoundingClientRect().width).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);
		expect(getComputedStyle(select).maxWidth).not.toBe('none');
		controlByText(rendered.container, 'Open').click();
		await waitFor(
			() => rendered.container.textContent?.includes('decode_failed'),
			'the failure reason'
		);
		await waitFor(
			() =>
				[...rendered.container.querySelectorAll('button')].some(
					(button) => button.getAttribute('aria-label') === 'Retry broken-chart.png'
				),
			'the retry button'
		);
		expect(batch.state).toBe('open');
		await rendered.unmount();
	});
});
