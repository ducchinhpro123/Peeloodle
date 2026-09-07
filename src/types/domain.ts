export const DOCUMENT_SCHEMA_VERSION = 1
export const ARTBOARD_SIZE = 1024

export type Transform = { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
export type CropRect = { x: number; y: number; width: number; height: number }
export type Artboard = { width: number; height: number; background: 'transparent' }
export type ImageFilters = { brightness: number; contrast: number; saturation: number; grayscale: number }
export type LayerBase = { id: string; name: string; transform: Transform; opacity: number; visible: boolean; locked: boolean }
export type ImageLayer = LayerBase & { kind: 'image'; assetId: string; crop?: CropRect; maskKey?: string; filters?: ImageFilters }
export type TextLayer = LayerBase & { kind: 'text'; content: string; fontFamily: string; fontSize: number; color: string }
export type ShapeLayer = LayerBase & { kind: 'shape'; shape: 'circle' | 'rectangle'; fill: string }
export type Layer = ImageLayer | TextLayer | ShapeLayer
export type ProjectDocument = {
  schemaVersion: typeof DOCUMENT_SCHEMA_VERSION
  id: string
  title: string
  artboard: Artboard
  layers: Layer[]
  assetIds: string[]
  createdAt: string
  updatedAt: string
  revision: number
}
export type Asset = { id: string; mimeType: string; width: number; height: number; blobKey: string; cloudObjectPath?: string; provenance: string }
export type Pack = { id: string; title: string; description: string; coverAssetId?: string; visibility: 'local' | 'private'; createdAt: string; updatedAt: string }
export type PackItem = { packId: string; projectId: string; position: number }
export type PackRecord = Pack & { projectIds: string[] }
export type Template = { id: string; title: string; category: string; tags: string[]; preview: string; document: ProjectDocument }
