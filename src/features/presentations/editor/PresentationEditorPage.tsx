import { ArrowLeft, ImagePlus, MonitorUp, PenLine, Save, ShieldAlert, Type } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { usePresentationRepository } from '@/app/presentationRepositoryContext'
import { isPersistenceError } from '@/lib/persistence/repository'
import type { PresentationMediaRecord } from '@/lib/persistence/presentations/repository'
import { isUnmodifiedPrimaryClick } from '../../editor/toolIntent'
import { isPresentationParseError } from '../model/parse'
import { createTextElement } from '../model/factories'
import type { PresentationDocument } from '../model/types'
import { ensurePresentationFonts } from '../rendering/fonts'
import type { PresentationImageSource, PresentationImageSources } from '../rendering/renderSlide'
import { PresentationCanvasControls } from './PresentationCanvasControls'
import { PrepareImageError, preparePresentationImage } from './insertImageAsset'
import { TextEditOverlay } from './TextEditOverlay'
import { usePresentationSave, type PersistInsertOutcome } from './usePresentationSave'
import { registerLeaveGuard } from './leaveGuard'
import { usePresentationStore } from './store'

const PresentationCanvas = lazy(() => import('./PresentationCanvas').then((module) => ({ default: module.PresentationCanvas })))

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; images: PresentationImageSources }
  | { status: 'missing' }
  | { status: 'missing-media' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string }

type DecodedSource = {
  source: PresentationImageSource
  dispose(): void
}

/** One decode path for stored and just-inserted media; the caller owns disposal. */
async function decodeImageSource(blob: Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap === 'function') {
    // Same orientation policy as every other decode site (validateUpload, backup,
    // renderDocument): a rotated phone JPEG must not draw with swapped axes against
    // the asset width/height that fitImageWithinSlide already used. The bare call
    // stays as the fallback for engines that reject the option.
    try {
      const oriented = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: oriented, dispose: () => oriented.close() }
    } catch {
      const bitmap = await createImageBitmap(blob)
      return { source: bitmap, dispose: () => bitmap.close() }
    }
  }

  const url = URL.createObjectURL(blob)
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

type DecodedMedia = {
  images: Map<string, PresentationImageSource>
  /** Decodes media held for a new asset so it can never render without artwork. */
  add(records: PresentationMediaRecord[]): Promise<void>
  dispose(): void
}

async function decodeMedia(records: PresentationMediaRecord[]): Promise<DecodedMedia> {
  const images = new Map<string, PresentationImageSource>()
  const disposers = new Map<string, () => void>()

  const decodeInto = async (record: PresentationMediaRecord) => {
    const decoded = await decodeImageSource(new Blob([record.bytes], { type: record.mimeType }))
    // Keyed by asset id so the decoded source for the SAME id can be released
    // immediately: an image inserted again under an existing asset id would
    // otherwise keep its previous bitmap (or object URL) alive until close.
    disposers.get(record.assetId)?.()
    disposers.set(record.assetId, decoded.dispose)
    images.set(record.assetId, decoded.source)
  }

  try {
    for (const record of records) await decodeInto(record)
  } catch (error) {
    for (const dispose of disposers.values()) dispose()
    throw error
  }

  return {
    images,
    async add(next) {
      for (const record of next) await decodeInto(record)
    },
    dispose() {
      for (const dispose of disposers.values()) dispose()
    },
  }
}

/**
 * Insert outcomes the status region cannot show on its own: a store refusal never
 * reaches the write path, so it has no save state to publish in. Write failures
 * (`failed`, `conflict`) are already reported there with their own message.
 */
function insertRefusalMessage(outcome: Extract<PersistInsertOutcome, { ok: false }>): string | null {
  return outcome.reason === 'failed' || outcome.reason === 'conflict' ? null : outcome.message
}

export function PresentationEditorPage() {
  const { presentationId = '' } = useParams()
  const navigate = useNavigate()
  const repository = usePresentationRepository()
  const document = usePresentationStore((state) => state.document)
  const activeSlideId = usePresentationStore((state) => state.view.activeSlideId)
  const selectedElementIds = usePresentationStore((state) => state.view.selectedElementIds)
  const dirty = usePresentationStore((state) => state.dirty)
  const save = usePresentationSave({ repository, documentId: presentationId })
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [inserting, setInserting] = useState(false)
  const [insertError, setInsertError] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [editorNote, setEditorNote] = useState<string | null>(null)
  const mediaRef = useRef<DecodedMedia | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  /**
   * Fetches and decodes one document's artwork. This is a callable rather than an
   * effect body because conflict recovery loads a NEWER revision under the SAME
   * document id: an effect keyed on the route id alone would never run again and
   * the canvas would keep showing the pre-recovery artwork.
   */
  const decodeDocumentMedia = useCallback(async (loadedDocument: PresentationDocument) => {
    const media = await Promise.all(loadedDocument.assets.map((asset) => repository.getMedia(asset.id)))
    return { media, decoded: await decodeMedia(media) }
  }, [repository])

  useEffect(() => {
    let live = true
    let decoded: DecodedMedia | undefined
    setLoadState({ status: 'loading' })

    void (async () => {
      try {
        const fontsPromise = ensurePresentationFonts()
        const loadedDocument = await repository.getPresentation(presentationId)

        try {
          decoded = (await decodeDocumentMedia(loadedDocument)).decoded
        } catch (mediaError) {
          // The document exists but its artwork does not: do not report the whole
          // presentation as deleted, and keep retry available.
          void fontsPromise.catch(() => {})
          if (isPersistenceError(mediaError) && mediaError.code === 'not_found') {
            if (live) setLoadState({ status: 'missing-media' })
            return
          }
          throw mediaError
        }

        await fontsPromise
        if (!live) {
          decoded.dispose()
          return
        }
        mediaRef.current = decoded
        const store = usePresentationStore.getState()
        store.loadDocument(loadedDocument, { saved: true })
        setLoadState({ status: 'ready', images: decoded.images })
      } catch (error) {
        decoded?.dispose()
        decoded = undefined
        if (!live) return
        if (isPersistenceError(error) && error.code === 'not_found') setLoadState({ status: 'missing' })
        else if ((isPersistenceError(error) && error.code === 'unsupported_schema') || (isPresentationParseError(error) && error.code === 'unsupported_schema')) {
          setLoadState({ status: 'unsupported' })
        } else {
          setLoadState({ status: 'error', message: 'This presentation could not be opened. Your other saved work is unchanged.' })
        }
      }
    })()

    return () => {
      live = false
      const owned = mediaRef.current
      mediaRef.current = null
      owned?.dispose()
      if (usePresentationStore.getState().document?.id === presentationId) usePresentationStore.getState().closeDocument()
    }
  }, [attempt, decodeDocumentMedia, presentationId, repository])

  /** Re-decodes the artwork of the document the store now holds (after recovery). */
  const reloadStoredArtwork = useCallback(async (): Promise<void> => {
    const current = usePresentationStore.getState().document
    if (!current || current.id !== presentationId) return
    const { decoded } = await decodeDocumentMedia(current)
    if (usePresentationStore.getState().document?.id !== presentationId) {
      decoded.dispose()
      return
    }
    const previous = mediaRef.current
    mediaRef.current = decoded
    previous?.dispose()
    setLoadState({ status: 'ready', images: new Map(decoded.images) })
  }, [decodeDocumentMedia, presentationId])

  /**
   * The one leave decision, taken before the route changes: text that is still
   * only on screen is flushed and its write awaited, so leaving cannot silently
   * drop an edit. When the write fails the editor stays put and says why. The
   * header Back link calls this directly and the shell's own nav links reach it
   * through the leave-guard registry (see leaveGuard.ts).
   *
   * ROUTER CONSTRAINT: this app renders <BrowserRouter> with <Routes>, not a data
   * router, so react-router's `useBlocker` throws here. The in-app links the shell
   * renders now consult this guard, but a programmatic navigate() and the
   * browser's Back/Forward buttons still cannot be intercepted, and the
   * `beforeunload` guard covers reload/close only.
   */
  const confirmLeave = async (event: MouseEvent): Promise<boolean> => {
    // A modified click is a new tab or window: it does not abandon this tab's work.
    if (!isUnmodifiedPrimaryClick(event)) return true
    // The decision needs a write, so the click is stopped before it is awaited.
    event.preventDefault()
    setEditorNote(null)
    if (await save.saveBeforeLeave()) return true
    setEditorNote('This presentation could not be saved, so it is still open. Press Save to try again — or press Keep my copy if another tab or window has a newer version.')
    return false
  }

  useEffect(() => {
    registerLeaveGuard(confirmLeave)
    return () => registerLeaveGuard(null)
    // Re-registered after every render, so the registered guard always uses the
    // current save path and note setter rather than an earlier render's closure.
  })

  /** The header Back link: the same decision, with its own destination. */
  const leaveEditor = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isUnmodifiedPrimaryClick(event)) return
    if (await confirmLeave(event)) navigate('/presentations')
  }

  if (loadState.status === 'loading') {
    return <Card className="presentation-route-state"><p role="status">Opening presentation…</p></Card>
  }

  if (loadState.status !== 'ready' || !document) {
    const missing = loadState.status === 'missing'
    const missingMedia = loadState.status === 'missing-media'
    const unsupported = loadState.status === 'unsupported'
    return (
      <Card className="presentation-route-state">
        <ShieldAlert size={34} aria-hidden="true" />
        <h1>{missing ? 'Presentation not found' : missingMedia ? 'Presentation artwork is missing' : unsupported ? 'This presentation needs a newer StickerLab' : 'Presentation could not be opened'}</h1>
        <p>{missing
          ? 'It may have been removed from this browser.'
          : missingMedia
            ? 'This browser no longer has the saved artwork for this presentation. Retry, or open it from the library after restoring your local data.'
            : unsupported
              ? 'This saved file uses a document version this app cannot safely edit.'
              : loadState.status === 'error' ? loadState.message : 'This presentation could not be opened.'}</p>
        <div className="button-row">
          <Link className="button primary" to="/presentations">Back to presentations</Link>
          {!missing && !unsupported ? <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button> : null}
        </div>
      </Card>
    )
  }

  const activeSlide = document.slides.find((slide) => slide.id === activeSlideId) ?? document.slides[0]
  const saveReported = save.state.status === 'failed' || save.state.status === 'conflict'
  const saveLabel = save.state.status === 'conflict'
    ? 'Save conflict'
    : save.state.status === 'failed'
      ? 'Save failed'
      : save.state.status === 'saving'
        ? 'Saving…'
        : dirty
          ? 'Unsaved changes'
          : 'Saved locally'
  // A failure is shown in words, not only in a tooltip: what happened and that
  // the edit is still here with a way to retry it.
  const saveStatus = saveReported && save.state.message ? `${saveLabel} — ${save.state.message}` : saveLabel
  const selectedElement = activeSlide?.elements.find((element) => element.id === selectedElementIds[0])
  const selectedText = selectedElement?.kind === 'text' ? selectedElement : null

  const addTextBox = () => {
    const store = usePresentationStore.getState()
    const textCount = activeSlide?.elements.filter((element) => element.kind === 'text').length ?? 0
    const element = createTextElement({
      name: textCount === 0 ? 'Text' : `Text ${textCount + 1}`,
      x: 140 + (textCount % 4) * 24,
      y: 240 + (textCount % 4) * 24,
      width: 1000,
      height: 160,
      paragraphs: [{ runs: [], alignment: 'left', bullet: 'none', bulletLevel: 0 }],
    })
    const id = store.addElement(element)
    // Open the editor straight away so the new box can be typed into immediately.
    if (id) store.startTextEdit(id)
  }

  /**
   * Persist, then adopt: the repository writes the document and this image's
   * bytes in one transaction, and only then does the editor add the element and
   * decode the artwork. A refused or failed insert therefore leaves both the
   * document and the screen exactly as they were, and no success is ever shown
   * for it.
   */
  const addImage = async (file: File) => {
    const store = usePresentationStore.getState()
    if (!store.document) return
    if (!mediaRef.current) {
      setInsertError('This presentation is still opening its artwork, so the image was not added. Try again once the slide appears.')
      return
    }
    setInsertError(null)

    setInserting(true)
    // Past the write the element, its asset and its bytes are stored, so a later
    // display failure must not be reported as a failed insert.
    let persisted = false
    try {
      const prepared = await preparePresentationImage(file)
      const outcome = await save.persistInsert(prepared)
      if (!outcome.ok) {
        setInsertError(insertRefusalMessage(outcome))
        return
      }
      persisted = true
      const media = mediaRef.current
      if (!media) {
        setInsertError('This image was saved, but this editor can no longer display it. Reopen the presentation to see it.')
        return
      }
      await media.add([prepared.media])
      // A fresh Map so the canvas re-renders with the new artwork.
      setLoadState({ status: 'ready', images: new Map(media.images) })
    } catch (error) {
      if (error instanceof PrepareImageError) setInsertError(error.message)
      else if (persisted) setInsertError('This image was saved, but it cannot be displayed here yet. Reopen the presentation to see it.')
      else setInsertError('This image could not be added.')
    } finally {
      setInserting(false)
    }
  }

  const requestSave = () => {
    setEditorNote(null)
    save.requestSave()
  }

  /**
   * The way out of a stale revision: keep the local work as a copy, then re-open
   * the newer stored revision so Save is no longer dead.
   */
  const recoverFromConflict = async () => {
    setRecovering(true)
    setEditorNote(null)
    let reopened = false
    try {
      const outcome = await save.keepMineAsCopy()
      if (!outcome.ok) {
        setEditorNote(outcome.message)
        return
      }
      // The store holds the newer revision from here on; only its artwork is left.
      reopened = true
      await reloadStoredArtwork()
      setEditorNote('Your work was saved as a separate conflict copy. The newer saved version is open now.')
    } catch {
      setEditorNote(reopened
        ? 'Your work was saved as a separate conflict copy, and the newer saved version is open — but its artwork could not be shown yet. Reload this page to see it.'
        : 'The newer version could not be reopened. Reload this page to continue.')
    } finally {
      setRecovering(false)
    }
  }

  return (
    <div className="presentation-editor">
      <header className="presentation-editor-bar">
        <Link className="button icon" aria-label="Back to presentations" to="/presentations" onClick={(event) => void leaveEditor(event)}><ArrowLeft size={19} /></Link>
        <div className="presentation-editor-title">
          <p>Presentation</p>
          <h1 title={document.title}>{document.title}</h1>
        </div>
        <div className="presentation-editor-actions">
          <Button onClick={addTextBox}><Type size={16} aria-hidden="true" /> Add text</Button>
          <Button disabled={inserting} onClick={() => imageInputRef.current?.click()}>
            <ImagePlus size={16} aria-hidden="true" /> {inserting ? 'Adding image…' : 'Add image'}
          </Button>
          <input
            ref={imageInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Choose image file"
            data-testid="presentation-image-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void addImage(file)
            }}
          />
          {selectedText ? (
            <Button aria-label={`Edit text: ${selectedText.name}`} onClick={() => usePresentationStore.getState().startTextEdit(selectedText.id)}>
              <PenLine size={16} aria-hidden="true" /> Edit text
            </Button>
          ) : null}
          <Button onClick={requestSave}><Save size={16} aria-hidden="true" /> Save</Button>
          {save.state.status === 'conflict' ? (
            <Button disabled={recovering} onClick={() => void recoverFromConflict()}>
              {recovering ? 'Keeping your copy…' : 'Keep my copy'}
            </Button>
          ) : null}
          <p className="presentation-local-status" role="status" title={save.state.message ?? undefined}>{editorNote ?? saveStatus}</p>
        </div>
      </header>
      {insertError ? <p className="asset-error" role="alert">{insertError}</p> : null}
      <div className="presentation-mobile-note">
        <MonitorUp size={18} aria-hidden="true" />
        <span>Presentation authoring is designed for a laptop or desktop. This preview remains available on your phone.</span>
      </div>
      <div className="presentation-workspace">
        <aside className="presentation-slide-rail" aria-label="Slides">
          <p>Slides</p>
          <div className="presentation-slide-list">
            {document.slides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                className="presentation-slide-card"
                aria-current={slide.id === activeSlide?.id ? 'true' : undefined}
                aria-label={`Show slide ${index + 1}: ${slide.name}`}
                onClick={() => usePresentationStore.getState().selectSlide(slide.id)}
              >
                <span aria-hidden="true">{index + 1}</span>
                <b>{slide.name}</b>
              </button>
            ))}
          </div>
        </aside>
        <PresentationCanvasSlot images={loadState.images} />
        <aside className="presentation-inspector" aria-label="Presentation details">
          <p>Page</p>
          <dl>
            <div><dt>Size</dt><dd>{document.pageSize.width} × {document.pageSize.height}</dd></div>
            <div><dt>Slides</dt><dd>{document.slides.length}</dd></div>
            <div><dt>Elements</dt><dd>{activeSlide?.elements.length ?? 0}</dd></div>
          </dl>
          <p className="muted">Select a text box on the slide to edit its content. Moving and formatting arrive in later increments.</p>
        </aside>
      </div>
    </div>
  )
}

export default PresentationEditorPage

function PresentationCanvasSlot({ images }: { images: PresentationImageSources }) {
  const document = usePresentationStore((state) => state.document)
  const activeSlideId = usePresentationStore((state) => state.view.activeSlideId)
  const selectedElementId = usePresentationStore((state) => state.view.selectedElementIds[0] ?? null)
  const editingElementId = usePresentationStore((state) => state.view.editingElementId)
  const zoom = usePresentationStore((state) => state.view.zoom)
  const pan = usePresentationStore((state) => state.view.pan)
  const activeSlide = document?.slides.find((slide) => slide.id === activeSlideId) ?? document?.slides[0]
  const editingElement = activeSlide?.elements.find((element) => element.id === editingElementId)

  if (import.meta.env.MODE === 'test') {
    if (!document) return null
    const selectedElement = activeSlide?.elements.find((element) => element.id === selectedElementId)
    return (
      <section className="presentation-canvas-panel" aria-label="Slide canvas">
        <PresentationCanvasControls />
        <div
          className="presentation-canvas"
          data-testid="presentation-canvas"
          data-document-width={document.pageSize.width}
          data-document-height={document.pageSize.height}
          data-view-zoom={zoom}
          data-view-pan-x={pan.x}
          data-view-pan-y={pan.y}
          data-selected-element={selectedElementId ?? ''}
          data-editing-element={editingElementId ?? ''}
        />
        {selectedElement && !editingElement ? <div className="presentation-selection-outline" aria-hidden="true" /> : null}
        {editingElement?.kind === 'text' ? (
          <TextEditOverlay element={editingElement} scale={1} offsetX={0} offsetY={0} theme={document.theme} />
        ) : null}
      </section>
    )
  }

  return <Suspense fallback={<p className="presentation-canvas-loading" role="status">Preparing slide canvas…</p>}><PresentationCanvas images={images} /></Suspense>
}
