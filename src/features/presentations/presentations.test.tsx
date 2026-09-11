import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { App } from '../../main'
import { createMemoryRepository } from '../../lib/persistence/repository'
import { createMemoryPresentationRepository } from '../../lib/persistence/presentations/repository'
import { createPresentationDocument } from './model/factories'
import { createFixturePresentation, FIXTURE_ID, FIXTURE_IMAGE_ASSET_ID, fixtureImagePng } from './model/fixtures/fixture'
import { usePresentationStore } from './editor/store'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverStub
  globalThis.createImageBitmap = async () => ({ width: 64, height: 64, close() {} }) as ImageBitmap
})

afterEach(() => {
  cleanup()
  usePresentationStore.getState().closeDocument()
})

function renderPresentations(path: string, presentationRepository = createMemoryPresentationRepository(), { strict = false } = {}) {
  const app = (
    <MemoryRouter initialEntries={[path]}>
      <App repository={createMemoryRepository()} presentationRepository={presentationRepository} />
    </MemoryRouter>
  )
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app)
  return { repository: presentationRepository, unmount: view.unmount }
}

function trackDecodedBitmaps() {
  const closes: ReturnType<typeof vi.fn>[] = []
  globalThis.createImageBitmap = (async () => {
    const close = vi.fn()
    closes.push(close)
    return { width: 256, height: 256, close } as unknown as ImageBitmap
  }) as typeof createImageBitmap
  return closes
}

async function saveFixture( repository = createMemoryPresentationRepository()) {
  const document = createFixturePresentation()
  await repository.savePresentation(document, [{ assetId: FIXTURE_IMAGE_ASSET_ID, bytes: fixtureImagePng(), mimeType: 'image/png' }])
  return document
}

describe('presentation routes', () => {
  it('creates a blank presentation, returns to the library, and reopens real local state', async () => {
    const { repository } = renderPresentations('/presentations')
    expect(await screen.findByRole('heading', { name: 'No presentations yet' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    expect(await screen.findByRole('heading', { name: 'Untitled presentation' })).toBeInTheDocument()
    expect(screen.getByTestId('presentation-canvas')).toHaveAttribute('data-document-width', '1280')
    expect(screen.getByTestId('presentation-canvas')).toHaveAttribute('data-document-height', '720')

    const saved = await repository.listPresentations()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ title: 'Untitled presentation', slideCount: 1 })

    fireEvent.click(screen.getByRole('link', { name: 'Back to presentations' }))
    const reopen = await screen.findByRole('link', { name: 'Open Untitled presentation' })
    fireEvent.click(reopen)
    expect(await screen.findByRole('heading', { name: 'Untitled presentation' })).toBeInTheDocument()
    expect(usePresentationStore.getState().document?.id).toBe(saved[0]!.id)
  })

  it('keeps long titles readable in the library and editor', async () => {
    const repository = createMemoryPresentationRepository()
    const title = 'A very long Vietnamese research presentation title that must wrap without hiding the saved work'
    await repository.savePresentation(createPresentationDocument({ id: 'long-title', title }))
    renderPresentations('/presentations', repository)

    const card = await screen.findByRole('link', { name: `Open ${title}` })
    expect(card).toHaveTextContent(title)
    fireEvent.click(card)
    expect(await screen.findByRole('heading', { name: title })).toHaveAttribute('title', title)
  })

  it('shows a recoverable missing presentation state', async () => {
    renderPresentations('/presentations/missing')
    expect(await screen.findByRole('heading', { name: 'Presentation not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to presentations' })).toBeInTheDocument()
  })

  it('shows a recoverable unsupported presentation state', async () => {
    const repository = createMemoryPresentationRepository()
    repository.seedRawDocument('future', { ...createPresentationDocument({ id: 'future' }), schemaVersion: 99 })
    renderPresentations('/presentations/future', repository)
    expect(await screen.findByRole('heading', { name: 'This presentation needs a newer StickerLab' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to presentations' })).toBeInTheDocument()
  })

  it('reports a failed blank creation without leaving the library', async () => {
    const repository = createMemoryPresentationRepository()
    repository.injectWriteFailure()
    renderPresentations('/presentations', repository)
    fireEvent.click(await screen.findByRole('button', { name: 'Create your first presentation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not create a presentation/)
    expect(await repository.listPresentations()).toEqual([])
  })

  it('changes zoom and pan without changing the presentation document', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'view-only', title: 'View only transforms' }))
    renderPresentations('/presentations/view-only', repository)
    await screen.findByRole('heading', { name: 'View only transforms' })
    const before = structuredClone(usePresentationStore.getState().document)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    act(() => { usePresentationStore.getState().setPan({ x: 24, y: -12 }) })

    await waitFor(() => expect(screen.getByLabelText('Canvas zoom')).toHaveTextContent('125%'))
    expect(screen.getByTestId('presentation-canvas')).toHaveAttribute('data-view-pan-x', '24')
    expect(usePresentationStore.getState().document).toEqual(before)
    expect(usePresentationStore.getState().dirty).toBe(false)
  })

  it('clamps the shared zoom range so every control agrees', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'zoom-range', title: 'Zoom range' }))
    renderPresentations('/presentations/zoom-range', repository)
    await screen.findByRole('heading', { name: 'Zoom range' })

    for (let step = 0; step < 20; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(usePresentationStore.getState().view.zoom).toBe(4)
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()

    for (let step = 0; step < 30; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(usePresentationStore.getState().view.zoom).toBe(0.25)
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  })

  it('reports missing artwork without claiming the presentation was deleted', async () => {
    const repository = createMemoryPresentationRepository()
    repository.seedRawDocument(FIXTURE_ID, createFixturePresentation())
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)

    expect(await screen.findByRole('heading', { name: 'Presentation artwork is missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to presentations' })).toBeInTheDocument()
    expect(screen.queryByTestId('presentation-canvas')).not.toBeInTheDocument()
  })

  it('renders the referenced slide from the rail without dirtying the document', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    const first = screen.getByRole('button', { name: 'Show slide 1: Title slide' })
    const second = screen.getByRole('button', { name: 'Show slide 2: Bullets slide' })
    expect(first).toHaveAttribute('aria-current', 'true')

    fireEvent.click(second)

    expect(second).toHaveAttribute('aria-current', 'true')
    expect(usePresentationStore.getState().view.activeSlideId).toBe('fixture-slide-2')
    expect(usePresentationStore.getState().dirty).toBe(false)
  })

  it('releases decoded artwork when the editor closes', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    const closes = trackDecodedBitmaps()

    const { unmount } = renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })
    expect(closes).toHaveLength(1)
    expect(closes[0]).not.toHaveBeenCalled()

    unmount()

    await waitFor(() => expect(closes[0]).toHaveBeenCalledTimes(1))
  })

  it('disposes the media decoded by an abandoned StrictMode mount', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    const closes = trackDecodedBitmaps()

    renderPresentations(`/presentations/${FIXTURE_ID}`, repository, { strict: true })
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    await waitFor(() => expect(closes).toHaveLength(2))
    expect(closes[0]).toHaveBeenCalledTimes(1)
    expect(closes[1]).not.toHaveBeenCalled()
    expect(usePresentationStore.getState().document?.id).toBe(FIXTURE_ID)
  })
})
