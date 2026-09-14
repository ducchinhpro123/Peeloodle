import {
  ArrowRight,
  Clock3,
  Copy,
  FilePlus2,
  MonitorUp,
  Pencil,
  Presentation as PresentationIcon,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { offlineReadinessLabel, usePresentationOfflineReadiness } from '@/app/presentationOffline'
import { usePresentationRepository } from '@/app/presentationRepositoryContext'
import { blobToArrayBuffer } from '@/lib/blob'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { createPresentationDocument } from '../model/factories'
import { PRESENTATION_LIMITS } from '../model/limits'
import type { PresentationSummary } from '../model/types'
import { RENAME_EMPTY_TITLE_MESSAGE, describeLibraryFailure, renamedDocument } from './libraryActions'
import { restoreBackupArchive } from './restoreBackup'
import { PresentationThumb } from './PresentationThumb'

/**
 * Where focus goes when one of these dialogs closes: the opener while it still
 * exists, otherwise the first action of a remaining card, otherwise the search
 * field. Deleting a row removes its opener, so "focus the opener" alone would
 * drop focus on the document body.
 */
function focusAfterLibraryChange(opener: HTMLButtonElement | null): void {
  const target = (opener?.isConnected ? opener : null)
    ?? document.querySelector<HTMLButtonElement>('.presentation-card-actions button')
    ?? document.getElementById('presentation-library-search')
  target?.focus()
}

function formattedDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function PresentationsPage() {
  const repository = usePresentationRepository()
  const navigate = useNavigate()
  // Opening the library starts (and shows) the offline warm-up for this session.
  const offline = usePresentationOfflineReadiness()
  const live = useRef(true)
  const creating = useRef(false)
  const [items, setItems] = useState<PresentationSummary[]>([])
  // Only the first fetch shows the loading card; a refresh keeps the grid (and
  // the button that opened a dialog) in place.
  const [loading, setLoading] = useState(true)
  const [creatingBlank, setCreatingBlank] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<PresentationSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PresentationSummary | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const renameOpener = useRef<HTMLButtonElement | null>(null)
  const deleteOpener = useRef<HTMLButtonElement | null>(null)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleItems = normalizedQuery
    ? items.filter((item) => item.title.toLocaleLowerCase().includes(normalizedQuery))
    : items

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  const load = useCallback(async () => {
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

  /**
   * Restores one backup as a NEW presentation: the parsed archive is bounded and
   * verified by the backup parser, then cloned with fresh ids, so a bad file or a
   * failed save leaves every existing presentation exactly as it was.
   */
  const restoreBackup = async (file: File) => {
    setRestoring(true)
    setActionError(null)
    setRestoreNote(null)
    try {
      // FileReader-backed helper: `File.arrayBuffer` is missing in some embeddings.
      const bytes = new Uint8Array(await blobToArrayBuffer(file))
      const outcome = await restoreBackupArchive(repository, bytes)
      if (!outcome.ok) {
        if (live.current) setActionError(outcome.message)
        return
      }
      if (!live.current) return
      setRestoreNote(`Restored “${outcome.document.title}” as a new presentation.`)
      await load()
    } catch {
      if (live.current) setActionError('This backup could not be read on this device.')
    } finally {
      if (live.current) setRestoring(false)
    }
  }

  const openRename = (item: PresentationSummary, event: MouseEvent<HTMLButtonElement>) => {
    renameOpener.current = event.currentTarget
    setRenameTitle(item.title)
    setRenameError(null)
    setRenaming(item)
  }

  const closeRename = () => {
    setRenaming(null)
    setRenameError(null)
  }

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    if (!renaming) return
    setRenameError(null)
    setBusyId(renaming.id)
    try {
      // Read first, then write: the revision just read is the base, so work saved
      // elsewhere is reported as a conflict instead of being overwritten.
      const stored = await repository.getPresentation(renaming.id)
      const renamed = renamedDocument(stored, renameTitle)
      if (!renamed) {
        setRenameError(RENAME_EMPTY_TITLE_MESSAGE)
        return
      }
      await repository.savePresentation(renamed, undefined, { baseRevision: stored.revision })
      setRenaming(null)
    } catch (cause) {
      setRenameError(describeLibraryFailure(cause, 'rename'))
    } finally {
      setBusyId(null)
      await load()
    }
  }

  const duplicate = async (item: PresentationSummary) => {
    setBusyId(item.id)
    setActionError(null)
    try {
      // The repository assigns fresh document/slide/element/asset IDs and copies the artwork.
      await repository.duplicatePresentation(item.id, { title: `${item.title} copy` })
    } catch (cause) {
      setActionError(describeLibraryFailure(cause, 'duplicate'))
    } finally {
      setBusyId(null)
      await load()
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setBusyId(pendingDelete.id)
    setDeleteError(null)
    try {
      await repository.deletePresentation(pendingDelete.id)
      // Refresh before closing, so the dialog's focus restore sees the row gone and
      // moves focus to a survivor instead of a button that is about to be removed.
      await load()
      setPendingDelete(null)
    } catch (cause) {
      // The row stays: the write failed, so nothing was removed.
      setDeleteError(describeLibraryFailure(cause, 'delete'))
    } finally {
      setBusyId(null)
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
              id="presentation-library-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your presentations…"
            />
          </label>
          <p className="presentation-device-note"><MonitorUp size={16} /> Best edited on a larger screen</p>
          <Button disabled={restoring} onClick={() => restoreInputRef.current?.click()}>
            <Upload size={16} aria-hidden="true" /> {restoring ? 'Restoring…' : 'Restore backup'}
          </Button>
          <input
            ref={restoreInputRef}
            className="sr-only"
            type="file"
            accept=".zip,application/zip"
            aria-label="Choose backup file"
            data-testid="presentation-restore-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void restoreBackup(file)
            }}
          />
        </div>
      </div>

      {actionError ? <p role="alert">{actionError}</p> : null}
      {restoreNote ? <p role="status">{restoreNote}</p> : null}
      {/* Only a completed warm-up says the session is offline-ready. */}
      <p role="status">{offlineReadinessLabel(offline)}</p>

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
            <p>Create a blank presentation and shape it one idea at a time. Templates arrive in a later increment; use <strong>Restore backup</strong> to bring back a downloaded .stickerlab.zip.</p>
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
              <article className="presentation-card">
                <Link className="presentation-card-link" to={`/presentations/${item.id}`} aria-label={`Open ${item.title}`}>
                  <span className="presentation-card-preview" aria-hidden="true">
                    <span className="presentation-card-paper">
                      <PresentationIcon size={17} />
                      <b>{item.title}</b>
                      <em />
                    </span>
                    <PresentationThumb documentId={item.id} revision={item.revision} />
                    <i>16:9 SLIDES</i>
                  </span>
                  <span className="presentation-card-body">
                    <span className="presentation-card-title"><strong title={item.title}>{item.title}</strong><ArrowRight size={17} /></span>
                    <small><Clock3 size={13} /> Updated {formattedDate(item.updatedAt)}</small>
                    <small>{item.slideCount} {item.slideCount === 1 ? 'slide' : 'slides'} · Local</small>
                  </span>
                </Link>
                <div className="presentation-card-actions">
                  <Button
                    className="icon"
                    aria-label={`Rename ${item.title}`}
                    disabled={busyId === item.id}
                    onClick={(event) => openRename(item, event)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    className="icon"
                    aria-label={`Duplicate ${item.title}`}
                    disabled={busyId === item.id}
                    onClick={() => void duplicate(item)}
                  >
                    <Copy size={16} />
                  </Button>
                  <Button
                    className="icon"
                    aria-label={`Delete ${item.title}`}
                    disabled={busyId === item.id}
                    onClick={(event) => {
                      deleteOpener.current = event.currentTarget
                      setDeleteError(null)
                      setPendingDelete(item)
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) closeRename() }}>
        <DialogContent
          onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById('rename-presentation-title')?.focus() }}
          onCloseAutoFocus={(event) => { event.preventDefault(); focusAfterLibraryChange(renameOpener.current) }}
        >
          <DialogTitle>Rename this presentation</DialogTitle>
          <DialogDescription>
            Give “{renaming?.title}” a new name. Its slides and artwork are not changed.
          </DialogDescription>
          <form onSubmit={(event) => void submitRename(event)}>
            <div className="dialog-field">
              <label htmlFor="rename-presentation-title">Presentation name</label>
              <input
                id="rename-presentation-title"
                value={renameTitle}
                maxLength={PRESENTATION_LIMITS.maxTitleLength}
                autoComplete="off"
                onChange={(event) => setRenameTitle(event.target.value)}
              />
            </div>
            {renameError ? <p role="alert">{renameError}</p> : null}
            <DialogFooter>
              <Button id="cancel-rename-presentation" onClick={closeRename}>Keep the current name</Button>
              <Button className="primary" type="submit" disabled={busyId === renaming?.id}>Save name</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DialogContent
          onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById('cancel-delete-presentation')?.focus() }}
          onCloseAutoFocus={(event) => { event.preventDefault(); focusAfterLibraryChange(deleteOpener.current) }}
        >
          <DialogTitle>Delete this presentation?</DialogTitle>
          <DialogDescription>
            “{pendingDelete?.title}” and its slides will be removed from this browser. Your stickers and sticker packs are not affected.
          </DialogDescription>
          {deleteError ? <p role="alert">{deleteError}</p> : null}
          <DialogFooter>
            <Button id="cancel-delete-presentation" onClick={() => setPendingDelete(null)}>Keep presentation</Button>
            <Button className="danger" disabled={busyId === pendingDelete?.id} onClick={() => void confirmDelete()}>Delete presentation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default PresentationsPage
