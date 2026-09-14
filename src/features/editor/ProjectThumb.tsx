import { useEffect, useState } from 'react'
import type { ProjectDocument } from '../../types/domain'
import type { StickerLabRepository } from '../../lib/persistence/repository'
import { acquireProjectThumbnail } from './projectThumbnails'

export function ProjectThumb({ project, repo }: { project: ProjectDocument; repo: StickerLabRepository }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        if (import.meta.env.MODE === 'test') return
        // The thumbnail cache owns the object URL; this component must not revoke it.
        const thumbnail = await acquireProjectThumbnail({ repository: repo, project })
        if (!live) return
        if (thumbnail) setUrl(thumbnail)
        else setFailed(true)
      } catch {
        if (live) { setUrl(null); setFailed(true) }
      }
    })()
    return () => {
      live = false
    }
  }, [project, repo])
  return (
    <div className="project-thumb" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <span className="project-preview-placeholder">{project.layers.length === 0 ? 'Blank canvas' : failed ? 'Preview unavailable' : 'Loading preview…'}</span>}
    </div>
  )
}
