/**
 * Presentation document factories (P09).
 *
 * Every factory returns a fully valid document object; the parser (P10) remains
 * the only gate for data coming from storage, backups or the network.
 */

import {
	PRESENTATION_KIND,
	PRESENTATION_PAGE_HEIGHT,
	PRESENTATION_PAGE_WIDTH,
	PRESENTATION_SCHEMA_VERSION,
	type Element,
	type FontId,
	type ImageElement,
	type NormalizedCrop,
	type PresentationAsset,
	type PresentationDocument,
	type ShapeElement,
	type ShapeKind,
	type Slide,
	type TextElement,
	type TextParagraph,
	type Theme
} from './types';

export const DEFAULT_THEME: Theme = {
	headingFontId: 'spectral',
	bodyFontId: 'be-vietnam-pro',
	colors: {
		text: '#08152f',
		muted: '#66758f',
		accent: '#08b879',
		surface: '#ffffff',
		background: '#ffffff'
	}
};

export const DEFAULT_BODY_FONT_SIZE = 28;
export const DEFAULT_TITLE_FONT_SIZE = 56;

function newId(): string {
	return crypto.randomUUID();
}

export function createPresentationDocument(
	input: { id?: string; title?: string; now?: string } = {}
): PresentationDocument {
	const now = input.now ?? new Date().toISOString();
	return {
		kind: PRESENTATION_KIND,
		schemaVersion: PRESENTATION_SCHEMA_VERSION,
		id: input.id ?? newId(),
		title: input.title ?? 'Untitled presentation',
		revision: 0,
		pageSize: { width: PRESENTATION_PAGE_WIDTH, height: PRESENTATION_PAGE_HEIGHT },
		theme: structuredClone(DEFAULT_THEME),
		slides: [createSlide({ name: 'Slide 1' })],
		assets: [],
		createdAt: now,
		updatedAt: now
	};
}

export function createSlide(
	input: { id?: string; name?: string; background?: string } = {}
): Slide {
	return {
		id: input.id ?? newId(),
		name: input.name ?? 'Slide',
		background: input.background ?? DEFAULT_THEME.colors.background!,
		elements: []
	};
}

type ElementBaseInput = Partial<
	Pick<
		Element,
		'id' | 'name' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'visible' | 'locked'
	>
>;

type TextElementInput = ElementBaseInput & {
	text?: string;
	fontId?: FontId;
	size?: number;
	color?: string;
	paragraphs?: TextParagraph[];
	padding?: number;
	lineHeight?: number;
	verticalAlign?: TextElement['verticalAlign'];
};

type ShapeElementInput = ElementBaseInput & {
	shape?: ShapeKind;
	fill?: string | null;
	stroke?: string | null;
	strokeWidth?: number;
};

type ImageElementInput = ElementBaseInput & {
	assetId: string;
	alt?: string;
	crop?: NormalizedCrop;
	flipX?: boolean;
	flipY?: boolean;
};

function baseElement(input: ElementBaseInput, index: number) {
	return {
		id: input.id ?? newId(),
		name: input.name ?? `Element ${index}`,
		x: input.x ?? 80,
		y: input.y ?? 80,
		width: input.width ?? 600,
		height: input.height ?? 160,
		rotation: input.rotation ?? 0,
		opacity: input.opacity ?? 1,
		visible: input.visible ?? true,
		locked: input.locked ?? false
	};
}

export function createTextElement(input: TextElementInput = {}): TextElement {
	const fontId = input.fontId ?? DEFAULT_THEME.bodyFontId;
	const size = input.size ?? DEFAULT_BODY_FONT_SIZE;
	return {
		...baseElement(input, 1),
		kind: 'text',
		paragraphs:
			input.paragraphs && input.paragraphs.length > 0
				? input.paragraphs
				: [
						{
							runs: [
								{
									text: input.text ?? '',
									fontId,
									size,
									color: input.color ?? DEFAULT_THEME.colors.text!
								}
							],
							alignment: 'left',
							bullet: 'none',
							bulletLevel: 0
						}
					],
		padding: input.padding ?? 12,
		lineHeight: input.lineHeight ?? 1.3,
		verticalAlign: input.verticalAlign ?? 'top'
	};
}

export function createShapeElement(input: ShapeElementInput = {}): ShapeElement {
	return {
		...baseElement(input, 1),
		kind: 'shape',
		shape: input.shape ?? 'rectangle',
		fill: input.fill === undefined ? DEFAULT_THEME.colors.accent! : input.fill,
		stroke: input.stroke === undefined ? null : input.stroke,
		strokeWidth: input.strokeWidth ?? (input.stroke ? 2 : 0)
	};
}

export function createImageElement(input: ImageElementInput): ImageElement {
	return {
		...baseElement(input, 1),
		kind: 'image',
		assetId: input.assetId,
		crop: input.crop ?? { x: 0, y: 0, width: 1, height: 1 },
		flipX: input.flipX ?? false,
		flipY: input.flipY ?? false,
		alt: input.alt ?? ''
	};
}

export function nextSlideName(slides: Array<{ name: string }>): string {
	let index = slides.length + 1;
	const names = new Set(slides.map((slide) => slide.name));
	while (names.has(`Slide ${index}`)) index += 1;
	return `Slide ${index}`;
}

/**
 * Independent copy for "duplicate presentation", template cloning and pack
 * snapshots: fresh document/slide/element/asset IDs, remapped asset references,
 * revision reset to 0 and a fresh timestamp.
 */
export function clonePresentationDocumentWithNewIds(
	source: PresentationDocument,
	options: { title?: string; now?: string } = {}
): PresentationDocument {
	const now = options.now ?? new Date().toISOString();
	const assetIdMap = new Map<string, string>();
	const assets: PresentationAsset[] = source.assets.map((asset) => {
		const id = newId();
		assetIdMap.set(asset.id, id);
		return { ...asset, id, provenance: { ...asset.provenance } };
	});
	const slides = source.slides.map((slide) => ({
		...slide,
		id: newId(),
		elements: slide.elements.map((element) => {
			const copy = structuredClone(element);
			copy.id = newId();
			if (copy.kind === 'image') {
				const mapped = assetIdMap.get(copy.assetId);
				if (!mapped) throw new Error(`Source document references missing asset ${copy.assetId}`);
				copy.assetId = mapped;
			}
			return copy;
		})
	}));
	return {
		...structuredClone(source),
		id: newId(),
		title: options.title ?? source.title,
		revision: 0,
		slides,
		assets,
		createdAt: now,
		updatedAt: now
	};
}
