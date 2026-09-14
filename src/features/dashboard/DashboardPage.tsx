import { ChevronRight, Clock, ImagePlus, LayoutGrid, Play, Scissors, Sparkles, Type, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Hero } from '@/components/Hero'
import { StickerCollage } from '@/components/StickerCollage'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { LocalProjectList } from '@/features/editor/LocalProjectList'
import { TemplateRail } from '@/features/templates/TemplateRail'
import { preloadEditor } from '@/app/routeModules'
import { Shell } from '@/app/Shell'

const dashboardFeatures = [
  { icon: Scissors, title: 'Background Eraser', to: '/create?tool=erase', detail: 'Brush away the background. Keep the good bits.', tone: 'pink' },
  { icon: Type, title: 'Text & Emoji', to: '/create?tool=text', detail: 'Say it your way with editable text.', tone: 'blue' },
  { icon: Sparkles, title: 'Filters & Effects', to: '/create?tool=effects', detail: 'Tune brightness, contrast, and grayscale on a photo.', tone: 'yellow' },
  { icon: LayoutGrid, title: 'Templates', to: '/templates', detail: 'A little inspiration. A lot of possibilities.', tone: 'purple' },
  { icon: Upload, title: 'Share & Export', to: '/create?tool=export', detail: 'Made it? Take it with you as a transparent PNG.', tone: 'green', torn: true },
] as const

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

export function DashboardPage() {
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
