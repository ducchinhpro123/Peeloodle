import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PresentationRepositoryProvider } from '@/app/presentationRepository'
import { createMemoryPresentationRepository } from '@/lib/persistence/presentations/repository'
import { createImageElement, createPresentationDocument, createSlide } from '../model/factories'
import { createFixturePresentation, FIXTURE_IMAGE_ASSET_ID, fixtureImagePng } from '../model/fixtures/fixture'
import type { PresentationDocument } from '../model/types'
import { PresentationThumb } from './PresentationThumb'
import {
  PRESENTATION_THUMBNAIL_CACHE_SIZE,
  PRESENTATION_THUMBNAIL_MAX_RENDERS,
  acquirePresentationThumbnail,
  loadStoredSlideThumbnail,
  presentationThumbnailKey,
  releasePresentationThumbnail,
  type PresentationThumbnailRequest,
  type PresentationThumbnailSource,
  type SlideThumbnailRasterizer,
} from './presentationThumbnails'

/**
 * P20 slice 2: the thumbnail cache, the decode/disposal path and the card's
 * fallback. jsdom cannot rasterize (Konva needs a canvas), so the renderer is
 * replaced through the module's seams and never asserted here.
 */

/** A source that hands out a new URL per call, so a cache hit is visible. */
function countingSource() {
  let calls = 0
  const source: PresentationThumbnailSource = async () => ({ url: `data:image/png;base64,render-${calls++}` })
  return { source, calls: () => calls }
}

function request(overrides: Partial<PresentationThumbnailRequest>): PresentationThumbnailRequest {
  return { repository: createMemoryPresentationRepository(), documentId: 'deck', revision: 0, ...overrides }
}

/** Counts the bitmaps a decode path closes, and fails the decode itself. */
function trackDecoder({ fail = false } = {}) {
  const closes: ReturnType<typeof vi.fn>[] = []
  globalThis.createImageBitmap = (async () => {
    if (fail) throw new Error('unsupported image')
    const close = vi.fn()
    closes.push(close)
    return { width: 256, height: 256, close } as unknown as ImageBitmap
  }) as typeof createImageBitmap
  return closes
}

/** The fixture's first slide draws one stored image; the second slide draws none. */
async function savedFixture() {
  const repository = createMemoryPresentationRepository()
  const document = createFixturePresentation()
  await repository.savePresentation(document, [
    { assetId: FIXTURE_IMAGE_ASSET_ID, bytes: fixtureImagePng(), mimeType: 'image/png' },
  ])
  return { repository, document }
}

beforeEach(() => {
  trackDecoder()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  ControlledObserver.instances = []
  // jsdom has no IntersectionObserver; the lazy test installs the stub above.
  Reflect.deleteProperty(globalThis, 'IntersectionObserver')
})

describe('presentation thumbnail cache', () => {
  it('draws again for a new revision instead of serving the previous pixels', async () => {
    const { source, calls } = countingSource()
    const documentId = 'revision-key'

    const first = await acquirePresentationThumbnail(request({ documentId, revision: 0 }), source)
    expect(calls()).toBe(1)

    // Same deck, same revision: the raster is reused, not drawn twice.
    const again = await acquirePresentationThumbnail(request({ documentId, revision: 1 - 1 }), source)
    expect(calls()).toBe(1)
    expect(again).toEqual(first)

    // A saved change (a rename, new artwork) is a new revision and must be redrawn.
    const second = await acquirePresentationThumbnail(request({ documentId, revision: 1 }), source)
    expect(calls()).toBe(2)
    expect(second?.url).not.toBe(first?.url)

    expect(await acquirePresentationThumbnail(request({ documentId, revision: 0 }), source)).toEqual(first)
    expect(calls()).toBe(2)
  })

  it('keeps the cache bounded and drops the least recently used deck', async () => {
    const { source, calls } = countingSource()
    const filled = PRESENTATION_THUMBNAIL_CACHE_SIZE + 6

    for (let index = 0; index < filled; index += 1) {
      await acquirePresentationThumbnail(request({ documentId: `lru-${index}` }), source)
    }
    expect(calls()).toBe(filled)

    // The oldest entry fell out of the cache, so it is drawn again…
    await acquirePresentationThumbnail(request({ documentId: 'lru-0' }), source)
    expect(calls()).toBe(filled + 1)
    // …while the newest one is still there.
    await acquirePresentationThumbnail(request({ documentId: `lru-${filled - 1}` }), source)
    expect(calls()).toBe(filled + 1)
  })

  it('draws at most two slides at once', async () => {
    let inFlight = 0
    let peak = 0
    const source: PresentationThumbnailSource = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return { url: 'data:image/png;base64,parallel' }
    }

    const cards = ['busy-0', 'busy-1', 'busy-2', 'busy-3', 'busy-4']
    const pending = cards.map((documentId) => acquirePresentationThumbnail(request({ documentId }), source))
    await Promise.all(pending)

    expect(peak).toBe(PRESENTATION_THUMBNAIL_MAX_RENDERS)

    // A second wave still runs: a queued waiter cannot leak a slot by waking
    // into one another waiter already took.
    const nextWave = await Promise.all(
      cards.map((documentId) => acquirePresentationThumbnail(request({ documentId: `${documentId}-again` }), source)),
    )
    expect(nextWave.every(Boolean)).toBe(true)
  })

  it('drops a finished thumbnail when the card releases it', async () => {
    const { source, calls } = countingSource()
    const documentId = 'release-me'

    expect(await acquirePresentationThumbnail(request({ documentId }), source)).not.toBeNull()
    releasePresentationThumbnail(presentationThumbnailKey(documentId, 0))
    expect(await acquirePresentationThumbnail(request({ documentId }), source)).not.toBeNull()
    expect(calls()).toBe(2)
  })

  it('keeps the paper fallback and retries when a render fails', async () => {
    let attempts = 0
    const flaky: PresentationThumbnailSource = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('render failed')
      return { url: 'data:image/png;base64,second-try' }
    }

    expect(await acquirePresentationThumbnail(request({ documentId: 'flaky' }), flaky)).toBeNull()
    // The failure is not cached: the card is not stuck on paper for the session.
    expect(await acquirePresentationThumbnail(request({ documentId: 'flaky' }), flaky)).not.toBeNull()
    expect(attempts).toBe(2)
  })
})

describe('stored slide thumbnails', () => {
  it('decodes the first slide artwork and closes it once the raster exists', async () => {
    const closes = trackDecoder()
    const { repository, document } = await savedFixture()
    const rasterize: SlideThumbnailRasterizer = async (_document, images) => ({ url: `data:image/png;base64,${images.size}-frame` })

    const thumbnail = await loadStoredSlideThumbnail({ repository, documentId: document.id, revision: 0 }, rasterize)

    expect(thumbnail).toEqual({ url: 'data:image/png;base64,1-frame' })
    expect(closes).toHaveLength(1)
    expect(closes[0]).toHaveBeenCalledTimes(1)
  })

  it('closes the bitmaps it decoded when the raster fails, and keeps the fallback', async () => {
    const closes = trackDecoder()
    const { repository, document } = await savedFixture()
    const rasterize: SlideThumbnailRasterizer = async () => { throw new Error('no canvas') }

    expect(await loadStoredSlideThumbnail({ repository, documentId: document.id, revision: 0 }, rasterize)).toBeNull()
    expect(closes).toHaveLength(1)
    expect(closes[0]).toHaveBeenCalledTimes(1)
  })

  it('keeps the fallback instead of throwing when stored media cannot be read', async () => {
    const { repository, document } = await savedFixture()
    vi.spyOn(repository, 'getMedia').mockRejectedValue(new Error('media is missing'))
    const rasterize = vi.fn<SlideThumbnailRasterizer>(async () => ({ url: 'data:image/png;base64,never' }))

    expect(await loadStoredSlideThumbnail({ repository, documentId: document.id, revision: 0 }, rasterize)).toBeNull()
    expect(rasterize).not.toHaveBeenCalled()
  })

  it('decodes only the artwork of the slide it draws', async () => {
    const { repository, document } = await savedFixture()
    const secondAssetId = 'fixture-asset-second-slide'
    const withSecondSlideAsset: PresentationDocument = {
      ...document,
      id: 'first-slide-only',
      slides: [
        document.slides[0]!,
        {
          ...document.slides[1]!,
          elements: [...document.slides[1]!.elements, createImageElement({ assetId: secondAssetId })],
        },
      ],
      assets: [...document.assets, { ...document.assets[0]!, id: secondAssetId }],
    }
    await repository.savePresentation(withSecondSlideAsset, [
      { assetId: secondAssetId, bytes: fixtureImagePng(), mimeType: 'image/png' },
    ])
    const getMedia = vi.spyOn(repository, 'getMedia')
    const rasterize: SlideThumbnailRasterizer = async (_document, images) => ({ url: `data:image/png;base64,${images.size}-frame` })

    const thumbnail = await loadStoredSlideThumbnail({ repository, documentId: document.id, revision: 0 }, rasterize)

    expect(thumbnail).toEqual({ url: 'data:image/png;base64,1-frame' })
    expect(getMedia).toHaveBeenCalledTimes(1)
    expect(getMedia).toHaveBeenCalledWith(FIXTURE_IMAGE_ASSET_ID)
  })

  it('keeps the paper preview for a slide with nothing on it', async () => {
    const repository = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'blank-deck' })
    await repository.savePresentation(document)
    const getMedia = vi.spyOn(repository, 'getMedia')
    const rasterize = vi.fn<SlideThumbnailRasterizer>(async () => ({ url: 'data:image/png;base64,never' }))

    expect(await loadStoredSlideThumbnail({ repository, documentId: 'blank-deck', revision: 0 }, rasterize)).toBeNull()
    expect(rasterize).not.toHaveBeenCalled()
    expect(getMedia).not.toHaveBeenCalled()
  })

  it('draws nothing for a document that has no slide', async () => {
    const repository = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'empty-deck' })
    await repository.savePresentation({ ...document, slides: [{ ...createSlide(), elements: [] }] })
    vi.spyOn(repository, 'getPresentation').mockResolvedValue({ ...document, slides: [] })
    const rasterize = vi.fn<SlideThumbnailRasterizer>(async () => ({ url: 'data:image/png;base64,never' }))

    expect(await loadStoredSlideThumbnail({ repository, documentId: 'empty-deck', revision: 0 }, rasterize)).toBeNull()
    expect(rasterize).not.toHaveBeenCalled()
  })
})

class ControlledObserver {
  static instances: ControlledObserver[] = []
  disconnected = false
  private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void

  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    this.callback = callback
    ControlledObserver.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true }
  scrollIntoView() { this.callback([{ isIntersecting: true }]) }
}

/** The card preview as the library renders it: paper, then the real render on top. */
function renderCard(source?: PresentationThumbnailSource) {
  return render(
    <PresentationRepositoryProvider repository={createMemoryPresentationRepository()}>
      <span className="presentation-card-preview" aria-hidden="true">
        <span className="presentation-card-paper"><b>Deck one</b></span>
        <PresentationThumb documentId="card-deck" revision={0} source={source} />
      </span>
    </PresentationRepositoryProvider>,
  )
}

describe('the card thumbnail', () => {
  it('waits until the card is near the viewport before drawing', async () => {
    globalThis.IntersectionObserver = ControlledObserver as unknown as typeof IntersectionObserver
    const source = vi.fn<PresentationThumbnailSource>(async () => ({ url: 'data:image/png;base64,render' }))
    renderCard(source)

    await waitFor(() => expect(ControlledObserver.instances).toHaveLength(1))
    expect(source).not.toHaveBeenCalled()

    act(() => ControlledObserver.instances[0]!.scrollIntoView())
    expect(await screen.findByTestId('presentation-card-thumb')).toHaveAttribute('src', 'data:image/png;base64,render')
    expect(ControlledObserver.instances[0]!.disconnected).toBe(true)
  })

  it('shows the render as decoration over the paper preview', async () => {
    renderCard(async () => ({ url: 'data:image/png;base64,render' }))

    const image = await screen.findByTestId('presentation-card-thumb')
    expect(image).toHaveAttribute('width', '480')
    expect(image).toHaveAttribute('height', '270')
    // Decorative only: no accessible name competes with the card's link text.
    expect(image).toHaveAttribute('alt', '')
    expect(screen.getByText('Deck one')).toBeInTheDocument()
  })

  it('keeps the paper preview and draws no image when the render fails', async () => {
    const source = vi.fn<PresentationThumbnailSource>(async () => null)
    renderCard(source)

    await waitFor(() => expect(source).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('presentation-card-thumb')).not.toBeInTheDocument()
    expect(screen.getByText('Deck one')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('draws again when the card is unmounted and shown once more', async () => {
    const { source, calls } = countingSource()
    const first = renderCard(source)
    expect(await screen.findByTestId('presentation-card-thumb')).toBeInTheDocument()
    first.unmount()

    renderCard(source)
    await waitFor(() => expect(calls()).toBe(2))
  })
})
