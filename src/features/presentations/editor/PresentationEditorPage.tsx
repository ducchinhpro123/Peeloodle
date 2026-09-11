import { ArrowLeft, MonitorUp, ShieldAlert } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { usePresentationRepository } from '@/app/presentationRepositoryContext'
import { isPersistenceError } from '@/lib/persistence/repository'
import type { PresentationMediaRecord } from '@/lib/persistence/presentations/repository'
import { isPresentationParseError } from '../model/parse'
import { ensurePresentationFonts } from '../rendering/fonts'
import type { PresentationImageSource, PresentationImageSources } from '../rendering/renderSlide'
import { PresentationCanvasControls } from './PresentationCanvasControls'
import { usePresentationStore } from './store'

const PresentationCanvas = lazy(() => import('./PresentationCanvas').then((module) => ({ default: module.PresentationCanvas })))

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; images: PresentationImageSources }
  | { status: 'missing' }
  | { status: 'missing-media' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string }

type DecodedMedia = {
  images: Map<string, PresentationImageSource>
  dispose(): void
}

async function decodeMedia(records: PresentationMediaRecord[]): Promise<DecodedMedia> {
  const images = new Map<string, PresentationImageSource>()
  const bitmaps: ImageBitmap[] = []
  const objectUrls: string[] = []

  try {
    for (const record of records) {
      const blob = new Blob([record.bytes], { type: record.mimeType })
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob)
        bitmaps.push(bitmap)
        images.set(record.assetId, bitmap)
        continue
      }

      const url = URL.createObjectURL(blob)
      objectUrls.push(url)
      const image = new Image()
      image.src = url
      await image.decode()
      images.set(record.assetId, image)
    }
  } catch (error) {
    for (const bitmap of bitmaps) bitmap.close()
    for (const url of objectUrls) URL.revokeObjectURL(url)
    throw error
  }

  return {
    images,
    dispose() {
      for (const bitmap of bitmaps) bitmap.close()
      for (const url of objectUrls) URL.revokeObjectURL(url)
    },
  }
}

export function PresentationEditorPage() {
  const { presentationId = '' } = useParams()
  const repository = usePresentationRepository()
  const document = usePresentationStore((state) => state.document)
  const activeSlideId = usePresentationStore((state) => state.view.activeSlideId)
  const dirty = usePresentationStore((state) => state.dirty)
  const saving = usePresentationStore((state) => state.saving)
  const saveError = usePresentationStore((state) => state.saveError)
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

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
  const saveStatus = saveError ? 'Save failed' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved locally'

  return (
    <div className="presentation-editor">
      <header className="presentation-editor-bar">
        <Link className="button icon" aria-label="Back to presentations" to="/presentations"><ArrowLeft size={19} /></Link>
        <div className="presentation-editor-title">
          <p>Presentation</p>
          <h1 title={document.title}>{document.title}</h1>
        </div>
        <p className="presentation-local-status" role="status" title={saveError ?? undefined}>{saveStatus}</p>
      </header>
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
          <p className="muted">Editing tools arrive in the next presentation increments.</p>
        </aside>
      </div>
    </div>
  )
}

export default PresentationEditorPage

function PresentationCanvasSlot({ images }: { images: PresentationImageSources }) {
  const document = usePresentationStore((state) => state.document)
  const zoom = usePresentationStore((state) => state.view.zoom)
  const pan = usePresentationStore((state) => state.view.pan)

  if (import.meta.env.MODE === 'test') {
    if (!document) return null
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
        />
      </section>
    )
  }

  return <Suspense fallback={<p className="presentation-canvas-loading" role="status">Preparing slide canvas…</p>}><PresentationCanvas images={images} /></Suspense>
}
