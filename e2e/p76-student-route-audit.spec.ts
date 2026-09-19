/**
 * P76 (Svelte) — student-route audit at 1440×900, 1024×768 and 390×844.
 *
 * Walks the real production routes a student uses and checks the two claims the
 * plan makes: desktop/tablet actions stay reachable, and the phone messaging does
 * not promise cross-device local access or full editing. Layout containment is
 * measured as `documentElement.scrollWidth` against the viewport, the same
 * measurement that caught the dashboard overflow at 390 in the cloud suite.
 *
 * `P76_EVIDENCE=1` additionally writes viewport screenshots and a JSON report to
 * `proofs/out/`; the assertions run in the default e2e suite either way.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openBlankEditor } from './presentations';

const OUT = join(process.cwd(), 'proofs', 'out');
const evidence = process.env.P76_EVIDENCE === '1';

const VIEWPORTS = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'tablet', width: 1024, height: 768 },
	{ name: 'phone', width: 390, height: 844 }
] as const;

type RouteAudit = {
	route: string;
	viewport: string;
	width: number;
	scrollWidth: number;
	clientWidth: number;
	actions: string[];
	honestPhoneCopy?: boolean;
};

async function metrics(page: Page) {
	return page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		bodyScrollWidth: document.body.scrollWidth
	}));
}

/** Every route must fit its viewport; one overflowing pixel is a layout bug. */
async function expectContained(page: Page, route: string, width: number) {
	const { scrollWidth, clientWidth, bodyScrollWidth } = await metrics(page);
	expect(scrollWidth, `${route} at ${width}px (document)`).toBeLessThanOrEqual(clientWidth + 1);
	expect(bodyScrollWidth, `${route} at ${width}px (body)`).toBeLessThanOrEqual(clientWidth + 1);
	return { scrollWidth, clientWidth };
}

test('P76: student routes are contained and actionable at three widths', async ({ page }) => {
	test.setTimeout(600_000);
	await mkdir(OUT, { recursive: true });
	const audits: RouteAudit[] = [];

	for (const viewport of VIEWPORTS) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });

		// Dashboard.
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		const dashboard = await expectContained(page, '/', viewport.width);
		if (evidence)
			await page.screenshot({
				path: join(OUT, `p76-dashboard-${viewport.width}.png`),
				fullPage: false
			});
		audits.push({
			route: '/',
			viewport: viewport.name,
			width: viewport.width,
			...dashboard,
			actions: []
		});

		// Presentation library.
		await page.goto('/presentations');
		const create = page
			.getByRole('button', {
				name: /Create your first presentation|Create a blank presentation|Start a blank presentation/
			})
			.first();
		await expect(create).toBeVisible();
		const library = await expectContained(page, '/presentations', viewport.width);
		if (evidence)
			await page.screenshot({
				path: join(OUT, `p76-library-${viewport.width}.png`),
				fullPage: false
			});
		audits.push({
			route: '/presentations',
			viewport: viewport.name,
			width: viewport.width,
			...library,
			actions: ['create or open a presentation']
		});

		// Editor: canvas plus the core actions, and the honest phone note.
		await openBlankEditor(page);
		await expect(page.getByTestId('presentation-canvas')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Add text', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
		const editor = await expectContained(page, '/presentations/<id>', viewport.width);
		const note = page.locator('.presentation-mobile-note');
		let honestPhoneCopy: boolean | undefined;
		if (viewport.name === 'phone') {
			await expect(note).toBeVisible();
			await expect(note).toContainText('designed for a laptop or desktop');
			await expect(note).toContainText('preview remains available');
			const copy = (await note.innerText()).toLowerCase();
			expect(copy).not.toContain('sync');
			expect(copy).not.toContain('cross-device');
			expect(copy).not.toContain('full editing');
			honestPhoneCopy = true;
		} else {
			await expect(note).toBeHidden();
		}
		if (evidence)
			await page.screenshot({
				path: join(OUT, `p76-editor-${viewport.width}.png`),
				fullPage: false
			});
		audits.push({
			route: '/presentations/<id>',
			viewport: viewport.name,
			width: viewport.width,
			...editor,
			actions: ['add text', 'export', 'save'],
			honestPhoneCopy
		});

		// Deck-template browser: without catalog configuration it must say so, not
		// show an empty catalog.
		await page.goto('/presentation-templates');
		await expect(page.getByRole('heading', { name: 'Deck templates' })).toBeVisible();
		await expect(page.getByText(/Deck templates need the catalog/)).toBeVisible();
		const templates = await expectContained(page, '/presentation-templates', viewport.width);
		if (evidence)
			await page.screenshot({
				path: join(OUT, `p76-templates-${viewport.width}.png`),
				fullPage: false
			});
		audits.push({
			route: '/presentation-templates',
			viewport: viewport.name,
			width: viewport.width,
			...templates,
			actions: ['unconfigured message']
		});
	}

	if (evidence) {
		await writeFile(
			join(OUT, 'p76-student-routes-report.json'),
			`${JSON.stringify(
				{
					generatedAt: new Date().toISOString(),
					browser: `chromium ${await page.evaluate(() => navigator.userAgent)}`,
					viewports: VIEWPORTS,
					audits,
					notes: [
						'Containment is documentElement.scrollWidth ≤ clientWidth + 1 at each viewport.',
						'The phone note is asserted to avoid sync, cross-device and full-editing promises.',
						'Screenshots are viewport-sized captures of each audited route.'
					]
				},
				null,
				'\t'
			)}\n`
		);
	}
});
