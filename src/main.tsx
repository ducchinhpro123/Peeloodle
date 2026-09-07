import { StrictMode, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { RepositoryProvider, useRepository } from './app/repository'
import { LocalProjectList } from './features/editor/LocalProjectList'
import type { StickerLabRepository } from './lib/persistence/repository'
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Heart,
  Home,
  ImagePlus,
  Layers3,
  LayoutGrid,
  Menu,
  Play,
  Plus,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserRound,
  X,
} from 'lucide-react'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  NoticeDialog,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from './components/ui'
import type { PackRecord, ProjectDocument, Template } from './types/domain'
import { downloadBlob } from './features/exports/renderDocument'
import { exportPackZip } from './features/exports/zipExport'
import {
  cloneTemplateDocument,
  getFavoriteTemplateIds,
  TEMPLATE_CATEGORIES,
  templateData,
  toggleFavoriteTemplateId,
} from './features/templates/templates'
import './styles.css'

const CreateEditor = lazy(() => import('./features/editor/EditorPage').then((module) => ({ default: module.CreateEditor })))
const ProjectEditor = lazy(() => import('./features/editor/EditorPage').then((module) => ({ default: module.ProjectEditor })))
const editorFallback = <p className="muted" style={{ padding: 24 }}>Opening sticker…</p>

const getView = (search: string) => new URLSearchParams(search).get('view')

const topNavigation = [
  { to: '/', label: 'Home', active: (pathname: string, search: string) => pathname === '/' && !getView(search) },
  { to: '/create', label: 'Create', active: (pathname: string) => pathname === '/create' || pathname.startsWith('/editor/') },
  { to: '/templates', label: 'Templates', active: (pathname: string, search: string) => pathname === '/templates' && getView(search) !== 'explore' },
  { to: '/my-stickers', label: 'My Stickers', active: (pathname: string, search: string) => pathname === '/my-stickers' && getView(search) !== 'favorites' },
  { to: '/templates?view=explore', label: 'Explore', active: (pathname: string, search: string) => pathname === '/templates' && getView(search) === 'explore' },
]

function Unavailable({ children, label = 'Not available yet', className, 'aria-label': ariaLabel }: { children: ReactNode; label?: string; className?: string; 'aria-label'?: string }) {
  return (
    <NoticeDialog title={label} trigger={<Button className={className} aria-label={ariaLabel}>{children}</Button>}>
      This control is not available yet. Local editing, saving, and PNG export work in the editor; packs, cloud sharing, and messenger installs come later.
    </NoticeDialog>
  )
}

function Header() {
  const { pathname, search } = useLocation()

  return (
    <header className="header">
      <Sheet>
        <SheetTrigger asChild>
          <Button className="icon mobile-only" aria-label="Open navigation"><Menu /></Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription className="sr-only">StickerLab navigation links</SheetDescription>
          <Sidebar mobile />
        </SheetContent>
      </Sheet>
      <Link to="/" className="brand"><span className="mascot">●ᴗ●</span><span>Sticker<span>Lab</span><small>Turn moments into stickers</small></span></Link>
      <nav className="topnav" aria-label="Primary navigation">
        {topNavigation.map((item) => (
          <Link key={item.label} to={item.to} className={item.active(pathname, search) ? 'active' : undefined}>{item.label}</Link>
        ))}
      </nav>
      <Unavailable className="search search-button" label="Search is not implemented" aria-label="Search templates and packs">
        <Search size={16} /><span>Search templates and packs</span>
      </Unavailable>
      <NoticeDialog title="Notifications are unavailable" trigger={<Button className="icon" aria-label="Notifications"><Bell size={18} /></Button>}>
        Notifications are unavailable until accounts exist.
      </NoticeDialog>
      <span className="profile" aria-label="Guest profile"><span>G</span><b>Guest</b><ChevronDown size={15} aria-hidden="true" /></span>
    </header>
  )
}

function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const { pathname, search } = useLocation()
  const isFavorites = pathname === '/my-stickers' && getView(search) === 'favorites'
  const isShared = pathname === '/my-stickers' && getView(search) === 'shared'
  const items = [
    { to: '/', label: 'Dashboard', icon: Home, active: pathname === '/' },
    { to: '/create', label: 'Create Sticker', icon: Plus, active: pathname === '/create' || pathname.startsWith('/editor/') },
    { to: '/my-stickers', label: 'My Stickers', icon: ImagePlus, active: pathname === '/my-stickers' && !isFavorites && !isShared },
    { to: '/templates', label: 'Templates', icon: LayoutGrid, active: pathname === '/templates' },
    { to: '/my-stickers?view=favorites', label: 'Favorites', icon: Heart, active: isFavorites },
    { to: '/my-stickers?view=shared', label: 'Shared with Me', icon: UserRound, active: isShared },
  ]

  const itemLink = ({ to, label, icon: Icon, active }: typeof items[number]) => {
    const link = <Link className={active ? 'active' : undefined} to={to}><Icon size={18} />{label}</Link>
    return mobile ? <SheetClose asChild key={label}>{link}</SheetClose> : <span key={label}>{link}</span>
  }

  return (
    <aside className="sidebar">
      <div className="side-links">{items.map(itemLink)}</div>
      <div className="side-tools">
        <small>TOOLS</small>
        {[
          { label: 'Background Eraser', icon: Scissors },
          { label: 'Text & Emoji', icon: Type },
          { label: 'Filters & Effects', icon: Sparkles },
          { label: 'Export & Share', icon: Upload },
        ].map(({ label, icon: Icon }) => {
          const link = <Link to="/create"><Icon size={18} />{label}</Link>
          return mobile ? <SheetClose asChild key={label}>{link}</SheetClose> : <span key={label}>{link}</span>
        })}
      </div>
      <Card className="pro"><b>👑 Go Pro</b><p>Premium templates and HD exports are planned for a future release.</p><Button disabled>Coming later</Button></Card>
    </aside>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <><Header /><div className="layout"><Sidebar /><main>{children}</main></div></>
}

const dashboardFeatures = [
  { icon: Scissors, title: 'Background Eraser', to: '/create', detail: 'Manual erase arrives later. Auto-removal is not available.', tone: 'pink' },
  { icon: Type, title: 'Text & Emoji', to: '/create', detail: 'Add and edit text in the editor. Emoji decorations arrive later.', tone: 'blue' },
  { icon: LayoutGrid, title: 'Templates', to: '/templates', detail: 'Start with a ready-made sample idea.', tone: 'purple' },
  { icon: Upload, title: 'Share & Export', to: '/create', detail: 'Export a transparent PNG. Messenger packs arrive later.', tone: 'green' },
] as const

const dashboardHeroArt = (
  <div className="collage" aria-hidden="true">
    <img className="hero-art" src="/art/hero-collage.webp" alt="" width={1400} height={632} decoding="async" />
  </div>
)

function Hero({ title, children, action, art, kicker, points }: { title: ReactNode; children: ReactNode; action?: ReactNode; art?: ReactNode; kicker?: ReactNode; points?: ReactNode }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        {kicker}
        <h1>{title}</h1>
        <p className="hero-lead">{children}</p>
        {action}
        {points}
      </div>
      {art}
    </section>
  )
}

function Dashboard() {
  return (
    <Shell>
      <Hero
        title={<>Create Custom<br /><em>Stickers from</em><br />Your Photos</>}
        kicker={<p className="hero-kicker">Stickers make chats happier!</p>}
        action={<div className="actions"><Link className="button primary" to="/create"><ImagePlus size={16} />Create a Sticker<ChevronRight size={16} /></Link><Walkthrough /></div>}
        points={<ul className="hero-points"><li>No design skills needed</li><li>Works on any device</li><li>Share everywhere</li></ul>}
        art={dashboardHeroArt}
      >
        Turn your selfies, pets, memes and everyday moments into amazing stickers. Easy, fun and ready to share anywhere!
      </Hero>
      <div className="feature-grid">{dashboardFeatures.map(({ icon: Icon, title, to, detail, tone }) => <Link className="feature" to={to} key={title}><b className={tone}><Icon size={18} /></b><span><strong>{title}</strong><small>{detail}</small></span></Link>)}</div>
      <div className="split"><ProjectSection /><TemplateRail title="🔥 Trending Templates" /></div>
      <section className="bottom-banner">
        <b>Better conversations with your own stickers</b>
        <div className="banner-copy"><strong>Stick together</strong><small>Connect, create and share with friends.</small></div>
        <Link to="/create" className="button primary">Start Creating<ChevronRight size={16} /></Link>
      </section>
    </Shell>
  )
}

function Walkthrough() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button><Play size={16} />Watch how it works</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>How StickerLab works</DialogTitle>
        <ol className="walkthrough">
          <li>Create a sticker from the dashboard or Create page.</li>
          <li>Upload a PNG, JPEG, or static WebP photo.</li>
          <li>Move, resize, and rotate it, then add text.</li>
          <li>Save locally, reopen from Dashboard or My Stickers, and export a transparent PNG.</li>
        </ol>
      </DialogContent>
    </Dialog>
  )
}

function ProjectSection() {
  return <section><div className="section-title"><h2><Clock size={16} aria-hidden="true" /> Recent Projects</h2><Link to="/my-stickers">View all</Link></div><LocalProjectList limit={6} /></section>
}

function TemplateCard({
  template,
  isFavorite,
  onToggleFavorite,
  onUse,
}: {
  template: Template
  isFavorite: boolean
  onToggleFavorite: (id: string) => void
  onUse: (template: Template) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <article className="template-card" key={template.id}>
      <div
        className="template-art"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(true)
        }}
      >
        {template.preview}
        <button
          type="button"
          className="favorite-button"
          aria-label={isFavorite ? `Remove ${template.title} from favorites` : `Add ${template.title} to favorites`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(template.id)
          }}
        >
          {isFavorite ? '❤️' : '♡'}
        </button>
      </div>
      <button
        type="button"
        className="template-title-btn"
        onClick={() => setOpen(true)}
      >
        <b>{template.title}</b>
      </button>
      <small>{template.category} · {template.document.layers.length} layers</small>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{template.title}</DialogTitle>
          <div className="template-preview-body">
            <div className="detail-cover" style={{ fontSize: 64 }}>
              {template.preview}
            </div>
            <p><strong>Category:</strong> {template.category}</p>
            <p>
              <strong>Layers:</strong>{' '}
              {template.document.layers.map((l) => l.name).join(', ') || 'Starter artwork'}
            </p>
            <div className="button-row" style={{ marginTop: 16 }}>
              <Button
                className="primary"
                onClick={() => {
                  setOpen(false)
                  onUse(template)
                }}
              >
                Use Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  )
}

function TemplateRail({
  title,
  items = templateData.slice(0, 4),
}: {
  title: string
  items?: Template[]
}) {
  const navigate = useNavigate()
  const repo = useRepository()
  const [favorites, setFavorites] = useState<string[]>(() => getFavoriteTemplateIds())

  const handleToggleFavorite = (id: string) => {
    setFavorites(toggleFavoriteTemplateId(id))
  }

  const handleUse = async (template: Template) => {
    const cloned = cloneTemplateDocument(template)
    await repo.saveProject(cloned)
    navigate(`/editor/${cloned.id}`)
  }

  return (
    <section>
      <div className="section-title">
        <h2>{title}</h2>
        <Link to="/templates">View all</Link>
      </div>
      <div className="rail">
        {items.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            isFavorite={favorites.includes(template.id)}
            onToggleFavorite={handleToggleFavorite}
            onUse={handleUse}
          />
        ))}
      </div>
    </section>
  )
}

function TemplatesPage() {
  const [category, setCategory] = useState('All Templates')
  const [query, setQuery] = useState('')
  const result = templateData.filter((template) => (category === 'All Templates' || template.category === category) && template.title.toLowerCase().includes(query.toLowerCase()))
  const resetFilters = () => { setCategory('All Templates'); setQuery('') }

  return (
    <Shell>
      <Hero title={<>Discover Amazing <em>Sticker Templates</em></>}>Choose a ready-made template and customize it in the editor. Templates clone into independent editable projects.</Hero>
      <div className="pills" aria-label="Template category filters">{TEMPLATE_CATEGORIES.map((item) => <button aria-pressed={category === item} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
      <div className="filters"><label>Sort by <select disabled aria-describedby="template-filter-help"><option>Featured</option></select></label><label>Style <select disabled aria-describedby="template-filter-help"><option>All styles</option></select></label><span id="template-filter-help" className="muted">Category and title search work; sort and style arrive later.</span><label className="filter-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search sample templates" placeholder="Search samples" /></label></div>
      {result.length ? <><TemplateRail title="🔥 Trending Templates" items={result} /><TemplateRail title="✦ Explore by Category" items={result.slice().reverse()} /><TemplateRail title="✨ More Templates You'll Love" items={result.slice(2)} /></> : <Card className="empty"><h2>No sample templates found</h2><Button onClick={resetFilters}>Reset filters</Button></Card>}
    </Shell>
  )
}

function EditorLayout({ children }: { children: ReactNode }) {
  return <Shell><Suspense fallback={editorFallback}>{children}</Suspense></Shell>
}

function Packs() {
  const repo = useRepository()
  const [params, setParams] = useSearchParams()
  const [packs, setPacks] = useState<PackRecord[]>([])
  const [projects, setProjects] = useState<ProjectDocument[]>([])
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [addStickerOpen, setAddStickerOpen] = useState(false)
  const [exportingZip, setExportingZip] = useState(false)

  const reload = useCallback(() => {
    void repo.listPacks().then((list) => {
      setPacks(list)
      setSelectedPackId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id ?? null))
    })
    void repo.listProjects().then(setProjects)
  }, [repo])

  useEffect(() => {
    reload()
  }, [reload])

  const viewParam = params.get('view')
  const view =
    viewParam === 'favorites'
      ? 'Favorites'
      : viewParam === 'shared'
      ? 'Shared with Me'
      : viewParam === 'export-history'
      ? 'Export History'
      : 'All Packs'
  const selectView = (next: string) => {
    if (next === 'Favorites') setParams({ view: 'favorites' })
    else if (next === 'Shared with Me') setParams({ view: 'shared' })
    else if (next === 'Export History') setParams({ view: 'export-history' })
    else setParams({})
  }

  const selectedPack = packs.find((p) => p.id === selectedPackId) || packs[0] || null

  const handleCreatePack = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newTitle.trim()
    if (!trimmed) return
    const newPack: PackRecord = {
      id: crypto.randomUUID(),
      title: trimmed,
      description: newDesc.trim(),
      visibility: 'local',
      projectIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await repo.savePack(newPack)
    setNewTitle('')
    setNewDesc('')
    setCreateOpen(false)
    setSelectedPackId(newPack.id)
    reload()
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
    reload()
  }

  const handleDeletePack = async (packId: string) => {
    await repo.deletePack(packId)
    setSelectedPackId(null)
    reload()
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
    await repo.savePack(updated)
    reload()
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
    await repo.savePack(updated)
    reload()
  }

  const handleExportZip = async (pack: PackRecord) => {
    setExportingZip(true)
    try {
      const zipBlob = await exportPackZip(pack, repo)
      const safe = pack.title.replace(/[^\w.-]+/g, '_').toLowerCase() || 'pack'
      downloadBlob(zipBlob, `${safe}.zip`)
    } catch {
      // Export handled gracefully
    } finally {
      setExportingZip(false)
    }
  }

  const favoriteIds = getFavoriteTemplateIds()
  const favoriteTemplates = templateData.filter((t) => favoriteIds.includes(t.id))
  const emptyHeading = view === 'Favorites' ? 'No favorite local packs yet' : view === 'Shared with Me' ? 'Sharing is not available yet' : 'No local packs yet'
  const emptyDetail = view === 'Shared with Me' ? 'Cloud sharing is not set up. Local stickers stay on this device.' : 'Packs group stickers into collections and export them as ZIP archives.'

  return (
    <Shell>
      <Hero
        title="My Sticker Packs"
        action={
          <div className="actions">
            <Button className="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} />New Pack
            </Button>
            <Link className="button" to="/create">
              <ImagePlus size={16} />Import Photos
            </Link>
          </div>
        }
      >
        Organize saved stickers locally. Group them into packs and export transparent PNG ZIP bundles.
      </Hero>
      <div className="packs-controls">
        <div className="pills">
          {['All Packs', 'My Packs', 'Favorites', 'Shared with Me', 'Export History'].map((item) => (
            <button aria-pressed={view === item} disabled={!['All Packs', 'My Packs', 'Favorites', 'Shared with Me', 'Export History'].includes(item)} onClick={() => selectView(item)} key={item}>
              {item}
            </button>
          ))}
        </div>
        <span className="muted">Pack collections stay private on this device.</span>
      </div>

      {view === 'Favorites' && favoriteTemplates.length > 0 ? (
        <TemplateRail title="Favorite Templates" items={favoriteTemplates} />
      ) : null}

      {view === 'Shared with Me' ? (
        <section className="empty packs-empty">
          <Layers3 size={36} />
          <h2>Sharing is not available yet</h2>
          <p>{emptyDetail}</p>
        </section>
      ) : view === 'Export History' ? (
        <section className="empty packs-empty">
          <Download size={36} />
          <h2>Export History</h2>
          <p>Pack ZIP files and individual PNG stickers download directly to your browser downloads folder.</p>
        </section>
      ) : packs.length === 0 ? (
        <section className="empty packs-empty">
          <Layers3 size={36} />
          <h2>{emptyHeading}</h2>
          <p>{emptyDetail}</p>
          <Button className="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />Create a Pack
          </Button>
        </section>
      ) : (
        <div className="packs-layout">
          <div className="pack-grid">
            {packs.map((pack) => (
              <button
                type="button"
                key={pack.id}
                className={`pack-card ${selectedPack?.id === pack.id ? 'active' : ''}`}
                onClick={() => setSelectedPackId(pack.id)}
              >
                <div className="pack-thumb">📦</div>
                <b>{pack.title}</b>
                <small>{pack.description || 'No description'}</small>
                <span className="pack-badge">{pack.projectIds.length} stickers · Local</span>
              </button>
            ))}
          </div>
          {selectedPack ? (
            <aside className="pack-detail">
              <h2>{selectedPack.title}</h2>
              <p className="muted">{selectedPack.description || 'No description'}</p>
              <span className="pack-badge">{selectedPack.projectIds.length} stickers · Local</span>

              <div className="button-row" style={{ marginTop: 12 }}>
                <Button
                  className="primary"
                  disabled={exportingZip || selectedPack.projectIds.length === 0}
                  onClick={() => handleExportZip(selectedPack)}
                >
                  <Download size={16} />{exportingZip ? 'Exporting…' : 'Download ZIP'}
                </Button>
                <Button onClick={() => setAddStickerOpen(true)}>
                  <Plus size={16} />Add Stickers
                </Button>
              </div>
              <div className="button-row" style={{ marginTop: 8 }}>
                <Button onClick={() => handleDuplicatePack(selectedPack)} title="Duplicate pack">
                  <Copy size={16} />Duplicate
                </Button>
                <Button onClick={() => handleDeletePack(selectedPack.id)} title="Delete pack">
                  <Trash2 size={16} />Delete
                </Button>
                <NoticeDialog title="Messenger packs are unavailable" trigger={<Button>WhatsApp / Telegram</Button>}>
                  Native WhatsApp and Telegram installation is not implemented. Download the pack ZIP and add stickers manually.
                </NoticeDialog>
              </div>

              <h3 style={{ marginTop: 16 }}>Stickers in Pack ({selectedPack.projectIds.length})</h3>
              {selectedPack.projectIds.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No stickers in this pack. Click Add Stickers to include saved stickers.</p>
              ) : (
                <div className="pack-stickers-list">
                  {selectedPack.projectIds.map((pId, idx) => {
                    const prj = projects.find((p) => p.id === pId)
                    const title = prj?.title || `Sticker (${pId.slice(0, 6)})`
                    return (
                      <div key={pId} className="pack-sticker-row">
                        <span>{title}</span>
                        <div className="layer-actions">
                          <button
                            type="button"
                            className="layer-action-btn"
                            disabled={idx === 0}
                            aria-label={`Move ${title} up`}
                            onClick={() => handleReorderStickerInPack(idx, 'up')}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="layer-action-btn"
                            disabled={idx === selectedPack.projectIds.length - 1}
                            aria-label={`Move ${title} down`}
                            onClick={() => handleReorderStickerInPack(idx, 'down')}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="layer-action-btn"
                            aria-label={`Remove ${title} from pack`}
                            onClick={() => handleToggleStickerInPack(pId)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
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

      <section style={{ marginTop: 24 }}>
        <div className="section-title"><h2>All Local Stickers</h2><Link to="/create">Create</Link></div>
        <LocalProjectList emptyTitle="No local stickers yet" emptyDetail="Save a sticker from the editor to reopen it here." />
      </section>

      {/* Dialogs */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogTitle>Create New Pack</DialogTitle>
          <DialogDescription>Group your stickers into a named pack.</DialogDescription>
          <form onSubmit={handleCreatePack}>
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
            <div className="button-row" style={{ marginTop: 16 }}>
              <Button className="primary" type="submit">Create Pack</Button>
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addStickerOpen} onOpenChange={setAddStickerOpen}>
        <DialogContent>
          <DialogTitle>Add stickers to {selectedPack?.title}</DialogTitle>
          <DialogDescription>Check saved local stickers to include them in this pack.</DialogDescription>
          {projects.length === 0 ? (
            <p className="muted">No saved stickers yet. Create and save stickers in the editor first.</p>
          ) : (
            <div className="pack-stickers-list" style={{ maxHeight: 300 }}>
              {projects.map((proj) => {
                const inPack = selectedPack?.projectIds.includes(proj.id) ?? false
                return (
                  <div key={proj.id} className="pack-sticker-row">
                    <span>{proj.title}</span>
                    <input
                      type="checkbox"
                      aria-label={`Include ${proj.title}`}
                      checked={inPack}
                      onChange={() => handleToggleStickerInPack(proj.id)}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  )
}

export function App({ repository }: { repository?: StickerLabRepository } = {}) {
  return (
    <RepositoryProvider repository={repository}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<EditorLayout><CreateEditor /></EditorLayout>} />
        <Route path="/editor/:projectId" element={<EditorLayout><ProjectEditor /></EditorLayout>} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/my-stickers" element={<Packs />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </RepositoryProvider>
  )
}

if (import.meta.env.MODE !== 'test') createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
