import {
  ArrowRight,
  Clock3,
  FilePlus2,
  MonitorUp,
  Presentation as PresentationIcon,
  Search,
  Sparkles,
} from 'lucide-react'
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
  const [query, setQuery] = useState('')

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleItems = normalizedQuery
    ? items.filter((item) => item.title.toLocaleLowerCase().includes(normalizedQuery))
    : items

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
        <div className="presentation-hero-copy">
          <p className="hero-kicker"><PresentationIcon size={15} /> YOUR IDEAS, ON THE BIG SCREEN</p>
          <h1>Tell your story.<br /><em>Make it stick.</em></h1>
          <p>Turn a blank 16:9 slide into something clear, colorful, and completely yours. Your work stays private in this browser.</p>
          <div className="presentation-hero-actions">
            <Button className="primary" onClick={() => void createBlank()} disabled={creatingBlank}>
              <FilePlus2 size={18} />{creatingBlank ? 'Creating…' : 'Start a blank presentation'}
            </Button>
            {items[0] ? <Link className="button" to={`/presentations/${items[0].id}`}>Open latest <ArrowRight size={16} /></Link> : null}
          </div>
          <ul className="presentation-hero-points" aria-label="Presentation features">
            <li>16:9 slide canvas</li>
            <li>Saved on your device</li>
            <li>No account needed</li>
          </ul>
        </div>
        <div className="presentation-hero-art" aria-hidden="true">
          <span className="presentation-art-note">big idea energy ✦</span>
          <img src="/art/presentation-cat-hero.webp" alt="" width={1200} height={744} />
          <span className="presentation-art-tape" />
          <span className="presentation-art-caption">Made to explain.<br />Styled to remember.</span>
        </div>
      </section>

      <div className="presentation-library-controls">
        <div>
          <p className="presentation-library-eyebrow"><Sparkles size={15} /> YOUR CREATIVE DESK</p>
          <h2>Your presentations</h2>
          <p>{items.length === 0 ? 'Start fresh with a blank page.' : `${items.length} saved ${items.length === 1 ? 'presentation' : 'presentations'} in this browser`}</p>
        </div>
        <div className="presentation-library-tools">
          <label className="presentation-library-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search presentations</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your presentations…"
            />
          </label>
          <p className="presentation-device-note"><MonitorUp size={16} /> Best edited on a larger screen</p>
        </div>
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
          <div className="presentation-empty-art" aria-hidden="true">
            <span className="presentation-empty-slide"><i /><b>YOUR<br />STORY</b><i /></span>
            <span className="presentation-empty-spark">✦</span>
          </div>
          <div className="presentation-empty-copy">
            <p className="presentation-empty-kicker">A fresh canvas is waiting</p>
            <h2>No presentations yet</h2>
            <p>Create a blank presentation and shape it one idea at a time. Templates and backup restore arrive in later increments.</p>
            <Button className="primary" onClick={() => void createBlank()} disabled={creatingBlank}>
              <FilePlus2 size={18} />{creatingBlank ? 'Creating…' : 'Create your first presentation'}
            </Button>
          </div>
        </Card>
      ) : visibleItems.length === 0 ? (
        <Card className="presentation-library-state presentation-library-no-results">
          <Search size={32} aria-hidden="true" />
          <h2>No presentation found</h2>
          <p>Nothing matches “{query.trim()}”. Try another title or clear the search.</p>
          <Button onClick={() => setQuery('')}>Clear search</Button>
        </Card>
      ) : (
        <ul className="presentation-grid">
          {visibleItems.map((item) => (
            <li key={item.id}>
              <Link className="presentation-card" to={`/presentations/${item.id}`} aria-label={`Open ${item.title}`}>
                <span className="presentation-card-preview" aria-hidden="true">
                  <span className="presentation-card-paper">
                    <PresentationIcon size={17} />
                    <b>{item.title}</b>
                    <em />
                  </span>
                  <i>16:9 SLIDES</i>
                </span>
                <span className="presentation-card-body">
                  <span className="presentation-card-title"><strong title={item.title}>{item.title}</strong><ArrowRight size={17} /></span>
                  <small><Clock3 size={13} /> Updated {formattedDate(item.updatedAt)}</small>
                  <small>{item.slideCount} {item.slideCount === 1 ? 'slide' : 'slides'} · Local</small>
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
