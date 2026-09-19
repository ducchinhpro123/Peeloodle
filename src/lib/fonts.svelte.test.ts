/**
 * P78 failure matrix — missing font. The export path must refuse a bundled font
 * that silently failed to load instead of drawing a substituted face, and must
 * word the failure so the student knows their text is unchanged.
 */
import { expect, it } from 'vitest';
import { loadFont } from './fonts';

it('refuses a bundled font that did not load instead of substituting it', async () => {
	const original = document.fonts.load.bind(document.fonts);
	// `fonts.load` resolves [] when no face matches, which is what a failed webfont
	// download looks like; a bundled family must not pass that check.
	document.fonts.load = async () => [];
	try {
		await expect(loadFont('Plus Jakarta Sans')).rejects.toThrow(
			/Could not load Plus Jakarta Sans\. Choose another font or reload to retry\. Your text is unchanged\./
		);
	} finally {
		document.fonts.load = original;
	}
});
