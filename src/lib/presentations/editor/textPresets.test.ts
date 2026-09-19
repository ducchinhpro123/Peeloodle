import { expect, it } from 'vitest';
import { DEFAULT_THEME } from '../model/factories';
import { createPresetText } from './textPresets';

it('uses theme fonts/colors and independent ids for every insertion', () => {
	const theme = { ...DEFAULT_THEME, colors: { text: '#123456', muted: '#345678' } };
	const heading = createPresetText('heading', theme);
	const subheading = createPresetText('subheading', theme);
	const body = createPresetText('body', theme);
	expect(heading.paragraphs[0]!.runs[0]).toMatchObject({
		text: '',
		size: 56,
		fontId: theme.headingFontId,
		color: '#123456'
	});
	expect(subheading.paragraphs[0]!.runs[0]).toMatchObject({ size: 36, color: '#345678' });
	expect(body.paragraphs[0]!.runs[0]).toMatchObject({ size: 28, fontId: theme.bodyFontId });
	expect([heading, subheading, body].every((text) => text.autoGrow)).toBe(true);
	expect(createPresetText('heading', theme).id).not.toBe(heading.id);
});

it('falls back to the text color when the theme has no muted color', () => {
	const theme = { ...DEFAULT_THEME, colors: { text: '#0f0f0f' } };
	expect(createPresetText('subheading', theme).paragraphs[0]!.runs[0]!.color).toBe('#0f0f0f');
});

it('honours layout sample text without changing the preset style', () => {
	const text = createPresetText('body', DEFAULT_THEME, 'Add your main points');
	expect(text.paragraphs[0]!.runs[0]).toMatchObject({ text: 'Add your main points', size: 28 });
});
