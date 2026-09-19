import { expect, it } from 'vitest';
import { createPresentationDocument, DEFAULT_THEME } from '../model/factories';
import { parsePresentationDocument } from '../model/parse';
import { BUILTIN_LAYOUTS, createBuiltinLayout } from './builtinLayouts';

it.each(['title', 'title-body', 'two-columns', 'section', 'image-caption'] as const)(
	'creates a valid, independent %s slide without media',
	(id) => {
		const document = createPresentationDocument();
		const first = createBuiltinLayout(id, DEFAULT_THEME);
		const second = createBuiltinLayout(id, DEFAULT_THEME);
		document.slides = [first, second];
		expect(parsePresentationDocument(document).assets).toEqual([]);
		expect(first.id).not.toBe(second.id);
		expect(first.elements.every((e) => !second.elements.some((other) => other.id === e.id))).toBe(
			true
		);
		expect(first.elements.filter((e) => e.kind === 'text').every((e) => e.autoGrow)).toBe(true);
	}
);

it('exposes exactly five named layout choices', () => {
	expect(BUILTIN_LAYOUTS.map((item) => item.name)).toEqual([
		'Title slide',
		'Title + body',
		'Two columns',
		'Section header',
		'Image + caption'
	]);
});
