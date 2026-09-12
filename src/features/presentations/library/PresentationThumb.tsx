import { useEffect, useRef, useState } from 'react'
import { usePresentationRepository } from '@/app/presentationRepositoryContext'
import {
  PRESENTATION_THUMBNAIL_HEIGHT,
  PRESENTATION_THUMBNAIL_WIDTH,
  acquirePresentationThumbnail,
  presentationThumbnailKey,
  releasePresentationThumbnail,
  type PresentationThumbnailSource,
} from './presentationThumbnails'

/**
 * The real first-slide render of one library card, drawn over the decorative
 * paper preview. The card keeps its paper until a raster exists, so loading and
 * every failure look exactly like the card did before thumbnails existed.
 *
 * The slot is an empty box that never affects layout, and the whole preview is
 * aria-hidden: the card's name and link come from the title text, not from here.
 */
export function PresentationThumb({
  documentId,
  revision,
  source,
}: {
  documentId: string
  revision: number
  /** Test seam; the library uses the stored-slide source. */
  source?: PresentationThumbnailSource
}) {
  const repository = usePresentationRepository()
  const slot = useRef<HTMLSpanElement>(null)
  const key = presentationThumbnailKey(documentId, revision)
  const [nearViewport, setNearViewport] = useState(false)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const element = slot.current
    if (!element) return
    // jsdom has no IntersectionObserver; there every card counts as on screen.
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setNearViewport(true)
        observer.disconnect()
      },
      // A little ahead of the fold, so a card is drawn before it is scrolled to.
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!nearViewport) return
    let live = true
    setUrl(null)
    void acquirePresentationThumbnail({ repository, documentId, revision }, source).then((thumbnail) => {
      if (live && thumbnail) setUrl(thumbnail.url)
    })
    return () => {
      live = false
      releasePresentationThumbnail(key)
    }
  }, [nearViewport, repository, documentId, revision, key, source])

  return (
    <span ref={slot} className="presentation-card-thumb">
      {url ? (
        <img
          data-testid="presentation-card-thumb"
          src={url}
          alt=""
          width={PRESENTATION_THUMBNAIL_WIDTH}
          height={PRESENTATION_THUMBNAIL_HEIGHT}
        />
      ) : null}
    </span>
  )
}

export default PresentationThumb
