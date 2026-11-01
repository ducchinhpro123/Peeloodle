// Failure modes: category state is lost on reload; All falls back to the task;
// filtering resets scroll/focus or page mode; deck labels follow array position.
// Sweep failures: a narrow viewport scrolls sideways, a label is clipped, the form
// is unreachable by keyboard, arrow keys do not change a radio group, or a
// length × look pair fails to build, open or stay inside the slide limits.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { listStoredPresentations, readStoredPresentationJson } from './presentations';

test('chip choice survives reload without leaving the research task', async ({ page }) => {
	await page.goto('/presentations?task=research-defense');
	await expect(page.getByRole('button', { name: 'Research', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const chip = page.getByRole('button', { name: 'Class', exact: true });
	await chip.scrollIntoViewIfNeeded();
	const scroll = await page.evaluate(() => scrollY);
	await chip.click();
	await expect(page).toHaveURL(/task=research-defense/);
	await expect(page).toHaveURL(/category=class/);
	await expect(chip).toBeFocused();
	expect(await page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Class', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page).toHaveURL(/task=research-defense/);
	await page.getByRole('button', { name: 'All templates', exact: true }).click();
	await expect(page).toHaveURL(/category=all/);
	await page.reload();
	await expect(page.getByRole('button', { name: 'All templates', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page).toHaveURL(/task=research-defense/);
	await page
		.getByRole('searchbox', { name: 'Search presentation templates' })
		.fill('No matching template');
	await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Preview Class presentation' })).toBeVisible();
});

test('category param wins and invalid values fall back to the task', async ({ page }) => {
	await page.goto('/presentations?category=business');
	await expect(page.getByRole('button', { name: 'Business', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(
		page.getByRole('button', { name: 'Preview Red & white company profile' })
	).toBeVisible();
	await page.goto('/presentations?task=club-pitch&category=bogus');
	await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('deck labels follow each template use case', async ({ page }) => {
	await page.goto('/presentations');
	await expect(page.getByRole('button', { name: 'Preview Research defense' })).toContainText(
		'Research ·'
	);
	await expect(
		page.getByRole('button', { name: 'Preview Red & white company profile' })
	).toContainText('Business ·');
});

// Form failures: wrong task mode, unreachable title, lost personal details,
// empty required title, duplicate submission, quota failure, and UTC date drift.
const subtitleLines = (doc: any) =>
	doc.slides[0].elements
		.find((element: any) => element.name === 'Subtitle')
		.paragraphs.map((paragraph: any) => paragraph.runs.map((run: any) => run.text).join(''));
async function openSetup(page: Page) {
	await page.goto('/presentations?task=research-defense');
	await expect(page.getByRole('region', { name: 'Build your defense deck' })).toBeVisible();
}
async function openBuiltDeck(page: Page) {
	await expect(page).toHaveURL(/\/presentations\/[^?]+$/);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	return JSON.parse(
		await readStoredPresentationJson(page, new URL(page.url()).pathname.split('/').at(-1)!)
	);
}

test('research hero replaces the generic hero only for this task', async ({ page }) => {
	await openSetup(page);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Defend your work.');
	await expect(
		page.getByRole('button', { name: 'Set up my defense deck', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Class', exact: true }).click();
	await page.reload();
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Defend your work.');
	await expect(page.getByRole('region', { name: 'Build your defense deck' })).toBeVisible();
	await page.goto('/presentations?task=class');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Tell your story.');
	await expect(page.getByRole('region', { name: 'Build your defense deck' })).toHaveCount(0);
});

test('hero button focuses the title field', async ({ page }) => {
	await openSetup(page);
	await page.getByRole('button', { name: 'Set up my defense deck', exact: true }).click();
	await expect(page.getByLabel('Thesis or project title', { exact: true })).toBeFocused();
});

test('a student builds a personalised defense deck', async ({ page }, info) => {
	await openSetup(page);
	await page.getByLabel('20 minutes · 13 slides').check();
	await page.getByRole('radio', { name: 'Thesis', exact: true }).check();
	await page.getByLabel('Thesis or project title', { exact: true }).fill('Light and Growth');
	await page.getByLabel('Your name', { exact: true }).fill('Ana Lim');
	await page.getByLabel('School or program', { exact: true }).fill('Uni X');
	await page.getByLabel('Advisor', { exact: true }).fill('Dr. B');
	await page.getByLabel('Defense date', { exact: true }).fill('2026-12-05');
	await page.getByLabel('Research question', { exact: true }).fill('Does light matter?');
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	const doc = await openBuiltDeck(page);
	expect(doc.slides).toHaveLength(13);
	expect(doc.title).toBe('Light and Growth');
	expect(subtitleLines(doc)).toEqual(['Ana Lim · Uni X', 'Advisor: Dr. B', 'December 5, 2026']);
	const question = doc.slides
		.find((slide: any) => slide.name === 'Question')
		.elements.find((element: any) => element.name === 'Question body');
	expect(question.paragraphs[0].runs[0].text).toBe('Does light matter?');
	await page.screenshot({ path: info.outputPath('research-defense-editor.png') });
});

test('an empty title is refused in place', async ({ page }) => {
	await openSetup(page);
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	await expect(page.getByText('Add your thesis or project title.', { exact: true })).toBeVisible();
	const title = page.getByLabel('Thesis or project title', { exact: true });
	await expect(title).toBeFocused();
	await expect(title).toHaveAttribute('aria-invalid', 'true');
	await expect(title).toHaveAttribute('aria-describedby', /\S/);
	expect(await listStoredPresentations(page)).toHaveLength(0);
});

test('building twice quickly saves one deck', async ({ page }) => {
	await openSetup(page);
	await page.getByLabel('Thesis or project title', { exact: true }).fill('One defense deck');
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).dblclick();
	await openBuiltDeck(page);
	expect(await listStoredPresentations(page)).toHaveLength(1);
});

test('a failed save keeps the form and stores nothing', async ({ page }) => {
	const key = 'peeloodle-e2e-fail-defense-writes';
	await page.addInitScript((key) => {
		if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, 'on');
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (...args) {
			if (sessionStorage.getItem(key) === 'on' && this.name === 'presentations')
				throw new DOMException(
					'The quota has been exceeded (injected failure)',
					'QuotaExceededError'
				);
			return put.apply(this, args);
		};
	}, key);
	await openSetup(page);
	await page.getByLabel('Thesis or project title', { exact: true }).fill('Keep my research');
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText(
		"Couldn't create your defense deck. Nothing was saved. Please try again."
	);
	await expect(page.getByLabel('Thesis or project title', { exact: true })).toHaveValue(
		'Keep my research'
	);
	expect(await listStoredPresentations(page)).toHaveLength(0);
	await page.evaluate((key) => sessionStorage.setItem(key, 'off'), key);
	await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
	await openBuiltDeck(page);
	expect(await listStoredPresentations(page)).toHaveLength(1);
});

test.describe('local defense date', () => {
	test.use({ timezoneId: 'Pacific/Honolulu' });
	test('defense date keeps the calendar day in Pacific/Honolulu', async ({ page }) => {
		await openSetup(page);
		await page.getByLabel('Thesis or project title', { exact: true }).fill('Calendar day');
		await page.getByLabel('Defense date', { exact: true }).fill('2026-12-05');
		await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
		expect(subtitleLines(await openBuiltDeck(page))).toEqual(['December 5, 2026']);
	});
});

// Story arc failures: the panel lists the wrong sections, the times drift from the
// length table, the arc stops following the radio, or the talk time is misreported.
test('the story arc follows the chosen length', async ({ page }) => {
	await page.goto('/presentations?task=research-defense');
	const arc = page.getByRole('list', { name: 'Defense story arc' });
	await expect(arc.getByRole('listitem')).toHaveCount(9);
	await expect(arc.getByRole('listitem').first()).toContainText('Title');
	await expect(arc.getByRole('listitem').first()).toContainText('~30 s');
	await expect(arc.getByRole('listitem').filter({ hasText: /^Results/ })).toContainText('~3.5 min');
	await expect(arc.getByRole('listitem').last()).toContainText('after the talk');
	await expect(page.getByText('Talk time: 15 minutes')).toBeVisible();
	await page.getByLabel('10 minutes · 7 slides').check();
	await expect(arc.getByRole('listitem')).toHaveCount(7);
	await expect(page.getByText('Talk time: 10 minutes')).toBeVisible();
});

const LENGTHS = [
	['short', '10 minutes · 7 slides'],
	['standard', '15 minutes · 9 slides'],
	['extended', '20 minutes · 13 slides']
] as const;
const LOOKS = [
	['midnight', 'Midnight'],
	['lab', 'Lab notebook'],
	['thesis', 'Thesis']
] as const;
/** Exactly 120 characters: the field limit, so the title slide has to shrink. */
const LONG_TITLE =
	'Canopy light, frost timing and seedling recovery: a twelve-week field study of photosynthetic rebound across three sites';
const OUT_DIR = path.resolve('proofs/out/research-defense');
const PROOF = path.resolve('proofs/research-defense.md');

/** The stored row with every generated identifier and timestamp removed. */
const normalizedJson = (value: unknown) =>
	JSON.stringify(value, (key, item) =>
		['id', 'createdAt', 'updatedAt'].includes(key) ? undefined : item
	);

async function fillDefenseForm(page: Page, lengthLabel: string, lookLabel: string) {
	await page.getByLabel(lengthLabel, { exact: true }).check();
	await page.getByRole('radio', { name: lookLabel, exact: true }).check();
	await page.getByLabel('Thesis or project title', { exact: true }).fill(LONG_TITLE);
	await page.getByLabel('Your name', { exact: true }).fill('Ana Lim');
	await page.getByLabel('School or program', { exact: true }).fill('University of the Lowlands');
	await page.getByLabel('Advisor', { exact: true }).fill('Dr. Bea Cortez');
	await page.getByLabel('Defense date', { exact: true }).fill('2026-12-05');
	await page
		.getByLabel('Research question', { exact: true })
		.fill('Does canopy light speed photosynthetic recovery after a late frost?');
}

test.describe('responsive sweep', () => {
	test.use({ reducedMotion: 'reduce' });
	for (const width of [320, 390, 768, 1024, 1440, 1920]) {
		test(`research setup fits at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto('/presentations?task=research-defense');
			await expect(page.getByRole('region', { name: 'Build your defense deck' })).toBeVisible();
			await expect(page.getByRole('list', { name: 'Defense story arc' })).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Build my defense deck', exact: true })
			).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
				`horizontal scroll at ${width}px`
			).toBeLessThanOrEqual(width);
			const clipped = await page.evaluate(() =>
				[...document.querySelectorAll('#defense-setup label')]
					.filter((label) => label.scrollWidth > label.clientWidth)
					.map((label) => label.textContent?.trim().slice(0, 40) ?? '')
			);
			expect(clipped, `clipped labels at ${width}px`).toEqual([]);
			// The arc sits beside the form from 900px up and stacks under it below.
			expect(
				await page.evaluate(() => {
					const grid = document.querySelector('#defense-setup .setup-grid');
					return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
				}),
				`setup columns at ${width}px`
			).toBe(width >= 900 ? 2 : 1);
			mkdirSync(OUT_DIR, { recursive: true });
			await page.screenshot({
				path: path.join(OUT_DIR, `setup-${width}.png`),
				fullPage: true
			});
		});
	}
});

test('keyboard-only build', async ({ page }) => {
	await openSetup(page);
	// The blank button is disabled while the library loads; wait so tab order is stable.
	await expect(page.getByRole('button', { name: 'Start a blank presentation' })).toBeEnabled();
	await page.getByRole('button', { name: 'Set up my defense deck', exact: true }).focus();
	await page.keyboard.press('Tab'); // Start a blank presentation
	await page.keyboard.press('Tab'); // the checked length radio
	await expect(page.getByLabel('15 minutes · 9 slides', { exact: true })).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByLabel('20 minutes · 13 slides', { exact: true })).toBeChecked();
	await page.keyboard.press('Tab'); // the checked look radio
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('radio', { name: 'Lab notebook', exact: true })).toBeChecked();
	await page.keyboard.press('Tab'); // the title field
	await expect(page.getByLabel('Thesis or project title', { exact: true })).toBeFocused();
	await page.keyboard.type('Keyboard defense');
	await page.keyboard.press('Enter');
	const doc = await openBuiltDeck(page);
	expect(doc.slides).toHaveLength(13);
	expect(doc.title).toBe('Keyboard defense');
});

// The repeatable artifact: one row per length × look, built through the real form.
test('proof: every length × look', async ({ page }) => {
	mkdirSync(OUT_DIR, { recursive: true });
	/** @type {Array<{ length: string, look: string, slides: number, title: string, subtitle: string, sha256: string }>} */
	const rows = [];
	for (const [length, lengthLabel] of LENGTHS) {
		for (const [look, lookLabel] of LOOKS) {
			await openSetup(page);
			await fillDefenseForm(page, lengthLabel, lookLabel);
			await page.getByRole('button', { name: 'Build my defense deck', exact: true }).click();
			await expect(page).toHaveURL(/\/presentations\/[^?]+$/);
			await expect(page.getByTestId('presentation-canvas')).toBeVisible();
			const id = new URL(page.url()).pathname.split('/').at(-1)!;
			const stored = JSON.parse(await readStoredPresentationJson(page, id));
			expect(stored.title).toBe(LONG_TITLE);
			expect(LONG_TITLE).toHaveLength(120);
			// The editor's own layout engine (real fonts, real wrapping) is the oracle for
			// "the long title fits its slide": select the title and read its overflow state.
			await page.getByRole('button', { name: 'text Title' }).click();
			await expect(page.getByLabel('Text sizing')).toBeVisible();
			await expect(page.locator('.presentation-overflow-notice')).toHaveCount(0);
			// Geometry agrees: the boxes stack on the slide instead of overlapping it.
			const [titleBox, subtitleBox] = ['Title', 'Subtitle'].map((name) =>
				stored.slides[0].elements.find((element: any) => element.name === name)
			);
			expect(subtitleBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
			expect(subtitleBox.y + subtitleBox.height).toBeLessThanOrEqual(stored.pageSize.height);
			rows.push({
				length,
				look,
				slides: stored.slides.length,
				title: `${stored.title.length} chars`,
				subtitle: subtitleLines(stored).join(' / '),
				sha256: createHash('sha256').update(normalizedJson(stored)).digest('hex')
			});
			await page
				.getByTestId('presentation-canvas')
				.screenshot({ path: path.join(OUT_DIR, `${length}-${look}.png`) });
		}
	}
	expect(rows).toHaveLength(9);
	expect(rows.map((row) => row.slides)).toEqual([7, 7, 7, 9, 9, 9, 13, 13, 13]);
	const build = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
	const generatedAt = new Date().toISOString();
	writeFileSync(
		PROOF,
		[
			'# Research defense: length × look proof',
			'',
			`Generated ${generatedAt} by \`e2e/research-defense.spec.ts\` (production build, headless Chromium).`,
			'',
			`- Build: \`${build}\``,
			'- Every row was built through the real setup form: a 120-character title, name, school, advisor, a `2026-12-05` defense date and a research question.',
			'- "Title fits" is the editor\'s own layout engine (real fonts, real wrapping) reporting no text overflow for the title element; it is asserted for every row, not eyeballed.',
			'- SHA-256 covers the stored IndexedDB row with every `id`, `createdAt` and `updatedAt` removed, so a re-run on the same build reproduces it.',
			'',
			'| Length | Look | Slides | Stored title | Subtitle | Title fits | SHA-256 (ids stripped) |',
			'| --- | --- | --- | --- | --- | --- | --- |',
			...rows.map(
				(row) =>
					`| ${row.length} | ${row.look} | ${row.slides} | ${row.title} | ${row.subtitle} | yes | \`${row.sha256}\` |`
			),
			'',
			'## Artifacts',
			'',
			'`proofs/out/research-defense/` holds one editor screenshot per pair (`short-midnight.png` … `extended-thesis.png`) and the responsive sweep (`setup-320.png` … `setup-1920.png`).',
			'',
			'## Re-run',
			'',
			'`npx playwright test e2e/research-defense.spec.ts`; the last test writes this file and the screenshots.',
			''
		].join('\n')
	);
	expect(readFileSync(PROOF, 'utf8')).toContain(`Build: \`${build}\``);
	const dataRows = readFileSync(PROOF, 'utf8')
		.split('\n')
		.filter((line) => /^\| (short|standard|extended) \|/.test(line));
	expect(dataRows).toHaveLength(9);
	for (const row of rows)
		expect(
			readFileSync(path.join(OUT_DIR, `${row.length}-${row.look}.png`)).byteLength
		).toBeGreaterThan(0);
});

test.afterEach(async ({ page }, info) => {
	writeFileSync(
		info.outputPath('research-page-state.json'),
		JSON.stringify(
			{
				url: page.url(),
				viewport: page.viewportSize(),
				selectedCategories: await page
					.locator('.categories [aria-pressed="true"]')
					.allTextContents()
			},
			null,
			2
		)
	);
});
