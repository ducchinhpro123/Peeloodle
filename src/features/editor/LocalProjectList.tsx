import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ImagePlus } from 'lucide-react'
import { useRepository } from '../../app/repository'
import type { ProjectDocument } from '../../types/domain'

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
  const location = useLocation()
  const [projects, setProjects] = useState<ProjectDocument[] | null>(null)

  useEffect(() => {
    let live = true
    repo
      .listProjects()
      .then((list) => {
        if (live) setProjects(list)
      })
      .catch(() => {
        if (live) setProjects([])
      })
    return () => {
      live = false
    }
  }, [repo, location.pathname, location.key])

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
    <div className="project-grid">
      {visible.map((project) => (
        <Link className="project-card" to={`/editor/${project.id}`} key={project.id}>
          <div className="project-thumb" aria-hidden="true">{project.title.slice(0, 1) || 'S'}</div>
          <b>{project.title}</b>
          <small>Saved locally</small>
        </Link>
      ))}
      <Link className="project-card project-new" to="/create">
        <div className="project-thumb">+</div>
        <b>New project</b>
        <small>Start creating</small>
      </Link>
    </div>
  )
}
