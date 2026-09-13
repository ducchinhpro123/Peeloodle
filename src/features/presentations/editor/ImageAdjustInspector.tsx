/**
 * Image adjust controls (P29): flip, non-destructive crop and replace.
 *
 * Crop is stored as normalized 0..1 document data, never baked into the pixels,
 * so undo and reopening always restore the original image. Flip and crop changes
 * are grouped under one history entry per editing session.
 */

import { FlipHorizontal2, FlipVertical2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePresentationStore } from './store'
import type { ImageElement, NormalizedCrop } from '../model/types'

type CropField = 'left' | 'top' | 'right' | 'bottom'

const asPercent = (value: number) => Math.round(value * 1000) / 10

export function ImageAdjustInspector({ element, onReplace }: { element: ImageElement; onReplace?: (elementId: string) => void }) {
  const group = `image-adjust:${element.id}`
  const patch = (update: Partial<ImageElement>) => {
    usePresentationStore.getState().updateElement(element.id, update, { historyGroup: group })
  }
  const endGroup = () => usePresentationStore.getState().endHistoryGroup()

  const values: Record<CropField, number> = {
    left: asPercent(element.crop.x),
    top: asPercent(element.crop.y),
    right: asPercent(1 - (element.crop.x + element.crop.width)),
    bottom: asPercent(1 - (element.crop.y + element.crop.height)),
  }

  const applyCrop = (change: Partial<Record<CropField, number>>) => {
    const clamp = (value: number) => Math.min(90, Math.max(0, Number.isFinite(value) ? value : 0)) / 100
    const left = clamp(change.left ?? values.left)
    const top = clamp(change.top ?? values.top)
    const right = clamp(change.right ?? values.right)
    const bottom = clamp(change.bottom ?? values.bottom)
    const crop: NormalizedCrop = {
      x: left,
      y: top,
      // A sliver must remain visible so the crop can always be adjusted back.
      width: Math.max(0.05, 1 - left - right),
      height: Math.max(0.05, 1 - top - bottom),
    }
    patch({ crop })
  }

  return (
    <div className="presentation-image-fields">
      <div className="presentation-image-actions">
        <Button aria-label="Flip horizontally" aria-pressed={element.flipX} title="Flip horizontally" onMouseDown={(event) => event.preventDefault()} onClick={() => patch({ flipX: !element.flipX })}>
          <FlipHorizontal2 size={16} aria-hidden="true" />
        </Button>
        <Button aria-label="Flip vertically" aria-pressed={element.flipY} title="Flip vertically" onMouseDown={(event) => event.preventDefault()} onClick={() => patch({ flipY: !element.flipY })}>
          <FlipVertical2 size={16} aria-hidden="true" />
        </Button>
        {onReplace ? (
          <Button onMouseDown={(event) => event.preventDefault()} onClick={() => onReplace(element.id)}>
            <RefreshCw size={16} aria-hidden="true" /> Replace photo
          </Button>
        ) : null}
      </div>
      <div className="presentation-geometry-fields">
        {(['left', 'top', 'right', 'bottom'] as const).map((field) => (
          <label key={field}>
            Crop {field} %
            <input
              type="number"
              aria-label={`Crop ${field} percent`}
              min={0}
              max={90}
              step={1}
              value={values[field]}
              onChange={(event) => applyCrop({ [field]: Number(event.target.value) })}
              onBlur={endGroup}
            />
          </label>
        ))}
      </div>
      <Button onMouseDown={(event) => event.preventDefault()} onClick={() => patch({ crop: { x: 0, y: 0, width: 1, height: 1 } })}>
        Reset crop
      </Button>
    </div>
  )
}
