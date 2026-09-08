import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useRepository } from '../app/repository'
import { useCloudStatus } from '../features/auth/Workspace'
import { templateData } from '../features/templates/templates'
import type { PackRecord } from '../types/domain'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'

export function GlobalSearch() {
  const repo = useRepository()
  const cloudStatus = useCloudStatus()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [packs, setPacks] = useState<PackRecord[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        if (document.querySelector('[role="dialog"]')) return
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => {
    if (!open) return
    let live = true
    setPacks(null)
    setError(false)
    void repo.listPacks().then((items) => { if (live) setPacks(items) }).catch(() => {
      if (live) { setPacks([]); setError(true) }
    })
    return () => { live = false }
  }, [open, repo, cloudStatus.version])
  const needle = query.trim().toLowerCase()
  const templates = templateData.filter((item) => `${item.title} ${item.category} ${item.tags.join(' ')}`.toLowerCase().includes(needle))
  const matches = (packs ?? []).filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(needle))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="search search-button" aria-label="Search templates and packs"><Search size={16} /><span>Search templates and packs...</span></Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>Search templates and packs</DialogTitle>
        <DialogDescription>Find a template to customize or open one of your saved packs.</DialogDescription>
        <label className="filter-search global-search-input"><Search size={18} /><input autoFocus aria-label="Search library" placeholder="Try cats, birthday, or a pack name…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {error ? <p role="alert">Could not load your packs. Close and reopen search to retry. Templates are still available.</p> : null}
        <p className="muted" role="status">{packs === null ? 'Loading saved packs…' : `${templates.length + matches.length} ${templates.length + matches.length === 1 ? 'result' : 'results'}`}</p>
        {templates.length + matches.length === 0 && packs !== null ? <p>No matches. Try another name or category.</p> : null}
        {templates.length > 0 ? <section className="global-search-results"><h3>Templates</h3>{templates.map((item) => (
          <DialogClose asChild key={item.id}><Link to={`/templates?q=${encodeURIComponent(item.title)}`} className="global-search-result">
            {item.previewImage ? <img src={item.previewImage} alt="" loading="lazy" /> : <Search size={20} />}
            <span><strong>{item.title}</strong><small>{item.category} · Template</small></span>
          </Link></DialogClose>
        ))}</section> : null}
        {matches.length > 0 ? <section className="global-search-results"><h3>Your packs</h3>{matches.map((item) => (
          <DialogClose asChild key={item.id}><Link to={`/my-stickers?pack=${encodeURIComponent(item.id)}`} className="global-search-result"><span><strong>{item.title}</strong><small>{item.projectIds.length} stickers · Pack</small></span></Link></DialogClose>
        ))}</section> : null}
      </DialogContent>
    </Dialog>
  )
}
