/**
 * The warm-up list itself, checked without running the imports it holds: calling a
 * loader here would import the real component and export modules under Node, which is
 * slow and cannot say anything about the browser chunks. The production journeys are
 * where those fetches are observed.
 */

import { describe, expect, it } from 'vitest';
import { EXPORT_BUILDER_LOADERS } from './exports/loaders';
import { PRESENTATION_OFFLINE_MODULES, PRESENTATION_OFFLINE_ROUTES } from './offlineModules';

describe('PRESENTATION_OFFLINE_MODULES', () => {
	it('holds the three presentation routes the flow renders', () => {
		// Library, editor and the editor's canvas: rendering a route does not fetch a
		// separate canvas chunk, so the canvas is its own entry.
		expect(PRESENTATION_OFFLINE_MODULES).toHaveLength(3 + EXPORT_BUILDER_LOADERS.length);
	});

	it('names the concrete routes whose own chunks the client router fetches', () => {
		// Components alone are not enough in SvelteKit: each route also has a generated
		// node chunk the router imports on navigation, and `preloadCode` is what fetches
		// it. The library path is literal; the editor path only has to match its dynamic
		// route, and nothing ever navigates there.
		expect(PRESENTATION_OFFLINE_ROUTES[0]).toBe('/presentations');
		expect(PRESENTATION_OFFLINE_ROUTES).toHaveLength(2);
		expect(PRESENTATION_OFFLINE_ROUTES[1]).toMatch(/^\/presentations\/[^/]+$/);
	});

	it('warms the same loader objects the export controller calls', () => {
		// Identity, not equal shape: a builder is only warm if readiness awaited the very
		// loader the export controller reaches, so a new format added to the shared list
		// is warmed without editing readiness.
		expect(PRESENTATION_OFFLINE_MODULES.slice(-EXPORT_BUILDER_LOADERS.length)).toEqual([
			...EXPORT_BUILDER_LOADERS
		]);
	});
});
