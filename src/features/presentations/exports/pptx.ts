/**
 * Editable PPTX export (P38/P39).
 *
 * Text stays native PowerPoint text (paragraphs, runs, bullets, hyperlinks),
 * shapes stay native preset shapes, and every image is embedded individually so
 * it can be moved on its own. Transparency, rotation and the non-destructive
 * crop are mapped onto their OOXML equivalents.
 *
 * Geometry contract: document units are 1/96 inch, so the 1280×720 page becomes
 * the standard 13⅓×7.5 in LAYOUT_WIDE deck. Konva rotates an element around its
 * top-left origin; OOXML rotates around the frame centre, so the frame origin is
 * shifted by the rotated-centre difference to keep the visual placement.
 */

import PptxGenJS from 'pptxgenjs'
import { unitsToInches, unitsToPoints } from '../model/geometry'
import { fontFamilyFor } from '../rendering/fonts'
import type { PresentationExportSnapshot } from './snapshot'
import type { Element, ImageElement, ShapeElement, TextElement, TextParagraph } from '../model/types'

const hex = (color: string) => color.replace('#', '').toUpperCase()

export class PresentationPptxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresentationPptxError'
  }
}

/** Base64 for an embedded data URL; chunked so large photos cannot overflow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/**
 * The OOXML frame for an element whose document rotation turns around its
 * top-left corner: translate so the rotated centre matches the frame centre.
 */
export function pptxFrame(element: Element): { x: number; y: number; w: number; h: number } {
  const radians = (element.rotation * Math.PI) / 180
  const centreX = element.x + (element.width / 2) * Math.cos(radians) - (element.height / 2) * Math.sin(radians)
  const centreY = element.y + (element.width / 2) * Math.sin(radians) + (element.height / 2) * Math.cos(radians)
  return {
    x: unitsToInches(centreX - element.width / 2),
    y: unitsToInches(centreY - element.height / 2),
    w: unitsToInches(element.width),
    h: unitsToInches(element.height),
  }
}

const transparencyOf = (opacity: number) => Math.round((1 - opacity) * 100)

/**
 * One paragraph's runs.
 *
 * Every run carries the same paragraph options.
 *
 * PptxGenJS 4.0.1 writes `<a:pPr>` once *per run*: `genXmlTextBody` calls
 * `genXmlParagraphProperties` for each text object, and a run whose options lack
 * a bullet emits `<a:buNone/>` (node_modules/pptxgenjs/dist/pptxgen.es.js
 * `genXmlTextBody` step 6 + `genXmlParagraphProperties`). A reader that applies
 * the later block therefore drops the paragraph's bullet and indent, so the
 * options must be identical on every run. A run whose `align` differs from the
 * previous run's additionally starts a *new* paragraph, which readers render as
 * an extra line; keeping one identical alignment on every run prevents that.
 * Only `breakLine` is run-specific: it belongs on the last run of a paragraph
 * that is not the element's last, and nowhere else.
 */
function paragraphRuns(paragraph: TextParagraph, isLastParagraph: boolean, numberStartAt: number): PptxGenJS.TextProps[] {
  const paragraphOptions: PptxGenJS.TextPropsOptions = {
    align: paragraph.alignment,
    indentLevel: paragraph.bullet === 'none' ? 0 : paragraph.bulletLevel,
    bullet: paragraph.bullet === 'none'
      ? false
      : paragraph.bullet === 'number'
        ? { type: 'number' as const, numberType: 'arabicPeriod' as const, numberStartAt }
        : { characterCode: '2022' },
  }
  return paragraph.runs.map((run, index) => ({
    text: run.text,
    options: {
      fontFace: fontFamilyFor(run.fontId),
      fontSize: unitsToPoints(run.size),
      color: hex(run.color),
      bold: run.bold ?? false,
      italic: run.italic ?? false,
      ...(run.link ? { hyperlink: { url: run.link } } : {}),
      ...paragraphOptions,
      ...(index === paragraph.runs.length - 1 && !isLastParagraph ? { breakLine: true } : {}),
    },
  }))
}

function addText(slide: PptxGenJS.Slide, element: TextElement) {
  // PptxGenJS emits one buAutoNum per paragraph; consecutive numbered paragraphs
  // must carry explicit start values or readers restart at 1.
  const counters = new Map<number, number>()
  const runs = element.paragraphs.flatMap((paragraph, index) => {
    let numberStartAt = 1
    if (paragraph.bullet === 'number') {
      numberStartAt = (counters.get(paragraph.bulletLevel) ?? 0) + 1
      counters.set(paragraph.bulletLevel, numberStartAt)
    } else if (paragraph.bullet === 'none') {
      counters.clear()
    }
    return paragraphRuns(paragraph, index === element.paragraphs.length - 1, numberStartAt)
  })

  const frame = pptxFrame(element)
  slide.addText(runs, {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    margin: unitsToInches(element.padding),
    valign: element.verticalAlign,
    lineSpacingMultiple: element.lineHeight,
    wrap: true,
    rotate: element.rotation,
    transparency: transparencyOf(element.opacity),
    objectName: element.name,
  })
}

function addShape(slide: PptxGenJS.Slide, element: ShapeElement, shapeType: typeof PptxGenJS.ShapeType) {
  const shapeByKind: Record<ShapeElement['shape'], PptxGenJS.ShapeType> = {
    rectangle: shapeType.rect,
    'rounded-rectangle': shapeType.roundRect,
    ellipse: shapeType.ellipse,
    line: shapeType.line,
    arrow: shapeType.line,
  }
  const isLine = element.shape === 'line' || element.shape === 'arrow'
  const frame = pptxFrame(element)
  const transparency = transparencyOf(element.opacity)
  slide.addShape(shapeByKind[element.shape], {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: isLine ? 0 : frame.h,
    rotate: element.rotation,
    objectName: element.name,
    ...(isLine
      ? {
          line: {
            color: hex(element.stroke ?? '#08152f'),
            width: unitsToPoints(Math.max(1, element.strokeWidth)),
            transparency,
            endArrowType: element.shape === 'arrow' ? ('triangle' as const) : ('none' as const),
          },
        }
      : {
          fill: element.fill ? { color: hex(element.fill), transparency } : { color: 'FFFFFF', transparency: 100 },
          line: element.stroke
            ? { color: hex(element.stroke), width: unitsToPoints(element.strokeWidth), transparency }
            : { color: 'FFFFFF', transparency: 100, width: 0 },
          ...(element.shape === 'rounded-rectangle' ? { rectRadius: 0.08 } : {}),
        }),
  })
}

/**
 * Non-destructive crop mapped to `<a:srcRect>` through PptxGenJS sizing: the
 * option w/h describe the full image and the sizing box the visible part, so the
 * frame can stay the element's own box while the source is cropped.
 */
export function imageCropSizing(element: ImageElement): { w: number; h: number; sizing: { type: 'crop'; x: number; y: number; w: number; h: number } } {
  const fullWidth = element.width / element.crop.width
  const fullHeight = element.height / element.crop.height
  return {
    w: unitsToInches(fullWidth),
    h: unitsToInches(fullHeight),
    sizing: {
      type: 'crop',
      x: unitsToInches(element.crop.x * fullWidth),
      y: unitsToInches(element.crop.y * fullHeight),
      w: unitsToInches(element.width),
      h: unitsToInches(element.height),
    },
  }
}

function addImage(slide: PptxGenJS.Slide, element: ImageElement, snapshot: PresentationExportSnapshot) {
  const media = snapshot.media.get(element.assetId)
  if (!media) throw new PresentationPptxError(`Artwork for “${element.alt || element.name}” is missing, so the deck cannot be exported.`)
  const frame = pptxFrame(element)
  const crop = imageCropSizing(element)
  slide.addImage({
    data: `data:${media.mimeType};base64,${bytesToBase64(media.bytes)}`,
    x: frame.x,
    y: frame.y,
    w: crop.w,
    h: crop.h,
    sizing: crop.sizing,
    rotate: element.rotation,
    flipH: element.flipX,
    flipV: element.flipY,
    transparency: transparencyOf(element.opacity),
    altText: element.alt || element.name,
    objectName: element.name,
  })
}

export type PresentationPptxOptions = { author?: string; title?: string }

/**
 * Builds the editable PPTX for one export snapshot. Slides, elements and
 * paragraph order follow the document arrays exactly; invisible elements are
 * skipped as they are on screen.
 */
export async function buildPresentationPptx(
  snapshot: PresentationExportSnapshot,
  options: PresentationPptxOptions = {},
): Promise<Uint8Array> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = options.author ?? 'StickerLab'
  pptx.title = options.title ?? snapshot.document.title
  pptx.subject = 'StickerLab presentation'

  for (const slideModel of snapshot.document.slides) {
    const slide = pptx.addSlide()
    slide.background = { color: hex(slideModel.background) }
    for (const element of slideModel.elements) {
      if (!element.visible) continue
      if (element.kind === 'text') addText(slide, element)
      else if (element.kind === 'shape') addShape(slide, element, pptx.ShapeType)
      else addImage(slide, element, snapshot)
    }
  }

  const output = await pptx.write({ outputType: 'uint8array' })
  if (!(output instanceof Uint8Array)) throw new PresentationPptxError('The PPTX writer did not return bytes.')
  return output
}
