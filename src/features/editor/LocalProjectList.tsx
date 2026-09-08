import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useRepository } from '../../app/repository'
import { useCloudStatus, useWorkspace } from '../auth/Workspace'
import type { ProjectDocument } from '../../types/domain'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import type { StickerLabRepository } from '../../lib/persistence/repository'
import { removeProject } from './removeProject'

export function LocalProjectList({
  emptyTitle = 'No projects yet',
  emptyDetail = 'Your local projects will appear here.',
  limit,
}: {
  emptyTitle?: string
  emptyDetail?: string
  limit?: number
}) {
  const repo = useRepository()
  const cloud = useWorkspace()?.cloud
  const cloudStatus = useCloudStatus()
  const location = useLocation()
  const [projects, setProjects] = useState<ProjectDocument[] | null>(null)
  const [pending, setPending] = useState<ProjectDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)

  const reload = () => repo.listProjects().then(setProjects).catch(() => setProjects([]))

  useEffect(() => {
    let live = true
    repo.listProjects().then((list) => { if (live) setProjects(list) }).catch(() => { if (live) setProjects([]) })
    return () => { live = false }
  }, [repo, location.pathname, location.key, cloudStatus.version])

  if (!projects) return <p className="muted">Loading projects…</p>
  const visible = limit ? projects.slice(0, limit) : projects
  if (visible.length === 0) {
    return (
      <div className="project-empty">
        <ImagePlus size={28} />
        <b>{emptyTitle}</b>
        <span>{emptyDetail}</span>
        <Link to="/create">Create your first sticker</Link>
      </div>
    )
  }

  return (
    <>
      <div className="project-grid">
        {visible.map((project) => (
          <article className="project-card" key={project.id}>
            <Link className="project-card-link" to={`/editor/${project.id}`}>
              <ProjectThumb project={project} repo={repo} />
              <b>{project.title}</b>
              <small>{cloud ? 'Private workspace' : 'Saved locally'}</small>
            </Link>
            <Button
              className="icon project-delete"
              aria-label={`Delete ${project.title}`}
              onClick={(event) => { opener.current = event.currentTarget; setError(null); setPending(project) }}
            >
              <Trash2 size={16} />
            </Button>
          </article>
        ))}
        <Link className="project-card project-new" to="/create">
          <div className="project-thumb">+</div>
          <b>New project</b>
          <small>Start creating</small>
        </Link>
      </div>
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent
          onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById('cancel-delete-project')?.focus() }}
          onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus() }}
        >
          <DialogTitle>Delete this sticker?</DialogTitle>
          <DialogDescription>
            “{pending?.title}” will be removed {cloud ? 'from your private StickerLab account on this device and other signed-in devices' : 'from this browser'}.
            Any pack memberships for this sticker will be removed; the other stickers in those packs will be kept.
          </DialogDescription>
          {error ? <p role="alert">{error}</p> : null}
          <DialogFooter>
            <Button id="cancel-delete-project" onClick={() => setPending(null)}>Keep sticker</Button>
            <Button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (!pending) return
                setBusy(true)
                setError(null)
                void removeProject(repo, pending).then(() => {
                  setPending(null)
                  return reload()
                }).catch((cause) => {
                  setError(cause instanceof Error ? cause.message : 'Could not delete this sticker. Please retry.')
                }).finally(() => setBusy(false))
              }}
            >
              Delete sticker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProjectThumb({ project, repo }: { project: ProjectDocument; repo: StickerLabRepository }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let objectUrl: string | undefined
    void (async () => {
      try {
        if (import.meta.env.MODE === 'test') return
        const assets = await Promise.all(project.assetIds.map((id) => repo.getAsset(id)))
        const keys = [...new Set(project.layers.flatMap((layer) => (layer.kind === 'image' && layer.maskKey ? [layer.maskKey] : [])))]
        const masks = Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await repo.getMask(key)] as const)))
        const { renderDocument } = await import('../exports/renderDocument')
        const blob = await renderDocument(project, Object.fromEntries(assets.map((record) => [record.asset.id, record])), { size: 512, masks, bounds: 'artwork' })
        if (!live) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        if (live) setUrl(null)
      }
    })()
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [project, repo])
  return (
    <div className="project-thumb" aria-hidden="true">
      {url ? <img src={url} alt="" /> : project.title.slice(0, 1) || 'S'}
    </div>
  )
}


