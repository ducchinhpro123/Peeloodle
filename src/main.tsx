import { StrictMode, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useRepository } from './app/repository'
import { WorkspaceProvider, useCloudStatus, useWorkspace } from './features/auth/Workspace'
import { Account, AuthCallback, CloudBanner } from './features/auth/Account'
import { LocalProjectList } from './features/editor/LocalProjectList'
import { downloadBlob } from './features/exports/download'
import type { StickerLabRepository } from './lib/persistence/repository'
import {
  Bell,
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
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { NoticeDialog } from '@/components/ui/notice-dialog'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { PackRecord, ProjectDocument, Template } from './types/domain'
import {
  instantiateTemplate,
  getFavoriteTemplateIds,
  TEMPLATE_CATEGORIES,
  templateData,
  toggleFavoriteTemplateId,
} from './features/templates/templates'
import { StickerCollage } from './components/StickerCollage'
import { GlobalSearch } from './components/GlobalSearch'
import { isUnmodifiedPrimaryClick, parseToolIntent, requestToolIntent, shouldReuseCurrentToolRoute, toolIntentHref, type ToolIntent } from './features/editor/toolIntent'
import './styles.css'

const CreateEditor = lazy(() => import('./features/editor/EditorPage').then((module) => ({ default: module.CreateEditor })))
const ProjectEditor = lazy(() => import('./features/editor/EditorPage').then((module) => ({ default: module.ProjectEditor })))
const preloadEditor = () => { void import('./features/editor/EditorPage') }
const editorFallback = <p className="muted" style={{ padding: 24 }}>Opening sticker…</p>

const getView = (search: string) => new URLSearchParams(search).get('view')

const topNavigation = [
  { to: '/', label: 'Home', active: (pathname: string, search: string) => pathname === '/' && !getView(search) },
  { to: '/create', label: 'Create', active: (pathname: string) => pathname === '/create' || pathname.startsWith('/editor/') },
  { to: '/templates', label: 'Templates', active: (pathname: string, search: string) => pathname === '/templates' && getView(search) !== 'explore' },
  { to: '/my-stickers', label: 'My Stickers', active: (pathname: string, search: string) => pathname === '/my-stickers' && getView(search) !== 'favorites' },
  { to: '/templates?view=explore', label: 'Explore', active: (pathname: string, search: string) => pathname === '/templates' && getView(search) === 'explore' },
]

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
      <Link to="/" className="brand"><span className="mascot" aria-hidden="true"><svg viewBox="0 0 64 44" fill="none"><circle cx="19" cy="23" r="7" fill="currentColor" /><circle cx="46" cy="23" r="7" fill="currentColor" /><path d="M29 25c0 7 8 7 8 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span><span>Sticker<span>Lab</span><small>Turn moments into stickers</small></span></Link>
      <nav className="topnav" aria-label="Primary navigation">
        {topNavigation.map((item) => (
          <Link key={item.label} to={item.to} className={item.active(pathname, search) ? 'active' : undefined} aria-current={item.active(pathname, search) ? 'page' : undefined} onMouseEnter={item.to === '/create' ? preloadEditor : undefined} onFocus={item.to === '/create' ? preloadEditor : undefined}>{item.label}</Link>
        ))}
      </nav>
      <GlobalSearch />
      <NoticeDialog title="Notifications are unavailable" trigger={<Button className="icon notifications" aria-label="Notifications"><Bell size={18} /></Button>}>
        Notifications are not implemented.
      </NoticeDialog>
      <Account />
    </header>
  )
}

const sidebarTools: Array<{ label: string; icon: typeof Scissors; intent: ToolIntent }> = [
  { label: 'Background Eraser', icon: Scissors, intent: 'erase' },
  { label: 'Text & Emoji', icon: Type, intent: 'text' },
  { label: 'Filters & Effects', icon: Sparkles, intent: 'effects' },
  { label: 'Export & Share', icon: Upload, intent: 'export' },
]

function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const { pathname, search } = useLocation()
  const isFavorites = pathname === '/my-stickers' && getView(search) === 'favorites'
  const isShared = pathname === '/my-stickers' && getView(search) === 'shared'
  const currentIntent = parseToolIntent(new URLSearchParams(search).get('tool'))
  const items = [
    { to: '/', label: 'Dashboard', icon: Home, active: pathname === '/' },
    { to: '/create', label: 'Create Sticker', icon: Plus, active: pathname === '/create' || pathname.startsWith('/editor/') },
    { to: '/my-stickers', label: 'My Stickers', icon: ImagePlus, active: pathname === '/my-stickers' && !isFavorites && !isShared },
    { to: '/templates', label: 'Templates', icon: LayoutGrid, active: pathname === '/templates' },
    { to: '/my-stickers?view=favorites', label: 'Favorites', icon: Heart, active: isFavorites },
    { to: '/my-stickers?view=shared', label: 'Shared with Me', icon: UserRound, active: isShared },
  ]

  const itemLink = ({ to, label, icon: Icon, active }: typeof items[number]) => {
    const link = <Link className={active ? 'active' : undefined} to={to} onMouseEnter={to === '/create' ? preloadEditor : undefined} onFocus={to === '/create' ? preloadEditor : undefined}><Icon size={18} />{label}</Link>
    return mobile ? <SheetClose asChild key={label}>{link}</SheetClose> : <span key={label}>{link}</span>
  }

  return (
    <aside className="sidebar">
      <div className="side-links">{items.map(itemLink)}</div>
      <div className="side-tools">
        <small>TOOLS</small>
        {sidebarTools.map(({ label, icon: Icon, intent }) => {
          const to = toolIntentHref(intent, pathname)
          const active = currentIntent === intent && (pathname === '/create' || pathname.startsWith('/editor/'))
          const link = (
            <Link
              className={active ? 'active' : undefined}
              to={to}
              replace={shouldReuseCurrentToolRoute(pathname, search, intent)}
              aria-current={active ? 'page' : undefined}
              onMouseEnter={preloadEditor}
              onFocus={preloadEditor}
              onClick={(event) => {
                if (!isUnmodifiedPrimaryClick(event) || !shouldReuseCurrentToolRoute(pathname, search, intent)) return
                requestToolIntent(intent)
              }}
            >
              <Icon size={18} />{label}
            </Link>
          )
          return mobile ? <SheetClose asChild key={label}>{link}</SheetClose> : <span key={label}>{link}</span>
        })}
      </div>
      <Card className="studio-note"><img src="/art/stickers/04-winking-smiley.webp" alt="" width={64} height={64} /><b>Good ideas stick.</b><p>Create. Customize.<br />Share. Repeat.</p><Link to="/create">Make something fun <ChevronRight size={14} /></Link></Card>
    </aside>
  )
}

function Shell({ children, editor = false }: { children: ReactNode; editor?: boolean }) {
  return <><Header /><div className={`layout${editor ? ' editor-layout' : ''}`}><Sidebar /><main><CloudBanner />{children}</main></div></>
}

const dashboardFeatures = [
  { icon: Scissors, title: 'Background Eraser', to: '/create?tool=erase', detail: 'Brush away the background. Keep the good bits.', tone: 'pink' },
  { icon: Type, title: 'Text & Emoji', to: '/create?tool=text', detail: 'Say it your way with editable text.', tone: 'blue' },
  { icon: Sparkles, title: 'Filters & Effects', to: '/create?tool=effects', detail: 'Tune brightness, contrast, and grayscale on a photo.', tone: 'yellow' },
  { icon: LayoutGrid, title: 'Templates', to: '/templates', detail: 'A little inspiration. A lot of possibilities.', tone: 'purple' },
  { icon: Upload, title: 'Share & Export', to: '/create?tool=export', detail: 'Made it? Take it with you as a transparent PNG.', tone: 'green', torn: true },
] as const

function Hero({ title, children, action, art, kicker, points, className }: { title: ReactNode; children: ReactNode; action?: ReactNode; art?: ReactNode; kicker?: ReactNode; points?: ReactNode; className?: string }) {
  return (
    <section className={className ? `hero ${className}` : 'hero'}>
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
        className="hero-dashboard"
        title={<>Small stickers.<br /><em>Big personality.</em></>}
        kicker={<p className="hero-kicker tape">YOUR EVERYDAY, REMIXED</p>}
        action={<div className="actions"><Link className="button primary" to="/create" onMouseEnter={preloadEditor} onFocus={preloadEditor}><ImagePlus size={16} />Create a Sticker<ChevronRight size={16} /></Link><Walkthrough /></div>}
        points={<ul className="hero-points"><li>No account needed</li><li>Saved on your device</li><li>Made by you</li></ul>}
        art={<StickerCollage />}
      >
        Your cat. Your chaos. Your favorite face. Turn everyday photos into little things worth sending.
      </Hero>
      <div className="feature-grid">{dashboardFeatures.map(({ icon: Icon, title, to, detail, tone, ...rest }) => (
        <Link className={`feature${'torn' in rest && rest.torn ? ' torn' : ''}`} to={to} key={title} onMouseEnter={to.startsWith('/create') ? preloadEditor : undefined} onFocus={to.startsWith('/create') ? preloadEditor : undefined}>
          <b className={tone}><Icon size={18} /></b>
          <span><strong>{title}</strong><small>{detail}</small></span>
          <i className="feature-doodle" aria-hidden="true">
            {title === 'Text & Emoji' ? <span className="feature-scrap">Make it yours!</span> : null}
            {title === 'Templates' ? <>
              <span className="feature-polaroid field"><img src="/art/polaroid-field.svg" alt="" /></span>
              <span className="feature-polaroid daisy"><img src="/art/polaroid-daisy.svg" alt="" /></span>
              <img className="feature-smiley" src="/art/stickers/04-winking-smiley.webp" alt="" />
            </> : null}
          </i>
        </Link>
      ))}</div>
      <div className="split"><ProjectSection /><TemplateRail title="🔥 Trending Templates" /></div>
      <section className="bottom-banner">
        <img className="banner-sticker" src="/art/stickers/16-rainbow.webp" alt="" width={96} height={72} /><b>Less ordinary.<br />More you.</b>
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
        <DialogDescription>From camera roll to conversation starter.</DialogDescription>
        <ol className="walkthrough">
          <li>Create a sticker from the dashboard or Create page.</li>
          <li>Upload a PNG, JPEG, or static WebP photo.</li>
          <li>Move, resize, and rotate it, then add text.</li>
          <li>Save locally, reopen from Dashboard or My Stickers, and export a transparent PNG.</li>
        </ol>
        <DialogFooter><DialogClose asChild><Button className="primary">Let’s make something</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectSection() {
  return <section><div className="section-title"><h2><Clock size={16} aria-hidden="true" /> Recent Projects</h2><Link to="/my-stickers#local-stickers">View all</Link></div><LocalProjectList limit={6} /></section>
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
  onUse: (template: Template) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  return (
    <article className="template-card" key={template.id}>
      <div className="template-art">
        <button
          type="button"
          className="template-preview-trigger"
          aria-label={`Preview ${template.title}`}
          onClick={(event) => { opener.current = event.currentTarget; setOpen(true) }}
        >
          {template.previewImage ? <img className="template-preview-image" src={template.previewImage} alt="" loading="lazy" /> : template.preview}
        </button>
        <button
          type="button"
          className="favorite-button"
          aria-label={isFavorite ? `Remove ${template.title} from favorites` : `Add ${template.title} to favorites`}
          onClick={() => onToggleFavorite(template.id)}
        >
          {isFavorite ? '❤️' : '♡'}
        </button>
      </div>
      <button
        type="button"
        className="template-title-btn"
        onClick={(event) => { opener.current = event.currentTarget; setOpen(true) }}
      >
        <b>{template.title}</b>
      </button>
      <small>{template.category} · {template.document.layers.length} {template.document.layers.length === 1 ? 'layer' : 'layers'}</small>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus() }}>
          <DialogTitle>{template.title}</DialogTitle>
          <DialogDescription>Clone this template into an independent editable sticker.</DialogDescription>
          <div className="template-preview-body">
            <div className="detail-cover template-preview-art">
              {template.previewImage ? <img className="template-preview-image" src={template.previewImage} alt={template.title} /> : template.preview}
            </div>
            {template.previewImage ? <p className="muted">Replace the sample cat with your own photo, edit the caption, and move each decoration independently. In the editor, open Layers → Your photo → Adjust → Replace photo. Photo backgrounds are not removed automatically.</p> : null}
            <p><strong>Category:</strong> {template.category}</p>
            <p>
              <strong>Layers:</strong>{' '}
              {template.document.layers.map((l) => l.name).join(', ') || 'Starter artwork'}
            </p>
            {error ? <p role="alert">{error}</p> : null}
            <DialogFooter>
              <DialogClose asChild><Button>Keep browsing</Button></DialogClose>
              <Button
                className="primary"
                disabled={creating}
                onClick={async () => {
                  setCreating(true)
                  setError(null)
                  try {
                    await onUse(template)
                    setOpen(false)
                  } catch {
                    setError('Could not save the template. Please retry; the original is unchanged.')
                  } finally {
                    setCreating(false)
                  }
                }}
              >
                Use Template
              </Button>
            </DialogFooter>
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
  useEffect(() => {
    const refresh = () => setFavorites(getFavoriteTemplateIds())
    window.addEventListener('stickerlab:favorites', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('stickerlab:favorites', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const handleToggleFavorite = (id: string) => {
    setFavorites(toggleFavoriteTemplateId(id))
  }

  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const handleUse = async (template: Template) => {
    const { document, assets } = await instantiateTemplate(template)
    if (!live.current) return
    await repo.saveProjectWithAssets(document, assets)
    if (live.current) navigate(`/editor/${document.id}`)
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
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const setQuery = (value: string) => setSearchParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set('q', value); else next.delete('q'); return next }, { replace: true })
  useEffect(() => { setCategory('All Templates') }, [query])
  const result = templateData.filter((template) => (category === 'All Templates' || template.category === category) && template.title.toLowerCase().includes(query.toLowerCase()))
  const resetFilters = () => { setCategory('All Templates'); setQuery('') }

  return (
    <Shell>
      <Hero title={<><span>Find your vibe.</span><br /><em>Make it yours.</em></>} kicker={<p className="hero-kicker"><Sparkles size={14} /> THE INSPIRATION STATION</p>} art={<StickerCollage variant="templates" />}>
        Start with a spark, add your own twist. Every template becomes your very own editable sticker.
      </Hero>
      <div className="pills" aria-label="Template category filters">{TEMPLATE_CATEGORIES.map((item) => <button aria-pressed={category === item} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
      <div className="filters"><span className="muted">{result.length} editable templates · free to make your own</span><label className="filter-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search sample templates" placeholder="Find your next idea…" /></label></div>
      {result.length ? <><TemplateRail title="🔥 Trending Templates" items={result} /><TemplateRail title="✦ Explore by Category" items={result.slice().reverse()} /><TemplateRail title="✨ More Templates You'll Love" items={result.slice(2)} /></> : <Card className="empty"><h2>No sample templates found</h2><Button onClick={resetFilters}>Reset filters</Button></Card>}
    </Shell>
  )
}

function EditorLayout({ children }: { children: ReactNode }) {
  return <Shell editor><Suspense fallback={editorFallback}>{children}</Suspense></Shell>
}

function Packs() {
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
  const requestedPack = params.get('pack')
  useEffect(() => { if (requestedPack) setSelectedPackId(requestedPack) }, [requestedPack])
  const [createOpen, setCreateOpen] = useState(false)
  const [editingPack, setEditingPack] = useState<PackRecord | null>(null)
  const [deletePack, setDeletePack] = useState<PackRecord | null>(null)
  const deleteOpener = useRef<HTMLButtonElement | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [addStickerOpen, setAddStickerOpen] = useState(false)
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
  const view =
    viewParam === 'mine'
      ? 'My Packs'
      : viewParam === 'favorites'
      ? 'Favorites'
      : viewParam === 'shared'
      ? 'Shared with Me'
      : viewParam === 'export-history'
      ? 'Export History'
      : 'All Packs'
  const selectView = (next: string) => {
    if (next === 'My Packs') setParams({ view: 'mine' })
    else if (next === 'Favorites') setParams({ view: 'favorites' })
    else if (next === 'Shared with Me') setParams({ view: 'shared' })
    else if (next === 'Export History') setParams({ view: 'export-history' })
    else setParams({})
  }

  const selectedPack = packs.find((p) => p.id === selectedPackId) || packs[0] || null

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
      const { exportPackZip } = await import('./features/exports/zipExport')
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
      >
        Organize saved stickers into packs and export transparent PNG ZIP bundles.
      </Hero>
      {error ? <p role="alert">{error}</p> : null}
      <div className="packs-controls">
        <div className="pills">
          {['All Packs', 'My Packs', 'Favorites', 'Shared with Me', 'Export History'].map((item) => (
            <button aria-pressed={view === item} disabled={!['All Packs', 'My Packs', 'Favorites', 'Shared with Me', 'Export History'].includes(item)} onClick={() => selectView(item)} key={item}>
              {item}
            </button>
          ))}
        </div>
        <span className="muted">{cloud ? 'Private account · local-first cloud saving' : 'Pack collections stay private on this device.'}</span>
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
          <p>Export history is not recorded yet. PNG and ZIP exports start a browser download; your browser controls where files are saved.</p>
        </section>
      ) : packs.length === 0 ? (
        <section className="empty packs-empty">
          <Layers3 size={36} />
          <h2>{emptyHeading}</h2>
          <p>{emptyDetail}</p>
          <Button className="primary" onClick={(event) => { createOpener.current = event.currentTarget; setEditingPack(null); setNewTitle(''); setNewDesc(''); setCreateOpen(true) }}>
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
                <span className="pack-badge">{pack.projectIds.length} stickers · {cloud ? 'Private' : 'Local'}</span>
              </button>
            ))}
          </div>
          {selectedPack ? (
            <aside className="pack-detail">
              <h2>{selectedPack.title}</h2>
              <p className="muted">{selectedPack.description || 'No description'}</p>
              <span className="pack-badge">{selectedPack.projectIds.length} stickers · {cloud ? 'Private' : 'Local'}</span>

              <div className="button-row">
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
              <div className="button-row">
                <Button disabled={busy} onClick={(event) => { createOpener.current = event.currentTarget; setEditingPack(selectedPack); setNewTitle(selectedPack.title); setNewDesc(selectedPack.description); setCreateOpen(true) }}>Edit pack</Button>
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

              <h3>Stickers in Pack ({selectedPack.projectIds.length})</h3>
              {selectedPack.projectIds.length === 0 ? (
                <p className="muted">No stickers in this pack. Click Add Stickers to include saved stickers.</p>
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

      <section className="local-stickers-section" id="local-stickers">
        <div className="section-title"><h2>{cloud ? 'All Private Stickers' : 'All Local Stickers'}</h2><Link to="/create">Create</Link></div>
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

      {/* Dialogs */}
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

export function App({ repository }: { repository?: StickerLabRepository } = {}) {
  return (
    <WorkspaceProvider repository={repository}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<EditorLayout><CreateEditor /></EditorLayout>} />
        <Route path="/editor/:projectId" element={<EditorLayout><ProjectEditor /></EditorLayout>} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/my-stickers" element={<Packs />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </WorkspaceProvider>
  )
}

if (import.meta.env.MODE !== 'test') createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
