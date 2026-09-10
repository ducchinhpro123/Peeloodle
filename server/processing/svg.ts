/**
 * Restricted SVG ingestion (P07, productionized in P57).
 *
 * Policy: a strict static subset. A real XML parser builds the tree; only
 * whitelisted elements/attributes survive; scripts, event handlers, external
 * references, DTDs/entities, foreign content, CSS imports and text elements are
 * rejected with a reviewable error. Approved SVG is rasterized with resvg
 * (no scripting, no network) into a bounded PNG derivative.
 *
 * Text elements are rejected deliberately: deterministic server-side font
 * rendering cannot be guaranteed, so vector text must be converted to paths
 * before upload rather than silently rendering differently.
 */

import { Resvg } from '@resvg/resvg-js'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { ProcessingError } from './errors'
import { PROCESSING_LIMITS } from './limits'

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'marker',
  'title',
  'desc',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feColorMatrix',
  'feBlend',
  'feComposite',
  'feFlood',
  'feMerge',
  'feMergeNode',
])

export type SvgInspection = { width: number; height: number; nodes: number; depth: number }

type XmlNode = Record<string, unknown>

function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const match = /^\s*([+-]?\d*\.?\d+)(px|pt|pc|in|cm|mm)?\s*$/.exec(value)
  if (!match) return undefined
  const number = Number(match[1])
  if (!Number.isFinite(number) || number <= 0) return undefined
  const unit = match[2]
  const factor = unit === 'pt' ? 96 / 72 : unit === 'pc' ? 16 : unit === 'in' ? 96 : unit === 'cm' ? 96 / 2.54 : unit === 'mm' ? 96 / 25.4 : 1
  return number * factor
}

function attributesOf(node: XmlNode): Record<string, string> {
  const raw = node[':@']
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key.startsWith('@_') ? key.slice(2) : key] = String(value)
  }
  return result
}

function validateAttributes(element: string, attributes: Record<string, string>): void {
  let count = 0
  for (const [name, value] of Object.entries(attributes)) {
    count += 1
    if (count > PROCESSING_LIMITS.svg.maxDepth * 8) throw new ProcessingError('svg_too_complex', 'Too many attributes on an element')
    const lower = name.toLowerCase()
    if (lower.startsWith('on')) throw new ProcessingError('svg_unsafe', `Event handler attribute is not allowed: ${name}`)
    if (lower === 'href' || lower === 'xlink:href') {
      if (!value.trim().startsWith('#')) throw new ProcessingError('svg_unsafe', 'Only same-document fragment references are allowed')
    }
    const compact = value.replace(/\s+/g, '').toLowerCase()
    if (compact.includes('javascript:') || compact.includes('data:text/html') || compact.includes('expression(')) {
      throw new ProcessingError('svg_unsafe', `Unsafe attribute value on ${element}`)
    }
    if (compact.includes('@import')) throw new ProcessingError('svg_unsafe', 'CSS imports are not allowed')
    if (compact.includes('url(')) {
      for (const match of value.matchAll(/url\(\s*['"]?([^'")]*)/gi)) {
        if (!match[1]!.trim().startsWith('#')) throw new ProcessingError('svg_unsafe', 'Only same-document url(#id) references are allowed')
      }
    }
  }
}

function walk(nodes: unknown[], depth: number, stats: { nodes: number; depth: number; viewBox?: { width: number; height: number }; width?: number; height?: number }): void {
  const limits = PROCESSING_LIMITS.svg
  if (depth > limits.maxDepth) throw new ProcessingError('svg_too_complex', 'SVG nesting is too deep')
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    for (const key of Object.keys(node as XmlNode)) {
      if (key === ':@' || key === '#text') continue
      const element = localName(key)
      stats.nodes += 1
      stats.depth = Math.max(stats.depth, depth)
      if (stats.nodes > limits.maxNodes) throw new ProcessingError('svg_too_complex', 'SVG has too many elements')
      if (!ALLOWED_ELEMENTS.has(element)) {
        if (element === 'text' || element === 'tspan' || element === 'textPath') {
          throw new ProcessingError('unsupported_feature', 'Text elements are not allowed; convert text to paths first')
        }
        throw new ProcessingError('unsupported_feature', `Unsupported SVG element: ${element}`)
      }
      const attributes = attributesOf(node as XmlNode)
      validateAttributes(element, attributes)
      if (element === 'svg') {
        const viewBox = attributes.viewBox
        if (viewBox) {
          const parts = viewBox.trim().split(/[\s,]+/).map(Number)
          if (parts.length === 4 && parts.every((part) => Number.isFinite(part)) && parts[2]! > 0 && parts[3]! > 0) {
            stats.viewBox = { width: parts[2]!, height: parts[3]! }
          }
        }
        stats.width = parseNumber(attributes.width) ?? stats.viewBox?.width
        stats.height = parseNumber(attributes.height) ?? stats.viewBox?.height
      }
      const children = (node as XmlNode)[key]
      if (Array.isArray(children)) walk(children, depth + 1, stats)
    }
  }
}

export function inspectSvg(bytes: Uint8Array): SvgInspection {
  const limits = PROCESSING_LIMITS.svg
  if (bytes.length > limits.maxSourceBytes) throw new ProcessingError('file_too_large', 'SVG exceeds the source size limit')
  const text = new TextDecoder().decode(bytes)
  // Policy check only; the XML parser below is the actual analyzer.
  if (/<!doctype/i.test(text)) throw new ProcessingError('svg_unsafe', 'DOCTYPE declarations are not allowed')
  if (/<!entity/i.test(text)) throw new ProcessingError('svg_unsafe', 'Entity declarations are not allowed')
  const validation = XMLValidator.validate(text, { allowBooleanAttributes: false })
  if (validation !== true) throw new ProcessingError('svg_unsafe', `SVG is not well-formed XML: ${validation.err?.msg ?? 'unknown error'}`)

  let parsed: unknown
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      processEntities: false,
      allowBooleanAttributes: false,
      preserveOrder: true,
    }).parse(text)
  } catch {
    throw new ProcessingError('svg_unsafe', 'SVG could not be parsed')
  }

  const stats: { nodes: number; depth: number; viewBox?: { width: number; height: number }; width?: number; height?: number } = { nodes: 0, depth: 0 }
  if (!Array.isArray(parsed)) throw new ProcessingError('svg_unsafe', 'SVG has no root element')
  const rootNames = parsed
    .filter((node): node is XmlNode => !!node && typeof node === 'object')
    .flatMap((node) => Object.keys(node).filter((key) => key !== ':@' && key !== '#text'))
  if (!rootNames.some((name) => localName(name) === 'svg')) throw new ProcessingError('svg_unsafe', 'Root element must be svg')
  walk(parsed, 1, stats)

  const width = stats.width ?? stats.viewBox?.width
  const height = stats.height ?? stats.viewBox?.height
  if (!width || !height) throw new ProcessingError('unsupported_feature', 'SVG needs finite width/height or a viewBox')
  if (width > limits.maxRenderedEdge || height > limits.maxRenderedEdge) throw new ProcessingError('dimension_too_large', 'SVG dimensions exceed the render limit')
  if (width * height > limits.maxPixels) throw new ProcessingError('too_many_pixels', 'SVG exceeds the pixel limit')
  return { width, height, nodes: stats.nodes, depth: stats.depth }
}

export type RasterizedSvg = { png: Uint8Array; width: number; height: number }

export function rasterizeSvg(bytes: Uint8Array): RasterizedSvg {
  const inspection = inspectSvg(bytes)
  const limits = PROCESSING_LIMITS.svg
  const text = new TextDecoder().decode(bytes)
  const targetWidth = Math.min(inspection.width, limits.maxRenderedEdge, limits.outputEdge)
  let rendered: ReturnType<InstanceType<typeof Resvg>['render']>
  try {
    const resvg = new Resvg(text, {
      fitTo: { mode: 'width', value: targetWidth },
      background: 'rgba(0,0,0,0)',
      logLevel: 'error',
      font: { loadSystemFonts: false },
    })
    rendered = resvg.render()
  } catch {
    throw new ProcessingError('render_failed', 'SVG could not be rendered')
  }
  if (rendered.width <= 0 || rendered.height <= 0) throw new ProcessingError('render_failed', 'SVG rendered to an empty image')
  if (rendered.width > limits.maxRenderedEdge || rendered.height > limits.maxRenderedEdge) {
    throw new ProcessingError('dimension_too_large', 'Rendered SVG exceeds the size limit')
  }
  if (rendered.width * rendered.height > limits.maxPixels) throw new ProcessingError('too_many_pixels', 'Rendered SVG exceeds the pixel limit')
  return { png: new Uint8Array(rendered.asPng()), width: rendered.width, height: rendered.height }
}
