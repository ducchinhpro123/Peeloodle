/**
 * The two presentation typefaces (P05).
 *
 * Chosen because each ships static regular/bold/italic/bold-italic fonts with
 * full Vietnamese coverage (U+1EA0–U+1EF9) and an OFL license:
 *
 * - Be Vietnam Pro — Vietnamese-first sans for body text.
 * - Spectral — serif for headings; spectral-OFL.txt is the license.
 *
 * Files live in `static/fonts/presentations/`. Provenance and verification are
 * recorded in docs/assets-provenance.md. Documents store the stable `id`, never
 * a CSS family name, so font files can be replaced without rewriting documents.
 * Unknown IDs fall back to the sans stack and are surfaced as a warning.
 */

export type FontId = string;

export type PresentationFontFamily = {
	id: FontId;
	displayName: string;
	/** CSS font-family value used by the DOM editor and canvas measurement. */
	cssFamily: string;
};

export const PRESENTATION_FONT_FAMILIES: PresentationFontFamily[] = [
	{ id: 'be-vietnam-pro', displayName: 'Be Vietnam Pro', cssFamily: 'Be Vietnam Pro' },
	{ id: 'spectral', displayName: 'Spectral', cssFamily: 'Spectral' }
];

export const FALLBACK_FONT_ID = 'be-vietnam-pro';
export const FALLBACK_FONT_STACK = 'ui-sans-serif, system-ui, sans-serif';

const FAMILY_BY_ID = new Map(PRESENTATION_FONT_FAMILIES.map((family) => [family.id, family]));

export function isKnownFontId(fontId: string): boolean {
	return FAMILY_BY_ID.has(fontId);
}

export function fontFamilyFor(fontId: string): string {
	return FAMILY_BY_ID.get(fontId)?.cssFamily ?? FAMILY_BY_ID.get(FALLBACK_FONT_ID)!.cssFamily;
}

/** CSS stack for text that should not break when a font is unavailable. */
export function fontStackFor(fontId: string): string {
	return `${fontFamilyFor(fontId)}, ${FALLBACK_FONT_STACK}`;
}

export type PresentationFontFace = {
	family: string;
	style: 'normal' | 'italic';
	weight: 400 | 700;
	/** Path served from public/. */
	url: string;
};

export const PRESENTATION_FONT_FACES: PresentationFontFace[] = [
	{
		family: 'Be Vietnam Pro',
		style: 'normal',
		weight: 400,
		url: '/fonts/presentations/BeVietnamPro-Regular.ttf'
	},
	{
		family: 'Be Vietnam Pro',
		style: 'normal',
		weight: 700,
		url: '/fonts/presentations/BeVietnamPro-Bold.ttf'
	},
	{
		family: 'Be Vietnam Pro',
		style: 'italic',
		weight: 400,
		url: '/fonts/presentations/BeVietnamPro-Italic.ttf'
	},
	{
		family: 'Be Vietnam Pro',
		style: 'italic',
		weight: 700,
		url: '/fonts/presentations/BeVietnamPro-BoldItalic.ttf'
	},
	{
		family: 'Spectral',
		style: 'normal',
		weight: 400,
		url: '/fonts/presentations/Spectral-Regular.ttf'
	},
	{
		family: 'Spectral',
		style: 'normal',
		weight: 700,
		url: '/fonts/presentations/Spectral-Bold.ttf'
	},
	{
		family: 'Spectral',
		style: 'italic',
		weight: 400,
		url: '/fonts/presentations/Spectral-Italic.ttf'
	},
	{
		family: 'Spectral',
		style: 'italic',
		weight: 700,
		url: '/fonts/presentations/Spectral-BoldItalic.ttf'
	}
];

/**
 * The browser surface the check runs against: `document.fonts` in a browser, an
 * injected stub in tests. `load` forces the face's file to be fetched, and `ready`
 * settles once layout has the loaded faces.
 */
export type PresentationFontEnvironment = {
	load: (request: string) => Promise<readonly { status: FontFaceLoadStatus }[]>;
	ready: Promise<unknown>;
};

/**
 * The request `FontFaceSet.load` matches against `presentation-fonts.css`: style,
 * weight, size and family, which is the same descriptor the `@font-face` rule declares.
 */
export function presentationFontRequest(face: PresentationFontFace): string {
	return `${face.style} ${face.weight} 32px "${face.family}"`;
}

/** jsdom and server rendering have no FontFaceSet, so no face can be proven there. */
function browserFontEnvironment(): PresentationFontEnvironment | undefined {
	return typeof document === 'undefined' ? undefined : document.fonts;
}

/**
 * Loads every presentation face before layout/measurement/export. Canvas and
 * DOM metrics disagree while a face is still loading, so callers must await
 * this (or an equivalent) before measuring, rendering or exporting.
 *
 * Every one of `PRESENTATION_FONT_FACES` must be answered by a registered face that
 * finished loading. `FontFaceSet.load` resolves with an EMPTY array when no rule
 * declares the requested family, and `FontFaceSet.check` answers `true` from the
 * fallback in that same case — so neither resolving nor `check` is proof a face
 * arrived. A missing face is an error here: text measured and exported against a
 * system fallback is not the document the author saw.
 */
export async function ensurePresentationFonts(
	environment: PresentationFontEnvironment | undefined = browserFontEnvironment()
): Promise<void> {
	if (!environment) return;
	await Promise.all(
		PRESENTATION_FONT_FACES.map(async (face) => {
			const request = presentationFontRequest(face);
			const matched = await environment.load(request);
			if (matched.length === 0) throw new Error(`No registered font face matches ${request}`);
			if (matched.some((loaded) => loaded.status !== 'loaded'))
				throw new Error(`${request} did not finish loading`);
		})
	);
	await environment.ready;
}
