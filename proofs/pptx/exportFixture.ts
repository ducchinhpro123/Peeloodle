/**
 * P03 proof: minimal PptxGenJS mapping of the P02 fixture.
 *
 * Throwaway proof code — the production adapter is written in P38 after this
 * evaluation. Goal: confirm editable native text runs (bold/italic/hyperlink),
 * native shapes and individually movable pictures end up in the package, with
 * the 1280×720 document mapped to 13⅓×7.5 in at 96 units/inch.
 */

import PptxGenJS from 'pptxgenjs';
import {
	createFixturePresentation,
	fixtureImagePng
} from '../../src/features/presentations/model/fixtures/fixture';
import { fontFamilyFor } from '../../src/features/presentations/rendering/fonts';
import { unitsToInches, unitsToPoints } from '../../src/features/presentations/model/geometry';
import { fontFamilyFor } from '../../src/features/presentations/rendering/fonts';
import type {
	Element,
	PresentationDocument,
	ShapeElement,
	TextElement,
	TextParagraph
} from '../../src/features/presentations/model/types';

const hex = (color: string) => color.replace('#', '').toUpperCase();

function paragraphRuns(paragraph: TextParagraph, isLast: boolean, numberStartAt: number) {
	return paragraph.runs.map((run, index) => {
		const last = index === paragraph.runs.length - 1;
		return {
			text: run.text,
			options: {
				fontFace: fontFamilyFor(run.fontId),
				fontSize: unitsToPoints(run.size),
				color: hex(run.color),
				bold: run.bold ?? false,
				italic: run.italic ?? false,
				...(run.link ? { hyperlink: { url: run.link } } : {}),
				align: paragraph.alignment,
				...(last
					? {
							breakLine: !isLast,
							indentLevel: paragraph.bullet === 'none' ? 0 : paragraph.bulletLevel,
							bullet:
								paragraph.bullet === 'none'
									? false
									: paragraph.bullet === 'number'
										? {
												type: 'number' as const,
												numberType: 'arabicPeriod' as const,
												numberStartAt
											}
										: { characterCode: '2022' }
						}
					: {})
			}
		};
	});
}

function addText(slide: PptxGenJS.Slide, element: TextElement) {
	// PptxGenJS emits one buAutoNum per paragraph; consecutive numbered
	// paragraphs must carry explicit start values or readers restart at 1.
	const counters = new Map<number, number>();
	const runs = element.paragraphs.flatMap((paragraph, index) => {
		let numberStartAt = 1;
		if (paragraph.bullet === 'number') {
			numberStartAt = (counters.get(paragraph.bulletLevel) ?? 0) + 1;
			counters.set(paragraph.bulletLevel, numberStartAt);
		} else if (paragraph.bullet === 'none') {
			counters.clear();
		}
		return paragraphRuns(paragraph, index === element.paragraphs.length - 1, numberStartAt);
	});
	slide.addText(runs, {
		x: unitsToInches(element.x),
		y: unitsToInches(element.y),
		w: unitsToInches(element.width),
		h: unitsToInches(element.height),
		margin: unitsToInches(element.padding),
		valign: element.verticalAlign,
		lineSpacingMultiple: element.lineHeight,
		wrap: true
	});
}

function addShape(slide: PptxGenJS.Slide, element: ShapeElement) {
	const shapeByKind = {
		rectangle: 'rect',
		'rounded-rectangle': 'roundRect',
		ellipse: 'ellipse',
		line: 'line',
		arrow: 'line'
	} as const;
	const isLine = element.shape === 'line' || element.shape === 'arrow';
	slide.addShape(shapeByKind[element.shape], {
		x: unitsToInches(element.x),
		y: unitsToInches(element.y),
		w: unitsToInches(element.width),
		h: isLine ? 0 : unitsToInches(element.height),
		...(isLine
			? {
					line: {
						color: hex(element.stroke ?? '#000000'),
						width: unitsToPoints(element.strokeWidth),
						endArrowType: element.shape === 'arrow' ? ('triangle' as const) : ('none' as const)
					}
				}
			: {
					fill: element.fill ? { color: hex(element.fill) } : { transparency: 100 },
					line: element.stroke
						? { color: hex(element.stroke), width: unitsToPoints(element.strokeWidth) }
						: { color: 'FFFFFF', transparency: 100, width: 0 },
					...(element.shape === 'rounded-rectangle' ? { rectRadius: 0.08 } : {})
				}),
		transparency: Math.round((1 - element.opacity) * 100)
	});
}

function addElement(
	slide: PptxGenJS.Slide,
	element: Element,
	document: PresentationDocument,
	imageData: string
) {
	if (!element.visible) return;
	if (element.kind === 'text') {
		addText(slide, element);
		return;
	}
	if (element.kind === 'shape') {
		addShape(slide, element);
		return;
	}
	const asset = document.assets.find((candidate) => candidate.id === element.assetId);
	if (!asset) throw new Error(`Fixture references missing asset ${element.assetId}`);
	slide.addImage({
		data: imageData,
		x: unitsToInches(element.x),
		y: unitsToInches(element.y),
		w: unitsToInches(element.width),
		h: unitsToInches(element.height),
		altText: element.alt,
		flipH: element.flipX,
		flipV: element.flipY,
		transparency: Math.round((1 - element.opacity) * 100)
	});
}

export async function buildFixturePptx(
	document = createFixturePresentation()
): Promise<{ buffer: Buffer; report: Record<string, unknown> }> {
	const pptx = new PptxGenJS();
	pptx.layout = 'LAYOUT_WIDE';
	pptx.author = 'StickerLab proof';
	pptx.title = document.title;
	const imageData = `data:image/png;base64,${Buffer.from(fixtureImagePng()).toString('base64')}`;

	const counts = { text: 0, shape: 0, image: 0 };
	for (const slideModel of document.slides) {
		const slide = pptx.addSlide();
		slide.background = { color: hex(slideModel.background) };
		for (const element of slideModel.elements) {
			if (!element.visible) continue;
			counts[element.kind] += 1;
			addElement(slide, element, document, imageData);
		}
	}

	const output = await pptx.write({ outputType: 'nodebuffer' });
	return {
		buffer: Buffer.from(output as ArrayBuffer),
		report: {
			generator: 'PptxGenJS',
			slideCount: document.slides.length,
			pageSizeInches: { width: 13.3333, height: 7.5 },
			elementCounts: counts,
			fonts: ['Be Vietnam Pro', 'Spectral']
		}
	};
}
