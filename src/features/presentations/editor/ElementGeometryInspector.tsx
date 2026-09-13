import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { usePresentationStore } from './store'
import { ImageAdjustInspector } from './ImageAdjustInspector'
import { ShapeStyleInspector } from './ShapeStyleInspector'
import { TextOverflowNotice } from './TextOverflowNotice'
import { alignToSlide, type SlideAlignment } from './alignmentGuides'
import { elementGeometry, withRotation } from './transformGeometry'
import type { Element } from '../model/types'

type GeometryField = 'x' | 'y' | 'width' | 'height' | 'rotation'

const FIELDS: Array<{ key: GeometryField; label: string; step: number }> = [
  { key: 'x', label: 'X position', step: 1 },
  { key: 'y', label: 'Y position', step: 1 },
  { key: 'width', label: 'Width', step: 1 },
  { key: 'height', label: 'Height', step: 1 },
  { key: 'rotation', label: 'Rotation', step: 0.1 },
]

const ALIGN_ACTIONS: Array<{ key: SlideAlignment; label: string }> = [
  { key: 'left', label: 'Left' },
  { key: 'center-horizontal', label: 'Center' },
  { key: 'right', label: 'Right' },
  { key: 'top', label: 'Top' },
  { key: 'middle-vertical', label: 'Middle' },
  { key: 'bottom', label: 'Bottom' },
]

function formatValue(value: number): string {
  return String(Number(value.toFixed(1)))
}

type GeometryFieldInputProps = {
  label: string
  value: number
  /** Arrow-key increment; rotation keeps tenths, positions and sizes stay whole units. */
  step: number
  disabled: boolean
  onCommit: (value: number) => void
}

/**
 * One numeric geometry field. It shows the committed value (or the live gesture
 * preview), keeps the typing in a draft so a partly typed number is never
 * committed, and writes through the store on Enter or when the field is left.
 * Escape puts the document's value back.
 */
function GeometryFieldInput({ label, value, step, disabled, onCommit }: GeometryFieldInputProps) {
  const [draft, setDraft] = useState(() => formatValue(value))

  useEffect(() => {
    setDraft(formatValue(value))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(formatValue(value))
      return
    }
    onCommit(parsed)
  }

  return (
    <label>
      {label}
      <input
        type="number"
        // The store clamps and rounds whatever these fields submit.
        step={step}
        disabled={disabled}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(formatValue(value))
          }
        }}
      />
    </label>
  )
}

/**
 * Numeric element geometry (P24). These fields are the keyboard path to the same
 * values the canvas handles produce, and they read the live gesture preview so
 * the numbers and the frame never disagree while an element is being dragged.
 * Locked elements show their numbers read-only: the command would refuse them.
 */
export function ElementGeometryInspector({ element, onReplaceImage }: { element: Element; onReplaceImage?: (elementId: string) => void }) {
  const transformPreview = usePresentationStore((state) => state.view.transformPreview)
  const pageSize = usePresentationStore((state) => state.document?.pageSize)
  const geometry = elementGeometry(element, transformPreview)

  const commitField = (key: GeometryField, value: number) => {
    const store = usePresentationStore.getState()
    // Rotation keeps the visual centre: the stored origin moves with the angle,
    // so the frame does not jump when the number changes.
    store.commitTransform(element.id, key === 'rotation' ? withRotation(geometry, value) : { ...geometry, [key]: value })
  }

  const align = (alignment: SlideAlignment) => {
    if (!pageSize) return
    const store = usePresentationStore.getState()
    const current = elementGeometry(element, store.view.transformPreview)
    store.commitTransform(element.id, { ...current, ...alignToSlide(current, pageSize, alignment) })
  }

  return (
    <>
      <div className="presentation-geometry-fields">
        {FIELDS.map(({ key, label, step }) => (
          <GeometryFieldInput
            key={key}
            label={label}
            step={step}
            disabled={element.locked}
            value={geometry[key]}
            onCommit={(value) => commitField(key, value)}
          />
        ))}
      </div>
      <div className="presentation-align-controls" role="group" aria-label="Align to slide">
        {ALIGN_ACTIONS.map(({ key, label }) => (
          <Button key={key} aria-label={`Align ${label}`} title={`Align ${label}`} disabled={element.locked} onClick={() => align(key)}>
            {label}
          </Button>
        ))}
      </div>
      {element.locked ? <p className="muted">This element is locked, so it ignores moves, resizes, and rotations.</p> : null}
      {element.kind === 'text' ? <TextOverflowNotice element={element} /> : null}
      {element.kind === 'shape' ? <ShapeStyleInspector element={element} /> : null}
      {element.kind === 'image' ? <ImageAdjustInspector element={element} onReplace={onReplaceImage} /> : null}
    </>
  )
}
