/**
 * Theme-aware text insertion presets (headings, subheadings, body).
 *
 * A preset is an ordinary editable text element with an empty styled run: the
 * style survives the first keystroke, clearing the field, and save/reopen
 * because the run carries it rather than the DOM. `autoGrow` is on, so the
 * store can grow the box inside the command that changes the content.
 */

import { createTextElement, DEFAULT_THEME } from '../model/factories';
import type { TextElement, Theme } from '../model/types';

export type TextPreset = 'heading' | 'subheading' | 'body';

const PRESETS = {
	heading: { name: 'Heading', size: 56, y: 64, height: 96 },
	subheading: { name: 'Subheading', size: 36, y: 176, height: 72 },
	body: { name: 'Body text', size: 28, y: 272, height: 80 }
} as const;

export function createPresetText(preset: TextPreset, theme: Theme, text = ''): TextElement {
	return createTextElement({
		...PRESETS[preset],
		text,
		x: 80,
		width: 1120,
		padding: 8,
		lineHeight: 1.3,
		autoGrow: true,
		fontId: preset === 'body' ? theme.bodyFontId : theme.headingFontId,
		color:
			(preset === 'subheading' ? theme.colors.muted : undefined) ??
			theme.colors.text ??
			DEFAULT_THEME.colors.text!
	});
}
