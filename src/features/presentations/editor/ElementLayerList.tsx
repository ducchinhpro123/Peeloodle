/**
 * Accessible element list for the active slide (P30). Top of the list is the
 * front-most element, matching what the canvas paints last. Every action is a
 * labelled button, so selection, ordering, duplication, deletion and locks are
 * all reachable from the keyboard; destructive actions stay undoable rather
 * than opening a dialog for each one.
 *
 * Rows are memoized and the list is indexed in one pass: with the 200-element
 * cap, a selection change then re-renders only the rows whose state changed
 * instead of every row plus a per-row array scan.
 */

import { memo } from 'react'
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePresentationStore } from './store'
import type { Element } from '../model/types'

function kindLabel(element: Element): string {
  if (element.kind === 'shape') return element.shape.replace('-', ' ')
  return element.kind
}

type LayerRowProps = {
  element: Element
  index: number
  count: number
  selected: boolean
}

const LayerRow = memo(function LayerRow({ element, index, count, selected }: LayerRowProps) {
  const name = element.name || kindLabel(element)
  const store = () => usePresentationStore.getState()

  return (
    <div className="presentation-layer-item" role="listitem" data-selected={selected ? 'true' : undefined}>
      <button
        type="button"
        className="presentation-layer-select"
        aria-current={selected ? 'true' : undefined}
        onClick={() => store().selectElements([element.id])}
      >
        <span aria-hidden="true">{kindLabel(element)}</span>
        <b>{name}</b>
        {element.locked ? <Lock size={12} aria-label="Locked" /> : null}
      </button>
      <div className="presentation-layer-actions">
        <Button
          className="icon"
          aria-label={element.visible ? `Hide ${name}` : `Show ${name}`}
          title={element.visible ? 'Hide' : 'Show'}
          onClick={() => store().toggleElementVisible(element.id)}
        >
          {element.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
        </Button>
        <Button
          className="icon"
          aria-label={element.locked ? `Unlock ${name}` : `Lock ${name}`}
          aria-pressed={element.locked}
          title={element.locked ? 'Unlock' : 'Lock'}
          onClick={() => store().toggleElementLocked(element.id)}
        >
          {element.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
        </Button>
        <Button
          className="icon"
          aria-label={`Move ${name} up`}
          title="Bring forward"
          disabled={index === count - 1}
          onClick={() => store().reorderElement(element.id, index + 1)}
        >
          <ChevronUp size={14} aria-hidden="true" />
        </Button>
        <Button
          className="icon"
          aria-label={`Move ${name} down`}
          title="Send backward"
          disabled={index === 0}
          onClick={() => store().reorderElement(element.id, index - 1)}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
        <Button className="icon" aria-label={`Duplicate ${name}`} title="Duplicate" onClick={() => store().duplicateElement(element.id)}>
          <Copy size={14} aria-hidden="true" />
        </Button>
        <Button className="icon presentation-layer-delete" aria-label={`Delete ${name}`} title="Delete" onClick={() => store().removeElement(element.id)}>
          <Trash2 size={14} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
})

export function ElementLayerList() {
  const document = usePresentationStore((state) => state.document)
  const activeSlideId = usePresentationStore((state) => state.view.activeSlideId)
  const selectedIds = usePresentationStore((state) => state.view.selectedElementIds)
  const slide = document?.slides.find((candidate) => candidate.id === activeSlideId) ?? document?.slides[0]
  if (!slide) return null

  // The original index is carried while reversing, so rows never scan the array.
  const rows = slide.elements.map((element, index) => ({ element, index })).reverse()
  const selected = new Set(selectedIds)

  return (
    <div className="presentation-layer-list" role="list" aria-label={`Elements on ${slide.name}`}>
      {rows.map(({ element, index }) => (
        <LayerRow key={element.id} element={element} index={index} count={slide.elements.length} selected={selected.has(element.id)} />
      ))}
      {slide.elements.length === 0 ? <p className="muted">This slide has no elements yet.</p> : null}
    </div>
  )
}
