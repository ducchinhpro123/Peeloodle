/**
 * Shared text layout for presentation text elements.
 *
 * A paragraph/run model is authoritative — never HTML. This service measures,
 * wraps, aligns and positions runs in document units so the Konva canvas, the
 * DOM editing overlay and raster/PDF exports all agree. It has no DOM or Konva
 * dependency: the caller supplies a `measure` implementation (canvas
 * `measureText` in the browser, a deterministic fake in unit tests).
 */

import type { ParagraphAlignment, TextElement, TextParagraph, TextRun } from '../model/types';
import { fontStackFor, isKnownFontId } from './fonts';

export type FontSpec = { fontId: string; size: number; bold: boolean; italic: boolean };

/** Width of `text` in document units for the given font. */
export type MeasureText = (text: string, font: FontSpec) => number;

export type LayoutRun = { run: TextRun; text: string; x: number; width: number };

export type LayoutBullet = { kind: 'bullet' | 'number'; level: number; marker: string; x: number };

export type LayoutLine = {
	/** Top offset from the element's content-box top (padding excluded). */
	y: number;
	height: number;
	/** Paragraph-relative x offset where text begins. */
	indent: number;
	/** Available width for the line's text (content width minus bullet indent). */
	availableWidth: number;
	runs: LayoutRun[];
	align: ParagraphAlignment;
	bullet: LayoutBullet | null;
	paragraphIndex: number;
	/** True for the first line of a paragraph; renderers draw bullet markers only here. */
	firstInParagraph: boolean;
	/** True for the final line of a paragraph (justify leaves it left-aligned). */
	lastInParagraph: boolean;
	width: number;
	text: string;
};

export type TextLayoutResult = {
	lines: LayoutLine[];
	contentHeight: number;
	overflow: boolean;
	missingFontIds: string[];
};

export type LayoutOptions = {
	width: number;
	height?: number;
	padding: number;
	lineHeight: number;
	verticalAlign?: 'top' | 'middle' | 'bottom';
	measure: MeasureText;
};

export const BULLET_INDENT_PER_LEVEL = 32;
export const BULLET_HANGING = 26;

const BULLET_CHAR = '\u2022';

type Token = {
	kind: 'word' | 'space' | 'break';
	text: string;
	run: TextRun;
	spec: FontSpec;
	width: number;
	joinsPrevious: boolean;
};

export function layoutTextElement(element: TextElement, measure: MeasureText): TextLayoutResult {
	return layoutParagraphs(element.paragraphs, {
		width: element.width,
		height: element.height,
		padding: element.padding,
		lineHeight: element.lineHeight,
		verticalAlign: element.verticalAlign,
		measure
	});
}

export function layoutParagraphs(
	paragraphs: TextParagraph[],
	options: LayoutOptions
): TextLayoutResult {
	const contentWidth = Math.max(1, options.width - options.padding * 2);
	const lines: LayoutLine[] = [];
	const missingFontIds = new Set<string>();
	let y = 0;
	let numberCounters = new Map<number, number>();

	paragraphs.forEach((paragraph, paragraphIndex) => {
		const hasBullet = paragraph.bullet !== 'none';
		if (!hasBullet) numberCounters = new Map();
		const bulletIndent = hasBullet
			? paragraph.bulletLevel * BULLET_INDENT_PER_LEVEL + BULLET_HANGING
			: 0;
		const availableWidth = Math.max(1, contentWidth - bulletIndent);
		const tokens = tokenizeParagraph(paragraph, options.measure, missingFontIds);
		const paragraphLines = wrapTokens(tokens, availableWidth, options.measure);
		const baseSize = maxRunSize(paragraph, 18);

		let number = 1;
		if (paragraph.bullet === 'number') {
			const level = paragraph.bulletLevel;
			number = (numberCounters.get(level) ?? 0) + 1;
			numberCounters.set(level, number);
		}

		paragraphLines.forEach((lineTokens, lineIndex) => {
			const firstInParagraph = lineIndex === 0;
			const lastInParagraph = lineIndex === paragraphLines.length - 1;
			const height = lineTokens.reduce(
				(max, token) => Math.max(max, token.spec.size * options.lineHeight),
				options.lineHeight * baseSize
			);
			const runs = tokensToRuns(lineTokens, paragraph.alignment === 'justify' && !lastInParagraph);
			const width = runs.reduce((sum, run) => sum + run.width, 0);
			const bullet: LayoutBullet | null = hasBullet
				? {
						kind: paragraph.bullet === 'number' ? 'number' : 'bullet',
						level: paragraph.bulletLevel,
						marker: paragraph.bullet === 'number' ? `${number}.` : BULLET_CHAR,
						x: paragraph.bulletLevel * BULLET_INDENT_PER_LEVEL
					}
				: null;

			const line: LayoutLine = {
				y,
				height,
				indent: bulletIndent,
				availableWidth,
				runs,
				align: paragraph.alignment,
				bullet,
				paragraphIndex,
				firstInParagraph,
				lastInParagraph,
				width,
				text: runs.map((run) => run.text).join('')
			};
			positionRuns(line, bulletIndent);
			lines.push(line);
			y += height;
		});
	});

	const contentHeight = y;
	const boxHeight =
		options.height === undefined
			? contentHeight
			: Math.max(0, options.height - options.padding * 2);
	const verticalAlign = options.verticalAlign ?? 'top';
	if (verticalAlign !== 'top' && contentHeight < boxHeight) {
		const offset =
			verticalAlign === 'middle' ? (boxHeight - contentHeight) / 2 : boxHeight - contentHeight;
		for (const line of lines) line.y += offset;
	}

	return {
		lines,
		contentHeight: y,
		overflow: contentHeight > boxHeight + 0.01,
		missingFontIds: [...missingFontIds]
	};
}

/** Assigns run x coordinates (content-box relative), including alignment and justify stretch. */
function positionRuns(line: LayoutLine, bulletIndent: number): void {
	const base = bulletIndent;
	const available = line.availableWidth;
	const gaps = countGaps(line.runs);
	const justify = line.align === 'justify' && !line.lastInParagraph && gaps > 0 && line.width > 0;
	const extraGap = justify ? Math.max(0, (available - line.width) / gaps) : 0;

	let start = base;
	if (!justify) {
		if (line.align === 'center') start = base + Math.max(0, (available - line.width) / 2);
		else if (line.align === 'right') start = base + Math.max(0, available - line.width);
	}

	let x = start;
	for (const run of line.runs) {
		run.x = x;
		x += run.width;
		if (justify) x += (run.text.match(/ /g)?.length ?? 0) * extraGap;
	}
	line.indent = start;
	line.width = x - start;
}

function countGaps(runs: LayoutRun[]): number {
	let gaps = 0;
	for (const run of runs) gaps += run.text.match(/ /g)?.length ?? 0;
	const last = runs.at(-1);
	if (last) gaps -= last.text.match(/ +$/)?.[0].length ?? 0;
	return Math.max(0, gaps);
}

function maxRunSize(paragraph: TextParagraph, fallback: number): number {
	return paragraph.runs.reduce((max, run) => Math.max(max, run.size), fallback);
}

/**
 * Splits paragraph runs into word/space/break tokens.
 * `joinsPrevious` marks tokens with no whitespace before them, so words split
 * across formatting boundaries are not separated by an invented space.
 */
export function tokenizeParagraph(
	paragraph: TextParagraph,
	measure: MeasureText,
	missingFontIds?: Set<string>
): Token[] {
	const tokens: Token[] = [];
	for (const run of paragraph.runs) {
		if (!isKnownFontId(run.fontId)) missingFontIds?.add(run.fontId);
		const spec = fontSpecFor(run);
		const parts = run.text.split(/(\n|\s+)/);
		let previousWasSpace = true;
		for (const part of parts) {
			if (!part) continue;
			if (part === '\n') {
				tokens.push({ kind: 'break', text: '', run, spec, width: 0, joinsPrevious: false });
				previousWasSpace = true;
				continue;
			}
			if (/^\s+$/.test(part)) {
				tokens.push({
					kind: 'space',
					text: part,
					run,
					spec,
					width: measure(part, spec),
					joinsPrevious: false
				});
				previousWasSpace = true;
				continue;
			}
			tokens.push({
				kind: 'word',
				text: part,
				run,
				spec,
				width: measure(part, spec),
				joinsPrevious: !previousWasSpace
			});
			previousWasSpace = false;
		}
	}
	return tokens;
}

function wrapTokens(tokens: Token[], availableWidth: number, measure: MeasureText): Token[][] {
	const lines: Token[][] = [];
	let current: Token[] = [];
	let width = 0;

	const flush = () => {
		while (current.length && current.at(-1)!.kind === 'space') current.pop();
		lines.push(current);
		current = [];
		width = 0;
	};

	for (const token of tokens) {
		if (token.kind === 'break') {
			flush();
			continue;
		}
		if (token.kind === 'space') {
			if (current.length) {
				current.push(token);
				width += token.width;
			}
			continue;
		}

		if (current.length && !token.joinsPrevious && width + token.width > availableWidth) flush();

		let rest = token;
		while (rest.width > availableWidth && rest.text.length > 1) {
			if (current.length) flush();
			const cut = largestFittingPrefix(rest, availableWidth, measure);
			const head: Token = {
				...rest,
				text: rest.text.slice(0, cut),
				width: measure(rest.text.slice(0, cut), rest.spec)
			};
			current.push(head);
			flush();
			rest = {
				...rest,
				text: rest.text.slice(cut),
				width: measure(rest.text.slice(cut), rest.spec)
			};
		}
		if (rest.text) {
			current.push(rest);
			width += rest.width;
		}
	}
	if (current.length || lines.length === 0) flush();
	return lines;
}

/** Largest prefix (never splitting a surrogate pair) that fits `limit`. */
function largestFittingPrefix(token: Token, limit: number, measure: MeasureText): number {
	let lo = 1;
	let hi = token.text.length;
	let best = 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const width = measure(token.text.slice(0, mid), token.spec);
		if (width <= limit) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	const code = token.text.charCodeAt(best - 1);
	if (code >= 0xd800 && code <= 0xdbff) best = Math.max(1, best - 1);
	return Math.min(best, token.text.length - 1);
}

function tokensToRuns(tokens: Token[], separateSpaces = false): LayoutRun[] {
	const runs: LayoutRun[] = [];
	for (const token of tokens) {
		const last = runs.at(-1);
		if (!separateSpaces && last && last.run === token.run) {
			last.text += token.text;
			last.width += token.width;
		} else {
			runs.push({ run: token.run, text: token.text, x: 0, width: token.width });
		}
	}
	return runs;
}

export function fontSpecFor(run: Pick<TextRun, 'fontId' | 'size' | 'bold' | 'italic'>): FontSpec {
	return {
		fontId: run.fontId,
		size: run.size,
		bold: run.bold ?? false,
		italic: run.italic ?? false
	};
}

/** CSS font shorthand for canvas/DOM measurement. */
export function cssFontFor(spec: FontSpec): string {
	const style = spec.italic ? 'italic ' : '';
	const weight = spec.bold ? '700 ' : '400 ';
	return `${style}${weight}${spec.size}px ${fontStackFor(spec.fontId)}`;
}
