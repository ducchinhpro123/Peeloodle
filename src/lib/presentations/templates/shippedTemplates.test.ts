/**
 * P72–P74 contract: the three shipped decks parse, cover every promised layout,
 * stay inside the editor's limits, use only bundled fonts, and ship no catalog
 * assets (so cloning downloads nothing).
 */
import { describe, expect, it } from 'vitest';
import { SHIPPED_TEMPLATES } from './shippedTemplates.js';
import { parsePresentationDocument, presentationDocumentToJson } from '../model/parse';
import { isKnownFontId } from '../rendering/fonts';
import { PRESENTATION_LIMITS } from '../model/limits';
import type { Element, PresentationDocument } from '../model/types';

const REQUIRED_LAYOUTS: Record<string, string[]> = {
	class: [
		'Title',
		'Agenda',
		'Concept',
		'Text & image',
		'Comparison',
		'Example',
		'Summary',
		'References',
		'Closing'
	],
	'research-defense': [
		'Title',
		'Problem',
		'Question',
		'Method',
		'Results image area',
		'Discussion',
		'Limitations',
		'References',
		'Q&A'
	],
	'club-pitch': [
		'Mission',
		'Problem',
		'Proposal',
		'Activities',
		'Timeline',
		'Team',
		'Impact',
		'Call to action'
	]
};

function elements(document: PresentationDocument): Element[] {
	return document.slides.flatMap((slide) => slide.elements);
}

describe('shipped templates', () => {
	it('ships three dictionaries of 8–10 layouts each with the promised slides', () => {
		expect(SHIPPED_TEMPLATES.map((template) => template.key)).toEqual([
			'class',
			'research-defense',
			'club-pitch'
		]);
		for (const template of SHIPPED_TEMPLATES) {
			const document = parsePresentationDocument(template.build());
			expect(document.slides.length).toBeGreaterThanOrEqual(8);
			expect(document.slides.length).toBeLessThanOrEqual(10);
			const names = document.slides.map((slide) => slide.name);
			for (const required of REQUIRED_LAYOUTS[template.key]!) expect(names).toContain(required);
		}
	});

	it('parses every deck, uses bundled fonts only, and ships no assets', () => {
		for (const template of SHIPPED_TEMPLATES) {
			const document = parsePresentationDocument(
				JSON.parse(presentationDocumentToJson(template.build()))
			);
			expect(document.assets).toHaveLength(0);
			expect(document.pageSize).toEqual({ width: 1280, height: 720 });
			expect(isKnownFontId(document.theme.headingFontId)).toBe(true);
			expect(isKnownFontId(document.theme.bodyFontId)).toBe(true);
			for (const slide of document.slides) {
				expect(slide.elements.length).toBeGreaterThan(0);
				expect(slide.elements.some((element) => element.kind === 'text')).toBe(true);
			}
			for (const element of elements(document))
				if (element.kind === 'text')
					for (const paragraph of element.paragraphs)
						for (const run of paragraph.runs) expect(isKnownFontId(run.fontId)).toBe(true);
		}
	});

	it('stays inside the centralized document limits', () => {
		for (const template of SHIPPED_TEMPLATES) {
			const document = parsePresentationDocument(template.build());
			const totalElements = elements(document).length;
			expect(totalElements).toBeLessThanOrEqual(PRESENTATION_LIMITS.maxElements);
			for (const slide of document.slides)
				expect(slide.elements.length).toBeLessThanOrEqual(PRESENTATION_LIMITS.maxElementsPerSlide);
		}
	});

	it('marks its text as sample content and promises no native data editing', () => {
		for (const template of SHIPPED_TEMPLATES) {
			const document = parsePresentationDocument(template.build());
			const text = elements(document)
				.filter((element) => element.kind === 'text')
				.map((element) =>
					element.paragraphs
						.flatMap((paragraph) => paragraph.runs)
						.map((run) => run.text)
						.join('')
				)
				.join(' ');
			expect(text.toLowerCase()).toContain('sample');
			// Placeholder copy may mention inserting a chart image; it must not
			// promise native chart/data editing.
			expect(text.toLowerCase()).not.toContain('native chart');
			expect(text.toLowerCase()).not.toContain('edit charts');
		}
	});
});
