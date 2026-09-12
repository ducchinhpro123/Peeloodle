/**
 * P19 save/autosave contract.
 *
 * The hook is exercised through the real store commands and the real
 * `MemoryPresentationRepository`, so the revision rule, the media rule and the
 * status copy are all tested where they are actually enforced.
 */

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PresentationRepositoryContext } from '@/app/presentationRepositoryContext'
import {
  MemoryPresentationRepository,
  type PresentationMediaRecord,
  type PresentationRepository,
  type SavePresentationOptions,
} from '@/lib/persistence/presentations/repository'
import type { PresentationDocument } from '../model/types'
import { createPresentationDocument, createTextElement } from '../model/factories'
import { FIXTURE_IMAGE_SHA256, fixtureImagePng } from '../model/fixtures/fixture'
import type { PreparedPresentationImage } from './insertImageAsset'
import { PresentationEditorPage } from './PresentationEditorPage'
import { textHistoryGroup } from './textEditSession'
import { usePresentationStore } from './store'
import { AUTOSAVE_DELAY_MS, usePresentationSave } from './usePresentationSave'

type Write = { revision: number; baseRevision: number | undefined; saving: boolean; dirty: boolean; assetIds: string[] }

/** Records what the store looked like at the moment the repository was called. */
class RecordingPresentationRepository extends MemoryPresentationRepository {
  readonly writes: Write[] = []

  override async savePresentation(document: PresentationDocument, media: PresentationMediaRecord[] = [], options: SavePresentationOptions = {}): Promise<void> {
    const state = usePresentationStore.getState()
    this.writes.push({
      revision: document.revision,
      baseRevision: options.baseRevision,
      saving: state.saving,
      dirty: state.dirty,
      assetIds: media.map((record) => record.assetId),
    })
    return super.savePresentation(document, media, options)
  }
}

/** A write that can be held open, so the in-flight state is observable. */
class GatedPresentationRepository extends RecordingPresentationRepository {
  /** Off by default, so seeding a presentation cannot hang. */
  pause = false
  private releaseWrite: (() => void) | null = null
  private writeEntered: (() => void) | null = null
  private gate: Promise<void> = new Promise((resolve) => { this.releaseWrite = resolve })
  /** Resolves as soon as a paused write has been entered. */
  readonly entered: Promise<void> = new Promise((resolve) => { this.writeEntered = resolve })

  override async savePresentation(document: PresentationDocument, media: PresentationMediaRecord[] = [], options: SavePresentationOptions = {}): Promise<void> {
    if (this.pause) {
      this.writeEntered?.()
      await this.gate
    }
    return super.savePresentation(document, media, options)
  }

  release(): void {
    this.releaseWrite?.()
  }
}

/** A held image: real asset shape, fabricated bytes (the repository only checks they exist). */
function preparedImage(id: string): PreparedPresentationImage {
  return {
    asset: {
      id,
      blobKey: `uploads/${id}`,
      mimeType: 'image/png',
      width: 8,
      height: 8,
      sha256: 'a'.repeat(64),
      provenance: { source: 'upload', label: `${id}.png` },
    },
    media: { assetId: id, bytes: new Uint8Array([id.length, id.charCodeAt(id.length - 1)]), mimeType: 'image/png' },
  }
}

const PRESENTATION_ID = 'p19-save'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  usePresentationStore.getState().closeDocument()
  vi.useRealTimers()
})

async function openEditor(repository: MemoryPresentationRepository): Promise<PresentationDocument> {
  const created = createPresentationDocument({ id: PRESENTATION_ID, title: 'P19' })
  await repository.savePresentation(created)
  const stored = await repository.getPresentation(PRESENTATION_ID)
  usePresentationStore.getState().loadDocument(stored, { saved: true })
  // Seeding the presentation is not a write under test.
  if (repository instanceof RecordingPresentationRepository) repository.writes.length = 0
  return stored
}

function editor(repository: MemoryPresentationRepository) {
  return renderHook(() => usePresentationSave({ repository, documentId: PRESENTATION_ID }))
}

const store = () => usePresentationStore.getState()
const slideId = () => store().document!.slides[0]!.id
const storedSlideName = async (repository: MemoryPresentationRepository) => (await repository.getPresentation(PRESENTATION_ID)).slides[0]!.name

async function advanceAutosave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
  })
}

describe('presentation save status', () => {
  it('autosaves a completed command as dirty → saving → saved locally', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    act(() => { store().renameSlide(slideId(), 'Renamed slide') })
    expect(view.result.current.state.status).toBe('clean')
    expect(store().dirty).toBe(true)
    expect(repository.writes).toHaveLength(0)

    await advanceAutosave()

    // The write happened while the store was truthfully marked saving and dirty.
    expect(repository.writes).toHaveLength(1)
    expect(repository.writes[0]).toMatchObject({ revision: 1, baseRevision: 0, saving: true, dirty: true })
    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    expect(store().dirty).toBe(false)
    expect(store().savedRevision).toBe(store().document!.revision)
    expect(store().saving).toBe(false)
    expect(await storedSlideName(repository)).toBe('Renamed slide')
  })

  it('reports a failed write in words and keeps the edit editable and dirty', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    act(() => { store().renameSlide(slideId(), 'Renamed slide') })
    repository.injectWriteFailure()
    await advanceAutosave()

    expect(view.result.current.state.status).toBe('failed')
    expect(view.result.current.state.message).toMatch(/could not be written to local storage/i)
    expect(view.result.current.state.message).toMatch(/press Save to try again/i)
    expect(store().saving).toBe(false)
    expect(store().dirty).toBe(true)
    // Nothing was written, and the local document is still the edited one.
    expect(await storedSlideName(repository)).toBe('Slide 1')
    expect(store().document!.slides[0]!.name).toBe('Renamed slide')

    // Still editable, and the next completed command retries the save on its own.
    act(() => { store().renameSlide(slideId(), 'Renamed again') })
    expect(store().document!.slides[0]!.name).toBe('Renamed again')
    expect(store().dirty).toBe(true)

    await advanceAutosave()

    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    expect(store().dirty).toBe(false)
    expect(await storedSlideName(repository)).toBe('Renamed again')
  })

  it('surfaces a stale baseRevision as a conflict and never overwrites the newer version', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    // Another tab saved a newer revision of the same presentation while this
    // editor stayed open: the stored row is the newer work.
    const newer = await repository.getPresentation(PRESENTATION_ID)
    newer.revision = 7
    newer.slides[0]!.name = 'Saved in another tab'
    await repository.savePresentation(newer)

    act(() => { store().renameSlide(slideId(), 'My local rename') })
    await act(async () => { await view.result.current.saveNow() })

    expect(view.result.current.state.status).toBe('conflict')
    expect(view.result.current.state.message).toMatch(/another tab or window/i)
    expect(repository.writes.at(-1)).toMatchObject({ baseRevision: 0 })
    expect(store().dirty).toBe(true)
    expect(store().document!.slides[0]!.name).toBe('My local rename')

    const stored = await repository.getPresentation(PRESENTATION_ID)
    expect(stored.revision).toBe(7)
    expect(stored.slides[0]!.name).toBe('Saved in another tab')
  })

  it('holds the autosave while a history group — an open text session — is in progress', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    const element = createTextElement({ name: 'Text', x: 40, y: 60, width: 300, height: 120, paragraphs: [] })
    act(() => {
      store().addElement(element)
      store().startTextEdit(element.id)
      // One keystroke inside the session's own group: the gesture stays open.
      store().updateText(element.id, [{ runs: [{ text: 'Mid gesture', fontId: 'be-vietnam-pro', size: 28, color: '#08152f' }], alignment: 'left', bullet: 'none', bulletLevel: 0 }], {
        historyGroup: textHistoryGroup(element.id),
      })
    })
    expect(store().lastHistoryGroup).toBe(textHistoryGroup(element.id))

    await advanceAutosave()

    // Nothing is written while the session holds the group, however long the quiet lasts.
    expect(repository.writes).toHaveLength(0)
    expect(view.result.current.state.status).toBe('clean')

    act(() => { store().endHistoryGroup() })
    await advanceAutosave()

    expect(repository.writes).toHaveLength(1)
    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    expect(store().dirty).toBe(false)
  })

  it('asks the browser to confirm closing only while there is unsaved work', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    act(() => { store().renameSlide(slideId(), 'Renamed slide') })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    await act(async () => { await view.result.current.saveNow() })
    const saved = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(saved)
    expect(saved.defaultPrevented).toBe(false)

    // The guard goes away with the editor.
    view.unmount()
    act(() => { store().renameSlide(slideId(), 'Dirty after unmount') })
    const detached = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(detached)
    expect(detached.defaultPrevented).toBe(false)
  })

  it('coalesces concurrent requests and never re-saves an unchanged revision', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    act(() => { store().renameSlide(slideId(), 'Renamed slide') })
    await act(async () => {
      await Promise.all([view.result.current.saveNow(), view.result.current.saveNow()])
    })

    expect(repository.writes).toHaveLength(1)
    expect(view.result.current.state.status).toBe('saved')

    // A save request on a clean document is not a write.
    await act(async () => { await view.result.current.saveNow() })
    expect(repository.writes).toHaveLength(1)
  })
})

describe('presentation save flushing', () => {
  it('writes text that is still only on screen in an open session, without closing it', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    const element = createTextElement({ name: 'Text', x: 40, y: 60, width: 300, height: 120, paragraphs: [] })
    act(() => {
      store().addElement(element)
      store().startTextEdit(element.id)
    })

    // The overlay's field, holding text the document has not seen yet.
    const field = globalThis.document.createElement('div')
    field.setAttribute('data-testid', 'text-edit-field')
    field.innerHTML = '<p>Typed on screen</p>'
    globalThis.document.body.appendChild(field)

    await act(async () => { await view.result.current.saveNow() })

    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    const written = (await repository.getPresentation(PRESENTATION_ID)).slides[0]!.elements.find((candidate) => candidate.id === element.id)
    expect(written?.kind).toBe('text')
    expect(written?.kind === 'text' ? written.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('') : '').toBe('Typed on screen')
    // Flushing reuses the session's history group: the session stays open and the
    // whole session is still one undo entry.
    expect(store().view.editingElementId).toBe(element.id)
    expect(store().past).toHaveLength(2)

    field.remove()
  })

  it('submits the bytes of a just-inserted image, not an empty media list', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    const bytes = fixtureImagePng()
    const assetId = `asset-${FIXTURE_IMAGE_SHA256}`
    act(() => {
      store().insertImage({
        asset: {
          id: assetId,
          blobKey: `uploads/${FIXTURE_IMAGE_SHA256}`,
          mimeType: 'image/png',
          width: 256,
          height: 256,
          sha256: FIXTURE_IMAGE_SHA256,
          provenance: { source: 'upload', label: 'photo.png' },
        },
        media: { assetId, bytes, mimeType: 'image/png' },
      })
    })

    await advanceAutosave()

    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    // A hook that submitted `[]` would fail this with missing_asset and store no artwork.
    expect(repository.writes.at(-1)?.assetIds).toEqual([assetId])
    const stored = await repository.getPresentation(PRESENTATION_ID)
    expect(stored.assets).toMatchObject([{ id: assetId, sha256: FIXTURE_IMAGE_SHA256 }])
    expect(stored.slides[0]!.elements.at(-1)).toMatchObject({ kind: 'image', assetId })
    // The written bytes are the inserted ones, and they are no longer held.
    expect(Array.from((await repository.getMedia(assetId)).bytes)).toEqual(Array.from(bytes))
    expect(store().pendingMedia).toEqual([])
  })

  it('drops only the media the write persisted, keeping artwork inserted while it was in flight', async () => {
    const repository = new GatedPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    act(() => {
      store().insertImage(preparedImage('asset-first'))
      store().insertImage(preparedImage('asset-second'))
    })

    repository.pause = true
    let writing!: Promise<void>
    act(() => { writing = view.result.current.saveNow() })
    await act(async () => { await repository.entered })

    // A third insert lands while the write of the first two is still in flight.
    act(() => { store().insertImage(preparedImage('asset-third')) })
    expect(store().pendingMedia.map((record) => record.assetId)).toEqual(['asset-first', 'asset-second', 'asset-third'])

    await act(async () => {
      repository.release()
      await writing
    })

    expect(repository.writes.at(-1)?.assetIds).toEqual(['asset-first', 'asset-second'])
    // Recomputing `mediaForSave()` after the write would drop the third asset's
    // bytes, and every later save would then fail with missing_asset.
    expect(store().pendingMedia.map((record) => record.assetId)).toEqual(['asset-third'])
    expect(store().dirty).toBe(true)

    await act(async () => { await view.result.current.saveNow() })

    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    expect(repository.writes.at(-1)?.assetIds).toEqual(['asset-third'])
    expect(await repository.hasMedia('asset-third')).toBe(true)
    expect(store().dirty).toBe(false)
  })

  it('writes text that is only on screen when the debounce fires, without closing the session', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    const element = createTextElement({ name: 'Text', x: 40, y: 60, width: 300, height: 120, paragraphs: [] })
    act(() => {
      store().addElement(element)
      store().startTextEdit(element.id)
    })

    const field = globalThis.document.createElement('div')
    field.setAttribute('data-testid', 'text-edit-field')
    field.innerHTML = '<p>Typed before the debounce</p>'
    globalThis.document.body.appendChild(field)

    await advanceAutosave()

    const written = (await repository.getPresentation(PRESENTATION_ID)).slides[0]!.elements.find((candidate) => candidate.id === element.id)
    expect(written?.kind).toBe('text')
    expect(written?.kind === 'text' ? written.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('') : '').toBe('Typed before the debounce')
    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    // The flush stays inside the session's history group: still open, still one undo entry.
    expect(store().view.editingElementId).toBe(element.id)
    expect(store().lastHistoryGroup).toBe(textHistoryGroup(element.id))
    expect(store().past).toHaveLength(2)

    field.remove()
  })

  it('submits only the media the document references, keeping bytes redo still needs', async () => {
    const repository = new RecordingPresentationRepository()
    await openEditor(repository)
    const view = editor(repository)

    const asset = {
      id: 'asset-p19',
      blobKey: 'uploads/asset-p19',
      mimeType: 'image/png' as const,
      width: 8,
      height: 8,
      sha256: 'a'.repeat(64),
      provenance: { source: 'upload' as const, label: 'photo.png' },
    }
    act(() => {
      store().insertImage({ asset, media: { assetId: asset.id, bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/png' } })
    })
    act(() => { store().undo() })

    expect(store().pendingMedia).toHaveLength(1)
    expect(store().mediaForSave()).toHaveLength(0)

    await act(async () => { await view.result.current.saveNow() })

    // Submitting the raw held record would fail here (`invalid_asset`).
    expect(view.result.current.state).toEqual({ status: 'saved', message: null })
    expect(repository.writes.at(-1)?.assetIds).toEqual([])
    // The unreferenced bytes stay held: redo must still be able to save them.
    expect(store().pendingMedia).toHaveLength(1)
  })
})

describe('presentation editor save wiring', () => {
  function renderEditor(repository: PresentationRepository) {
    return render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/presentations/${PRESENTATION_ID}`] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/presentations/:presentationId',
            element: createElement(
              PresentationRepositoryContext.Provider,
              { value: repository },
              createElement(PresentationEditorPage),
            ),
          }),
        ),
      ),
    )
  }

  it('shows the real save state and lets the Save control write a later edit', async () => {
    const repository = new RecordingPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: PRESENTATION_ID, title: 'P19' }))
    repository.writes.length = 0
    renderEditor(repository)
    await act(async () => {})

    expect(screen.getByText('Saved locally')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    await advanceAutosave()

    expect(screen.getByText('Saved locally')).toBeTruthy()
    const stored = await repository.getPresentation(PRESENTATION_ID)
    expect(stored.slides[0]!.elements).toHaveLength(1)
    expect(repository.writes).toHaveLength(1)

    // The status region is the shared one, so its announcement stays in place.
    expect(globalThis.document.querySelectorAll('.presentation-local-status[role="status"]')).toHaveLength(1)

    act(() => { usePresentationStore.getState().renameSlide(stored.slides[0]!.id, 'Saved by the control') })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => {})

    expect(screen.getByText('Saved locally')).toBeTruthy()
    expect(repository.writes).toHaveLength(2)
    expect((await repository.getPresentation(PRESENTATION_ID)).slides[0]!.name).toBe('Saved by the control')
  })

  it('says a failed write in the status region and recovers through the Save control', async () => {
    const repository = new RecordingPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: PRESENTATION_ID, title: 'P19' }))
    repository.writes.length = 0
    renderEditor(repository)
    await act(async () => {})

    const slide = usePresentationStore.getState().document!.slides[0]!
    repository.injectWriteFailure()
    act(() => { usePresentationStore.getState().renameSlide(slide.id, 'Kept locally') })
    await advanceAutosave()

    // The failure is readable text, not a tooltip, and the edit is untouched.
    expect(screen.getByText(/^Save failed — /)).toBeTruthy()
    expect(usePresentationStore.getState().dirty).toBe(true)
    expect(usePresentationStore.getState().document!.slides[0]!.name).toBe('Kept locally')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => {})

    expect(screen.getByText('Saved locally')).toBeTruthy()
    expect(usePresentationStore.getState().dirty).toBe(false)
    expect((await repository.getPresentation(PRESENTATION_ID)).slides[0]!.name).toBe('Kept locally')
  })

  it('shows the write in progress while a save is in flight', async () => {
    const repository = new GatedPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: PRESENTATION_ID, title: 'P19' }))
    repository.writes.length = 0
    renderEditor(repository)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    repository.pause = true
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => { await repository.entered })

    // The middle state of dirty → saving → saved is visible, not skipped.
    expect(screen.getByText('Saving…')).toBeTruthy()

    await act(async () => { repository.release() })
    await act(async () => {})

    expect(screen.getByText('Saved locally')).toBeTruthy()
    expect(usePresentationStore.getState().dirty).toBe(false)
  })

  it('names a stale write as a conflict in the status region, not as a generic failure', async () => {
    const repository = new RecordingPresentationRepository()
    await repository.savePresentation(createPresentationDocument({ id: PRESENTATION_ID, title: 'P19' }))
    repository.writes.length = 0
    renderEditor(repository)
    await act(async () => {})

    // Another tab saved a newer revision of the same presentation while this
    // editor stayed open: the stored row is the newer work.
    const newer = await repository.getPresentation(PRESENTATION_ID)
    newer.revision = 7
    newer.slides[0]!.name = 'Saved in another tab'
    await repository.savePresentation(newer)
    repository.writes.length = 0

    const slide = usePresentationStore.getState().document!.slides[0]!
    act(() => { usePresentationStore.getState().renameSlide(slide.id, 'My local rename') })
    await advanceAutosave()

    const status = screen.getByText(/^Save conflict — /)
    expect(status.textContent).toMatch(/another tab or window/i)
    expect(status.textContent).not.toMatch(/could not be written to local storage/i)
    expect(screen.queryByText(/^Save failed — /)).toBeNull()
    // The stale write was attempted against the revision this editor had read,
    // and the newer stored work is untouched.
    expect(repository.writes).toHaveLength(1)
    expect(repository.writes.at(-1)).toMatchObject({ baseRevision: 0 })
    expect(usePresentationStore.getState().dirty).toBe(true)
    expect(usePresentationStore.getState().document!.slides[0]!.name).toBe('My local rename')
    expect((await repository.getPresentation(PRESENTATION_ID)).slides[0]!.name).toBe('Saved in another tab')
  })
})
