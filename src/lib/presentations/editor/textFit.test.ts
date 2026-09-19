import { expect, it } from 'vitest';
import { createTextElement } from '../model/factories';
import { layoutTextElement, type MeasureText } from '../rendering/textLayout';
import { growTextToFit, shrinkTextToFit, textBoxInsidePage } from './textFit';

/** Deterministic measurer: every character is half the font size wide. */
const measure: MeasureText = (text, font) => (Array.from(text).length * font.size) / 2;
const page = { width: 1280, height: 720 } as const;

it('grows vertically without changing typography or shrinking on deletion', () => {
	const source = createTextElement({
		x: 80,
		y: 80,
		width: 160,
		height: 40,
		text: 'Words across several lines with Vietnamese: Xin chào',
		size: 28
	});
	const grown = growTextToFit(source, page, measure);
	expect(grown.height).toBeGreaterThan(source.height);
	expect(grown.paragraphs).toEqual(source.paragraphs);
	expect([grown.x, grown.y, grown.width]).toEqual([80, 80, 160]);
	expect(layoutTextElement(grown, measure).overflow).toBe(false);
	const shortened = structuredClone(grown);
	shortened.paragraphs[0]!.runs[0]!.text = 'Short';
	expect(growTextToFit(shortened, page, measure).height).toBe(grown.height);
});

it('caps growth at the slide edge and accounts for rotation', () => {
	const source = createTextElement({
		x: 80,
		y: 660,
		width: 200,
		height: 40,
		text: 'Long text '.repeat(50)
	});
	const grown = growTextToFit(source, page, measure);
	expect(grown.height).toBeLessThanOrEqual(60);
	expect(layoutTextElement(grown, measure).overflow).toBe(true);
	const rotated = createTextElement({
		x: 200,
		y: 80,
		width: 200,
		height: 40,
		rotation: 90,
		text: 'Long text '.repeat(50)
	});
	const result = growTextToFit(rotated, page, measure);
	expect(textBoxInsidePage(result, page)).toBe(true);
	expect(result.height).toBeLessThanOrEqual(200);
});

it('shrinks proportionally, explicitly, and refuses unreadable fits atomically', () => {
	const source = createTextElement({
		width: 220,
		height: 120,
		padding: 8,
		text: 'One two three four five six',
		size: 56
	});
	const original = structuredClone(source);
	const fitted = shrinkTextToFit(source, measure);
	expect(fitted).not.toBeNull();
	expect(fitted!.autoGrow).toBe(false);
	expect(fitted!.height).toBe(source.height);
	expect(fitted!.paragraphs[0]!.runs[0]!.size).toBeLessThan(56);
	expect(layoutTextElement(fitted!, measure).overflow).toBe(false);
	expect(source).toEqual(original);
	expect(shrinkTextToFit({ ...source, height: 1 }, measure)).toBeNull();
});

it('keeps empty and already-fitting text stable', () => {
	const source = createTextElement({ text: '', size: 28 });
	expect(growTextToFit(source, page, measure)).toBe(source);
	expect(shrinkTextToFit(source, measure)?.paragraphs).toEqual(source.paragraphs);
});

it('preserves relative run sizes and every non-size attribute while shrinking', () => {
	const source = createTextElement({
		width: 200,
		height: 80,
		padding: 4,
		paragraphs: [
			{
				runs: [
					{
						text: 'Big link',
						fontId: 'spectral',
						size: 56,
						color: '#111111',
						bold: true,
						link: 'https://example.com'
					},
					{ text: ' small', fontId: 'be-vietnam-pro', size: 28, color: '#222222', italic: true }
				],
				alignment: 'left',
				bullet: 'none',
				bulletLevel: 0
			}
		]
	});
	const fitted = shrinkTextToFit(source, measure);
	expect(fitted).not.toBeNull();
	const [big, small] = fitted!.paragraphs[0]!.runs;
	expect(big!.size / small!.size).toBeCloseTo(2);
	expect(big!.size).toBeLessThan(56);
	expect(big).toMatchObject({
		fontId: 'spectral',
		color: '#111111',
		bold: true,
		link: 'https://example.com'
	});
	expect(small).toMatchObject({ fontId: 'be-vietnam-pro', color: '#222222', italic: true });
	expect(layoutTextElement(fitted!, measure).overflow).toBe(false);
});

it('does not grow a box that is already outside the page', () => {
	const source = createTextElement({
		x: -500,
		y: 80,
		width: 40,
		height: 20,
		text: 'far off the page'
	});
	expect(growTextToFit(source, page, measure)).toBe(source);
});

it('never reduces a run that is already at the readable floor', () => {
	const source = createTextElement({ width: 40, height: 20, padding: 0, text: 'Tiny', size: 1 });
	const fitted = shrinkTextToFit(source, measure);
	expect(fitted).not.toBeNull();
	expect(fitted!.paragraphs[0]!.runs[0]!.size).toBe(1);
});
