import { StrictMode, Suspense, lazy, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { RepositoryProvider } from './app/repository'
import { LocalProjectList } from './features/editor/LocalProjectList'
import type { StickerLabRepository } from './lib/persistence/repository'
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
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
  Share2,
  Sparkles,
  Type,
  Upload,
  UserRound,
} from 'lucide-react'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
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
import type { Template } from './types/domain'
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

const samples = ['🐶', '🐱', '💖', '👑', '😎', '✨', '🌈', '☕']

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

const templateNames = ['Good Vibes Pack', 'Cat Expressions', 'Meme Essentials', 'Daily Vibes', 'Cool Pets', 'Selfie Stickers', 'Birthday Fun', 'Love Notes', 'Work Wins', 'Seasonal Smiles', 'Text Stickers', 'Big Reactions']
const categories = ['All Templates', 'Trending', 'Cute Animals', 'Meme Reactions', 'Birthday', 'Love', 'Work', 'Text Stickers', 'Emotions', 'Seasonal']
const templateData: Template[] = templateNames.map((title, index) => ({
  id: `sample-${index}`,
  title,
  category: categories[(index % (categories.length - 1)) + 1],
  tags: ['free', index % 2 ? 'cute' : 'fun'],
  preview: samples[index % samples.length],
  document: { schemaVersion: 1, id: `seed-${index}`, title, artboard: { width: 1024, height: 1024, background: 'transparent' }, layers: [], assetIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 0 },
}))

function TemplateRail({ title, items = templateData.slice(0, 4) }: { title: string; items?: Template[] }) {
  return <section><div className="section-title"><h2>{title}</h2><Link to="/templates">View all</Link></div><div className="rail">{items.map((template) => <article className="template-card" key={template.id}><div className="template-art">{template.preview}<Unavailable className="favorite-button" label="Favorites require local persistence">♡</Unavailable></div><b>{template.title}</b><small>{template.category} · Sample template</small></article>)}</div></section>
}

function TemplatesPage() {
  const [category, setCategory] = useState('All Templates')
  const [query, setQuery] = useState('')
  const result = templateData.filter((template) => (category === 'All Templates' || template.category === category) && template.title.toLowerCase().includes(query.toLowerCase()))
  const resetFilters = () => { setCategory('All Templates'); setQuery('') }

  return (
    <Shell>
      <Hero title={<>Discover Amazing <em>Sticker Templates</em></>}>A small, clearly labelled sample catalog for the foundation. Templates will become independent editable projects in a later milestone.</Hero>
      <div className="pills" aria-label="Template category filters">{categories.map((item) => <button aria-pressed={category === item} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
      <div className="filters"><label>Sort by <select disabled aria-describedby="template-filter-help"><option>Featured</option></select></label><label>Style <select disabled aria-describedby="template-filter-help"><option>All styles</option></select></label><span id="template-filter-help" className="muted">Category and title search work; sort and style arrive later.</span><label className="filter-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search sample templates" placeholder="Search samples" /></label></div>
      {result.length ? <><TemplateRail title="🔥 Trending Templates" items={result} /><TemplateRail title="✦ Explore by Category" items={result.slice().reverse()} /><TemplateRail title="✨ More Templates You'll Love" items={result.slice(2)} /></> : <Card className="empty"><h2>No sample templates found</h2><Button onClick={resetFilters}>Reset filters</Button></Card>}
    </Shell>
  )
}

function EditorLayout({ children }: { children: ReactNode }) {
  return <Shell><Suspense fallback={editorFallback}>{children}</Suspense></Shell>
}

function Packs() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'favorites' ? 'Favorites' : params.get('view') === 'shared' ? 'Shared with Me' : 'All Packs'
  const selectView = (next: string) => {
    if (next === 'Favorites') setParams({ view: 'favorites' })
    else if (next === 'Shared with Me') setParams({ view: 'shared' })
    else setParams({})
  }
  const emptyHeading = view === 'Favorites' ? 'No favorite local packs yet' : view === 'Shared with Me' ? 'Sharing is not available yet' : 'No local packs yet'
  const emptyDetail = view === 'Shared with Me' ? 'Cloud sharing is not set up. Local stickers stay on this device.' : 'Packs will group stickers without deleting them. Sharing is unavailable.'
  return <Shell><Hero title="My Sticker Packs" action={<div className="actions"><Unavailable><Plus />New Pack</Unavailable><Unavailable><ImagePlus />Import Photos</Unavailable></div>}>Organize saved stickers locally. Pack collections, favorites, and sharing arrive in a later milestone.</Hero><div className="packs-controls"><div className="pills">{['All Packs', 'My Packs', 'Favorites', 'Shared with Me', 'Export History'].map((item) => <button aria-pressed={view === item} disabled={!['All Packs', 'Favorites', 'Shared with Me'].includes(item)} onClick={() => selectView(item)} key={item}>{item}</button>)}</div><span className="muted">Packs are not implemented yet. Saved stickers are listed below.</span></div><section><div className="section-title"><h2>Local stickers</h2><Link to="/create">Create</Link></div><LocalProjectList emptyTitle="No local stickers yet" emptyDetail="Save a sticker from the editor to reopen it here." /></section><div className="packs-layout"><section className="empty packs-empty"><Layers3 size={36} /><h2>{emptyHeading}</h2><p>{emptyDetail}</p><Unavailable label="Packs are not implemented"><Plus />New Pack</Unavailable></section><aside className="pack-detail"><h2>Pack details</h2><div className="detail-cover">✦</div><p>Select a local pack to inspect its stickers and settings once packs exist.</p><Button disabled><Share2 />Share Pack</Button></aside></div></Shell>
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
