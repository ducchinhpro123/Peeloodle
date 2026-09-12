import { ArrowLeft, ImagePlus, MonitorUp, PenLine, Save, ShieldAlert, Type } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { usePresentationRepository } from '@/app/presentationRepositoryContext'
import { isPersistenceError } from '@/lib/persistence/repository'
import type { PresentationMediaRecord } from '@/lib/persistence/presentations/repository'
import { isPresentationParseError } from '../model/parse'
import { createTextElement } from '../model/factories'
import { PRESENTATION_LIMITS } from '../model/limits'
import { ensurePresentationFonts } from '../rendering/fonts'
import type { PresentationImageSource, PresentationImageSources } from '../rendering/renderSlide'
import { PresentationCanvasControls } from './PresentationCanvasControls'
import { PrepareImageError, preparePresentationImage } from './insertImageAsset'
import { TextEditOverlay } from './TextEditOverlay'
import { usePresentationSave } from './usePresentationSave'
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
  const disposers: Array<() => void> = []

  try {
    for (const record of records) {
      const decoded = await decodeImageSource(new Blob([record.bytes], { type: record.mimeType }))
      disposers.push(decoded.dispose)
      images.set(record.assetId, decoded.source)
    }
  } catch (error) {
    for (const dispose of disposers) dispose()
    throw error
  }

  return {
    images,
    async add(next) {
      for (const record of next) {
        const decoded = await decodeImageSource(new Blob([record.bytes], { type: record.mimeType }))
        disposers.push(decoded.dispose)
        images.set(record.assetId, decoded.source)
      }
    },
    dispose() {
      for (const dispose of disposers) dispose()
    },
  }
}

export function PresentationEditorPage() {
  const { presentationId = '' } = useParams()
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
  const mediaRef = useRef<DecodedMedia | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    let decoded: DecodedMedia | undefined
    setLoadState({ status: 'loading' })

    void (async () => {
      try {
        const fontsPromise = ensurePresentationFonts()
        const loadedDocument = await repository.getPresentation(presentationId)

        let media: PresentationMediaRecord[]
        try {
          media = await Promise.all(loadedDocument.assets.map((asset) => repository.getMedia(asset.id)))
        } catch (mediaError) {
          // The document exists but its artwork does not: do not report the whole
          // presentation as deleted, and keep retry available.
          if (isPersistenceError(mediaError) && mediaError.code === 'not_found') {
            void fontsPromise.catch(() => {})
            if (live) setLoadState({ status: 'missing-media' })
            return
          }
          throw mediaError
        }

        await fontsPromise
        decoded = await decodeMedia(media)
        if (!live) {
          decoded.dispose()
          return
        }
        mediaRef.current = decoded
        usePresentationStore.getState().loadDocument(loadedDocument, { saved: true })
        setLoadState({ status: 'ready', images: decoded.images })
      } catch (error) {
        if (!live) return
        decoded?.dispose()
        decoded = undefined
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
      mediaRef.current = null
      decoded?.dispose()
      if (usePresentationStore.getState().document?.id === presentationId) usePresentationStore.getState().closeDocument()
    }
  }, [attempt, presentationId, repository])

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
   * Order matters: validate, hash, then decode the artwork, and only then ask the
   * store to insert. A rejected or undecodable file therefore leaves no element
   * behind, and an accepted one can never be drawn without its image.
   */
  const addImage = async (file: File) => {
    const store = usePresentationStore.getState()
    const current = store.document
    const media = mediaRef.current
    if (!current || !media) return
    setInsertError(null)

    const slide = current.slides.find((candidate) => candidate.id === store.view.activeSlideId) ?? current.slides[0]
    if (slide && slide.elements.length >= PRESENTATION_LIMITS.maxElementsPerSlide) {
      setInsertError(`This slide is full (${PRESENTATION_LIMITS.maxElementsPerSlide} elements). Add a slide or remove something first.`)
      return
    }

    setInserting(true)
    try {
      const prepared = await preparePresentationImage(file)
      const knownAsset = current.assets.some((asset) => asset.id === prepared.asset.id)
      if (!knownAsset && current.assets.length >= PRESENTATION_LIMITS.maxAssets) {
        setInsertError(`This presentation already holds the maximum ${PRESENTATION_LIMITS.maxAssets} images.`)
        return
      }

      await media.add([prepared.media])
      const id = store.insertImage(prepared)
      if (!id) {
        setInsertError('This image could not be added to the slide.')
        return
      }
      // A fresh Map so the canvas re-renders with the new artwork.
      setLoadState({ status: 'ready', images: new Map(media.images) })
    } catch (error) {
      setInsertError(error instanceof PrepareImageError ? error.message : 'This image could not be added.')
    } finally {
      setInserting(false)
    }
  }

  return (
    <div className="presentation-editor">
      <header className="presentation-editor-bar">
        <Link className="button icon" aria-label="Back to presentations" to="/presentations"><ArrowLeft size={19} /></Link>
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
          <Button onClick={save.requestSave}><Save size={16} aria-hidden="true" /> Save</Button>
          <p className="presentation-local-status" role="status" title={save.state.message ?? undefined}>{saveStatus}</p>
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
