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
import { encodeRgbaPng } from './model/fixtures/png'
import { usePresentationStore } from './editor/store'
import { paragraphsToHtml } from './editor/textBridge'
import { prepareStickerSnapshot } from './editor/insertStickerSnapshot'

// The render pipeline needs a real canvas; the module has its own unit tests, so
// the route test only verifies the picker → atomic insert wiring.
vi.mock('./editor/insertStickerSnapshot', () => ({ prepareStickerSnapshot: vi.fn() }))

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
  const stickerRepository = createMemoryRepository()
  const app = (
    <MemoryRouter initialEntries={[path]}>
      <App repository={stickerRepository} presentationRepository={presentationRepository} />
    </MemoryRouter>
  )
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app)
  return { repository: presentationRepository, stickers: stickerRepository, unmount: view.unmount }
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
  return { repository, stickers: view.stickers, input: screen.getByTestId('presentation-image-input'), unmount: view.unmount }
}

function editorElements() {
  return usePresentationStore.getState().document!.slides[0]!.elements
}

/** Selects a text range, which is what the formatting toolbar acts on. */
function selectRange(node: Node, start: number, end: number) {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
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

  it('duplicates with fresh element IDs, autosaves, and reopens the copied content and media', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    const closes = trackDecodedBitmaps()
    const { unmount } = renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })
    expect(closes).toHaveLength(1)

    const source = usePresentationStore.getState().document!.slides[0]!
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate active slide' }))

    const afterDuplicate = usePresentationStore.getState()
    const duplicate = afterDuplicate.document!.slides.find((slide) => slide.id === afterDuplicate.view.activeSlideId)!
    expect(duplicate.id).not.toBe(source.id)
    // Disjoint element-ID sets: every copied element got its own ID, not just one.
    const sourceElementIds = new Set(source.elements.map((element) => element.id))
    expect(duplicate.elements.filter((element) => sourceElementIds.has(element.id))).toEqual([])
    expect(duplicate.elements.map((element) => element.name)).toEqual(source.elements.map((element) => element.name))
    expect(duplicate.elements.find((element) => element.kind === 'image')).toMatchObject({ assetId: FIXTURE_IMAGE_ASSET_ID })
    expect(afterDuplicate.view.activeSlideId).toBe(duplicate.id)

    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    const afterAdd = usePresentationStore.getState()
    const addedId = afterAdd.view.activeSlideId!
    expect(afterAdd.document!.slides).toHaveLength(4)
    expect(afterAdd.document!.slides.find((slide) => slide.id === addedId)?.elements).toEqual([])
    expect(screen.getByRole('button', { name: /Show slide 3:/ })).toHaveAttribute('aria-current', 'true')

    const savedOrder = afterAdd.document!.slides.map((slide) => slide.id)
    await waitFor(async () => {
      const stored = await repository.getPresentation(FIXTURE_ID)
      expect(stored.slides.map((slide) => slide.id)).toEqual(savedOrder)
    })
    expect(await repository.hasMedia(FIXTURE_IMAGE_ASSET_ID)).toBe(true)
    expect(Array.from((await repository.getMedia(FIXTURE_IMAGE_ASSET_ID)).bytes)).toEqual(Array.from(fixtureImagePng()))

    // Reload: close the editor and open the stored presentation again.
    unmount()
    await waitFor(() => expect(closes[0]).toHaveBeenCalledTimes(1))
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByTestId('presentation-canvas')

    const reopened = usePresentationStore.getState().document!
    expect(reopened.slides.map((slide) => slide.id)).toEqual(savedOrder)
    const reopenedCopy = reopened.slides.find((slide) => slide.id === duplicate.id)!
    expect(reopenedCopy.elements).toEqual(duplicate.elements)
    expect(reopenedCopy.elements.find((element) => element.kind === 'image')).toMatchObject({ assetId: FIXTURE_IMAGE_ASSET_ID })
    expect(reopened.assets.map((asset) => asset.id)).toEqual([FIXTURE_IMAGE_ASSET_ID])
    // Rendered media: the reopened editor decoded the reused artwork again and kept
    // it live for the canvas instead of reporting missing artwork.
    await waitFor(() => expect(closes).toHaveLength(2))
    expect(closes[1]).not.toHaveBeenCalled()
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

  it('undoes and redoes through the toolbar and keyboard without stealing text-field undo', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    const undo = screen.getByRole('button', { name: 'Undo' })
    const redo = screen.getByRole('button', { name: 'Redo' })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    expect(usePresentationStore.getState().document!.slides).toHaveLength(3)
    expect(undo).toBeEnabled()

    fireEvent.click(undo)
    expect(usePresentationStore.getState().document!.slides).toHaveLength(2)
    expect(redo).toBeEnabled()

    // Ctrl/Cmd+Shift+Z and Ctrl+Y redo; plain Ctrl/Cmd+Z undoes.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(usePresentationStore.getState().document!.slides).toHaveLength(3)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(usePresentationStore.getState().document!.slides).toHaveLength(3)
    expect(redo).toBeDisabled()

    // A shortcut typed inside a text field belongs to the field, not the document.
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    const historyBefore = usePresentationStore.getState().past.length
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true })
    expect(usePresentationStore.getState().past).toHaveLength(historyBefore)
    expect(usePresentationStore.getState().document!.slides).toHaveLength(3)
  })

  it('formats a selected run and keeps it through undo, redo and reopen', async () => {
    const { repository, unmount } = await openBlankEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    field.innerHTML = '<p>Xin chào</p>'
    fireEvent.input(field)

    const text = field.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 3)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const bold = screen.getByRole('button', { name: 'Bold' })
    fireEvent.click(bold)
    expect(bold).toHaveAttribute('aria-pressed', 'true')

    const formatted = editorElements()[0]!
    if (formatted.kind !== 'text') throw new Error('expected text')
    expect(formatted.paragraphs[0]!.runs.map((run) => ({ text: run.text, bold: run.bold ?? false }))).toEqual([
      { text: 'Xin', bold: true },
      { text: ' chào', bold: false },
    ])
    const documentId = usePresentationStore.getState().document!.id
    const history = usePresentationStore.getState().past.length

    // Typing and formatting stay one session, so one undo entry.
    fireEvent.blur(field)
    expect(usePresentationStore.getState().past).toHaveLength(history)
    await waitFor(async () => {
      const stored = await repository.getPresentation(documentId)
      const storedElement = stored.slides[0]!.elements[0]!
      if (storedElement.kind !== 'text') throw new Error('expected text')
      expect(storedElement.paragraphs[0]!.runs[0]!.bold).toBe(true)
    }, { timeout: 3000 })

    // Undo restores the empty box; redo brings the formatted runs back.
    usePresentationStore.getState().undo()
    const undone = editorElements()[0]!
    if (undone.kind !== 'text') throw new Error('expected text')
    expect(undone.paragraphs[0]!.runs).toEqual([])
    usePresentationStore.getState().redo()
    const redone = editorElements()[0]!
    if (redone.kind !== 'text') throw new Error('expected text')
    expect(redone.paragraphs[0]!.runs[0]!.bold).toBe(true)

    // Reopen from storage: the formatting is persisted data, not DOM state.
    unmount()
    renderPresentations(`/presentations/${documentId}`, repository)
    await screen.findByTestId('presentation-canvas')
    const reopened = editorElements()[0]!
    if (reopened.kind !== 'text') throw new Error('expected text')
    expect(reopened.paragraphs[0]!.runs.map((run) => run.bold ?? false)).toEqual([true, false])
  })

  it('applies paragraph alignment and bullets and keeps them after reopen', async () => {
    const { repository, unmount } = await openBlankEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    const run = { text: '', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }
    field.innerHTML = paragraphsToHtml([
      { runs: [{ ...run, text: 'Dòng một' }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
      { runs: [{ ...run, text: 'Dòng hai' }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
    ])
    fireEvent.input(field)

    const firstText = field.querySelector('[data-p="0"] span')!.firstChild as Text
    selectRange(firstText, 0, firstText.length)
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }))

    const secondText = field.querySelector('[data-p="1"] span')!.firstChild as Text
    selectRange(secondText, 0, secondText.length)
    fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))

    const element = editorElements()[0]!
    if (element.kind !== 'text') throw new Error('expected text')
    expect(element.paragraphs.map((paragraph) => paragraph.alignment)).toEqual(['center', 'left'])
    expect(element.paragraphs.map((paragraph) => paragraph.bullet)).toEqual(['none', 'bullet'])

    const documentId = usePresentationStore.getState().document!.id
    fireEvent.blur(field)
    await waitFor(async () => {
      const stored = await repository.getPresentation(documentId)
      const storedElement = stored.slides[0]!.elements[0]!
      if (storedElement.kind !== 'text') throw new Error('expected text')
      expect(storedElement.paragraphs[0]!.alignment).toBe('center')
      expect(storedElement.paragraphs[1]!.bullet).toBe('bullet')
    }, { timeout: 3000 })

    unmount()
    renderPresentations(`/presentations/${documentId}`, repository)
    await screen.findByTestId('presentation-canvas')
    const reopened = editorElements()[0]!
    if (reopened.kind !== 'text') throw new Error('expected text')
    expect(reopened.paragraphs[0]!.alignment).toBe('center')
    expect(reopened.paragraphs[1]!.bullet).toBe('bullet')
  })

  it('adds a safe link and refuses an unsafe one', async () => {
    await openBlankEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    field.innerHTML = paragraphsToHtml([
      { runs: [{ text: 'Trang chủ', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
    ])
    fireEvent.input(field)

    const text = field.querySelector('[data-p="0"] span')!.firstChild as Text
    selectRange(text, 0, text.length)
    const linkInput = screen.getByLabelText('Link URL')
    fireEvent.change(linkInput, { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))

    const linked = editorElements()[0]!
    if (linked.kind !== 'text') throw new Error('expected text')
    expect(linked.paragraphs[0]!.runs[0]!.link).toBe('https://example.com')
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeInTheDocument()

    // An unsafe scheme is refused in words, and the existing link is unchanged.
    fireEvent.change(linkInput, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Only http, https and mailto links can be added.')
    const stillLinked = editorElements()[0]!
    if (stillLinked.kind !== 'text') throw new Error('expected text')
    expect(stillLinked.paragraphs[0]!.runs[0]!.link).toBe('https://example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    const removed = editorElements()[0]!
    if (removed.kind !== 'text') throw new Error('expected text')
    expect(removed.paragraphs[0]!.runs[0]!.link).toBeUndefined()
  })

  it('shows actionable text overflow and grows the box to fit', async () => {
    await openBlankEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    field.innerHTML = paragraphsToHtml([
      { runs: [{ text: 'a'.repeat(600), fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
    ])
    fireEvent.input(field)

    const before = editorElements()[0]!
    if (before.kind !== 'text') throw new Error('expected text')
    expect(await screen.findByText(/Text overflows this box/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Grow box to fit' }))
    const grown = editorElements()[0]!
    if (grown.kind !== 'text') throw new Error('expected text')
    expect(grown.height).toBeGreaterThan(before.height)
    expect(screen.queryByText(/Text overflows this box/)).not.toBeInTheDocument()
  })

  it('inserts every shape kind and edits its fill and stroke', async () => {
    const { repository } = await openBlankEditor()
    const addShape = (kind: string) => fireEvent.change(screen.getByLabelText('Add shape'), { target: { value: kind } })

    addShape('rectangle')
    let first = editorElements()[0]!
    expect(first).toMatchObject({ kind: 'shape', shape: 'rectangle', x: 400, y: 225 })
    addShape('ellipse')
    addShape('rounded-rectangle')
    addShape('line')
    addShape('arrow')

    const shapes = editorElements().map((element) => (element.kind === 'shape' ? element.shape : null))
    expect(shapes).toEqual(['rectangle', 'ellipse', 'rounded-rectangle', 'line', 'arrow'])

    // Linear kinds carry a stroke and no fill; blocks carry the accent fill.
    const line = editorElements()[3]!
    if (line.kind !== 'shape') throw new Error('expected shape')
    expect(line).toMatchObject({ fill: null, stroke: '#08152f', strokeWidth: 4 })

    usePresentationStore.getState().undo()
    expect(editorElements()).toHaveLength(4)

    first = editorElements()[0]!
    if (first.kind !== 'shape') throw new Error('expected shape')
    usePresentationStore.getState().selectElements([first.id])
    fireEvent.change(await screen.findByLabelText('Shape fill color'), { target: { value: '#b42338' } })
    fireEvent.change(screen.getByLabelText('Stroke width'), { target: { value: '6' } })
    fireEvent.blur(screen.getByLabelText('Stroke width'))

    const updated = editorElements()[0]!
    if (updated.kind !== 'shape') throw new Error('expected shape')
    expect(updated.fill).toBe('#b42338')
    expect(updated.strokeWidth).toBe(6)

    // The style is real persisted document data, not just live state.
    const documentId = usePresentationStore.getState().document!.id
    await waitFor(async () => {
      const stored = await repository.getPresentation(documentId)
      const storedShape = stored.slides[0]!.elements[0]!
      expect(storedShape.kind === 'shape' ? storedShape.fill : null).toBe('#b42338')
    }, { timeout: 3000 })

    // One grouped history entry for the style session, not one per control.
    const history = usePresentationStore.getState().past.length
    usePresentationStore.getState().undo()
    const undone = editorElements()[0]!
    if (undone.kind !== 'shape') throw new Error('expected shape')
    expect(undone.fill).toBe('#08b879')
    expect(usePresentationStore.getState().past).toHaveLength(history - 1)
  })

  it('selects, reorders, duplicates, locks and deletes from the layer list', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    // Top of the list is the front-most element.
    const list = screen.getByRole('list', { name: /Elements on Title slide/ })
    let rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Accent circle')
    expect(rows[2]).toHaveTextContent('Title')
    expect(rows[3]).toHaveTextContent('Panel')

    fireEvent.click(within(rows[3]!).getByRole('button', { name: 'Panel' }))
    expect(usePresentationStore.getState().view.selectedElementIds).toEqual(['fixture-shape-panel'])

    fireEvent.click(screen.getByRole('button', { name: 'Move Panel up' }))
    expect(usePresentationStore.getState().document!.slides[0]!.elements.findIndex((element) => element.id === 'fixture-shape-panel')).toBe(1)
    usePresentationStore.getState().undo()
    expect(usePresentationStore.getState().document!.slides[0]!.elements[0]!.id).toBe('fixture-shape-panel')

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Panel' }))
    expect(usePresentationStore.getState().document!.slides[0]!.elements).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Panel copy' }))
    expect(usePresentationStore.getState().document!.slides[0]!.elements).toHaveLength(4)

    // Locking makes the canvas transform refuse the element.
    fireEvent.click(screen.getByRole('button', { name: 'Lock Panel' }))
    const locked = usePresentationStore.getState().document!.slides[0]!.elements.find((element) => element.id === 'fixture-shape-panel')!
    expect(locked.locked).toBe(true)
    usePresentationStore.getState().commitTransform('fixture-shape-panel', { x: 10, y: 10, width: 100, height: 100, rotation: 0 })
    const afterTransform = usePresentationStore.getState().document!.slides[0]!.elements.find((element) => element.id === 'fixture-shape-panel')!
    expect(afterTransform.x).toBe(locked.x)

    fireEvent.click(screen.getByRole('button', { name: 'Hide Panel' }))
    expect(usePresentationStore.getState().document!.slides[0]!.elements.find((element) => element.id === 'fixture-shape-panel')!.visible).toBe(false)
    rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
  })

  it('aligns an element to the slide from the inspector', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    act(() => { usePresentationStore.getState().selectElements(['fixture-shape-ellipse']) })
    const ellipse = () => usePresentationStore.getState().document!.slides[0]!.elements.find((element) => element.id === 'fixture-shape-ellipse')!

    fireEvent.click(await screen.findByRole('button', { name: 'Align Left' }))
    expect(ellipse().x).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Align Middle' }))
    expect(ellipse().y).toBe((720 - ellipse().height) / 2)

    fireEvent.click(screen.getByRole('button', { name: 'Align Bottom' }))
    expect(ellipse().y).toBe(720 - ellipse().height)

    // One entry per explicit alignment, each undoable.
    const history = usePresentationStore.getState().past.length
    usePresentationStore.getState().undo()
    expect(ellipse().y).toBe((720 - ellipse().height) / 2)
    expect(usePresentationStore.getState().past).toHaveLength(history - 1)
  })

  it('edits the slide background and theme defaults without restyling saved elements', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    // Slide background applies to the active slide only and persists.
    fireEvent.change(screen.getByLabelText('Slide background'), { target: { value: '#123456' } })
    fireEvent.blur(screen.getByLabelText('Slide background'))
    const changed = usePresentationStore.getState().document!
    expect(changed.slides[0]!.background).toBe('#123456')
    expect(changed.slides[1]!.background).not.toBe('#123456')
    await waitFor(async () => {
      const stored = await repository.getPresentation(FIXTURE_ID)
      expect(stored.slides[0]!.background).toBe('#123456')
    }, { timeout: 3000 })

    // Theme changes are defaults for new text; existing runs stay untouched.
    const titleBefore = structuredClone(usePresentationStore.getState().document!.slides[0]!.elements.find((element) => element.id === 'fixture-text-title'))
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    fireEvent.change(await screen.findByLabelText('Body font'), { target: { value: 'spectral' } })
    fireEvent.change(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } })
    fireEvent.blur(screen.getByLabelText('Text color'))
    expect(usePresentationStore.getState().document!.theme).toMatchObject({ bodyFontId: 'spectral', colors: { text: '#ff0000' } })
    const titleAfter = usePresentationStore.getState().document!.slides[0]!.elements.find((element) => element.id === 'fixture-text-title')
    expect(titleAfter).toEqual(titleBefore)
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    // A new text box uses the new defaults.
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const field = await screen.findByRole('textbox', { name: 'Text content' })
    field.innerHTML = '<p>Thème</p>'
    fireEvent.input(field)
    fireEvent.blur(field)
    const added = editorElements().at(-1)!
    if (added.kind !== 'text') throw new Error('expected text')
    expect(added.paragraphs[0]!.runs[0]).toMatchObject({ text: 'Thème', fontId: 'spectral', color: '#ff0000' })

    // Another presentation keeps its own theme.
    await repository.savePresentation(createPresentationDocument({ id: 'other', title: 'Other' }))
    expect((await repository.getPresentation('other')).theme.bodyFontId).toBe('be-vietnam-pro')
  })

  it('places a saved sticker as an immutable image snapshot', async () => {
    const { repository, stickers } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id

    const sticker = createProjectDocument({ id: 'sticker-1', title: 'Cat sticker' })
    sticker.layers = [{
      id: 'layer-1',
      kind: 'image',
      name: 'Photo',
      assetId: 'sticker-asset',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 1,
      visible: true,
      locked: false,
    }]
    sticker.assetIds = ['sticker-asset']
    await stickers.saveProjectWithAssets(sticker, [{
      asset: { id: 'sticker-asset', mimeType: 'image/png', width: 256, height: 256, blobKey: 'assets/sticker-asset', provenance: 'user' },
      blob: new Blob([fixtureImagePng()], { type: 'image/png' }),
    }])

    const asset = {
      id: 'asset-snapshot',
      blobKey: 'uploads/snapshot',
      mimeType: 'image/png' as const,
      width: 64,
      height: 64,
      sha256: 'a'.repeat(64),
      byteLength: 4,
      provenance: { source: 'sticker' as const, label: 'Cat sticker.png' },
    }
    vi.mocked(prepareStickerSnapshot).mockResolvedValue({
      asset,
      media: { assetId: asset.id, bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add sticker' }))
    fireEvent.click(await screen.findByRole('button', { name: /Cat sticker/ }))

    await waitFor(() => expect(editorElements()).toHaveLength(1))
    expect(editorElements()[0]!).toMatchObject({ kind: 'image', assetId: 'asset-snapshot', alt: 'Cat sticker.png' })

    // The presentation owns its copied bytes; the source sticker is untouched.
    const stored = await repository.getPresentation(presentationId)
    expect(stored.assets.map((storedAsset) => storedAsset.id)).toEqual(['asset-snapshot'])
    expect(Array.from((await repository.getMedia('asset-snapshot')).bytes)).toEqual([137, 80, 78, 71])
    expect((await stickers.getProject('sticker-1')).layers[0]).toMatchObject({ assetId: 'sticker-asset' })
    expect(vi.mocked(prepareStickerSnapshot)).toHaveBeenCalledWith(stickers, 'sticker-1')
  })

  it('keeps canvas shortcuts out of dialogs and text fields', async () => {
    const repository = createMemoryPresentationRepository()
    await saveFixture(repository)
    renderPresentations(`/presentations/${FIXTURE_ID}`, repository)
    await screen.findByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })

    act(() => { usePresentationStore.getState().addSlide() })
    const history = usePresentationStore.getState().past.length

    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'z', ctrlKey: true })
    expect(usePresentationStore.getState().past).toHaveLength(history)

    fireEvent.keyDown(screen.getByLabelText('Body font'), { key: 'z', ctrlKey: true })
    expect(usePresentationStore.getState().past).toHaveLength(history)
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
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

  it('flips, crops and replaces a photo without moving the element', async () => {
    const { repository, input } = await openBlankEditor()
    const presentationId = usePresentationStore.getState().document!.id
    fireEvent.change(input, { target: { files: [photoFile()] } })
    await waitFor(() => expect(editorElements()).toHaveLength(1))

    const before = editorElements()[0]!
    if (before.kind !== 'image') throw new Error('expected image')
    const placement = { x: before.x, y: before.y, width: before.width, height: before.height }
    usePresentationStore.getState().selectElements([before.id])

    fireEvent.click(await screen.findByRole('button', { name: 'Flip horizontally' }))
    fireEvent.click(screen.getByRole('button', { name: 'Flip vertically' }))
    let current = editorElements()[0]!
    if (current.kind !== 'image') throw new Error('expected image')
    expect(current).toMatchObject({ flipX: true, flipY: true, ...placement })

    // Crop is normalized document data; the pixels are never rewritten.
    fireEvent.change(screen.getByLabelText('Crop left percent'), { target: { value: '10' } })
    fireEvent.blur(screen.getByLabelText('Crop left percent'))
    current = editorElements()[0]!
    if (current.kind !== 'image') throw new Error('expected image')
    expect(current.crop).toEqual({ x: 0.1, y: 0, width: 0.9, height: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }))
    current = editorElements()[0]!
    if (current.kind !== 'image') throw new Error('expected image')
    expect(current.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })

    // Replace persists the new bytes first, then switches the asset in place.
    fireEvent.click(screen.getByRole('button', { name: 'Replace photo' }))
    fireEvent.change(input, { target: { files: [photoFile('replacement.png', encodeRgbaPng(64, 64, () => [255, 0, 0, 255]))] } })
    await waitFor(async () => {
      const stored = await repository.getPresentation(presentationId)
      const storedElement = stored.slides[0]!.elements[0]!
      expect(storedElement.kind === 'image' ? storedElement.alt : null).toBe('replacement.png')
    }, { timeout: 3000 })

    const replaced = editorElements()[0]!
    if (replaced.kind !== 'image') throw new Error('expected image')
    expect({ x: replaced.x, y: replaced.y, width: replaced.width, height: replaced.height }).toEqual(placement)
    expect(replaced).toMatchObject({ flipX: true, flipY: true, alt: 'replacement.png' })
    expect(replaced.assetId).not.toBe(before.assetId)

    usePresentationStore.getState().undo()
    const undone = editorElements()[0]!
    if (undone.kind !== 'image') throw new Error('expected image')
    expect(undone.assetId).toBe(before.assetId)
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
    // The refused insert never reached storage: whatever autosave wrote has no
    // image asset and no image element, only the fillers.
    const stored = await repository.getPresentation(presentationId)
    expect(stored.assets).toHaveLength(0)
    expect(stored.slides[0]!.elements.every((element) => element.kind === 'text')).toBe(true)
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
