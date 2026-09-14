import { Search, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Hero } from '@/components/Hero'
import { StickerCollage } from '@/components/StickerCollage'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Shell } from '@/app/Shell'
import { TemplateRail } from './TemplateRail'
import { TEMPLATE_CATEGORIES, templateData } from './templates'

export function TemplatesPage() {
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
