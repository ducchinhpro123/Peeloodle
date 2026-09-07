import {
  ARTBOARD_SIZE,
  DOCUMENT_SCHEMA_VERSION,
  type Artboard,
  type Asset,
  type CropRect,
  type ImageLayer,
  type Layer,
  type LayerBase,
  type ProjectDocument,
  type ShapeLayer,
  type TextLayer,
  type Transform,
} from '../../types/domain'

export type PersistenceErrorCode =
  | 'not_found'
  | 'invalid_document'
  | 'unsupported_schema'
  | 'malformed_data'
  | 'missing_asset'
  | 'invalid_asset'
  | 'transaction_failed'

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode
  readonly cause?: unknown

  constructor(code: PersistenceErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'PersistenceError'
    this.code = code
    this.cause = cause
  }
}

export function isPersistenceError(error: unknown): error is PersistenceError {
  return error instanceof PersistenceError
}

export function createProjectDocument(input: { id?: string; title?: string } = {}): ProjectDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: input.id ?? crypto.randomUUID(),
    title: input.title ?? 'Untitled Sticker',
    artboard: { width: ARTBOARD_SIZE, height: ARTBOARD_SIZE, background: 'transparent' },
    layers: [],
    assetIds: [],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  }
}

export function serializeProjectDocument(document: ProjectDocument): ProjectDocument {
  try {
    return parseProjectDocument(JSON.parse(JSON.stringify(document)) as unknown)
  } catch (error) {
    if (error instanceof PersistenceError) throw error
    throw new PersistenceError('malformed_data', 'Project document is not JSON-serializable', error)
  }
}

export function parseProjectDocument(value: unknown): ProjectDocument {
  const raw = value instanceof Object && typeof value !== 'string' ? value : parseJsonObject(value)
  if (!isRecord(raw)) throw invalidDocument('Project document must be an object')

  const schemaVersion = raw.schemaVersion
  if (schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    throw new PersistenceError(
      typeof schemaVersion === 'number' ? 'unsupported_schema' : 'invalid_document',
      `Unsupported project schemaVersion ${String(schemaVersion)}`,
    )
  }

  const id = requiredString(raw.id, 'id')
  const title = requiredString(raw.title, 'title', true)
  const artboard = parseArtboard(raw.artboard)
  const layers = parseLayers(raw.layers)
  const assetIds = parseIdList(raw.assetIds, 'assetIds')
  const createdAt = requiredTimestamp(raw.createdAt, 'createdAt')
  const updatedAt = requiredTimestamp(raw.updatedAt, 'updatedAt')
  const revision = requiredNonNegativeInteger(raw.revision, 'revision')

  const layerIds = new Set<string>()
  for (const layer of layers) {
    if (layerIds.has(layer.id)) throw invalidDocument(`Duplicate layer id ${layer.id}`)
    layerIds.add(layer.id)
    if (layer.kind === 'image' && !assetIds.includes(layer.assetId)) {
      throw invalidDocument(`Image layer ${layer.id} references asset ${layer.assetId} that is not in assetIds`)
    }
  }

  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, id, title, artboard, layers, assetIds, createdAt, updatedAt, revision }
}

export function parseAsset(value: unknown): Asset {
  const raw = isRecord(value) ? value : null
  if (!raw) throw new PersistenceError('invalid_asset', 'Asset metadata must be an object')

  const id = requiredString(raw.id, 'asset.id')
  const mimeType = requiredString(raw.mimeType, 'asset.mimeType')
  const width = requiredPositiveInteger(raw.width, 'asset.width')
  const height = requiredPositiveInteger(raw.height, 'asset.height')
  const blobKey = requiredString(raw.blobKey, 'asset.blobKey')
  const provenance = requiredString(raw.provenance, 'asset.provenance', true)
  const asset: Asset = { id, mimeType, width, height, blobKey, provenance }
  if (raw.cloudObjectPath !== undefined) asset.cloudObjectPath = requiredString(raw.cloudObjectPath, 'asset.cloudObjectPath')
  return asset
}

function parseJsonObject(value: unknown): unknown {
  if (typeof value !== 'string') throw invalidDocument('Project document must be an object')
  try {
    return JSON.parse(value) as unknown
  } catch (cause) {
    throw new PersistenceError('malformed_data', 'Project document is not valid JSON', cause)
  }
}

function parseArtboard(value: unknown): Artboard {
  if (!isRecord(value)) throw invalidDocument('artboard must be an object')
  const width = requiredPositiveInteger(value.width, 'artboard.width')
  const height = requiredPositiveInteger(value.height, 'artboard.height')
  if (width !== ARTBOARD_SIZE || height !== ARTBOARD_SIZE) {
    throw invalidDocument(`artboard must be ${ARTBOARD_SIZE}×${ARTBOARD_SIZE}`)
  }
  if (value.background !== 'transparent') throw invalidDocument('artboard.background must be transparent')
  return { width: ARTBOARD_SIZE, height: ARTBOARD_SIZE, background: 'transparent' }
}

function parseLayers(value: unknown): Layer[] {
  if (!Array.isArray(value)) throw invalidDocument('layers must be an array')
  return value.map((layer, index) => parseLayer(layer, index))
}

function parseLayer(value: unknown, index: number): Layer {
  if (!isRecord(value)) throw invalidDocument(`layers[${index}] must be an object`)
  const base = parseLayerBase(value, index)
  const kind = value.kind
  if (kind === 'image') return parseImageLayer(value, base)
  if (kind === 'text') return parseTextLayer(value, base)
  if (kind === 'shape') return parseShapeLayer(value, base)
  throw invalidDocument(`layers[${index}] has unsupported kind ${String(kind)}`)
}

function parseLayerBase(value: Record<string, unknown>, index: number): LayerBase {
  return {
    id: requiredString(value.id, `layers[${index}].id`),
    name: requiredString(value.name, `layers[${index}].name`, true),
    transform: parseTransform(value.transform, index),
    opacity: requiredUnitInterval(value.opacity, `layers[${index}].opacity`),
    visible: requiredBoolean(value.visible, `layers[${index}].visible`),
    locked: requiredBoolean(value.locked, `layers[${index}].locked`),
  }
}

function parseTransform(value: unknown, index: number): Transform {
  if (!isRecord(value)) throw invalidDocument(`layers[${index}].transform must be an object`)
  return {
    x: requiredFiniteNumber(value.x, `layers[${index}].transform.x`),
    y: requiredFiniteNumber(value.y, `layers[${index}].transform.y`),
    rotation: requiredFiniteNumber(value.rotation, `layers[${index}].transform.rotation`),
    scaleX: requiredFiniteNumber(value.scaleX, `layers[${index}].transform.scaleX`),
    scaleY: requiredFiniteNumber(value.scaleY, `layers[${index}].transform.scaleY`),
  }
}

function parseImageLayer(value: Record<string, unknown>, base: LayerBase): ImageLayer {
  const layer: ImageLayer = { ...base, kind: 'image', assetId: requiredString(value.assetId, `layer ${base.id} assetId`) }
  if (value.crop !== undefined) layer.crop = parseCrop(value.crop, base.id)
  if (value.maskKey !== undefined) layer.maskKey = requiredString(value.maskKey, `layer ${base.id} maskKey`)
  if (value.filters !== undefined) layer.filters = parseFilters(value.filters, base.id)
  if (value.outline !== undefined) layer.outline = parseOutline(value.outline, base.id)
  return layer
}

function parseOutline(value: unknown, layerId: string): import('../../types/domain').LayerOutline {
  if (!isRecord(value)) throw invalidDocument(`layer ${layerId} outline must be an object`)
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : false,
    color: requiredString(value.color, `layer ${layerId} outline.color`),
    width: requiredPositiveNumber(value.width, `layer ${layerId} outline.width`),
  }
}

function parseFilters(value: unknown, layerId: string): import('../../types/domain').ImageFilters {
  if (!isRecord(value)) throw invalidDocument(`layer ${layerId} filters must be an object`)
  return {
    brightness: requiredFiniteNumber(value.brightness, `layer ${layerId} filters.brightness`),
    contrast: requiredFiniteNumber(value.contrast, `layer ${layerId} filters.contrast`),
    saturation: requiredFiniteNumber(value.saturation, `layer ${layerId} filters.saturation`),
    grayscale: requiredFiniteNumber(value.grayscale, `layer ${layerId} filters.grayscale`),
  }
}

function parseCrop(value: unknown, layerId: string): CropRect {
  if (!isRecord(value)) throw invalidDocument(`layer ${layerId} crop must be an object`)
  const crop = {
    x: requiredFiniteNumber(value.x, `layer ${layerId} crop.x`),
    y: requiredFiniteNumber(value.y, `layer ${layerId} crop.y`),
    width: requiredFiniteNumber(value.width, `layer ${layerId} crop.width`),
    height: requiredFiniteNumber(value.height, `layer ${layerId} crop.height`),
  }
  if (crop.width <= 0 || crop.height <= 0) throw invalidDocument(`layer ${layerId} crop size must be positive`)
  return crop
}

function parseTextLayer(value: Record<string, unknown>, base: LayerBase): TextLayer {
  return {
    ...base,
    kind: 'text',
    content: requiredString(value.content, `layer ${base.id} content`, true),
    fontFamily: requiredString(value.fontFamily, `layer ${base.id} fontFamily`),
    fontSize: requiredPositiveNumber(value.fontSize, `layer ${base.id} fontSize`),
    color: requiredString(value.color, `layer ${base.id} color`),
  }
}

function parseShapeLayer(value: Record<string, unknown>, base: LayerBase): ShapeLayer {
  const shape = value.shape
  if (shape !== 'circle' && shape !== 'rectangle') throw invalidDocument(`layer ${base.id} has invalid shape`)
  return { ...base, kind: 'shape', shape, fill: requiredString(value.fill, `layer ${base.id} fill`) }
}

function parseIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw invalidDocument(`${label} must be an array`)
  const ids = value.map((id, index) => requiredString(id, `${label}[${index}]`))
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) throw invalidDocument(`Duplicate ${label} entry ${id}`)
    seen.add(id)
  }
  return ids
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) throw invalidDocument(`${label} must be a non-empty string`)
  return value
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalidDocument(`${label} must be a boolean`)
  return value
}

function requiredFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidDocument(`${label} must be a finite number`)
  return value
}

function requiredPositiveNumber(value: unknown, label: string): number {
  const number = requiredFiniteNumber(value, label)
  if (number <= 0) throw invalidDocument(`${label} must be positive`)
  return number
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const number = requiredFiniteNumber(value, label)
  if (!Number.isInteger(number) || number <= 0) throw invalidDocument(`${label} must be a positive integer`)
  return number
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  const number = requiredFiniteNumber(value, label)
  if (!Number.isInteger(number) || number < 0) throw invalidDocument(`${label} must be a non-negative integer`)
  return number
}

function requiredUnitInterval(value: unknown, label: string): number {
  const number = requiredFiniteNumber(value, label)
  if (number < 0 || number > 1) throw invalidDocument(`${label} must be between 0 and 1`)
  return number
}

function requiredTimestamp(value: unknown, label: string): string {
  const text = requiredString(value, label)
  if (!Number.isFinite(Date.parse(text))) throw invalidDocument(`${label} must be an ISO timestamp`)
  return text
}

function invalidDocument(message: string): PersistenceError {
  return new PersistenceError('invalid_document', message)
}
