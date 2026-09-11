import { ArrowRight, Clock3, FilePlus2, MonitorUp, Presentation as PresentationIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePresentationRepository } from '@/app/presentationRepositoryContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createPresentationDocument } from '../model/factories'
import type { PresentationSummary } from '../model/types'

function formattedDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function PresentationsPage() {
  const repository = usePresentationRepository()
  const navigate = useNavigate()
  const live = useRef(true)
  const creating = useRef(false)
  const [items, setItems] = useState<PresentationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingBlank, setCreatingBlank] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const presentations = await repository.listPresentations()
      if (live.current) setItems(presentations)
    } catch {
      if (live.current) setError('Could not load presentations saved in this browser. Please retry.')
    } finally {
      if (live.current) setLoading(false)
    }
  }, [repository])

  useEffect(() => { void load() }, [load])

  const createBlank = async () => {
    if (creating.current) return
    creating.current = true
    setCreatingBlank(true)
    setError(null)
    const document = createPresentationDocument()
    try {
      await repository.savePresentation(document)
      if (live.current) navigate(`/presentations/${document.id}`)
    } catch {
      if (live.current) setError('Could not create a presentation. No incomplete file was saved; please retry.')
    } finally {
      creating.current = false
      if (live.current) setCreatingBlank(false)
    }
  }

  return (
    <div className="presentations-library">
      <section className="presentations-hero">
        <div>
          <p className="hero-kicker"><PresentationIcon size={15} /> PRESENT YOUR NEXT BIG IDEA</p>
          <h1>Make the lesson <em>stick.</em></h1>
          <p>Build a clear 16:9 presentation with StickerLab’s playful visual language. Your work stays private in this browser.</p>
          <Button className="primary" onClick={() => void createBlank()} disabled={creatingBlank}>
            <FilePlus2 size={18} />{creatingBlank ? 'Creating…' : 'Start a blank presentation'}
          </Button>
        </div>
        <div className="presentation-hero-art" aria-hidden="true">
          <div className="presentation-paper presentation-paper-back"><span>research</span><i /></div>
          <div className="presentation-paper presentation-paper-front"><strong>IDEAS<br />THAT STICK</strong><span>✦</span><i /></div>
          <img src="/art/stickers/04-winking-smiley.webp" alt="" width={128} height={128} />
        </div>
      </section>

      <div className="presentation-library-heading">
        <div>
          <h2>Your presentations</h2>
          <p>{items.length === 0 ? 'Start with a blank page.' : `${items.length} saved ${items.length === 1 ? 'presentation' : 'presentations'}`}</p>
        </div>
        <p className="presentation-device-note"><MonitorUp size={16} /> Editing is designed for laptop and desktop screens.</p>
      </div>

      {error ? (
        <Card className="presentation-library-state">
          <div role="alert" className="presentation-library-alert">
            <h2>Presentations are unavailable</h2>
            <p>{error}</p>
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        </Card>
      ) : loading ? (
        <Card className="presentation-library-state"><p role="status">Loading local presentations…</p></Card>
      ) : items.length === 0 ? (
        <Card className="presentation-library-state presentation-library-empty">
          <PresentationIcon size={36} aria-hidden="true" />
          <h2>No presentations yet</h2>
          <p>Create a blank presentation now. Templates and backup restore arrive in later increments.</p>
          <Button className="primary" onClick={() => void createBlank()} disabled={creatingBlank}>
            <FilePlus2 size={18} />{creatingBlank ? 'Creating…' : 'Create your first presentation'}
          </Button>
        </Card>
      ) : (
        <ul className="presentation-grid">
          {items.map((item) => (
            <li key={item.id}>
              <Link className="presentation-card" to={`/presentations/${item.id}`} aria-label={`Open ${item.title}`}>
                <span className="presentation-card-preview" aria-hidden="true">
                  <span>{item.title}</span>
                  <i>16:9</i>
                </span>
                <span className="presentation-card-body">
                  <strong title={item.title}>{item.title}</strong>
                  <small><Clock3 size={13} /> Updated {formattedDate(item.updatedAt)}</small>
                  <small>{item.slideCount} {item.slideCount === 1 ? 'slide' : 'slides'} <ArrowRight size={14} /></small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default PresentationsPage
