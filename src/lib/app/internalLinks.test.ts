/**
 * Regression for base-path-safe internal navigation.
 *
 * Every in-app `<a href>` must be produced by SvelteKit's base-aware
 * `resolve()` from `$app/paths` (documented for pathnames *and* pathnames with
 * search/hash). A hard-coded root-relative literal keeps working at `/` but
 * navigates outside the app once `config.kit.paths.base` is set, which is the
 * defect this test locks out. `resolve` may not be imported by framework-free
 * modules that the node test project loads, so the check is source-based.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

function svelteFiles(dir: string): string[] {
	/** @type {string[]} */
	const found = [];
	const entries = readdirSync(path.join(projectRoot, dir), { withFileTypes: true });
	for (const entry of entries) {
		const relative = `${dir}/${entry.name}`;
		if (entry.isDirectory()) found.push(...svelteFiles(relative));
		else if (entry.name.endsWith('.svelte')) found.push(relative);
	}
	return found;
}

const sourceFiles = [...svelteFiles('src/lib/components'), ...svelteFiles('src/routes')];

/** Matches `href="/x"`, `href='/x'` and `href={`/x`}` but not `href={resolve(...)}`. */
const rootRelativeHref = /href=(["'`])\/(?!\/)/g;
/** Matches the same forms for `src`, but not `src={asset(...)}`. */
const rootRelativeSrc = /src=(["'`])\/(?!\/)/g;

describe('internal links are base-path aware', () => {
	it('never hard-codes a root-relative internal href', () => {
		/** @type {string[]} */
		const offenders = [];
		for (const file of sourceFiles) {
			const source = readFileSync(path.join(projectRoot, file), 'utf8');
			for (const match of source.matchAll(rootRelativeHref)) {
				offenders.push(`${file}: ${match[0]}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('never hard-codes a root-relative artwork src', () => {
		/** @type {string[]} */
		const offenders = [];
		for (const file of sourceFiles) {
			const source = readFileSync(path.join(projectRoot, file), 'utf8');
			for (const match of source.matchAll(rootRelativeSrc)) {
				offenders.push(`${file}: ${match[0]}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it.each([
		'src/lib/components/Header.svelte',
		'src/lib/components/Sidebar.svelte',
		'src/lib/components/StickerCollage.svelte',
		'src/lib/components/DashboardPage.svelte',
		'src/lib/components/AssetTray.svelte',
		'src/lib/components/EditorWorkspace.svelte',
		'src/lib/components/TemplateCard.svelte',
		'src/lib/components/PresentationsPage.svelte'
	])('routes static artwork through the base-aware asset() in %s', (file) => {
		const source = readFileSync(path.join(projectRoot, file), 'utf8');
		expect(source).toMatch(/asset\(/);
	});

	it('fetches bundled artwork through asset() while keeping the canonical provenance', () => {
		const source = readFileSync('src/lib/assets/assetLoader.ts', 'utf8');
		expect(source).toContain('fetch(asset(src))');
		expect(source).toContain('bundled-asset:${src}');
	});

	it.each([
		'src/lib/components/Header.svelte',
		'src/lib/components/Sidebar.svelte',
		'src/lib/components/DashboardPage.svelte',
		'src/lib/components/LocalProjectList.svelte',
		'src/lib/components/TemplateRail.svelte',
		'src/lib/components/PacksPage.svelte',
		'src/routes/+error.svelte',
		'src/routes/my-stickers/+page.svelte',
		'src/routes/presentations/+page.svelte'
	])('routes internal hrefs through the base-aware helpers in %s', (file) => {
		const source = readFileSync(path.join(projectRoot, file), 'utf8');
		expect(source).toMatch(/shellHref\(|resolve\(/);
	});

	it('keeps the shared helper the one place that builds shell links', () => {
		const source = readFileSync('src/lib/app/navigation.js', 'utf8');
		expect(source).toContain('shellHref');
		// `/my-stickers` is a real route now, so the temporary `base`-prefix fallback for a
		// not-yet-existing destination is gone: every shell link is typed `resolve()`.
		expect(source).not.toMatch(/import\s*\{[^}]*\bbase\b[^}]*\}\s*from\s*'\$app\/paths'/);
		expect(source).not.toContain('${base}');
	});
});
