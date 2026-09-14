import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { useRepository } from '@/app/repository'
import { instantiateTemplate, getFavoriteTemplateIds, templateData, toggleFavoriteTemplateId } from './templates'
import type { Template } from '@/types/domain'

export function TemplateCard({
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

export function TemplateRail({
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
