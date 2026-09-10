/**
 * Serializable presentation document contracts.
 *
 * P02 (proofs) establishes the model; P09/P10 finalize and validate it.
 * The model is deliberately separate from the sticker `ProjectDocument`
 * (see docs/adr/0001-separate-presentation-documents.md): fixed rectangular
 * 16:9 pages, ordered slides and paragraph/run rich text.
 *
 * Nothing here may contain DOM nodes, Konva objects, object URLs or functions.
 */

export const PRESENTATION_KIND = 'presentation'
export const PRESENTATION_SCHEMA_VERSION = 1

/** Document units. Deliberately independent of zoom, display px and devicePixelRatio. */
export const PRESENTATION_PAGE_WIDTH = 1280
export const PRESENTATION_PAGE_HEIGHT = 720

export type PresentationId = string

/** Stable font identity stored in documents and backups. */
export type FontId = string

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export type TextRun = {
  text: string
  fontId: FontId
  /** Font size in document units. */
  size: number
  color: string
  bold?: boolean
  italic?: boolean
  /** Optional safe hyperlink (http/https/mailto). Rejected otherwise by the parser. */
  link?: string
}

export type ParagraphAlignment = 'left' | 'center' | 'right' | 'justify'
export type BulletKind = 'none' | 'bullet' | 'number'
export type BulletLevel = 0 | 1 | 2

export type TextParagraph = {
  runs: TextRun[]
  alignment: ParagraphAlignment
  bullet: BulletKind
  bulletLevel: BulletLevel
}

export type ElementBase = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  /** Degrees clockwise. */
  rotation: number
  /** 0..1 */
  opacity: number
  visible: boolean
  locked: boolean
}

export type TextElement = ElementBase & {
  kind: 'text'
  paragraphs: TextParagraph[]
  /** Padding between element bounds and text, in document units. */
  padding: number
  /** Multiplier of font size. */
  lineHeight: number
  verticalAlign: 'top' | 'middle' | 'bottom'
}

export type NormalizedCrop = { x: number; y: number; width: number; height: number }

export type ImageElement = ElementBase & {
  kind: 'image'
  /** Document-local immutable asset reference. */
  assetId: string
  /** Non-destructive crop in image-local normalized 0..1 coordinates. */
  crop: NormalizedCrop
  flipX: boolean
  flipY: boolean
  alt: string
}

export type ShapeKind = 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'line' | 'arrow'

export type ShapeElement = ElementBase & {
  kind: 'shape'
  shape: ShapeKind
  fill: string | null
  stroke: string | null
  strokeWidth: number
}

export type Element = TextElement | ImageElement | ShapeElement
export type ElementKind = Element['kind']

export type Slide = {
  id: string
  name: string
  /** Background color; `#rrggbb`. */
  background: string
  elements: Element[]
}

export type Theme = {
  headingFontId: FontId
  bodyFontId: FontId
  colors: Record<string, string>
}

export type AssetProvenance = {
  source: 'upload' | 'sticker' | 'catalog'
  label: string
  /** Informational only; the document owns its immutable copy. */
  catalogItemId?: string
  catalogVersionId?: string
  stickerId?: string
}

export type PresentationAsset = {
  id: string
  blobKey: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  /** Hex SHA-256 of the stored bytes. */
  sha256: string
  provenance: AssetProvenance
}

export type PresentationDocument = {
  kind: typeof PRESENTATION_KIND
  schemaVersion: typeof PRESENTATION_SCHEMA_VERSION
  id: PresentationId
  title: string
  revision: number
  pageSize: { width: typeof PRESENTATION_PAGE_WIDTH; height: typeof PRESENTATION_PAGE_HEIGHT }
  theme: Theme
  slides: Slide[]
  assets: PresentationAsset[]
  createdAt: string
  updatedAt: string
}

export type PresentationSummary = {
  id: PresentationId
  title: string
  slideCount: number
  updatedAt: string
  revision: number
}
