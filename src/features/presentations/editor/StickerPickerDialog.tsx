/**
 * Saved-sticker picker for the presentation editor (P33). Lists the real local
 * sticker projects; choosing one asks the page to snapshot and place it. An
 * empty or unreadable library says so instead of rendering dead controls.
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { StickerLabRepository } from '@/lib/persistence/repository'
import type { ProjectDocument } from '@/types/domain'

export function StickerPickerDialog({ repository, disabled, onPick }: { repository: StickerLabRepository; disabled?: boolean; onPick: (projectId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectDocument[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    setProjects(null)
    setError(false)
    repository.listProjects()
      .then((list) => {
        if (live) setProjects([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      })
      .catch(() => {
        if (live) setError(true)
      })
    return () => { live = false }
  }, [open, repository])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>Add sticker</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add a saved sticker</DialogTitle>
        <DialogDescription>A snapshot is placed as its own image. Editing or deleting the sticker later does not change it.</DialogDescription>
        {error ? <p role="alert">Your saved stickers could not be read.</p> : null}
        {projects === null && !error ? <p role="status">Loading stickers…</p> : null}
        {projects?.length === 0 ? <p>No saved stickers yet. Create one in the sticker editor first.</p> : null}
        <ul className="presentation-sticker-picker">
          {projects?.map((project) => (
            <li key={project.id}>
              <Button
                onClick={() => {
                  onPick(project.id)
                  setOpen(false)
                }}
              >
                {project.title || 'Untitled sticker'}
                <span>{project.layers.length} {project.layers.length === 1 ? 'layer' : 'layers'}</span>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
