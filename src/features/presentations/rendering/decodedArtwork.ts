/**
 * Decoded artwork sessions (P18/P35).
 *
 * One place decides how stored or just-inserted bytes become drawable sources
 * and when those sources close, so the editor, library thumbnails and the export
 * snapshot cannot drift into different disposal behavior:
 *
 * - `createDecodedArtwork` is the incremental session: the editor adds records as
 *   they arrive, a repeated asset id replaces (and closes) the previous source,
 *   and a failed add closes everything decoded so far.
 * - `decodeArtworkBatch` is the all-or-nothing read: thumbnails and the export
 *   snapshot decode every record concurrently, and one failure closes every
 *   fulfilled bitmap before rethrowing.
 *
 * Both return the same `dispose` contract: close every source exactly once;
 * calling it again is safe. Only artwork that must be drawn belongs here — the
 * backup verifier decodes single files to check their dimensions and closes them
 * inline, which is a different policy and stays with the backup module.
 */

import { decodeImageBitmap } from '@/lib/imageDecode'
import type { PresentationImageSource, PresentationImageSources } from './renderSlide'

/** The bytes of one image, structurally compatible with `PresentationMediaRecord`. */
export type ArtworkBytes = { assetId: string; bytes: Uint8Array; mimeType: string }

export type DecodedSource = {
  source: PresentationImageSource
  dispose(): void
}

/** Turns one record into a drawable source; the session owns the result. */
export type DecodeMedia = (record: ArtworkBytes) => Promise<DecodedSource>

/** Sources the caller owns and must close. */
export type DecodedArtworkSources = {
  images: PresentationImageSources
  dispose(): void
}

export type DecodedArtwork = DecodedArtworkSources & {
  add(records: ArtworkBytes[]): Promise<void>
}

/** Bitmap-only decode with the shared EXIF policy. */
export const decodeMediaBitmap: DecodeMedia = async (record) => {
  const bitmap = await decodeImageBitmap(new Blob([record.bytes], { type: record.mimeType }))
  return { source: bitmap, dispose: () => bitmap.close() }
}

/**
 * Decode with an object-URL fallback for platforms without `createImageBitmap`,
 * so a browser that cannot decode a blob as a bitmap can still show the photo.
 */
export const decodeMediaWithFallback: DecodeMedia = async (record) => {
  if (typeof createImageBitmap === 'function') return decodeMediaBitmap(record)
  const url = URL.createObjectURL(new Blob([record.bytes], { type: record.mimeType }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, dispose: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

type Collector = {
  images: PresentationImageSources
  adopt(assetId: string, decoded: DecodedSource): void
  close(assetId: string): void
  closeAll(): void
}

/**
 * Keyed sources plus one disposal list. `adopt` closes whatever the same asset id
 * held before, so an image inserted again under an existing id never keeps its
 * previous bitmap (or object URL) alive.
 */
function createCollector(): Collector {
  const images = new Map<string, PresentationImageSource>()
  const disposers = new Map<string, () => void>()
  const close = (assetId: string) => {
    disposers.get(assetId)?.()
    disposers.delete(assetId)
    images.delete(assetId)
  }
  return {
    images,
    adopt(assetId, decoded) {
      close(assetId)
      disposers.set(assetId, decoded.dispose)
      images.set(assetId, decoded.source)
    },
    close,
    closeAll() {
      for (const assetId of [...disposers.keys()]) close(assetId)
    },
  }
}

export function createDecodedArtwork(decode: DecodeMedia = decodeMediaWithFallback): DecodedArtwork {
  const collector = createCollector()
  return {
    images: collector.images,
    async add(records) {
      const adopted: string[] = []
      try {
        for (const record of records) {
          collector.adopt(record.assetId, await decode(record))
          adopted.push(record.assetId)
        }
      } catch (error) {
        // Close only what this call adopted: a failed incremental add (an image
        // that cannot be displayed) must not blank the artwork already on screen.
        for (const assetId of adopted) collector.close(assetId)
        throw error
      }
    },
    dispose: collector.closeAll,
  }
}

/** All-or-nothing decode: every record concurrently, one failure closes the rest. */
export async function decodeArtworkBatch(records: ArtworkBytes[], decode: DecodeMedia = decodeMediaBitmap): Promise<DecodedArtworkSources> {
  const collector = createCollector()
  const decoded = await Promise.allSettled(records.map((record) => decode(record)))

  const failure = decoded.find((result) => result.status === 'rejected')
  if (failure) {
    for (const result of decoded) {
      if (result.status === 'fulfilled') result.value.dispose()
    }
    throw failure.reason
  }

  records.forEach((record, index) => {
    const result = decoded[index]!
    if (result.status === 'fulfilled') collector.adopt(record.assetId, result.value)
  })

  return { images: collector.images, dispose: collector.closeAll }
}
