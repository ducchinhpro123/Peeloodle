import { ArrowDown, ArrowLeft, ArrowUp, Copy, ImagePlus, MonitorUp, PenLine, Plus, Redo2, Save, ShieldAlert, Trash2, Type, Undo2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useOptionalRepository } from '@/app/repository'
import { usePresentationRepository } from '@/app/presentationRepositoryContext'
import { isPersistenceError } from '@/lib/persistence/repository'
import { decodeImageBitmap } from '@/lib/imageDecode'
import type { PresentationMediaRecord } from '@/lib/persistence/presentations/repository'
import { isUnmodifiedPrimaryClick } from '../../editor/toolIntent'
import { isPresentationParseError } from '../model/parse'
import { createTextElement } from '../model/factories'
import type { PresentationDocument } from '../model/types'
import { ensurePresentationFonts } from '../rendering/fonts'
import type { PresentationImageSource, PresentationImageSources } from '../rendering/renderSlide'
import { PresentationCanvasControls } from './PresentationCanvasControls'
import { ElementLayerList } from './ElementLayerList'
import { ElementGeometryInspector } from './ElementGeometryInspector'
import { PrepareImageError, preparePresentationImage, type PreparedPresentationImage } from './insertImageAsset'
import { prepareStickerSnapshot } from './insertStickerSnapshot'
import { StickerPickerDialog } from './StickerPickerDialog'
import { createSlideShape, type ShapeInsertKind } from './shapeTools'
import { TextEditOverlay } from './TextEditOverlay'
import { TextFormatToolbar } from './TextFormatToolbar'
import { ThemeControls } from './ThemeControls'
import { usePresentationSave, type PersistInsertOutcome } from './usePresentationSave'
import { usePresentationExport } from './usePresentationExport'
import { ExportDialog } from './ExportDialog'
import { usePresentationShortcuts } from './usePresentationShortcuts'
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
    // The shared helper applies the same EXIF orientation policy as every other
    // decode site, so a rotated phone JPEG cannot draw with swapped axes against
    // the asset width/height that fitImageWithinSlide already used.
    const bitmap = await decodeImageBitmap(blob)
    return { source: bitmap, dispose: () => bitmap.close() }
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
  const stickerRepository = useOptionalRepository()
  const document = usePresentationStore((state) => state.document)
  const activeSlideId = usePresentationStore((state) => state.view.activeSlideId)
  const selectedElementIds = usePresentationStore((state) => state.view.selectedElementIds)
  const editingElementId = usePresentationStore((state) => state.view.editingElementId)
  const dirty = usePresentationStore((state) => state.dirty)
  const canUndo = usePresentationStore((state) => state.past.length > 0)
  const canRedo = usePresentationStore((state) => state.future.length > 0)
  const save = usePresentationSave({ repository, documentId: presentationId })
  const exportController = usePresentationExport({ repository })
  usePresentationShortcuts()
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [inserting, setInserting] = useState(false)
  const [insertError, setInsertError] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [editorNote, setEditorNote] = useState<string | null>(null)
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null)
  const mediaRef = useRef<DecodedMedia | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const slideButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const [focusSlideId, setFocusSlideId] = useState<string | null>(null)

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

  useEffect(() => {
    if (focusSlideId === null) return
    const button = slideButtonRefs.current.get(focusSlideId)
    if (!button) return
    button.focus()
    setFocusSlideId(null)
  }, [document, focusSlideId])

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

  const addSlide = () => {
    const id = usePresentationStore.getState().addSlide()
    if (id) setFocusSlideId(id)
  }

  const addShape = (kind: ShapeInsertKind) => {
    const store = usePresentationStore.getState()
    if (!store.document) return
    const element = createSlideShape(kind, store.document.pageSize)
    // Blocks take the document's accent; linear kinds keep their stroke colour.
    if (element.shape !== 'line' && element.shape !== 'arrow') element.fill = store.document.theme.colors.accent ?? element.fill
    store.addElement(element)
  }

  const duplicateActiveSlide = () => {
    const store = usePresentationStore.getState()
    const activeId = store.view.activeSlideId
    if (!activeId) return
    const id = store.duplicateSlide(activeId)
    if (id) setFocusSlideId(id)
  }

  const moveSlide = (slideId: string, targetIndex: number) => {
    usePresentationStore.getState().reorderSlide(slideId, targetIndex)
  }

  const deleteSlide = (slideId: string) => {
    const store = usePresentationStore.getState()
    if (!store.removeSlide(slideId)) return
    const survivor = usePresentationStore.getState().view.activeSlideId
    if (survivor) setFocusSlideId(survivor)
  }

  /**
   * Persist, then adopt: the repository writes the document and this image's
   * bytes in one transaction, and only then does the editor add the element and
   * decode the artwork. A refused or failed insert therefore leaves both the
   * document and the screen exactly as they were, and no success is ever shown
   * for it.
   */
  /**
   * Persist, then adopt: the repository writes the document and this image's
   * bytes in one transaction, and only then does the editor show the artwork.
   * Shared by insertion and replacement so neither path can report success for a
   * half-written change.
   */
  const runImageWrite = async (
    prepare: () => Promise<PreparedPresentationImage>,
    write: (prepared: PreparedPresentationImage) => Promise<PersistInsertOutcome>,
    fallback: string,
  ) => {
    const store = usePresentationStore.getState()
    if (!store.document) return
    if (!mediaRef.current) {
      setInsertError('This presentation is still opening its artwork, so the image was not added. Try again once the slide appears.')
      return
    }
    setInsertError(null)

    setInserting(true)
    // Past the write the element, its asset and its bytes are stored, so a later
    // display failure must not be reported as a failed write.
    let persisted = false
    try {
      const prepared = await prepare()
      const outcome = await write(prepared)
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
      else setInsertError(fallback)
    } finally {
      setInserting(false)
    }
  }

  const addImage = (file: File) => runImageWrite(() => preparePresentationImage(file), (prepared) => save.persistInsert(prepared), 'This image could not be added.')

  /** Opens the file picker for a replacement; the chosen file keeps the element's placement. */
  const beginReplaceImage = (elementId: string) => {
    setReplaceTargetId(elementId)
    imageInputRef.current?.click()
  }

  const replacePhoto = (file: File) => {
    const target = replaceTargetId
    if (!target) return
    setReplaceTargetId(null)
    return runImageWrite(() => preparePresentationImage(file), (prepared) => save.persistReplace(target, prepared), 'This photo could not be replaced.')
  }

  /** Composes a saved sticker once and places the snapshot as an immutable image. */
  const addSticker = (projectId: string) => {
    if (!stickerRepository) {
      setInsertError('Saved stickers are not available in this session.')
      return
    }
    return runImageWrite(() => prepareStickerSnapshot(stickerRepository, projectId), (prepared) => save.persistInsert(prepared), 'This sticker could not be added.')
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
          <Button
            className="icon"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={!canUndo}
            onClick={() => usePresentationStore.getState().undo()}
          >
            <Undo2 size={17} aria-hidden="true" />
          </Button>
          <Button
            className="icon"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!canRedo}
            onClick={() => usePresentationStore.getState().redo()}
          >
            <Redo2 size={17} aria-hidden="true" />
          </Button>
          <label className="presentation-add-shape">
            <span className="sr-only">Add shape</span>
            <select
              aria-label="Add shape"
              value=""
              onChange={(event) => {
                const kind = event.target.value as ShapeInsertKind
                if (kind) addShape(kind)
              }}
            >
              <option value="">Add shape…</option>
              <option value="rectangle">Rectangle</option>
              <option value="rounded-rectangle">Rounded rectangle</option>
              <option value="ellipse">Ellipse</option>
              <option value="line">Line</option>
              <option value="arrow">Arrow</option>
            </select>
          </label>
          <Button onClick={addTextBox}><Type size={16} aria-hidden="true" /> Add text</Button>
          <Button disabled={inserting} onClick={() => { setReplaceTargetId(null); imageInputRef.current?.click() }}>
            <ImagePlus size={16} aria-hidden="true" /> {inserting ? 'Adding image…' : 'Add image'}
          </Button>
          {stickerRepository ? <StickerPickerDialog repository={stickerRepository} disabled={inserting} onPick={(projectId) => void addSticker(projectId)} /> : null}
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
              if (!file) return
              if (replaceTargetId) void replacePhoto(file)
              else void addImage(file)
            }}
          />
          {selectedText ? (
            <Button aria-label={`Edit text: ${selectedText.name}`} onClick={() => usePresentationStore.getState().startTextEdit(selectedText.id)}>
              <PenLine size={16} aria-hidden="true" /> Edit text
            </Button>
          ) : null}
          {selectedElement ? (
            /* The wide pane is hidden from 1150px down, so the same numeric fields
               stay reachable through the shared dialog at tablet and phone widths. */
            <Dialog>
              <DialogTrigger asChild>
                <Button className="properties-toggle">Element properties</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Element properties</DialogTitle>
                <DialogDescription>Exact document values for the selected element. Typing here is the keyboard path to the same numbers the canvas handles produce.</DialogDescription>
                <ElementGeometryInspector element={selectedElement} onReplaceImage={beginReplaceImage} />
              </DialogContent>
            </Dialog>
          ) : null}
          <Dialog>
            <DialogTrigger asChild>
              <Button>Theme</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Presentation theme</DialogTitle>
              <DialogDescription>Defaults for new slides and text. Existing elements keep their own styles.</DialogDescription>
              <ThemeControls theme={document.theme} onChange={(next) => usePresentationStore.getState().setTheme(next, { historyGroup: 'theme' })} />
            </DialogContent>
          </Dialog>
          <ExportDialog
            state={exportController.state}
            onExport={(format) => void exportController.exportDeck(format)}
            onCancel={exportController.cancel}
          />
          <Button onClick={requestSave}><Save size={16} aria-hidden="true" /> Save</Button>
          {save.state.status === 'conflict' ? (
            <Button disabled={recovering} onClick={() => void recoverFromConflict()}>
              {recovering ? 'Keeping your copy…' : 'Keep my copy'}
            </Button>
          ) : null}
          {saveReported ? (
            /* Recovery guidance: if the local write fails, the work can still leave
               the browser as a backup archive. */
            <Button onClick={() => void exportController.exportDeck('backup')}>Download backup</Button>
          ) : null}
          <p className="presentation-local-status" role="status" title={save.state.message ?? undefined}>{editorNote ?? saveStatus}</p>
        </div>
      </header>
      {editingElementId ? <TextFormatToolbar /> : null}
      {insertError ? <p className="asset-error" role="alert">{insertError}</p> : null}
      <div className="presentation-mobile-note">
        <MonitorUp size={18} aria-hidden="true" />
        <span>Presentation authoring is designed for a laptop or desktop. This preview remains available on your phone.</span>
      </div>
      <div className="presentation-workspace">
        <aside className="presentation-slide-rail" aria-label="Slides">
          <p>Slides</p>
          <div className="presentation-slide-rail-actions">
            <Button aria-label="Add slide" title="Add slide" onClick={addSlide}>
              <Plus size={16} aria-hidden="true" />
              <span>Add slide</span>
            </Button>
            <Button aria-label="Duplicate active slide" title="Duplicate active slide" onClick={duplicateActiveSlide}>
              <Copy size={16} aria-hidden="true" />
              <span>Duplicate</span>
            </Button>
          </div>
          <div className="presentation-slide-list">
            {document.slides.map((slide, index) => (
              <div className="presentation-slide-item" key={slide.id}>
                <button
                  ref={(button) => {
                    if (button) slideButtonRefs.current.set(slide.id, button)
                    else slideButtonRefs.current.delete(slide.id)
                  }}
                  type="button"
                  className="presentation-slide-card"
                  aria-current={slide.id === activeSlide?.id ? 'true' : undefined}
                  aria-label={`Show slide ${index + 1}: ${slide.name}`}
                  onClick={() => usePresentationStore.getState().selectSlide(slide.id)}
                >
                  <span aria-hidden="true">{index + 1}</span>
                  <b>{slide.name}</b>
                </button>
                <div className="presentation-slide-item-actions">
                  <Button
                    className="presentation-slide-action"
                    aria-label={`Move slide ${index + 1} up`}
                    title={`Move slide ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => moveSlide(slide.id, index - 1)}
                  >
                    <ArrowUp size={15} aria-hidden="true" />
                  </Button>
                  <Button
                    className="presentation-slide-action"
                    aria-label={`Move slide ${index + 1} down`}
                    title={`Move slide ${index + 1} down`}
                    disabled={index === document.slides.length - 1}
                    onClick={() => moveSlide(slide.id, index + 1)}
                  >
                    <ArrowDown size={15} aria-hidden="true" />
                  </Button>
                  <Button
                    className="presentation-slide-action presentation-slide-delete"
                    aria-label={`Delete slide ${index + 1}`}
                    title={`Delete slide ${index + 1}`}
                    disabled={document.slides.length <= 1}
                    onClick={() => deleteSlide(slide.id)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <p>Elements</p>
          <ElementLayerList />
        </aside>
        <PresentationCanvasSlot images={loadState.images} />
        <aside className="presentation-inspector" aria-label="Presentation details">
          <p>Page</p>
          <dl>
            <div><dt>Size</dt><dd>{document.pageSize.width} × {document.pageSize.height}</dd></div>
            <div><dt>Slides</dt><dd>{document.slides.length}</dd></div>
            <div><dt>Elements</dt><dd>{activeSlide?.elements.length ?? 0}</dd></div>
          </dl>
          {activeSlide ? (
            <label className="presentation-slide-background">
              Slide background
              <input
                type="color"
                aria-label="Slide background"
                value={activeSlide.background}
                onChange={(event) => usePresentationStore.getState().setSlideBackground(activeSlide.id, event.target.value, { historyGroup: `slide-bg:${activeSlide.id}` })}
                onBlur={() => usePresentationStore.getState().endHistoryGroup()}
              />
            </label>
          ) : null}
          {selectedElement ? (
            <>
              <p>{selectedElement.name || 'Element'}</p>
              <ElementGeometryInspector element={selectedElement} onReplaceImage={beginReplaceImage} />
            </>
          ) : null}
          <p className="muted">Drag an element on the slide to move it, use a corner handle to resize, and the round handle to rotate. These values are the same document units — type one to place an element exactly.</p>
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
