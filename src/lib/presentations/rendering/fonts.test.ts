/**
 * Deterministic font-loading regressions.
 *
 * These replace the jsdom test that imported the real route and export modules: jsdom
 * has no `FontFaceSet`, so that test could never observe a face and proved nothing
 * about the defect it was meant to catch — readiness reporting "fonts ready" while
 * nothing had been registered or fetched. The browser check lives in
 * `e2e/presentations-production-offline.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
	PRESENTATION_FONT_FACES,
	ensurePresentationFonts,
	presentationFontRequest,
	type PresentationFontEnvironment
} from './fonts';

function fontEnvironment(load: PresentationFontEnvironment['load']): PresentationFontEnvironment {
	return { load, ready: Promise.resolve() };
}

const faceThatLoaded = async () => [{ status: 'loaded' }] as const;
/** What `FontFaceSet.load` returns when no `@font-face` rule declares the request. */
const noMatchingFace = async () => [];

describe('ensurePresentationFonts', () => {
	it('loads a registered face for every declared style and weight', async () => {
		const requests: string[] = [];
		await ensurePresentationFonts(
			fontEnvironment(async (request) => {
				requests.push(request);
				return [{ status: 'loaded' }];
			})
		);

		// One request per declared face: a dropped descriptor would leave that style
		// measured and exported against a system fallback.
		expect(requests).toEqual(PRESENTATION_FONT_FACES.map(presentationFontRequest));
		expect(requests).toEqual([
			'normal 400 32px "Be Vietnam Pro"',
			'normal 700 32px "Be Vietnam Pro"',
			'italic 400 32px "Be Vietnam Pro"',
			'italic 700 32px "Be Vietnam Pro"',
			'normal 400 32px "Spectral"',
			'normal 700 32px "Spectral"',
			'italic 400 32px "Spectral"',
			'italic 700 32px "Spectral"'
		]);
	});

	it('fails when a request matches no registered face', async () => {
		const load = async (request: string) =>
			request === 'italic 700 32px "Spectral"' ? noMatchingFace() : faceThatLoaded();

		// The defect this guards: `load` resolving with an empty array used to count as
		// a loaded font, and `document.fonts.check` answers true from the fallback too.
		await expect(ensurePresentationFonts(fontEnvironment(load))).rejects.toThrow(
			'No registered font face matches italic 700 32px "Spectral"'
		);
	});

	it('fails when a matched face did not finish loading', async () => {
		await expect(
			ensurePresentationFonts(fontEnvironment(async () => [{ status: 'error' }]))
		).rejects.toThrow('did not finish loading');
	});

	it('does nothing without a font face set instead of claiming the faces loaded', async () => {
		await expect(ensurePresentationFonts(undefined)).resolves.toBeUndefined();
	});
});
