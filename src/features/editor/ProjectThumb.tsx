import { useEffect, useState } from 'react'
import type { ProjectDocument } from '../../types/domain'
import type { StickerLabRepository } from '../../lib/persistence/repository'

export function ProjectThumb({ project, repo }: { project: ProjectDocument; repo: StickerLabRepository }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
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
        if (live) { setUrl(null); setFailed(true) }
      }
    })()
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [project, repo])
  return (
    <div className="project-thumb" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <span className="project-preview-placeholder">{project.layers.length === 0 ? 'Blank canvas' : failed ? 'Preview unavailable' : 'Loading preview…'}</span>}
    </div>
  )
}


