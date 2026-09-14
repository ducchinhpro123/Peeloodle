import { Bell, ChevronRight, Menu, Scissors, Sparkles, Type, Upload } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NoticeDialog } from '@/components/ui/notice-dialog'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Account, CloudBanner } from '@/features/auth/Account'
import { GlobalSearch } from '@/features/search/GlobalSearch'
import { isUnmodifiedPrimaryClick, parseToolIntent, requestToolIntent, shouldReuseCurrentToolRoute, toolIntentHref, type ToolIntent } from '@/features/editor/toolIntent'
import { primaryNavigation, sidebarNavigation } from './navigation'
import { preloadEditor } from './routeModules'
import type { ReactNode } from 'react'

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
      <Link to="/" className="brand"><img src="/art/logo-wordmark.webp" width={500} height={224} alt="StickerLab" /></Link>
      <nav className="topnav" aria-label="Primary navigation">
        {primaryNavigation.map((item) => (
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
  const currentIntent = parseToolIntent(new URLSearchParams(search).get('tool'))

  const itemLink = ({ to, label, icon: Icon, active }: typeof sidebarNavigation[number]) => {
    const isActive = active(pathname, search)
    const link = <Link className={isActive ? 'active' : undefined} to={to} onMouseEnter={to === '/create' ? preloadEditor : undefined} onFocus={to === '/create' ? preloadEditor : undefined}>{Icon ? <Icon size={18} /> : null}{label}</Link>
    return mobile ? <SheetClose asChild key={label}>{link}</SheetClose> : <span key={label}>{link}</span>
  }

  return (
    <aside className="sidebar">
      <div className="side-links">{sidebarNavigation.map(itemLink)}</div>
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

export function Shell({ children, editor = false }: { children: ReactNode; editor?: boolean }) {
  return <><Header /><div className={`layout${editor ? ' editor-layout' : ''}`}><Sidebar /><main><CloudBanner />{children}</main></div></>
}
