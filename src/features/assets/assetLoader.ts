import { ARTBOARD_SIZE, type Asset, type Transform } from '../../types/domain'
import type { AssetRecord } from '../../lib/persistence/repository'
import { validateUpload, type ValidateUploadOptions } from './validateUpload'

export async function ingestImageFile(file: File, options: ValidateUploadOptions = {}): Promise<AssetRecord> {
  const validated = await validateUpload(file, options)
  const id = crypto.randomUUID()
  const asset: Asset = {
    id,
    mimeType: validated.mimeType,
    width: validated.width,
    height: validated.height,
    blobKey: id,
    provenance: `user-upload:${file.name || 'untitled'}`,
  }
  return { asset, blob: validated.blob }
}

/** Top-left origin; switch if the editor uses center offsets. */
export function fitImageToArtboard(width: number, height: number, artboard = ARTBOARD_SIZE): Transform {
  if (width <= 0 || height <= 0) throw new Error('Image dimensions must be positive')
  const scale = Math.min(artboard / width, artboard / height, 1)
  return {
    x: (artboard - width * scale) / 2,
    y: (artboard - height * scale) / 2,
    rotation: 0,
    scaleX: scale,
    scaleY: scale,
  }
}

export class AssetObjectUrlCache {
  private readonly urls = new Map<string, string>()

  urlFor(id: string, blob: Blob): string {
    const existing = this.urls.get(id)
    if (existing) return existing
    const url = URL.createObjectURL(blob)
    this.urls.set(id, url)
    return url
  }

  revoke(id: string): void {
    const url = this.urls.get(id)
    if (!url) return
    URL.revokeObjectURL(url)
    this.urls.delete(id)
  }

  revokeAll(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
  }
}
