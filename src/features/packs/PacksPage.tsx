import { ArrowUpDown, ChevronRight, Copy, Download, ImagePlus, Layers3, LockKeyhole, PackageOpen, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Hero } from '@/components/Hero'
import { StickerCollage } from '@/components/StickerCollage'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { NoticeDialog } from '@/components/ui/notice-dialog'
import { useRepository } from '@/app/repository'
import { Shell } from '@/app/Shell'
import { useCloudStatus, useWorkspace } from '@/features/auth/Workspace'
import { LocalProjectList } from '@/features/editor/LocalProjectList'
import { ProjectThumb } from '@/features/editor/ProjectThumb'
import { downloadBlob } from '@/features/exports/download'
import { TemplateRail } from '@/features/templates/TemplateRail'
import { getFavoriteTemplateIds, templateData } from '@/features/templates/templates'
import type { PackRecord, ProjectDocument } from '@/types/domain'
import type { StickerLabRepository } from '@/lib/persistence/repository'

const packViews = ['All Packs', 'My Packs', 'Favorites', 'Shared with Me', 'Export History'] as const
type PackView = typeof packViews[number]
type PackSort = 'recent' | 'name'

function PackArtwork({
  pack,
  projectById,
  repo,
  tone = 0,
  large = false,
}: {
  pack: PackRecord
  projectById: Map<string, ProjectDocument>
  repo: StickerLabRepository
  tone?: number
  large?: boolean
}) {
  const previews: ProjectDocument[] = []
  for (const projectId of pack.projectIds) {
    const project = projectById.get(projectId)
    if (project) previews.push(project)
    if (previews.length === 5) break
  }

  return (
    <div className={`pack-cover pack-cover-tone-${tone % 3}${large ? ' pack-cover-large' : ''}`} aria-hidden="true">
      <span className="pack-cover-tape" />
      <span className="pack-cover-spark pack-cover-spark-left">✦</span>
      <span className="pack-cover-spark pack-cover-spark-right">♡</span>
      {previews.length > 0 ? (
        <div className={`pack-cover-stack pack-cover-stack-${previews.length}`}>
          {previews.map((project, index) => (
            <span className={`pack-cover-sticker pack-cover-sticker-${index + 1}`} key={project.id}>
              <ProjectThumb project={project} repo={repo} />
            </span>
          ))}
        </div>
      ) : (
        <span className="pack-cover-empty">
          <PackageOpen size={large ? 46 : 34} />
          <b>{pack.projectIds.length === 0 ? 'Ready for stickers' : 'Preview unavailable'}</b>
        </span>
      )}
      <span className="pack-cover-title">{pack.title}</span>
    </div>
  )
}

export function PacksPage() {
  const repo = useRepository()
  const location = useLocation()
  const cloud = useWorkspace()?.cloud
  const cloudStatus = useCloudStatus()
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [params, setParams] = useSearchParams()
  const [packs, setPacks] = useState<PackRecord[]>([])
  const [projects, setProjects] = useState<ProjectDocument[]>([])
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  const [detailClosed, setDetailClosed] = useState(false)
  const requestedPack = params.get('pack')
  useEffect(() => { if (requestedPack) setSelectedPackId(requestedPack) }, [requestedPack])
  const [createOpen, setCreateOpen] = useState(false)
  const [editingPack, setEditingPack] = useState<PackRecord | null>(null)
  const [deletePack, setDeletePack] = useState<PackRecord | null>(null)
  const deleteOpener = useRef<HTMLButtonElement | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [addStickerOpen, setAddStickerOpen] = useState(false)
  const [packQuery, setPackQuery] = useState('')
  const [packSort, setPackSort] = useState<PackSort>('recent')
  const [exportingZip, setExportingZip] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operationActive = useRef(false)
  const createOpener = useRef<HTMLButtonElement | null>(null)
  const newPackButton = useRef<HTMLButtonElement | null>(null)
  const addOpener = useRef<HTMLButtonElement | null>(null)

  const reload = useCallback(async () => {
    const [list, savedProjects] = await Promise.all([repo.listPacks(), repo.listProjects()])
    if (!live.current) return
    setPacks(list)
    setProjects(savedProjects)
    setSelectedPackId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id ?? null))
  }, [repo])

  useEffect(() => {
    void reload().catch(() => setError('Could not load local packs. Please retry.'))
  }, [reload, cloudStatus.version])
  useEffect(() => {
    if (location.hash !== '#local-stickers') return
    document.getElementById('local-stickers')?.scrollIntoView({ block: 'start' })
  }, [location.hash, packs])

  const runPackAction = async (action: () => Promise<void>) => {
    if (operationActive.current) return
    operationActive.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pack operation failed. Please retry.')
    } finally {
      operationActive.current = false
      setBusy(false)
    }
  }

  const viewParam = params.get('view')
  const view: PackView =
    viewParam === 'mine'
      ? 'My Packs'
      : viewParam === 'favorites'
      ? 'Favorites'
      : viewParam === 'shared'
      ? 'Shared with Me'
      : viewParam === 'export-history'
      ? 'Export History'
      : 'All Packs'
  const selectView = (next: PackView) => {
    if (next === 'My Packs') setParams({ view: 'mine' })
    else if (next === 'Favorites') setParams({ view: 'favorites' })
    else if (next === 'Shared with Me') setParams({ view: 'shared' })
    else if (next === 'Export History') setParams({ view: 'export-history' })
    else setParams({})
  }

  const normalizedPackQuery = packQuery.trim().toLocaleLowerCase()
  const visiblePacks = packs
    .filter((pack) => !normalizedPackQuery || `${pack.title} ${pack.description}`.toLocaleLowerCase().includes(normalizedPackQuery))
    .slice()
    .sort((left, right) => packSort === 'name'
      ? left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
      : right.updatedAt.localeCompare(left.updatedAt))
  const selectedPack = detailClosed ? null : visiblePacks.find((pack) => pack.id === selectedPackId) || visiblePacks[0] || null
  const projectById = new Map(projects.map((project) => [project.id, project]))

  const handleCreatePack = async () => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    const newPack: PackRecord = {
      id: editingPack?.id ?? crypto.randomUUID(),
      title: trimmed,
      description: newDesc.trim(),
      visibility: editingPack?.visibility ?? 'local',
      projectIds: editingPack?.projectIds ?? [],
      createdAt: editingPack?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await repo.savePack(newPack, editingPack ?? undefined)
    setNewTitle('')
    setNewDesc('')
    setCreateOpen(false)
    setSelectedPackId(newPack.id)
  }

  const handleDuplicatePack = async (pack: PackRecord) => {
    const dup: PackRecord = {
      ...pack,
      id: crypto.randomUUID(),
      title: `${pack.title} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await repo.savePack(dup)
    setSelectedPackId(dup.id)
  }

  const handleDeletePack = async (packId: string) => {
    await repo.deletePack(packId, deletePack ?? undefined)
    deleteOpener.current = null
    setDeletePack(null)
    setSelectedPackId(null)
  }

  const handleToggleStickerInPack = async (projectId: string) => {
    if (!selectedPack) return
    const projectIds = selectedPack.projectIds.includes(projectId)
      ? selectedPack.projectIds.filter((id) => id !== projectId)
      : [...selectedPack.projectIds, projectId]
    const updated: PackRecord = {
      ...selectedPack,
      projectIds,
      updatedAt: new Date().toISOString(),
    }
    await repo.savePack(updated, selectedPack)
  }

  const handleReorderStickerInPack = async (index: number, direction: 'up' | 'down') => {
    if (!selectedPack) return
    const ids = [...selectedPack.projectIds]
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= ids.length) return
    const [item] = ids.splice(index, 1)
    ids.splice(target, 0, item!)
    const updated: PackRecord = {
      ...selectedPack,
      projectIds: ids,
      updatedAt: new Date().toISOString(),
    }
    await repo.savePack(updated, selectedPack)
  }

  const handleExportZip = async (pack: PackRecord) => {
    setExportingZip(true)
    try {
      const { exportPackZip } = await import('@/features/exports/zipExport')
      const zipBlob = await exportPackZip(pack, repo)
      const safe = pack.title.replace(/[^\w.-]+/g, '_').toLowerCase() || 'pack'
      if (live.current) downloadBlob(zipBlob, `${safe}.zip`)
    } finally {
      if (live.current) setExportingZip(false)
    }
  }

  const favoriteIds = getFavoriteTemplateIds()
  const favoriteTemplates = templateData.filter((t) => favoriteIds.includes(t.id))
  const emptyHeading = view === 'Favorites' ? 'No favorite local packs yet' : view === 'Shared with Me' ? 'Sharing is not available yet' : 'No local packs yet'
  const emptyDetail = view === 'Shared with Me' ? 'Cloud sharing is not set up. Local stickers stay on this device.' : 'Packs group stickers into collections and export them as ZIP archives.'

  return (
    <Shell>
      <Hero
        className="hero-packs"
        title={<>Your little world.<br /><em>In sticker packs.</em></>}
        kicker={<p className="hero-kicker"><Layers3 size={14} /> COLLECT THE GOOD STUFF</p>}
        art={<StickerCollage variant="packs" />}
        action={
          <div className="actions">
            <Button ref={newPackButton} className="primary" onClick={(event) => { createOpener.current = event.currentTarget; setEditingPack(null); setNewTitle(''); setNewDesc(''); setCreateOpen(true) }}>
              <Plus size={16} />New Pack
            </Button>
            <Link className="button" to="/create">
              <ImagePlus size={16} />Import Photos
            </Link>
          </div>
        }
        points={<ul className="hero-points"><li>Private by default</li><li>ZIP ready</li><li>Made from your stickers</li></ul>}
      >
        Organize saved stickers into packs and export transparent PNG ZIP bundles.
      </Hero>
      {error ? <p role="alert">{error}</p> : null}
      <section className="packs-controls" aria-label="Pack library controls">
        <div className="pills">
          {packViews.map((item) => (
            <button aria-pressed={view === item} onClick={() => selectView(item)} key={item}>
              {item}
            </button>
          ))}
        </div>
        <div className="pack-library-tools">
          <label className="pack-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search packs</span>
            <input
              type="search"
              value={packQuery}
              onChange={(event) => setPackQuery(event.target.value)}
              placeholder="Search packs…"
            />
          </label>
          <label className="pack-sort">
            <ArrowUpDown size={16} aria-hidden="true" />
            <span>Sort</span>
            <select value={packSort} onChange={(event) => setPackSort(event.target.value as PackSort)} aria-label="Sort packs">
              <option value="recent">Recent</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        {cloud ? <p className="pack-privacy-note"><LockKeyhole size={15} aria-hidden="true" />Private account · local-first cloud saving</p> : null}
      </section>

      {view === 'Favorites' && favoriteTemplates.length > 0 ? (
        <TemplateRail title="Favorite Templates" items={favoriteTemplates} />
      ) : null}

      {view === 'Shared with Me' ? (
        <section className="empty packs-empty">
          <span className="packs-empty-art"><Layers3 size={38} /><i>♡</i><b>✦</b></span>
          <p className="packs-empty-kicker">A space for future collaborations</p>
          <h2>Sharing is not available yet</h2>
          <p>{emptyDetail}</p>
        </section>
      ) : view === 'Export History' ? (
        <section className="empty packs-empty">
          <span className="packs-empty-art"><Download size={38} /><i>↓</i><b>✦</b></span>
          <p className="packs-empty-kicker">Downloads stay in your browser</p>
          <h2>Export History</h2>
          <p>Export history is not recorded yet. PNG and ZIP exports start a browser download; your browser controls where files are saved.</p>
        </section>
      ) : packs.length === 0 ? (
        <section className="empty packs-empty">
          <span className="packs-empty-art"><PackageOpen size={42} /><i>♡</i><b>✦</b></span>
          <p className="packs-empty-kicker">Your first collection starts here</p>
          <h2>{emptyHeading}</h2>
          <p>{emptyDetail}</p>
          <Button className="primary" onClick={(event) => { createOpener.current = event.currentTarget; setEditingPack(null); setNewTitle(''); setNewDesc(''); setCreateOpen(true) }}>
            <Plus size={16} />Create a Pack
          </Button>
        </section>
      ) : visiblePacks.length === 0 ? (
        <section className="empty packs-empty packs-no-results">
          <span className="packs-empty-art"><Search size={38} /><i>?</i><b>✦</b></span>
          <p className="packs-empty-kicker">That title is playing hide-and-seek</p>
          <h2>No packs found</h2>
          <p>Nothing matches “{packQuery.trim()}”. Try another name or description.</p>
          <Button onClick={() => setPackQuery('')}>Clear search</Button>
        </section>
      ) : (
        <div className="packs-layout">
          <section className="pack-library" aria-labelledby="pack-library-title">
            <div className="pack-library-heading">
              <div>
                <p>YOUR COLLECTION SHELF</p>
                <h2 id="pack-library-title">{view === 'Favorites' ? 'Your packs' : view}</h2>
              </div>
              <span>{visiblePacks.length} {visiblePacks.length === 1 ? 'pack' : 'packs'}</span>
            </div>
            <div className="pack-grid">
              {visiblePacks.map((pack, index) => (
                <button
                  type="button"
                  key={pack.id}
                  className={`pack-card ${selectedPack?.id === pack.id ? 'active' : ''}`}
                  aria-pressed={selectedPack?.id === pack.id}
                  onClick={() => { setSelectedPackId(pack.id); setDetailClosed(false) }}
                >
                  <PackArtwork pack={pack} projectById={projectById} repo={repo} tone={index} />
                  <span className="pack-card-copy">
                    <span className="pack-card-title"><b>{pack.title}</b><ChevronRight size={17} aria-hidden="true" /></span>
                    <small>{pack.description || 'A fresh pack ready for your favorite stickers.'}</small>
                    <span className="pack-card-meta">
                      <span><PackageOpen size={13} aria-hidden="true" />{pack.projectIds.length} {pack.projectIds.length === 1 ? 'sticker' : 'stickers'}</span>
                      <span className="pack-badge">{cloud ? 'Private' : 'Local'}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          {selectedPack ? (
            <aside className="pack-detail" aria-label={`${selectedPack.title} pack details`}>
              <button type="button" className="pack-detail-close" aria-label="Close pack details" onClick={() => setDetailClosed(true)}><X size={16} aria-hidden="true" /></button>
              <PackArtwork pack={selectedPack} projectById={projectById} repo={repo} tone={visiblePacks.indexOf(selectedPack)} large />
              <div className="pack-detail-heading">
                <div>
                  <p>SELECTED PACK</p>
                  <h2>{selectedPack.title}</h2>
                </div>
                <span className="pack-badge">{cloud ? 'Private' : 'Local'}</span>
              </div>
              <p className="muted">{selectedPack.description || 'A fresh pack ready for your favorite stickers.'}</p>

              <div className="pack-detail-primary-actions">
                <Button
                  className="primary"
                  disabled={busy || exportingZip || selectedPack.projectIds.length === 0}
                  onClick={() => void runPackAction(() => handleExportZip(selectedPack))}
                >
                  <Download size={16} />{exportingZip ? 'Exporting…' : 'Download ZIP'}
                </Button>
                <Button onClick={(event) => { addOpener.current = event.currentTarget; setAddStickerOpen(true) }}>
                  <Plus size={16} />Add Stickers
                </Button>
              </div>
              <div className="pack-detail-secondary-actions">
                <Button disabled={busy} onClick={(event) => { createOpener.current = event.currentTarget; setEditingPack(selectedPack); setNewTitle(selectedPack.title); setNewDesc(selectedPack.description); setCreateOpen(true) }}><Pencil size={15} />Edit pack</Button>
                <Button disabled={busy} onClick={() => void runPackAction(() => handleDuplicatePack(selectedPack))} title="Duplicate pack">
                  <Copy size={16} />Duplicate
                </Button>
                <Button disabled={busy} onClick={(event) => { deleteOpener.current = event.currentTarget; setError(null); setDeletePack(selectedPack) }} title="Delete pack">
                  <Trash2 size={16} />Delete
                </Button>
                <NoticeDialog title="Messenger packs are unavailable" trigger={<Button>WhatsApp / Telegram</Button>}>
                  Native WhatsApp and Telegram installation is not implemented. Download the pack ZIP and add stickers manually.
                </NoticeDialog>
              </div>

              <div className="pack-detail-section-heading">
                <div><p>PACK CONTENTS</p><h3>Stickers ({selectedPack.projectIds.length})</h3></div>
                <Button className="pack-detail-add-shortcut" onClick={(event) => { addOpener.current = event.currentTarget; setAddStickerOpen(true) }}><Plus size={15} />Add</Button>
              </div>
              {selectedPack.projectIds.length === 0 ? (
                <div className="pack-detail-empty">
                  <PackageOpen size={30} />
                  <p>No stickers here yet. Add a saved sticker to start the collage.</p>
                </div>
              ) : (
                <div className="pack-sticker-gallery">
                  {selectedPack.projectIds.map((pId, idx) => {
                    const prj = projectById.get(pId)
                    const title = prj?.title || `Sticker (${pId.slice(0, 6)})`
                    return (
                      <article key={pId} className="pack-sticker-tile">
                        {prj ? <ProjectThumb project={prj} repo={repo} /> : <div className="project-thumb"><span className="project-preview-placeholder">Preview unavailable</span></div>}
                        <strong title={title}>{title}</strong>
                        <div className="layer-actions" aria-label={`Arrange ${title}`}>
                          <button
                            type="button"
                            className="layer-action-btn"
                            disabled={busy || idx === 0}
                            aria-label={`Move ${title} up`}
                            onClick={() => void runPackAction(() => handleReorderStickerInPack(idx, 'up'))}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="layer-action-btn"
                            disabled={busy || idx === selectedPack.projectIds.length - 1}
                            aria-label={`Move ${title} down`}
                            onClick={() => void runPackAction(() => handleReorderStickerInPack(idx, 'down'))}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="layer-action-btn"
                            aria-label={`Remove ${title} from pack`}
                            disabled={busy}
                            onClick={() => void runPackAction(() => handleToggleStickerInPack(pId))}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </article>
                    )
                  })}
                  <button className="pack-add-sticker-tile" type="button" onClick={(event) => { addOpener.current = event.currentTarget; setAddStickerOpen(true) }}>
                    <Plus size={22} /><span>Add sticker</span>
                  </button>
                </div>
              )}
            </aside>
          ) : (
            <aside className="pack-detail">
              <h2>Pack details</h2>
              <div className="detail-cover">✦</div>
              <p className="muted">Select a pack to inspect its stickers or export as ZIP.</p>
            </aside>
          )}
        </div>
      )}

      <section className="local-stickers-section" id="local-stickers">
        <div className="section-title"><div><p className="section-eyebrow">YOUR STICKER DRAWER</p><h2>{cloud ? 'All Private Stickers' : 'All Local Stickers'}</h2></div><Link to="/create">Create a sticker <ChevronRight size={15} /></Link></div>
        <LocalProjectList emptyTitle="No local stickers yet" emptyDetail="Save a sticker from the editor to reopen it here." />
      </section>

      <Dialog open={deletePack !== null} onOpenChange={(open) => { if (!open) setDeletePack(null) }}>
        <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById('cancel-delete-pack')?.focus() }} onCloseAutoFocus={(event) => { event.preventDefault(); (deleteOpener.current?.isConnected ? deleteOpener.current : newPackButton.current)?.focus() }}>
          <DialogTitle>Delete this pack?</DialogTitle>
          <DialogDescription>“{deletePack?.title}” will be removed. Your stickers will be kept, so you can use them in another pack.</DialogDescription>
          {error ? <p role="alert">{error}</p> : null}
          <DialogFooter>
            <Button id="cancel-delete-pack" onClick={() => setDeletePack(null)}>Keep Pack</Button>
            <Button className="danger" disabled={busy} onClick={() => { if (deletePack) void runPackAction(() => handleDeletePack(deletePack.id)) }}>Delete Pack</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (createOpener.current?.isConnected ? createOpener.current : newPackButton.current)?.focus() }}>
          <DialogTitle>{editingPack ? 'Edit Pack' : 'Create New Pack'}</DialogTitle>
          <DialogDescription>Group your stickers into a named pack.</DialogDescription>
          <form onSubmit={(event) => { event.preventDefault(); void runPackAction(handleCreatePack) }}>
            <div className="dialog-field">
              <label htmlFor="pack-title">Pack Name</label>
              <input
                id="pack-title"
                required
                placeholder="e.g. My Favorite Cats"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div className="dialog-field">
              <label htmlFor="pack-desc">Description (optional)</label>
              <input
                id="pack-desc"
                placeholder="e.g. Playful reactions for chats"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <DialogFooter>
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button className="primary" type="submit" disabled={busy}>{editingPack ? 'Save Pack' : 'Create Pack'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addStickerOpen} onOpenChange={setAddStickerOpen}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); addOpener.current?.focus() }}>
          <DialogTitle>Add stickers to {selectedPack?.title}</DialogTitle>
          <DialogDescription>Check saved local stickers to include them in this pack.</DialogDescription>
          {error ? <p role="alert">{error}</p> : null}
          {projects.length === 0 ? (
            <p className="muted">No saved stickers yet. Create and save stickers in the editor first.</p>
          ) : (
            <div className="pack-stickers-list">
              {projects.map((proj) => {
                const inPack = selectedPack?.projectIds.includes(proj.id) ?? false
                return (
                  <div key={proj.id} className="pack-sticker-row">
                    <span>{proj.title}</span>
                    <input
                      type="checkbox"
                      aria-label={`Include ${proj.title}`}
                      checked={inPack}
                      disabled={busy}
                      onChange={() => void runPackAction(() => handleToggleStickerInPack(proj.id))}
                    />
                  </div>
                )
              })}
            </div>
          )}
          <DialogFooter><DialogClose asChild><Button className="primary">Done</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  )
}
