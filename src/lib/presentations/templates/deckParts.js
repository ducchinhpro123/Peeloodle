export const SAMPLE_NOTE = 'Sample content — replace with your own.';

/** @type {{ width: 1280, height: 720 }} */
export const PAGE = { width: 1280, height: 720 };
export const HEADING = 'spectral';
export const BODY = 'be-vietnam-pro';
export const INK = '#0b1f2a';
export const MUTED = '#4a6572';
export const ACCENT = '#08b879';
export const PANEL = '#e8f4ee';
export const WHITE = '#ffffff';
export const DARK = '#0b1f3b';
export const ON_DARK = '#bfe9d6';

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

/**
 * @param {string} [heading]
 * @param {string} [body]
 * @param {string} [background]
 */
export function makeTheme(heading = HEADING, body = BODY, background = WHITE) {
	return {
		headingFontId: heading,
		bodyFontId: body,
		colors: { text: INK, accent: ACCENT, background, muted: MUTED }
	};
}

/**
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.text
 * @param {number} input.x
 * @param {number} input.y
 * @param {number} input.width
 * @param {number} input.height
 * @param {number} [input.size]
 * @param {string} [input.fontId]
 * @param {string} [input.color]
 * @param {'left' | 'center' | 'right' | 'justify'} [input.alignment]
 * @param {boolean} [input.bold]
 * @param {'top' | 'middle' | 'bottom'} [input.verticalAlign]
 * @param {'none' | 'bullet' | 'number'} [input.bullet]
 * @param {0 | 1 | 2} [input.bulletLevel]
 * @param {string} [input.line]
 * @returns {import('../model/types').TextElement}
 */
export function textBox(input) {
	return {
		id: newId(),
		kind: 'text',
		name: input.name,
		x: input.x,
		y: input.y,
		width: input.width,
		height: input.height,
		rotation: 0,
		opacity: 1,
		visible: true,
		locked: false,
		padding: 8,
		lineHeight: input.line ? Number(input.line) : 1.3,
		verticalAlign: input.verticalAlign ?? 'top',
		paragraphs: [
			{
				runs: [
					{
						text: input.text,
						fontId: input.fontId ?? BODY,
						size: input.size ?? 28,
						color: input.color ?? INK,
						...(input.bold ? { bold: true } : {})
					}
				],
				alignment: input.alignment ?? 'left',
				bullet: input.bullet ?? 'none',
				bulletLevel: input.bulletLevel ?? 0
			}
		]
	};
}

/**
 * A bullet list rendered as ordinary paragraphs (one per line).
 * @param {{ name: string, x: number, y: number, width: number, height: number, lines: string[], size?: number, color?: string }} input
 * @returns {import('../model/types').TextElement}
 */
export function bulletBox(input) {
	const element = textBox({ ...input, text: 'placeholder' });
	element.paragraphs = input.lines.map((line) => ({
		runs: [{ text: line, fontId: BODY, size: input.size ?? 26, color: input.color ?? INK }],
		alignment: 'left',
		bullet: 'bullet',
		bulletLevel: 0
	}));
	return element;
}

/**
 * @param {{
 *   name: string,
 *   x: number,
 *   y: number,
 *   width: number,
 *   height: number,
 *   shape: 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'line' | 'arrow',
 *   rotation?: number,
 *   opacity?: number,
 *   fill?: string | null,
 *   stroke?: string | null,
 *   strokeWidth?: number
 * }} input
 * @returns {import('../model/types').ShapeElement}
 */
export function shapeBox(input) {
	return {
		id: newId(),
		kind: 'shape',
		name: input.name,
		x: input.x,
		y: input.y,
		width: input.width,
		height: input.height,
		rotation: input.rotation ?? 0,
		opacity: input.opacity ?? 1,
		visible: true,
		locked: false,
		shape: input.shape,
		fill: input.fill ?? null,
		stroke: input.stroke ?? null,
		strokeWidth: input.strokeWidth ?? 0
	};
}

/**
 * A labelled rectangle standing in for an image the author will drop in.
 * @param {{ name: string, x: number, y: number, width: number, height: number, label?: string }} input
 * @returns {import('../model/types').Element[]}
 */
export function imagePlaceholder(input) {
	return [
		shapeBox({
			name: `${input.name} frame`,
			shape: 'rounded-rectangle',
			x: input.x,
			y: input.y,
			width: input.width,
			height: input.height,
			fill: PANEL,
			stroke: ACCENT,
			strokeWidth: 2
		}),
		textBox({
			name: `${input.name} label`,
			text: input.label ?? 'Image placeholder — insert your own image',
			x: input.x + 24,
			y: input.y + input.height / 2 - 24,
			width: input.width - 48,
			height: 48,
			size: 22,
			color: MUTED,
			alignment: 'center',
			verticalAlign: 'middle'
		})
	];
}

/**
 * @param {{ name: string, background?: string, elements: import('../model/types').Element[] }} input
 * @returns {import('../model/types').Slide}
 */
export function slide(input) {
	return {
		id: newId(),
		name: input.name,
		background: input.background ?? WHITE,
		elements: input.elements
	};
}

/**
 * Standard slide with a heading and an accent rule.
 * @param {string} name
 * @param {string} background
 * @param {string} heading
 * @param {import('../model/types').Element | null} body
 * @returns {import('../model/types').Slide}
 */
export function titled(name, background, heading, body) {
	return slide({
		name,
		background,
		elements: [
			textBox({
				name: `${name} heading`,
				text: heading,
				x: 72,
				y: 48,
				width: 1136,
				height: 100,
				size: 52,
				fontId: HEADING,
				color: background === DARK ? WHITE : INK,
				bold: true
			}),
			shapeBox({
				name: `${name} rule`,
				shape: 'rectangle',
				x: 72,
				y: 156,
				width: 160,
				height: 8,
				fill: ACCENT
			}),
			...(body ? [body] : [])
		]
	});
}

/**
 * @param {string} title
 * @param {{ headingFontId: string, bodyFontId: string, colors: Record<string, string> }} theme
 * @param {import('../model/types').Slide[]} slides
 * @returns {import('../model/types').PresentationDocument}
 */
export function makeDocument(title, theme, slides) {
	const stamp = now();
	return {
		kind: 'presentation',
		schemaVersion: 1,
		id: newId(),
		title,
		revision: 0,
		pageSize: PAGE,
		theme,
		slides,
		assets: [],
		createdAt: stamp,
		updatedAt: stamp
	};
}
