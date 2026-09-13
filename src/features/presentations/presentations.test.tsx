import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { App } from '../../main'
import { createMemoryRepository, createProjectDocument } from '../../lib/persistence/repository'
import { MemoryPresentationRepository, createMemoryPresentationRepository, type PresentationMediaRecord, type SavePresentationOptions } from '../../lib/persistence/presentations/repository'
import type { PresentationDocument } from './model/types'
import { createPresentationDocument, createTextElement } from './model/factories'
import { PRESENTATION_LIMITS } from './model/limits'
import { createFixturePresentation, FIXTURE_ID, FIXTURE_IMAGE_ASSET_ID, FIXTURE_IMAGE_BYTE_LENGTH, FIXTURE_IMAGE_SHA256, fixtureImagePng } from './model/fixtures/fixture'
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

function photoFile(name = 'photo.png', bytes: Uint8Array = fixtureImagePng()): File {
  return new File([bytes], name, { type: 'image/png' })
}

/** Opens a fresh blank presentation and returns the editor's image input. */
async function openBlankEditor(repository = createMemoryPresentationRepository()) {
  const view = renderPresentations('/presentations', repository)
  await screen.findByRole('heading', { name: 'No presentations yet' })
  fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
  await screen.findByRole('heading', { name: 'Untitled presentation' })
  return { repository, input: screen.getByTestId('presentation-image-input'), unmount: view.unmount }
}

function editorElements() {
  return usePresentationStore.getState().document!.slides[0]!.elements
}

/** A write that can be held open, so "not yet committed" is observable. */
class GatedPresentationRepository extends MemoryPresentationRepository {
  /** Off by default, so creating or seeding a presentation cannot hang. */
  hold = false
  private releaseWrite: (() => void) | null = null
  private writeEntered: (() => void) | null = null
  private gate: Promise<void> = new Promise((resolve) => { this.releaseWrite = resolve })
  /** Resolves as soon as a held write has been entered. */
  readonly entered: Promise<void> = new Promise((resolve) => { this.writeEntered = resolve })

  override async savePresentation(document: PresentationDocument, media: PresentationMediaRecord[] = [], options: SavePresentationOptions = {}): Promise<void> {
    if (this.hold) {
      this.writeEntered?.()
      await this.gate
    }
    return super.savePresentation(document, media, options)
  }

  release(): void {
    this.releaseWrite?.()
  }
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

  it('filters saved presentations by title and recovers from no results', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'biology', title: 'Biology field notes' }))
    await repository.savePresentation(createPresentationDocument({ id: 'history', title: 'History of Hà Nội' }))
    renderPresentations('/presentations', repository)

    expect(await screen.findByRole('link', { name: 'Open Biology field notes' })).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Search presentations' })
    fireEvent.change(search, { target: { value: 'hà nội' } })

    expect(screen.queryByRole('link', { name: 'Open Biology field notes' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open History of Hà Nội' })).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'astronomy' } })
    expect(screen.getByRole('heading', { name: 'No presentation found' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('link', { name: 'Open Biology field notes' })).toBeInTheDocument()
    expect(search).toHaveValue('')
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

  it('adds and duplicates the active slide, reuses media, and autosaves the new order', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    const source = usePresentationStore.getState().document!.slides[0]!
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate active slide' }))

    const afterDuplicate = usePresentationStore.getState().document!
    const duplicate = afterDuplicate.slides.find((slide) => slide.id === usePresentationStore.getState().view.activeSlideId)!
    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.elements.map((element) => element.id)).not.toEqual(source.elements.map((element) => element.id))
    expect(duplicate.elements.find((element) => element.kind === 'image')).toMatchObject({ assetId: FIXTURE_IMAGE_ASSET_ID })
    expect(usePresentationStore.getState().view.activeSlideId).toBe(duplicate.id)

    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    const afterAdd = usePresentationStore.getState()
    const addedId = afterAdd.view.activeSlideId!
    expect(afterAdd.document!.slides).toHaveLength(4)
    expect(afterAdd.document!.slides.find((slide) => slide.id === addedId)?.elements).toEqual([])
    expect(screen.getByRole('button', { name: /Show slide 3:/ })).toHaveAttribute('aria-current', 'true')

    await waitFor(async () => {
      const stored = await repository.getPresentation(FIXTURE_ID)
      expect(stored.slides.map((slide) => slide.id)).toEqual(afterAdd.document!.slides.map((slide) => slide.id))
    })
    expect(await repository.hasMedia(FIXTURE_IMAGE_ASSET_ID)).toBe(true)
    expect(Array.from((await repository.getMedia(FIXTURE_IMAGE_ASSET_ID)).bytes)).toEqual(Array.from(fixtureImagePng()))
  })

  it('reorders and deletes through explicit buttons, preserves a survivor, and restores focus', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    fireEvent.click(screen.getByRole('button', { name: 'Move slide 2 up' }))
    expect(usePresentationStore.getState().document!.slides.map((slide) => slide.id)).toEqual(['fixture-slide-2', 'fixture-slide-1'])
    await waitFor(async () => {
      const stored = await repository.getPresentation(FIXTURE_ID)
      expect(stored.slides.map((slide) => slide.id)).toEqual(['fixture-slide-2', 'fixture-slide-1'])
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show slide 1: Bullets slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete slide 1' }))

    await waitFor(() => {
      expect(usePresentationStore.getState().document!.slides.map((slide) => slide.id)).toEqual(['fixture-slide-1'])
      expect(usePresentationStore.getState().view.activeSlideId).toBe('fixture-slide-1')
      expect(screen.getByRole('button', { name: 'Show slide 1: Title slide' })).toHaveFocus()
    })
    expect(screen.getByRole('button', { name: 'Move slide 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move slide 1 down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete slide 1' })).toBeDisabled()
    await waitFor(async () => {
      const stored = await repository.getPresentation(FIXTURE_ID)
      expect(stored.slides.map((slide) => slide.id)).toEqual(['fixture-slide-1'])
    })
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

  it('edits a text box through the DOM bridge with one history entry and no position change', async () => {
    const repository = createMemoryPresentationRepository()
    renderPresentations('/presentations', repository)
    await screen.findByRole('heading', { name: 'No presentations yet' })
    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    await screen.findByRole('heading', { name: 'Untitled presentation' })

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    const inserted = usePresentationStore.getState().document!.slides[0]!.elements[0]!
    const placement = { x: inserted.x, y: inserted.y, width: inserted.width, height: inserted.height }

    field.innerHTML = '<p>Xin chào Việt Nam</p>'
    fireEvent.input(field)
    field.innerHTML = '<p>Xin chào Việt Nam và các bạn</p>'
    fireEvent.input(field)
    // addElement plus one grouped text session, not one entry per keystroke.
    expect(usePresentationStore.getState().past).toHaveLength(2)

    fireEvent.blur(field)

    const edited = usePresentationStore.getState().document!.slides[0]!.elements[0]!
    expect(edited.kind).toBe('text')
    if (edited.kind !== 'text') throw new Error('expected a text element')
    expect(edited.paragraphs[0]!.runs[0]!.text).toBe('Xin chào Việt Nam và các bạn')
    expect({ x: edited.x, y: edited.y, width: edited.width, height: edited.height }).toEqual(placement)
    expect(usePresentationStore.getState().past).toHaveLength(2)
    expect(usePresentationStore.getState().lastHistoryGroup).toBeNull()
    expect(usePresentationStore.getState().dirty).toBe(true)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Text content' })).not.toBeInTheDocument()
  })

  it('commits once per IME composition instead of per keystroke', async () => {
    renderPresentations('/presentations')
    await screen.findByRole('heading', { name: 'No presentations yet' })
    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    await screen.findByRole('heading', { name: 'Untitled presentation' })
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    const history = usePresentationStore.getState().past.length

    fireEvent.compositionStart(field)
    field.innerHTML = '<p>Kết quả</p>'
    fireEvent.input(field)
    expect(usePresentationStore.getState().past).toHaveLength(history)
    expect(usePresentationStore.getState().document!.slides[0]!.elements[0]!).toMatchObject({ kind: 'text', paragraphs: [{ runs: [] }] })

    fireEvent.compositionEnd(field)
    const element = usePresentationStore.getState().document!.slides[0]!.elements[0]!
    if (element.kind !== 'text') throw new Error('expected a text element')
    expect(element.paragraphs[0]!.runs[0]!.text).toBe('Kết quả')
    expect(usePresentationStore.getState().past).toHaveLength(history + 1)
  })

  it('keeps pasted markup out of the document', async () => {
    renderPresentations('/presentations')
    await screen.findByRole('heading', { name: 'No presentations yet' })
    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    await screen.findByRole('heading', { name: 'Untitled presentation' })
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })

    fireEvent.paste(field, {
      clipboardData: {
        getData: (type: string) => (type === 'text/html'
          ? '<p><b>Bold</b> <a href="javascript:alert(1)">link</a> <script>alert(2)</script></p>'
          : 'Bold link'),
      },
    })

    const element = usePresentationStore.getState().document!.slides[0]!.elements[0]!
    if (element.kind !== 'text') throw new Error('expected a text element')
    const pasted = element.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('')
    expect(pasted).toContain('Bold')
    expect(pasted).not.toContain('javascript')
    expect(pasted).not.toContain('alert')
    expect(element.paragraphs.every((paragraph) => paragraph.runs.every((run) => run.link === undefined))).toBe(true)
    expect(field.querySelector('script')).toBeNull()
  })

  it('edits an existing rich text element and keeps its run styling and geometry', async () => {    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    act(() => { usePresentationStore.getState().selectElements(['fixture-text-title']) })
    fireEvent.click(screen.getByRole('button', { name: 'Edit text: Title' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    expect(field.textContent).toContain('Nghiên cứu và trình bày')

    // Simulate typing in place: the seeded span (including its run attributes) stays.
    field.innerHTML = field.innerHTML.replace('Nghiên cứu và trình bày', 'Bài học mới')
    fireEvent.input(field)
    fireEvent.blur(field)

    const edited = usePresentationStore.getState().document!.slides[0]!.elements.find((element) => element.id === 'fixture-text-title')!
    if (edited.kind !== 'text') throw new Error('expected a text element')
    expect(edited.paragraphs[0]).toMatchObject({ alignment: 'center', bullet: 'none' })
    expect(edited.paragraphs[0]!.runs[0]).toMatchObject({ text: 'Bài học mới', fontId: 'spectral', size: 72, color: '#ffffff', bold: true })
    expect({ x: edited.x, y: edited.y, width: edited.width, height: edited.height }).toEqual({ x: 80, y: 96, width: 1120, height: 240 })
  })

  it('closes a text session without typing without touching history or the document', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })
    act(() => { usePresentationStore.getState().selectElements(['fixture-text-title']) })
    const history = usePresentationStore.getState().past.length
    const revision = usePresentationStore.getState().document!.revision

    fireEvent.click(screen.getByRole('button', { name: 'Edit text: Title' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    fireEvent.blur(field)

    const after = usePresentationStore.getState()
    expect(after.past).toHaveLength(history)
    expect(after.document!.revision).toBe(revision)
    expect(after.dirty).toBe(false)
    expect(after.view.editingElementId).toBeNull()
  })

  it('styles text typed into a new box with the document theme', async () => {
    const repository = createMemoryPresentationRepository()
    const document = createPresentationDocument({ id: 'themed', title: 'Themed' })
    document.theme = { ...document.theme, bodyFontId: 'spectral', colors: { ...document.theme.colors, text: '#123456' } }
    await repository.savePresentation(document)
    renderPresentations('/presentations/themed', repository)
    await screen.findByRole('heading', { name: 'Themed' })

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    field.innerHTML = '<p>Thème mới</p>'
    fireEvent.input(field)
    fireEvent.blur(field)

    const element = usePresentationStore.getState().document!.slides[0]!.elements[0]!
    if (element.kind !== 'text') throw new Error('expected a text element')
    expect(element.paragraphs[0]!.runs[0]).toMatchObject({ text: 'Thème mới', fontId: 'spectral', color: '#123456' })
  })

  it('keeps pasted line breaks and strips their markup', async () => {
    renderPresentations('/presentations')
    await screen.findByRole('heading', { name: 'No presentations yet' })
    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    await screen.findByRole('heading', { name: 'Untitled presentation' })
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })

    // A selection left over from elsewhere must not swallow the paste.
    const stale = document.createElement('div')
    stale.textContent = 'stale selection'
    document.body.appendChild(stale)
    const staleRange = document.createRange()
    staleRange.selectNodeContents(stale)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(staleRange)
    document.body.removeChild(stale)

    fireEvent.paste(field, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? 'Dòng một\nDòng hai' : ''),
      },
    })

    const element = usePresentationStore.getState().document!.slides[0]!.elements[0]!
    if (element.kind !== 'text') throw new Error('expected a text element')
    const pasted = element.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('')
    expect(pasted).toBe('Dòng một\nDòng hai')
  })

  it('keeps the session recoverable when the document rejects the text', async () => {
    renderPresentations('/presentations')
    await screen.findByRole('heading', { name: 'No presentations yet' })
    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    await screen.findByRole('heading', { name: 'Untitled presentation' })
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })

    field.innerHTML = `<p>${'a'.repeat(20_100)}</p>`
    fireEvent.input(field)

    // The limit rejects the command, but the session stays open and says so.
    expect(await screen.findByRole('alert')).toHaveTextContent(/too long/i)
    expect(usePresentationStore.getState().view.editingElementId).not.toBeNull()
    expect(usePresentationStore.getState().document!.slides[0]!.elements[0]!).toMatchObject({ kind: 'text', paragraphs: [{ runs: [] }] })

    fireEvent.blur(field)
    expect(usePresentationStore.getState().view.editingElementId).toBeNull()
    expect(usePresentationStore.getState().past).toHaveLength(1)
  })
})

describe('presentation image insertion', () => {
  it('commits the document and its bytes together when a photo is inserted', async () => {
    const { repository, input } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id
    const assetId = `asset-${FIXTURE_IMAGE_SHA256}`

    fireEvent.change(input, { target: { files: [photoFile()] } })

    await waitFor(() => expect(editorElements()).toHaveLength(1))
    expect(editorElements()[0]!).toMatchObject({
      kind: 'image',
      assetId,
      name: 'Image',
      alt: 'photo.png',
      // The stubbed decode reports 64×64, so the photo keeps its own size, centred.
      x: 608,
      y: 328,
      width: 64,
      height: 64,
    })

    // Read the stored rows back: the insert is reported as added only once both the
    // document and its artwork are committed, so nothing is left for a later save.
    const stored = await repository.getPresentation(presentationId)
    expect(stored.assets).toMatchObject([{ id: assetId, sha256: FIXTURE_IMAGE_SHA256, width: 64, height: 64 }])
    expect(stored.slides[0]!.elements[0]!).toMatchObject({ kind: 'image', assetId })
    expect(Array.from((await repository.getMedia(assetId)).bytes)).toEqual(Array.from(fixtureImagePng()))
    expect(usePresentationStore.getState().mediaForSave()).toHaveLength(0)
    expect(usePresentationStore.getState().dirty).toBe(false)
    expect(screen.getByText('Saved locally')).toBeInTheDocument()
  })

  it('reports an image as added only after the write completes', async () => {
    const repository = new GatedPresentationRepository()
    const { input } = await openBlankEditor(repository)
    const presentationId = usePresentationStore.getState().document!.id
    const assetId = `asset-${FIXTURE_IMAGE_SHA256}`

    repository.hold = true
    fireEvent.change(input, { target: { files: [photoFile()] } })
    await act(async () => { await repository.entered })

    // The write is in flight: nothing is on the slide, nothing is stored, and no
    // success is shown for an insert that has not committed.
    expect(editorElements()).toHaveLength(0)
    expect((await repository.getPresentation(presentationId)).assets).toEqual([])
    expect(await repository.hasMedia(assetId)).toBe(false)
    expect(screen.queryByText('Saved locally')).not.toBeInTheDocument()

    repository.release()

    await waitFor(() => expect(editorElements()).toHaveLength(1))
    expect((await repository.getPresentation(presentationId)).assets).toMatchObject([{ id: assetId }])
    expect(Array.from((await repository.getMedia(assetId)).bytes)).toEqual(Array.from(fixtureImagePng()))
  })

  it('leaves no element, asset, or media behind when a file is refused', async () => {
    const { input } = await openBlankEditor()

    fireEvent.change(input, { target: { files: [new File([new Uint8Array([0x42, 0x4d, 0x00, 0x00])], 'scan.bmp', { type: 'image/bmp' })] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/PNG, JPEG, or static WebP/)
    expect(editorElements()).toHaveLength(0)
    expect(usePresentationStore.getState().document!.assets).toHaveLength(0)
    expect(usePresentationStore.getState().pendingMedia).toHaveLength(0)
    expect(usePresentationStore.getState().dirty).toBe(false)

    // The refusal keeps the upload boundary's specific reason.
    fireEvent.change(input, { target: { files: [new File([fixtureImagePng()], 'logo.svg', { type: 'image/svg+xml' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/SVG uploads are not supported/)
    expect(editorElements()).toHaveLength(0)
    expect(usePresentationStore.getState().document!.assets).toHaveLength(0)
  })

  it('reuses one asset record when the same photo is inserted twice', async () => {
    const { repository, input } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id

    fireEvent.change(input, { target: { files: [photoFile()] } })
    await waitFor(() => expect(editorElements()).toHaveLength(1))
    fireEvent.change(input, { target: { files: [photoFile('photo-again.png')] } })
    await waitFor(() => expect(editorElements()).toHaveLength(2))

    expect(usePresentationStore.getState().document!.assets).toHaveLength(1)
    // Both insertions are already stored, so nothing is held for a later save.
    expect(usePresentationStore.getState().mediaForSave()).toHaveLength(0)
    // One history entry per insertion.
    expect(usePresentationStore.getState().past).toHaveLength(2)
    expect(editorElements().map((element) => element.name)).toEqual(['Image', 'Image 2'])
    const stored = await repository.getPresentation(presentationId)
    expect(stored.slides[0]!.elements).toHaveLength(2)
    expect(stored.assets).toHaveLength(1)
  })

  it('releases the decoded source it replaces when an asset is inserted again', async () => {
    const { input } = await openBlankEditor()
    const closes = trackDecodedBitmaps()
    // validateUpload closes its own probe bitmap, so anything still open belongs to
    // the editor's decoded media map.
    const liveBitmaps = () => closes.filter((close) => close.mock.calls.length === 0)

    fireEvent.change(input, { target: { files: [photoFile()] } })
    await waitFor(() => expect(editorElements()).toHaveLength(1))
    expect(liveBitmaps()).toHaveLength(1)

    fireEvent.change(input, { target: { files: [photoFile('photo-again.png')] } })
    await waitFor(() => expect(editorElements()).toHaveLength(2))

    // The replaced source was disposed immediately rather than at document close.
    expect(liveBitmaps()).toHaveLength(1)
    expect(closes.at(-1)).not.toHaveBeenCalled()
  })

  it('says a full slide is full instead of silently refusing the image', async () => {
    const { repository, input } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id
    act(() => {
      const store = usePresentationStore.getState()
      for (let index = 0; index < PRESENTATION_LIMITS.maxElementsPerSlide; index += 1) {
        store.addElement(createTextElement({ id: `filler-${index}`, name: `Filler ${index}` }))
      }
    })
    expect(editorElements()).toHaveLength(PRESENTATION_LIMITS.maxElementsPerSlide)

    fireEvent.change(input, { target: { files: [photoFile()] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(`This slide already holds the maximum of ${PRESENTATION_LIMITS.maxElementsPerSlide} elements`)
    expect(editorElements()).toHaveLength(PRESENTATION_LIMITS.maxElementsPerSlide)
    expect(usePresentationStore.getState().document!.assets).toHaveLength(0)
    // Refused before any write: the stored row never saw the insert.
    expect((await repository.getPresentation(presentationId)).slides[0]!.elements).toHaveLength(0)
  })

  it('says the artwork budget is spent instead of silently refusing the image', async () => {
    const { input } = await openBlankEditor()
    const storedAssetId = 'asset-already-stored'
    act(() => {
      const store = usePresentationStore.getState()
      // A stored asset whose recorded size already fills almost the whole budget.
      store.insertImage({
        asset: { id: storedAssetId, blobKey: 'uploads/stored', mimeType: 'image/png', width: 8, height: 8, sha256: 'c'.repeat(64), byteLength: PRESENTATION_LIMITS.maxMediaBytes - 1, provenance: { source: 'upload', label: 'stored.png' } },
        media: { assetId: storedAssetId, bytes: new Uint8Array([1]), mimeType: 'image/png' },
      })
    })

    fireEvent.change(input, { target: { files: [photoFile()] } })

    const limit = PRESENTATION_LIMITS.maxMediaBytes / (1024 * 1024)
    expect(await screen.findByRole('alert')).toHaveTextContent(`past the ${limit.toFixed(1)} MB limit`)
    expect(editorElements()).toHaveLength(1)
    expect(usePresentationStore.getState().document!.assets).toHaveLength(1)
  })

  it('says the image cap is reached instead of silently refusing the image', async () => {
    const { input } = await openBlankEditor()
    act(() => {
      const store = usePresentationStore.getState()
      for (let index = 0; index < PRESENTATION_LIMITS.maxAssets; index += 1) {
        if (index === PRESENTATION_LIMITS.maxElementsPerSlide / 2) {
          const second = store.addSlide()
          if (second) store.selectSlide(second)
        }
        const id = `cap-asset-${index}`
        store.insertImage({
          asset: { id, blobKey: `uploads/${id}`, mimeType: 'image/png', width: 8, height: 8, sha256: 'b'.repeat(64), byteLength: 1, provenance: { source: 'upload', label: `${id}.png` } },
          media: { assetId: id, bytes: new Uint8Array([index % 251]), mimeType: 'image/png' },
        })
      }
    })
    expect(usePresentationStore.getState().document!.assets).toHaveLength(PRESENTATION_LIMITS.maxAssets)
    const elementsBefore = editorElements().length
    // The active slide still has room, so only the asset cap can refuse the upload.
    expect(elementsBefore).toBeLessThan(PRESENTATION_LIMITS.maxElementsPerSlide)

    fireEvent.change(input, { target: { files: [photoFile()] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(`This presentation already holds the maximum of ${PRESENTATION_LIMITS.maxAssets} images`)
    expect(usePresentationStore.getState().document!.assets).toHaveLength(PRESENTATION_LIMITS.maxAssets)
    expect(editorElements()).toHaveLength(elementsBefore)
  })

  it('says a failed write in the status region and adds no element', async () => {
    const { repository, input } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id
    const document = usePresentationStore.getState().document

    repository.injectWriteFailure()
    fireEvent.change(input, { target: { files: [photoFile()] } })

    // The failure is readable, not a silent no-op, and it never claims success.
    expect(await screen.findByText(/^Save failed — /)).toBeInTheDocument()
    expect(editorElements()).toHaveLength(0)
    expect(usePresentationStore.getState().document).toBe(document)
    expect(usePresentationStore.getState().dirty).toBe(false)
    const stored = await repository.getPresentation(presentationId)
    expect(stored.assets).toEqual([])
    expect(stored.slides[0]!.elements).toEqual([])
  })

  it('says a saved image is saved but not yet displayable instead of claiming the insert failed', async () => {
    const { repository, input } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id
    const assetId = `asset-${FIXTURE_IMAGE_SHA256}`

    // The upload boundary decodes once to size the image; the second decode is the
    // editor's own, and it fails. The write has already committed by then.
    let decodes = 0
    globalThis.createImageBitmap = (async () => {
      decodes += 1
      if (decodes > 1) throw new Error('decode failed')
      return { width: 64, height: 64, close() {} } as ImageBitmap
    }) as typeof createImageBitmap

    fireEvent.change(input, { target: { files: [photoFile()] } })

    // Honest and without an invitation to retry: nothing is left to add.
    expect(await screen.findByRole('alert')).toHaveTextContent(/was saved, but it cannot be displayed/i)
    expect(screen.getByRole('alert')).not.toHaveTextContent(/could not be added/i)
    const stored = await repository.getPresentation(presentationId)
    expect(stored.assets).toMatchObject([{ id: assetId }])
    expect(stored.slides[0]!.elements[0]!).toMatchObject({ kind: 'image', assetId })
    expect(Array.from((await repository.getMedia(assetId)).bytes)).toEqual(Array.from(fixtureImagePng()))
  })
})

describe('presentation media budget and stored artwork', () => {
  it('hydrates the media budget from the artwork the load fetches', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    // The budget is summed from the document, so a loaded document already knows
    // how much of the 200 MB its stored artwork accounts for.
    expect(usePresentationStore.getState().document!.assets[0]!.byteLength).toBe(FIXTURE_IMAGE_BYTE_LENGTH)
  })

  it('re-opens the newer revision and decodes its artwork after a conflict recovery', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    const closes = trackDecodedBitmaps()
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })
    expect(closes).toHaveLength(1)

    // Another tab saved a newer revision of the same presentation.
    const newer = await repository.getPresentation(FIXTURE_ID)
    newer.revision = 7
    newer.title = 'Saved in another tab'
    await repository.savePresentation(newer)

    const slideId = usePresentationStore.getState().view.activeSlideId!
    act(() => { usePresentationStore.getState().renameSlide(slideId, 'My local rename') })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Keep my copy' })).toBeInTheDocument()
    expect(screen.getByText(/^Save conflict — /)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep my copy' }))

    await waitFor(() => expect(usePresentationStore.getState().document!.title).toBe('Saved in another tab'))
    // The newer revision was decoded from stored bytes: a load keyed on the route id
    // alone would have kept the canvas on the pre-recovery artwork.
    expect(closes).toHaveLength(2)
    expect(closes[1]).not.toHaveBeenCalled()
    expect(usePresentationStore.getState().document!.revision).toBe(7)
    expect(usePresentationStore.getState().document!.assets[0]!.byteLength).toBe(FIXTURE_IMAGE_BYTE_LENGTH)
    expect(await screen.findByText(/saved as a separate conflict copy/i)).toBeInTheDocument()

    // The local work survives as its own stored row, and the newer work is intact.
    const rows = await repository.listPresentations()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.title)).toContain('Saved in another tab')
    const copy = rows.find((row) => row.title.includes('conflict copy'))!
    expect((await repository.getPresentation(copy.id)).slides[0]!.name).toBe('My local rename')
  })
})

describe('leaving the presentation editor', () => {
  it('writes text that is only on screen before the Back link leaves', async () => {
    const { repository } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })

    // A composition commits once at compositionend, so this text exists only in the
    // editor: the leave path has to flush it through the overlay's registered commit.
    fireEvent.compositionStart(field)
    field.innerHTML = '<p>Chưa lưu</p>'
    fireEvent.input(field)

    fireEvent.click(screen.getByRole('link', { name: 'Back to presentations' }))

    expect(await screen.findByRole('link', { name: 'Open Untitled presentation' })).toBeInTheDocument()
    const stored = await repository.getPresentation(presentationId)
    const element = stored.slides[0]!.elements.find((candidate) => candidate.kind === 'text')
    if (element?.kind !== 'text') throw new Error('expected a stored text element')
    expect(element.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('')).toBe('Chưa lưu')
  })

  it('keeps the editor open with a visible reason when the work cannot be saved', async () => {
    const repository = createMemoryPresentationRepository()
    renderPresentations('/presentations', repository)
    await screen.findByRole('heading', { name: 'No presentations yet' })
    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    await screen.findByRole('heading', { name: 'Untitled presentation' })

    act(() => { usePresentationStore.getState().renameSlide(usePresentationStore.getState().view.activeSlideId!, 'Must not be lost') })
    repository.injectWriteFailure()
    fireEvent.click(screen.getByRole('link', { name: 'Back to presentations' }))

    expect(await screen.findByText(/could not be saved, so it is still open/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Untitled presentation' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No presentations yet' })).not.toBeInTheDocument()
    expect(usePresentationStore.getState().dirty).toBe(true)
    expect(usePresentationStore.getState().document!.slides[0]!.name).toBe('Must not be lost')
  })

  it('flushes an edit that only exists on screen before a shell nav link leaves', async () => {
    const { repository } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })

    // The shell's own Home link is reachable from inside the editor, and this text
    // is only in the open text session: the guard has to flush and write it first.
    fireEvent.compositionStart(field)
    field.innerHTML = '<p>Survives the shell</p>'
    fireEvent.input(field)

    fireEvent.click(screen.getByRole('link', { name: 'Home' }))

    expect(await screen.findByRole('heading', { name: /Small stickers/ })).toBeInTheDocument()
    const stored = await repository.getPresentation(presentationId)
    const element = stored.slides[0]!.elements.find((candidate) => candidate.kind === 'text')
    if (element?.kind !== 'text') throw new Error('expected a stored text element')
    expect(element.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('')).toBe('Survives the shell')
  })

  it('keeps a dirty editor open when a shell nav link cannot be saved', async () => {
    const repository = createMemoryPresentationRepository()
    renderPresentations('/presentations', repository)
    await screen.findByRole('heading', { name: 'No presentations yet' })
    fireEvent.click(screen.getByRole('button', { name: 'Create your first presentation' }))
    await screen.findByRole('heading', { name: 'Untitled presentation' })

    act(() => { usePresentationStore.getState().renameSlide(usePresentationStore.getState().view.activeSlideId!, 'Still here') })
    repository.injectWriteFailure()
    fireEvent.click(screen.getByRole('link', { name: 'Home' }))

    expect(await screen.findByText(/could not be saved, so it is still open/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Untitled presentation' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Small stickers/ })).not.toBeInTheDocument()
    expect(usePresentationStore.getState().dirty).toBe(true)
    expect(usePresentationStore.getState().document!.slides[0]!.name).toBe('Still here')
  })

  it('a clean editor leaves through a shell nav link without being held back', async () => {
    await openBlankEditor()

    fireEvent.click(screen.getByRole('link', { name: 'Home' }))

    expect(await screen.findByRole('heading', { name: /Small stickers/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Untitled presentation' })).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument()
  })
})

describe('presentation library actions', () => {
  /**
   * Simulates another tab writing a newer revision of the same presentation after
   * the library read it and before the rename is saved.
   */
  class StaleRevisionRepository extends MemoryPresentationRepository {
    override async savePresentation(document: PresentationDocument, media: PresentationMediaRecord[] = [], options: SavePresentationOptions = {}): Promise<void> {
      if (options.baseRevision !== undefined) {
        const stored = await this.getPresentation(document.id)
        await super.savePresentation({ ...stored, revision: stored.revision + 5, title: 'Renamed in another window' })
      }
      return super.savePresentation(document, media, options)
    }
  }

  /** Renders the library with a sticker repository the test can inspect. */
  function renderLibrary(repository: MemoryPresentationRepository) {
    const stickerRepository = createMemoryRepository()
    render(
      <MemoryRouter initialEntries={['/presentations']}>
        <App repository={stickerRepository} presentationRepository={repository} />
      </MemoryRouter>,
    )
    return { stickerRepository }
  }

  async function openRenameDialog(title: string) {
    fireEvent.click(await screen.findByRole('button', { name: `Rename ${title}` }))
    const dialog = await screen.findByRole('dialog', { name: 'Rename this presentation' })
    return { dialog, field: within(dialog).getByRole('textbox', { name: 'Presentation name' }) }
  }

  it('renames a presentation and stores the trimmed title at the next revision', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'draft', title: 'First draft' }))
    renderLibrary(repository)

    const { dialog, field } = await openRenameDialog('First draft')
    expect(field).toHaveValue('First draft')
    fireEvent.change(field, { target: { value: '  Bài học về Hà Nội  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))

    await waitFor(async () => expect((await repository.getPresentation('draft')).title).toBe('Bài học về Hà Nội'))
    expect((await repository.getPresentation('draft')).revision).toBe(1)
    expect(await screen.findByRole('link', { name: 'Open Bài học về Hà Nội' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refuses an empty rename without writing', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'draft', title: 'First draft' }))
    renderLibrary(repository)
    const write = vi.spyOn(repository, 'savePresentation')

    const { dialog, field } = await openRenameDialog('First draft')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Enter a name/)
    expect(write).not.toHaveBeenCalled()
    expect((await repository.getPresentation('draft')).title).toBe('First draft')
    expect((await repository.getPresentation('draft')).revision).toBe(0)
  })

  it('reports a rename that lost a revision race instead of overwriting the newer title', async () => {
    const repository = new StaleRevisionRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'draft', title: 'First draft' }))
    renderLibrary(repository)

    const { dialog, field } = await openRenameDialog('First draft')
    fireEvent.change(field, { target: { value: 'My new name' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/another tab or window/)
    // Nothing was written over the newer revision.
    expect((await repository.getPresentation('draft')).title).toBe('Renamed in another window')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep the current name' }))

    // The library was reloaded, so the title saved elsewhere is the one on screen.
    expect(await screen.findByRole('link', { name: 'Open Renamed in another window' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open My new name' })).not.toBeInTheDocument()
  })

  it('duplicates a presentation into an independent row with its own artwork', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderLibrary(repository)
    const source = await repository.getPresentation(FIXTURE_ID)

    fireEvent.click(await screen.findByRole('button', { name: `Duplicate ${source.title}` }))

    const rows = await waitFor(async () => {
      const list = await repository.listPresentations()
      expect(list).toHaveLength(2)
      return list
    })
    const copySummary = rows.find((row) => row.id !== FIXTURE_ID)!
    expect(copySummary.title).toBe(`${source.title} copy`)

    const copy = await repository.getPresentation(copySummary.id)
    expect(copy.id).not.toBe(FIXTURE_ID)
    expect(copy.slides[0]!.id).not.toBe(source.slides[0]!.id)
    expect(copy.assets[0]!.id).not.toBe(source.assets[0]!.id)
    const copiedImage = copy.slides.flatMap((slide) => slide.elements).find((element) => element.kind === 'image')!
    expect(copiedImage).toMatchObject({ assetId: copy.assets[0]!.id })
    // The copy owns its media: identical bytes under a different asset id.
    expect(Array.from((await repository.getMedia(copy.assets[0]!.id)).bytes)).toEqual(Array.from(fixtureImagePng()))
    expect(await screen.findByRole('link', { name: `Open ${copySummary.title}` })).toBeInTheDocument()
  })

  it('cancels a delete safely, keeps the row, and restores focus to the opener', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'keep-me', title: 'Keep me' }))
    renderLibrary(repository)

    const opener = await screen.findByRole('button', { name: 'Delete Keep me' })
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Delete this presentation?' })
    expect(within(dialog).getByRole('button', { name: 'Keep presentation' })).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep presentation' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Open Keep me' })).toBeInTheDocument()
    expect(await repository.listPresentations()).toHaveLength(1)
  })

  it('deletes only the confirmed presentation and leaves sticker projects alone', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'delete-me', title: 'Delete me' }))
    await repository.savePresentation(createPresentationDocument({ id: 'keep-me', title: 'Keep me' }))
    const { stickerRepository } = renderLibrary(repository)
    await stickerRepository.saveProject(createProjectDocument({ id: 'sticker-1', title: 'Happy Cat' }))
    const projectsBefore = await stickerRepository.listProjects()
    const packsBefore = await stickerRepository.listPacks()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Delete me' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this presentation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete presentation' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await repository.listPresentations()).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Open Delete me' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Keep me' })).toBeInTheDocument()
    // Focus lands on a surviving control, not the button that just disappeared.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Keep me' })).toHaveFocus())

    expect(await stickerRepository.listProjects()).toEqual(projectsBefore)
    expect(await stickerRepository.listPacks()).toEqual(packsBefore)
  })

  it('keeps the row and says why when a delete fails', async () => {
    const repository = createMemoryPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: 'stuck', title: 'Stuck' }))
    renderLibrary(repository)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Stuck' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this presentation?' })
    repository.injectWriteFailure()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete presentation' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Could not delete this presentation/)
    expect(await repository.listPresentations()).toHaveLength(1)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep presentation' }))
    expect(await screen.findByRole('link', { name: 'Open Stuck' })).toBeInTheDocument()
  })
})
