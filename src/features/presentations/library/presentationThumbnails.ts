/**
 * Library thumbnails (P20 slice 2).
 *
 * One real render of a stored presentation's first slide, produced on demand:
 *
 * - Lazy and throttled: the card asks only once it is near the viewport
 *   (PresentationThumb) and at most PRESENTATION_THUMBNAIL_MAX_RENDERS are drawn
 *   at a time, so opening a library of many decks stays responsive.
 * - Memory only: keyed by document id AND revision in a small LRU. No stored
 *   blobs, no schema change, no document mutation.
 * - The shared renderer: `renderSlide`, the same fixed-page builder the editor
 *   draws with, rasterized once on a fixed-size Stage — never a second renderer.
 * - Silent on failure: missing media, a decode error, a font that will not load
 *   or a render error returns null, so the card keeps its paper preview rather
 *   than showing a blank or half-drawn slide.
 *
 * Only the finished raster (a small data URL) is cached. Decoded bitmaps are
 * closed as soon as the raster is drawn: keeping 24 decoded images of up to 25
 * megapixels each is memory this cap could not bound.
 */

import type { PresentationRepository } from '@/lib/persistence/presentations/repository'
import { rasterizeSlidePage } from '../rendering/rasterizeSlide'
import { decodeArtworkBatch } from '../rendering/decodedArtwork'
import type { PresentationDocument, Slide } from '../model/types'
import { ensurePresentationFonts } from '../rendering/fonts'
import type { PresentationImageSources } from '../rendering/renderSlide'

/** 16:9, 0.375 of a 1280×720 page: sharp at two device pixels per card pixel. */
export const PRESENTATION_THUMBNAIL_WIDTH = 480
export const PRESENTATION_THUMBNAIL_HEIGHT = 270

/** Decks kept in memory before the least recently used one is dropped. */
export const PRESENTATION_THUMBNAIL_CACHE_SIZE = 24

/** Renders in flight at once; the rest of the cards wait their turn. */
export const PRESENTATION_THUMBNAIL_MAX_RENDERS = 2

export type PresentationThumbnail = { url: string }

export type PresentationThumbnailRequest = {
  repository: PresentationRepository
  documentId: string
  revision: number
}

/** Draws one stored document's first slide at thumbnail size; the seam tests replace. */
export type SlideThumbnailRasterizer = (
  document: PresentationDocument,
  images: PresentationImageSources,
) => Promise<PresentationThumbnail>

/** Produces a thumbnail, or null when no honest one can be made. */
export type PresentationThumbnailSource = (
  request: PresentationThumbnailRequest,
) => Promise<PresentationThumbnail | null>

type ThumbnailEntry = {
  settled: boolean
  pending: Promise<PresentationThumbnail | null>
}

const cache = new Map<string, ThumbnailEntry>()

/** The cache key: a new revision is a different deck to draw. */
export function presentationThumbnailKey(documentId: string, revision: number): string {
  return `${documentId}:${revision}`
}

export function acquirePresentationThumbnail(
  request: PresentationThumbnailRequest,
  source: PresentationThumbnailSource = loadStoredSlideThumbnail,
): Promise<PresentationThumbnail | null> {
  const key = presentationThumbnailKey(request.documentId, request.revision)
  const cached = cache.get(key)
  if (cached) {
    // Re-inserting moves the entry to the young end of the Map's insertion order.
    cache.delete(key)
    cache.set(key, cached)
    return cached.pending
  }

  const entry: ThumbnailEntry = { settled: false, pending: Promise.resolve(null) }
  entry.pending = withRenderSlot(() => source(request))
    .then((thumbnail) => { entry.settled = true; return thumbnail })
    .catch(() => { entry.settled = true; return null })
    .then((thumbnail) => {
      // A failure is not worth remembering: it costs nothing to try again on the
      // next visit, while a cached null would keep a card on paper for the session.
      if (thumbnail === null && cache.get(key) === entry) cache.delete(key)
      return thumbnail
    })
  cache.set(key, entry)
  trimCache()
  return entry.pending
}

/**
 * Drops one deck's thumbnail, called when a card lets it go. A raster still being
 * drawn is left in place: its key usually remounts immediately (StrictMode, or
 * clearing the search) and dropping it would draw the same slide twice.
 */
export function releasePresentationThumbnail(key: string): void {
  if (cache.get(key)?.settled) cache.delete(key)
}

/**
 * Fetches, decodes and draws one stored presentation. Every failure — unreadable
 * row, missing or undecodable media, fonts that will not load, render error —
 * resolves to null so the caller keeps the paper preview.
 */
export async function loadStoredSlideThumbnail(
  request: PresentationThumbnailRequest,
  rasterize: SlideThumbnailRasterizer = rasterizeSlideThumbnail,
): Promise<PresentationThumbnail | null> {
  try {
    const document = await request.repository.getPresentation(request.documentId)
    const slide = document.slides[0]
    // An untouched slide is a flat page of its background colour. The paper preview
    // carries the deck's own title, so it stays for that case rather than showing a
    // blank card — and no artwork is decoded to find out.
    if (!slide || !slide.elements.some((element) => element.visible)) return null
    const artwork = await decodeSlideArtwork(request.repository, slide)
    try {
      // Text must be measured with the real faces, exactly as the editor does.
      await ensurePresentationFonts()
      return await rasterize(document, artwork.images)
    } finally {
      artwork.dispose()
    }
  } catch {
    return null
  }
}

/**
 * Draws the first slide into a data URL through the shared fixed-page rasterizer,
 * so the card shows exactly what the export path would render.
 */
export async function rasterizeSlideThumbnail(
  document: PresentationDocument,
  images: PresentationImageSources,
): Promise<PresentationThumbnail> {
  const slide = document.slides[0]
  if (!slide) throw new Error('A presentation needs a slide to draw')
  const raster = await rasterizeSlidePage({
    slide,
    pageSize: document.pageSize,
    images,
    width: PRESENTATION_THUMBNAIL_WIDTH,
    height: PRESENTATION_THUMBNAIL_HEIGHT,
    pixelRatio: 1,
  })
  return { url: raster.dataUrl }
}

/** Decodes only the artwork the first slide draws, and owns its disposal. */
async function decodeSlideArtwork(repository: PresentationRepository, slide: Slide) {
  const assetIds = new Set(
    slide.elements.flatMap((element) => (element.kind === 'image' && element.visible ? [element.assetId] : [])),
  )
  const records = await Promise.all([...assetIds].map((assetId) => repository.getMedia(assetId)))
  return decodeArtworkBatch(records)
}

let rendersInFlight = 0
const renderQueue: Array<() => void> = []

async function withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
  if (rendersInFlight >= PRESENTATION_THUMBNAIL_MAX_RENDERS) {
    // A finished task hands its slot straight to the next waiter, so the count
    // never dips and no two waiters can wake into the same freed slot.
    await new Promise<void>((resolve) => renderQueue.push(resolve))
  } else {
    rendersInFlight += 1
  }
  try {
    return await task()
  } finally {
    const next = renderQueue.shift()
    if (next) next()
    else rendersInFlight -= 1
  }
}

function trimCache(): void {
  while (cache.size > PRESENTATION_THUMBNAIL_CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) return
    cache.delete(oldest)
  }
}
