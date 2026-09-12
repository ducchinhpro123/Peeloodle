import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { App } from '../../main'
import { createMemoryRepository } from '../../lib/persistence/repository'
import { createMemoryPresentationRepository } from '../../lib/persistence/presentations/repository'
import { createPresentationDocument, createTextElement } from './model/factories'
import { PRESENTATION_LIMITS } from './model/limits'
import { createFixturePresentation, FIXTURE_ID, FIXTURE_IMAGE_ASSET_ID, FIXTURE_IMAGE_SHA256, fixtureImagePng } from './model/fixtures/fixture'
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
  it('inserts an uploaded photo and stores its media with the document', async () => {
    const { repository, input } = await openBlankEditor()
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
    expect(usePresentationStore.getState().document!.assets).toMatchObject([{ id: assetId, sha256: FIXTURE_IMAGE_SHA256 }])
    expect(usePresentationStore.getState().mediaForSave()).toHaveLength(1)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    // The held bytes are exactly what a save persists: prove the seam end to end.
    const document = usePresentationStore.getState().document!
    await repository.savePresentation(document, usePresentationStore.getState().mediaForSave())

    const reopened = await repository.getPresentation(document.id)
    expect(reopened.assets).toMatchObject([{ id: assetId, sha256: FIXTURE_IMAGE_SHA256, width: 64, height: 64 }])
    expect(reopened.slides[0]!.elements[0]!).toMatchObject({ kind: 'image', assetId })
    const media = await repository.getMedia(assetId)
    expect(Array.from(media.bytes)).toEqual(Array.from(fixtureImagePng()))
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
    const { input } = await openBlankEditor()

    fireEvent.change(input, { target: { files: [photoFile()] } })
    await waitFor(() => expect(editorElements()).toHaveLength(1))
    fireEvent.change(input, { target: { files: [photoFile('photo-again.png')] } })
    await waitFor(() => expect(editorElements()).toHaveLength(2))

    expect(usePresentationStore.getState().document!.assets).toHaveLength(1)
    expect(usePresentationStore.getState().mediaForSave()).toHaveLength(1)
    // One history entry per insertion.
    expect(usePresentationStore.getState().past).toHaveLength(2)
    expect(editorElements().map((element) => element.name)).toEqual(['Image', 'Image 2'])
  })

  it('says a full slide is full instead of silently refusing the image', async () => {
    const { input } = await openBlankEditor()
    act(() => {
      const store = usePresentationStore.getState()
      for (let index = 0; index < PRESENTATION_LIMITS.maxElementsPerSlide; index += 1) {
        store.addElement(createTextElement({ id: `filler-${index}`, name: `Filler ${index}` }))
      }
    })
    expect(editorElements()).toHaveLength(PRESENTATION_LIMITS.maxElementsPerSlide)

    fireEvent.change(input, { target: { files: [photoFile()] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(`This slide is full (${PRESENTATION_LIMITS.maxElementsPerSlide} elements)`)
    expect(editorElements()).toHaveLength(PRESENTATION_LIMITS.maxElementsPerSlide)
    expect(usePresentationStore.getState().document!.assets).toHaveLength(0)
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
          asset: { id, blobKey: `uploads/${id}`, mimeType: 'image/png', width: 8, height: 8, sha256: 'b'.repeat(64), provenance: { source: 'upload', label: `${id}.png` } },
          media: { assetId: id, bytes: new Uint8Array([index % 251]), mimeType: 'image/png' },
        })
      }
    })
    expect(usePresentationStore.getState().document!.assets).toHaveLength(PRESENTATION_LIMITS.maxAssets)
    // The active slide still has room, so only the asset cap can refuse the upload.
    expect(editorElements().length).toBeLessThan(PRESENTATION_LIMITS.maxElementsPerSlide)

    fireEvent.change(input, { target: { files: [photoFile()] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(`This presentation already holds the maximum ${PRESENTATION_LIMITS.maxAssets} images.`)
    expect(usePresentationStore.getState().document!.assets).toHaveLength(PRESENTATION_LIMITS.maxAssets)
  })
})
