/**
 * Konva text helpers shared by the presentation canvas and raster exports.
 *
 * Konva is imported here (and only here) so lazy-loaded presentation screens
 * keep Konva out of the initial sticker bundle, and so proof/measurement code
 * uses the same rendering path as the editor.
 */

import Konva from 'konva';
import { fontFamilyFor } from './fonts';
import type { FontSpec } from './textLayout';
import type { TextRun } from '../model/types';

export { Konva };

/** Konva `fontStyle` string ('bold italic' | 'normal normal' | …). */
export function konvaFontStyle(run: Pick<TextRun, 'bold' | 'italic'>): string {
	return `${run.bold ? 'bold' : 'normal'} ${run.italic ? 'italic' : 'normal'}`;
}

/**
 * Konva text node for one run. Rendering paths (exports) leave it inert; the
 * interactive editor passes `listening: true` so the text box can be selected.
 */
export function createKonvaTextForRun(
	run: TextRun,
	text: string,
	x: number,
	y: number,
	listening = false
): Konva.Text {
	return new Konva.Text({
		x,
		y,
		text,
		fontFamily: fontFamilyFor(run.fontId),
		fontSize: run.size,
		fontStyle: konvaFontStyle(run),
		fill: run.color,
		lineHeight: 1,
		listening
	});
}

/** Width of `text` using the same canvas metrics as the layout service. */
export function konvaTextWidth(text: string, spec: FontSpec): number {
	const node = new Konva.Text({
		text,
		fontFamily: fontFamilyFor(spec.fontId),
		fontSize: spec.size,
		fontStyle: `${spec.bold ? 'bold' : 'normal'} ${spec.italic ? 'italic' : 'normal'}`,
		lineHeight: 1,
		listening: false
	});
	const width = node.getTextWidth();
	node.destroy();
	return width;
}
