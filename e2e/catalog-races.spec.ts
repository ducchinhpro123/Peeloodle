import { writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createPresentationDocument } from '../src/lib/presentations/model/factories';
import { openBlankEditor } from './presentations';

// Real routes and components, with only the external Supabase HTTP boundary replaced.
// Gates control response order without depending on network timing or arbitrary sleeps.
const ORIGIN = 'https://synthetic-test.supabase.co';
const NOW = '2026-11-07T00:00:00.000Z';
const ALPHA = '10000000-0000-4000-8000-000000000001';
const BETA = '10000000-0000-4000-8000-000000000002';

function template(id: string, title: string, order: number) {
	return {
		id,
		title,
		use_case: 'class',
		description: `${title} description`,
		tags: [],
		sort_order: order,
		state: 'published',
		revision: 1,
		published_version_id: `version-${id}`,
		published_at: NOW,
		archived_at: null,
		created_at: NOW,
		updated_at: NOW
	};
}

const TEMPLATES = [template(ALPHA, 'Alpha deck', 1), template(BETA, 'Beta deck', 2)];

function asset(index: number, name: string) {
	const id = `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
	return {
		id,
		collection_id: null,
		name,
		description: `${name} description`,
		tags: [],
		kind: 'raster',
		provenance: {},
		sort_order: index,
		state: 'published',
		revision: 1,
		published_version_id: `version-${id}`,
		published_at: NOW,
		archived_at: null,
		created_at: NOW,
		updated_at: NOW
	};
}

const ALPHA_ASSETS = Array.from({ length: 13 }, (_, index) =>
	asset(index + 1, `Alpha sticker ${index + 1}`)
);
const BETA_ASSET = asset(14, 'Beta sticker');

function assetVersion(id: string) {
	return {
		id: `version-${id}`,
		asset_id: id,
		version_number: 1,
		source_path: `assets/${id}/source.png`,
		source_sha256: 'a'.repeat(64),
		source_bytes: 100,
		source_mime: 'image/png',
		derivative_path: `assets/${id}/asset.png`,
		derivative_sha256: 'b'.repeat(64),
		derivative_bytes: 100,
		derivative_mime: 'image/png',
		derivative_width: 640,
		derivative_height: 360,
		thumbnail_path: `assets/${id}/thumb.png`,
		validation_state: 'validated',
		created_at: NOW
	};
}

function version(id: string) {
	const name = id === ALPHA ? 'Alpha' : 'Beta';
	const document = createPresentationDocument({ id, title: `${name} deck`, now: NOW });
	document.slides[0].name = `${name} introduction`;
	return {
		id: `version-${id}`,
		template_id: id,
		version_number: 1,
		document,
		document_sha256: 'a'.repeat(64),
		document_bytes: JSON.stringify(document).length,
		cover_path: `templates/${name.toLowerCase()}/cover.png`,
		cover_sha256: 'b'.repeat(64),
		slide_previews: [
			{
				ordinal: 0,
				path: `templates/${name.toLowerCase()}/slide.png`,
				sha256: 'c'.repeat(64),
				bytes: 100,
				width: 640,
				height: 360
			}
		],
		font_requirements: [],
		validation_state: 'validated',
		validation: {},
		created_at: NOW
	};
}

function gate() {
	let release!: () => void;
	let arrive!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const arrived = new Promise<void>((resolve) => (arrive = resolve));
	return { release, arrive, released, arrived };
}

async function catalogBackend(page: Page) {
	const requests: string[] = [];
	let held: { match: (url: URL) => boolean; gate: ReturnType<typeof gate> } | null = null;
	await page.route(`${ORIGIN}/**`, async (route) => {
		const url = new URL(route.request().url());
		requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
		if (held?.match(url)) {
			const current = held;
			held = null;
			current.gate.arrive();
			await current.gate.released;
		}
		const json = (body: unknown) => route.fulfill({ json: body });
		if (url.pathname === '/rest/v1/catalog_templates') {
			const id = url.searchParams.get('id')?.replace(/^eq\./, '');
			return json(id ? TEMPLATES.find((item) => item.id === id) : TEMPLATES);
		}
		if (url.pathname === '/rest/v1/catalog_template_versions') {
			return json(version(url.searchParams.get('template_id')!.replace(/^eq\./, '')));
		}
		if (url.pathname === '/rest/v1/catalog_collections') return json([]);
		if (url.pathname === '/rest/v1/catalog_assets') {
			const id = url.searchParams.get('id')?.replace(/^eq\./, '');
			if (id) return json([...ALPHA_ASSETS, BETA_ASSET].find((item) => item.id === id));
			const filters = url.searchParams.getAll('or').join(' ');
			if (filters.includes('Beta')) return json([BETA_ASSET]);
			return json(filters.includes('sort_order.gt.') ? ALPHA_ASSETS.slice(12) : ALPHA_ASSETS);
		}
		if (url.pathname === '/rest/v1/catalog_asset_versions')
			return json(assetVersion(url.searchParams.get('asset_id')!.replace(/^eq\./, '')));
		if (url.pathname === '/rest/v1/rpc/catalog_is_admin') return json(false);
		if (url.pathname.startsWith('/storage/v1/object/sign/')) {
			if (route.request().method() === 'POST')
				return json({ signedURL: `${url.pathname.slice('/storage/v1'.length)}?token=synthetic` });
			return route.fulfill({
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#08b879"/></svg>'
			});
		}
		throw new Error(`Unexpected synthetic catalog request: ${url.pathname}`);
	});
	return {
		requests,
		holdNext(match: (url: URL) => boolean) {
			const next = gate();
			held = { match, gate: next };
			return next;
		}
	};
}

// Wait for response delivery and a rendered browser turn before taking negative assertions.
async function releaseResponse(page: Page, pending: ReturnType<typeof gate>, path: string) {
	const response = page.waitForResponse((response) => new URL(response.url()).pathname === path);
	pending.release();
	await (await response).finished();
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
}

async function evidence(page: Page, info: TestInfo, requests: string[]) {
	await page.screenshot({ path: info.outputPath('catalog-state.png'), animations: 'disabled' });
	await writeFile(
		info.outputPath('catalog-state.json'),
		JSON.stringify(
			{
				url: page.url(),
				requests,
				dialogs: await page.getByRole('dialog').evaluateAll((dialogs) =>
					dialogs.map((dialog) => ({
						text: (dialog as HTMLElement).innerText,
						images: Array.from(dialog.querySelectorAll('img'), (image) => image.src),
						choices: Array.from(dialog.querySelectorAll('select'), (select) => select.value)
					}))
				)
			},
			null,
			2
		)
	);
}

test.use({ trace: 'on' });

test('an older template preview cannot replace the newly opened deck preview', async ({
	page
}, info) => {
	const backend = await catalogBackend(page);
	await page.goto('/presentation-templates');
	await expect(page.getByRole('button', { name: 'Preview Alpha deck', exact: true })).toBeVisible();
	const path = '/storage/v1/object/sign/catalog-derivatives/templates/alpha/slide.png';
	const oldPreview = backend.holdNext((url) => url.pathname === path);
	await page.getByRole('button', { name: 'Preview Alpha deck', exact: true }).click();
	await oldPreview.arrived;
	await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
	await page.getByRole('button', { name: 'Preview Beta deck', exact: true }).click();
	const preview = page.getByRole('dialog', { name: 'Beta deck — all slides', exact: true });
	await expect(preview.getByRole('img', { name: 'Slide 1', exact: true })).toHaveAttribute(
		'src',
		/templates\/beta\/slide\.png/
	);
	await releaseResponse(page, oldPreview, path);
	await evidence(page, info, backend.requests);
	await expect(preview.getByRole('img', { name: 'Slide 1', exact: true })).toHaveAttribute(
		'src',
		/templates\/beta\/slide\.png/
	);
});

test('template slide choices stay with the newest selected deck', async ({ page }, info) => {
	const backend = await catalogBackend(page);
	await openBlankEditor(page);
	await page.getByRole('tab', { name: 'Insert', exact: true }).click();
	await page.getByRole('button', { name: 'Insert template slides', exact: true }).click();
	const picker = page.getByRole('dialog', { name: 'Insert template slides', exact: true });
	const choice = picker.getByRole('combobox', { name: 'Template', exact: true });
	await expect(choice.getByRole('option')).toHaveCount(3);
	const path = '/rest/v1/catalog_template_versions';
	const oldChoice = backend.holdNext(
		(url) => url.pathname === path && url.searchParams.get('template_id') === `eq.${ALPHA}`
	);
	await choice.selectOption(ALPHA);
	await oldChoice.arrived;
	await choice.selectOption(BETA);
	await expect(
		picker.getByRole('checkbox', { name: '1. Beta introduction', exact: true })
	).toBeVisible();
	await releaseResponse(page, oldChoice, path);
	await evidence(page, info, backend.requests);
	await expect(
		picker.getByRole('checkbox', { name: '1. Beta introduction', exact: true })
	).toBeVisible();
	await expect(
		picker.getByRole('checkbox', { name: '1. Alpha introduction', exact: true })
	).toHaveCount(0);
});

test('catalog pagination cannot append results from a previous filter', async ({ page }, info) => {
	const backend = await catalogBackend(page);
	await openBlankEditor(page);
	await page.getByRole('tab', { name: 'Insert', exact: true }).click();
	await page.getByRole('button', { name: 'Add a catalog image', exact: true }).click();
	const picker = page.getByRole('dialog', { name: 'Add a catalog image', exact: true });
	const names = picker.locator('.catalog-item-name');
	await expect(names).toHaveCount(12);
	const path = '/rest/v1/catalog_assets';
	const oldPage = backend.holdNext(
		(url) =>
			url.pathname === path && url.searchParams.getAll('or').join(' ').includes('sort_order.gt.')
	);
	await picker.getByRole('button', { name: 'Load more', exact: true }).click();
	await oldPage.arrived;
	await picker.getByRole('searchbox', { name: 'Search', exact: true }).fill('Beta');
	await picker.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(names).toHaveText(['Beta sticker']);
	await releaseResponse(page, oldPage, path);
	await evidence(page, info, backend.requests);
	await expect(names).toHaveText(['Beta sticker']);
});
