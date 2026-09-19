/**
 * Presentation document parser/serializer (P10).
 *
 * The parser is the only gate for documents from IndexedDB, backups, templates
 * and the network. It rejects unknown versions, duplicate IDs, non-finite
 * geometry, invalid runs/colors, unsafe links, missing asset references and
 * oversized input *before* any caller mutates state. Errors carry stable codes
 * so UIs can offer a recoverable message.
 */

import { PRESENTATION_LIMITS } from './limits';
import { safeLink } from './links';
import {
	HEX_COLOR,
	PRESENTATION_KIND,
	PRESENTATION_PAGE_HEIGHT,
	PRESENTATION_PAGE_WIDTH,
	PRESENTATION_SCHEMA_VERSION,
	type AssetProvenance,
	type BulletLevel,
	type Element,
	type ImageElement,
	type ParagraphAlignment,
	type PresentationAsset,
	type PresentationDocument,
	type ShapeElement,
	type ShapeKind,
	type Slide,
	type TextElement,
	type TextParagraph,
	type TextRun,
	type Theme
} from './types';

export type PresentationParseErrorCode =
	'invalid' | 'unsupported_schema' | 'malformed_data' | 'limit_exceeded' | 'missing_reference';

export class PresentationParseError extends Error {
	readonly code: PresentationParseErrorCode;

	constructor(code: PresentationParseErrorCode, message: string) {
		super(message);
		this.name = 'PresentationParseError';
		this.code = code;
	}
}

export function isPresentationParseError(error: unknown): error is PresentationParseError {
	return error instanceof PresentationParseError;
}

const TEXT_ALIGNMENTS: ParagraphAlignment[] = ['left', 'center', 'right', 'justify'];
const BULLET_KINDS: TextParagraph['bullet'][] = ['none', 'bullet', 'number'];
const SHAPE_KINDS: ShapeKind[] = ['rectangle', 'rounded-rectangle', 'ellipse', 'line', 'arrow'];
const VERTICAL_ALIGNMENTS: TextElement['verticalAlign'][] = ['top', 'middle', 'bottom'];
const MIME_TYPES: PresentationAsset['mimeType'][] = ['image/png', 'image/jpeg', 'image/webp'];
const PROVENANCE_SOURCES: AssetProvenance['source'][] = ['upload', 'sticker', 'catalog'];

export function parsePresentationDocument(value: unknown): PresentationDocument {
	if (typeof value !== 'string') return parsePresentationObject(value);
	if (value.length > PRESENTATION_LIMITS.maxDocumentChars) {
		throw new PresentationParseError('limit_exceeded', 'Presentation document is too large');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new PresentationParseError('malformed_data', 'Presentation document is not valid JSON');
	}
	return parsePresentationObject(parsed);
}

function parsePresentationObject(value: unknown): PresentationDocument {
	const raw = value;
	if (!isRecord(raw)) throw invalid('Presentation document must be an object');
	if (raw.kind !== PRESENTATION_KIND) throw invalid('Not a presentation document');
	if (raw.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
		throw new PresentationParseError(
			'unsupported_schema',
			`Unsupported presentation schemaVersion ${String(raw.schemaVersion)}`
		);
	}

	const id = requiredId(raw.id, 'id');
	const title = requiredString(raw.title, 'title', { max: PRESENTATION_LIMITS.maxTitleLength });
	const revision = requiredNonNegativeInteger(raw.revision, 'revision');
	const createdAt = requiredTimestamp(raw.createdAt, 'createdAt');
	const updatedAt = requiredTimestamp(raw.updatedAt, 'updatedAt');
	const pageSize = parsePageSize(raw.pageSize);
	const theme = parseTheme(raw.theme);

	const assets = parseAssets(raw.assets);
	const assetIds = new Set(assets.map((asset) => asset.id));

	const slides = parseSlides(raw.slides, assetIds);
	const seen = new Set<string>([id]);
	for (const asset of assets) {
		if (seen.has(asset.id)) throw invalid(`Duplicate id ${asset.id}`);
		seen.add(asset.id);
	}
	for (const slide of slides) {
		if (seen.has(slide.id)) throw invalid(`Duplicate id ${slide.id}`);
		seen.add(slide.id);
		for (const element of slide.elements) {
			if (seen.has(element.id)) throw invalid(`Duplicate id ${element.id}`);
			seen.add(element.id);
		}
	}

	const document: PresentationDocument = {
		kind: PRESENTATION_KIND,
		schemaVersion: PRESENTATION_SCHEMA_VERSION,
		id,
		title,
		revision,
		pageSize,
		theme,
		slides,
		assets,
		createdAt,
		updatedAt
	};
	// Guarantee the round trip: anything accepted here must also be loadable from
	// its serialized JSON (and therefore from IndexedDB/backups) under one budget.
	assertWithinSizeBudget(document);
	return document;
}

function assertWithinSizeBudget(document: PresentationDocument): void {
	let json: string;
	try {
		json = JSON.stringify(document);
	} catch {
		throw new PresentationParseError(
			'malformed_data',
			'Presentation document is not JSON-serializable'
		);
	}
	if (json.length > PRESENTATION_LIMITS.maxDocumentChars) {
		throw new PresentationParseError(
			'limit_exceeded',
			'Presentation document exceeds the size limit'
		);
	}
}

/** Returns a clone containing only serializable, validated data. */
export function serializePresentationDocument(document: unknown): PresentationDocument {
	let json: string;
	try {
		json = JSON.stringify(document);
	} catch {
		throw new PresentationParseError(
			'malformed_data',
			'Presentation document is not JSON-serializable'
		);
	}
	if (json.length > PRESENTATION_LIMITS.maxDocumentChars) {
		throw new PresentationParseError(
			'limit_exceeded',
			'Presentation document exceeds the size limit'
		);
	}
	return parsePresentationDocument(json);
}

export function presentationDocumentToJson(document: PresentationDocument): string {
	return JSON.stringify(serializePresentationDocument(document));
}

export type PresentationValidation =
	| { ok: true; document: PresentationDocument }
	| { ok: false; code: PresentationParseErrorCode; message: string };

/** Non-throwing wrapper used by backup/template validation. */
export function validatePresentationDocument(value: unknown): PresentationValidation {
	try {
		return { ok: true, document: parsePresentationDocument(value) };
	} catch (error) {
		if (error instanceof PresentationParseError)
			return { ok: false, code: error.code, message: error.message };
		return {
			ok: false,
			code: 'invalid',
			message: error instanceof Error ? error.message : 'Invalid presentation document'
		};
	}
}

function parsePageSize(value: unknown): PresentationDocument['pageSize'] {
	if (!isRecord(value)) throw invalid('pageSize must be an object');
	if (value.width !== PRESENTATION_PAGE_WIDTH || value.height !== PRESENTATION_PAGE_HEIGHT) {
		throw invalid(`pageSize must be ${PRESENTATION_PAGE_WIDTH}×${PRESENTATION_PAGE_HEIGHT}`);
	}
	return { width: PRESENTATION_PAGE_WIDTH, height: PRESENTATION_PAGE_HEIGHT };
}

function parseTheme(value: unknown): Theme {
	if (!isRecord(value)) throw invalid('theme must be an object');
	const headingFontId = requiredId(value.headingFontId, 'theme.headingFontId');
	const bodyFontId = requiredId(value.bodyFontId, 'theme.bodyFontId');
	if (!isRecord(value.colors)) throw invalid('theme.colors must be an object');
	const entries = Object.entries(value.colors);
	if (entries.length > PRESENTATION_LIMITS.maxThemeColors)
		throw new PresentationParseError('limit_exceeded', 'Too many theme colors');
	const colors: Record<string, string> = {};
	for (const [name, color] of entries) {
		if (!name) throw invalid('theme color names must be non-empty');
		colors[name] = requiredColor(color, `theme.colors.${name}`);
	}
	return { headingFontId, bodyFontId, colors };
}

function parseAssets(value: unknown): PresentationAsset[] {
	if (!Array.isArray(value)) throw invalid('assets must be an array');
	if (value.length > PRESENTATION_LIMITS.maxAssets)
		throw new PresentationParseError('limit_exceeded', 'Too many assets');
	return value.map((asset, index) => {
		if (!isRecord(asset)) throw invalid(`assets[${index}] must be an object`);
		const mimeType = MIME_TYPES.find((candidate) => candidate === asset.mimeType);
		if (!mimeType) throw invalid(`assets[${index}] has unsupported mimeType`);
		const sha256 = requiredString(asset.sha256, `assets[${index}].sha256`);
		if (!/^[a-f0-9]{64}$/.test(sha256))
			throw invalid(`assets[${index}].sha256 must be a lowercase hex SHA-256`);
		return {
			id: requiredId(asset.id, `assets[${index}].id`),
			blobKey: requiredString(asset.blobKey, `assets[${index}].blobKey`, { max: 500 }),
			mimeType,
			width: requiredPositiveInteger(asset.width, `assets[${index}].width`),
			height: requiredPositiveInteger(asset.height, `assets[${index}].height`),
			sha256,
			// A document written before this field existed has no recorded size; treat it
			// as unknown (0) instead of rejecting a readable document. Every new write
			// records it, so the budget is exact for anything created now.
			byteLength:
				asset.byteLength === undefined
					? 0
					: requiredNonNegativeInteger(asset.byteLength, `assets[${index}].byteLength`),
			provenance: parseProvenance(asset.provenance, `assets[${index}].provenance`)
		};
	});
}

function parseProvenance(value: unknown, label: string): AssetProvenance {
	if (!isRecord(value)) throw invalid(`${label} must be an object`);
	const source = PROVENANCE_SOURCES.find((candidate) => candidate === value.source);
	if (!source) throw invalid(`${label}.source is invalid`);
	const provenance: AssetProvenance = {
		source,
		label: requiredString(value.label, `${label}.label`, { allowEmpty: true, max: 500 })
	};
	for (const key of ['catalogItemId', 'catalogVersionId', 'stickerId'] as const) {
		if (value[key] !== undefined)
			provenance[key] = requiredString(value[key], `${label}.${key}`, { max: 200 });
	}
	return provenance;
}

function parseSlides(value: unknown, assetIds: Set<string>): Slide[] {
	if (!Array.isArray(value)) throw invalid('slides must be an array');
	if (value.length < 1) throw invalid('A presentation needs at least one slide');
	if (value.length > PRESENTATION_LIMITS.maxSlides)
		throw new PresentationParseError('limit_exceeded', 'Too many slides');
	let totalElements = 0;
	return value.map((slide, index) => {
		if (!isRecord(slide)) throw invalid(`slides[${index}] must be an object`);
		const elements = parseElements(slide.elements, index, assetIds);
		totalElements += elements.length;
		if (totalElements > PRESENTATION_LIMITS.maxElements)
			throw new PresentationParseError('limit_exceeded', 'Too many elements');
		return {
			id: requiredId(slide.id, `slides[${index}].id`),
			name: requiredString(slide.name, `slides[${index}].name`, { allowEmpty: true, max: 200 }),
			background: requiredColor(slide.background, `slides[${index}].background`),
			elements
		};
	});
}

function parseElements(value: unknown, slideIndex: number, assetIds: Set<string>): Element[] {
	if (!Array.isArray(value)) throw invalid(`slides[${slideIndex}].elements must be an array`);
	if (value.length > PRESENTATION_LIMITS.maxElementsPerSlide) {
		throw new PresentationParseError(
			'limit_exceeded',
			`slides[${slideIndex}] has too many elements`
		);
	}
	return value.map((element, index) =>
		parseElement(element, `slides[${slideIndex}].elements[${index}]`, assetIds)
	);
}

function parseElement(value: unknown, label: string, assetIds: Set<string>): Element {
	if (!isRecord(value)) throw invalid(`${label} must be an object`);
	const base = {
		id: requiredId(value.id, `${label}.id`),
		name: requiredString(value.name, `${label}.name`, { allowEmpty: true, max: 200 }),
		x: requiredFinite(value.x, `${label}.x`),
		y: requiredFinite(value.y, `${label}.y`),
		width: requiredPositiveNumber(value.width, `${label}.width`),
		height: requiredPositiveNumber(value.height, `${label}.height`),
		rotation: requiredFinite(value.rotation, `${label}.rotation`),
		opacity: requiredRange(value.opacity, `${label}.opacity`, 0, 1),
		visible: requiredBoolean(value.visible, `${label}.visible`),
		locked: requiredBoolean(value.locked, `${label}.locked`)
	};
	switch (value.kind) {
		case 'text':
			return parseTextElement(value, base, label);
		case 'image':
			return parseImageElement(value, base, label, assetIds);
		case 'shape':
			return parseShapeElement(value, base, label);
		default:
			throw invalid(`${label}.kind is not supported`);
	}
}

type ElementBaseValues = Omit<
	TextElement,
	'kind' | 'paragraphs' | 'padding' | 'lineHeight' | 'verticalAlign' | 'autoGrow'
>;

function parseTextElement(
	value: Record<string, unknown>,
	base: ElementBaseValues,
	label: string
): TextElement {
	const paragraphs = parseParagraphs(value.paragraphs, label);
	const totalText = paragraphs.reduce(
		(sum, paragraph) => sum + paragraph.runs.reduce((lengths, run) => lengths + run.text.length, 0),
		0
	);
	if (totalText > PRESENTATION_LIMITS.maxTextLength)
		throw new PresentationParseError('limit_exceeded', `${label} has too much text`);
	const lineHeight = requiredRange(value.lineHeight, `${label}.lineHeight`, 0.1, 10);
	const verticalAlign = VERTICAL_ALIGNMENTS.find((candidate) => candidate === value.verticalAlign);
	if (!verticalAlign) throw invalid(`${label}.verticalAlign is invalid`);
	return {
		...base,
		kind: 'text',
		paragraphs,
		padding: requiredRange(value.padding, `${label}.padding`, 0, 500),
		lineHeight,
		verticalAlign,
		// null, strings, numbers and objects are invalid, not false.
		...(value.autoGrow === undefined
			? {}
			: { autoGrow: requiredBoolean(value.autoGrow, `${label}.autoGrow`) })
	};
}

function parseParagraphs(value: unknown, label: string): TextParagraph[] {
	if (!Array.isArray(value)) throw invalid(`${label}.paragraphs must be an array`);
	if (value.length === 0) throw invalid(`${label} needs at least one paragraph`);
	if (value.length > PRESENTATION_LIMITS.maxParagraphsPerElement)
		throw new PresentationParseError('limit_exceeded', `${label} has too many paragraphs`);
	return value.map((paragraph, index) => {
		const paragraphLabel = `${label}.paragraphs[${index}]`;
		if (!isRecord(paragraph)) throw invalid(`${paragraphLabel} must be an object`);
		const alignment = TEXT_ALIGNMENTS.find((candidate) => candidate === paragraph.alignment);
		if (!alignment) throw invalid(`${paragraphLabel}.alignment is invalid`);
		const bullet = BULLET_KINDS.find((candidate) => candidate === paragraph.bullet);
		if (!bullet) throw invalid(`${paragraphLabel}.bullet is invalid`);
		const level = paragraph.bulletLevel;
		if (level !== 0 && level !== 1 && level !== 2)
			throw invalid(`${paragraphLabel}.bulletLevel must be 0, 1 or 2`);
		if (!Array.isArray(paragraph.runs)) throw invalid(`${paragraphLabel}.runs must be an array`);
		if (paragraph.runs.length > PRESENTATION_LIMITS.maxRunsPerParagraph) {
			throw new PresentationParseError('limit_exceeded', `${paragraphLabel} has too many runs`);
		}
		return {
			runs: paragraph.runs.map((run, runIndex) =>
				parseRun(run, `${paragraphLabel}.runs[${runIndex}]`)
			),
			alignment,
			bullet,
			bulletLevel: level as BulletLevel
		};
	});
}

function parseRun(value: unknown, label: string): TextRun {
	if (!isRecord(value)) throw invalid(`${label} must be an object`);
	const run: TextRun = {
		text: requiredString(value.text, `${label}.text`, {
			allowEmpty: true,
			max: PRESENTATION_LIMITS.maxTextLength
		}),
		fontId: requiredId(value.fontId, `${label}.fontId`),
		size: requiredRange(value.size, `${label}.size`, 1, 1000),
		color: requiredColor(value.color, `${label}.color`)
	};
	if (value.bold !== undefined) run.bold = requiredBoolean(value.bold, `${label}.bold`);
	if (value.italic !== undefined) run.italic = requiredBoolean(value.italic, `${label}.italic`);
	if (value.link !== undefined) {
		const link = requiredString(value.link, `${label}.link`, { max: 2000 });
		if (!safeLink(link)) throw invalid(`${label}.link is not a safe http(s)/mailto URL`);
		run.link = link;
	}
	return run;
}

function parseImageElement(
	value: Record<string, unknown>,
	base: ElementBaseValues,
	label: string,
	assetIds: Set<string>
): ImageElement {
	const assetId = requiredId(value.assetId, `${label}.assetId`);
	if (!assetIds.has(assetId))
		throw new PresentationParseError(
			'missing_reference',
			`${label} references missing asset ${assetId}`
		);
	const crop = value.crop;
	if (!isRecord(crop)) throw invalid(`${label}.crop must be an object`);
	const parsedCrop = {
		x: requiredFinite(crop.x, `${label}.crop.x`),
		y: requiredFinite(crop.y, `${label}.crop.y`),
		width: requiredPositiveNumber(crop.width, `${label}.crop.width`),
		height: requiredPositiveNumber(crop.height, `${label}.crop.height`)
	};
	if (
		parsedCrop.x < 0 ||
		parsedCrop.y < 0 ||
		parsedCrop.x + parsedCrop.width > 1.0001 ||
		parsedCrop.y + parsedCrop.height > 1.0001
	) {
		throw invalid(`${label}.crop must stay inside the image`);
	}
	return {
		...base,
		kind: 'image',
		assetId,
		crop: parsedCrop,
		flipX: requiredBoolean(value.flipX, `${label}.flipX`),
		flipY: requiredBoolean(value.flipY, `${label}.flipY`),
		alt: requiredString(value.alt, `${label}.alt`, { allowEmpty: true, max: 500 })
	};
}

function parseShapeElement(
	value: Record<string, unknown>,
	base: ElementBaseValues,
	label: string
): ShapeElement {
	const shape = SHAPE_KINDS.find((candidate) => candidate === value.shape);
	if (!shape) throw invalid(`${label}.shape is invalid`);
	return {
		...base,
		kind: 'shape',
		shape,
		fill: optionalColor(value.fill, `${label}.fill`),
		stroke: optionalColor(value.stroke, `${label}.stroke`),
		strokeWidth: requiredRange(value.strokeWidth, `${label}.strokeWidth`, 0, 1000)
	};
}

function invalid(message: string): PresentationParseError {
	return new PresentationParseError('invalid', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredId(value: unknown, label: string): string {
	const text = requiredString(value, label, { max: 200 });
	if (!/^[A-Za-z0-9._:-]+$/.test(text)) throw invalid(`${label} must be a stable id`);
	return text;
}

function requiredString(
	value: unknown,
	label: string,
	options: { allowEmpty?: boolean; max?: number } = {}
): string {
	if (typeof value !== 'string') throw invalid(`${label} must be a string`);
	if (!options.allowEmpty && value.length === 0) throw invalid(`${label} must not be empty`);
	if (options.max !== undefined && value.length > options.max)
		throw new PresentationParseError('limit_exceeded', `${label} is too long`);
	return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw invalid(`${label} must be a boolean`);
	return value;
}

function requiredFinite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw invalid(`${label} must be a finite number`);
	return value;
}

function requiredPositiveNumber(value: unknown, label: string): number {
	const number = requiredFinite(value, label);
	if (number <= 0) throw invalid(`${label} must be positive`);
	return number;
}

function requiredPositiveInteger(value: unknown, label: string): number {
	const number = requiredFinite(value, label);
	if (!Number.isInteger(number) || number <= 0)
		throw invalid(`${label} must be a positive integer`);
	return number;
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
	const number = requiredFinite(value, label);
	if (!Number.isInteger(number) || number < 0)
		throw invalid(`${label} must be a non-negative integer`);
	return number;
}

function requiredRange(value: unknown, label: string, min: number, max: number): number {
	const number = requiredFinite(value, label);
	if (number < min || number > max) throw invalid(`${label} must be between ${min} and ${max}`);
	return number;
}

function requiredColor(value: unknown, label: string): string {
	const text = requiredString(value, label);
	if (!HEX_COLOR.test(text)) throw invalid(`${label} must be a #rrggbb color`);
	return text;
}

function optionalColor(value: unknown, label: string): string | null {
	if (value === null || value === undefined) return null;
	return requiredColor(value, label);
}

function requiredTimestamp(value: unknown, label: string): string {
	const text = requiredString(value, label);
	if (!Number.isFinite(Date.parse(text))) throw invalid(`${label} must be an ISO timestamp`);
	return text;
}
