import type Konva from 'konva'
import type { Element, ImageElement, PresentationDocument, ShapeElement, Slide, TextElement, TextRun } from '../model/types'
import { createKonvaTextForRun, Konva as KonvaRuntime, konvaTextWidthForRun } from './konvaText'
import { layoutTextElement } from './textLayout'

export type PresentationImageSource = CanvasImageSource & { readonly width: number; readonly height: number }
export type PresentationImageSources = ReadonlyMap<string, PresentationImageSource>

export type RenderSlideOptions = {
  slide: Slide
  pageSize: PresentationDocument['pageSize']
  images?: PresentationImageSources
  /** Makes text elements hit-testable for selection; shapes and images stay inert. */
  listening?: boolean
}

/**
 * Builds one fixed-size Konva page in document units. The caller owns and must
 * destroy the returned group. View zoom and pan belong on the Stage and are
 * deliberately absent from this renderer.
 */
export function renderSlide({ slide, pageSize, images = new Map(), listening = false }: RenderSlideOptions): Konva.Group {
  const page = new KonvaRuntime.Group({
    name: 'presentation-page',
    clip: { x: 0, y: 0, width: pageSize.width, height: pageSize.height },
    listening,
  })

  page.add(new KonvaRuntime.Rect({
    name: 'presentation-background',
    width: pageSize.width,
    height: pageSize.height,
    fill: slide.background,
    listening: false,
  }))

  for (const element of slide.elements) {
    if (!element.visible) continue
    page.add(renderElement(element, images, listening))
  }

  return page
}

function renderElement(element: Element, images: PresentationImageSources, listening: boolean): Konva.Group {
  if (element.kind === 'shape') return renderShape(element, listening)
  if (element.kind === 'image') return renderImage(element, images, listening)
  return renderText(element, listening)
}

function elementGroup(element: Element, listening: boolean): Konva.Group {
  return new KonvaRuntime.Group({
    id: element.id,
    name: `presentation-element presentation-${element.kind}`,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
    // P17 only needs text selection; shapes and images stay inert until P24 adds transforms.
    listening: listening && element.kind === 'text',
  })
}

function renderShape(element: ShapeElement, listening: boolean): Konva.Group {
  const group = elementGroup(element, listening)
  const shared = {
    fill: element.fill ?? undefined,
    stroke: element.stroke ?? undefined,
    strokeWidth: element.strokeWidth,
    listening,
  }

  if (element.shape === 'ellipse') {
    group.add(new KonvaRuntime.Ellipse({
      ...shared,
      x: element.width / 2,
      y: element.height / 2,
      radiusX: element.width / 2,
      radiusY: element.height / 2,
    }))
    return group
  }

  if (element.shape === 'line' || element.shape === 'arrow') {
    const Line = element.shape === 'arrow' ? KonvaRuntime.Arrow : KonvaRuntime.Line
    group.add(new Line({
      points: [0, 0, element.width, element.height],
      stroke: element.stroke ?? element.fill ?? '#08152f',
      strokeWidth: Math.max(1, element.strokeWidth),
      lineCap: 'round',
      lineJoin: 'round',
      listening,
    }))
    return group
  }

  group.add(new KonvaRuntime.Rect({
    ...shared,
    width: element.width,
    height: element.height,
    cornerRadius: element.shape === 'rounded-rectangle'
      ? Math.min(24, element.width / 4, element.height / 4)
      : 0,
  }))
  return group
}

function renderImage(element: ImageElement, images: PresentationImageSources, listening: boolean): Konva.Group {
  const source = images.get(element.assetId)
  if (!source) throw new Error(`Presentation image ${element.assetId} is not loaded`)

  const sourceWidth = source.width
  const sourceHeight = source.height
  const group = elementGroup(element, listening)
  group.add(new KonvaRuntime.Image({
    image: source,
    x: element.flipX ? element.width : 0,
    y: element.flipY ? element.height : 0,
    width: element.width,
    height: element.height,
    scaleX: element.flipX ? -1 : 1,
    scaleY: element.flipY ? -1 : 1,
    crop: {
      x: element.crop.x * sourceWidth,
      y: element.crop.y * sourceHeight,
      width: element.crop.width * sourceWidth,
      height: element.crop.height * sourceHeight,
    },
    listening,
  }))
  return group
}

function renderText(element: TextElement, listening: boolean): Konva.Group {
  const group = elementGroup(element, listening)
  if (listening) {
    // Painted glyphs alone would leave an empty (or cleared) box with no hit area,
    // making it unreachable. Konva paints this rect's color key on the hit canvas
    // only, so the fill is invisible while the whole box stays clickable.
    group.add(new KonvaRuntime.Rect({ width: element.width, height: element.height, fill: 'transparent', listening: true }))
  }
  const content = new KonvaRuntime.Group({ x: element.padding, y: element.padding, listening })
  const layout = layoutTextElement(element, (text, spec) => konvaTextWidthForRun(text, spec))

  for (const line of layout.lines) {
    if (line.bullet && line.firstInParagraph) {
      const firstRun = element.paragraphs[line.paragraphIndex]?.runs[0]
      if (firstRun) content.add(renderBullet(firstRun, line.bullet.marker, line.bullet.x, line.y, line.height, listening))
    }
    for (const run of line.runs) {
      content.add(createKonvaTextForRun(
        run.run,
        run.text,
        run.x,
        line.y + (line.height - run.run.size) / 2,
        listening,
      ))
    }
  }

  group.add(content)
  return group
}

function renderBullet(run: TextRun, marker: string, x: number, y: number, lineHeight: number, listening: boolean): Konva.Text {
  const bulletRun: TextRun = { ...run, text: marker, bold: false, italic: false, link: undefined }
  return createKonvaTextForRun(bulletRun, marker, x, y + (lineHeight - run.size) / 2, listening)
}
