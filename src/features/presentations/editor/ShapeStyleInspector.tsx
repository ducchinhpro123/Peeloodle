/**
 * Shape fill/stroke controls (P28). Every change is a document command grouped
 * under one history entry per editing session, so dragging a color picker or
 * holding a stepper produces one undo step rather than dozens.
 */

import { usePresentationStore } from './store'
import type { ShapeElement } from '../model/types'

const DEFAULT_FILL = '#08b879'
const DEFAULT_STROKE = '#08152f'

export function ShapeStyleInspector({ element }: { element: ShapeElement }) {
  const group = `shape-style:${element.id}`
  const linear = element.shape === 'line' || element.shape === 'arrow'

  const patch = (update: Partial<ShapeElement>) => {
    usePresentationStore.getState().updateElement(element.id, update, { historyGroup: group })
  }
  const endGroup = () => usePresentationStore.getState().endHistoryGroup()

  return (
    <div className="presentation-shape-fields">
      {linear ? null : (
        <>
          <label>
            Fill
            <input
              type="color"
              aria-label="Shape fill color"
              value={element.fill ?? DEFAULT_FILL}
              disabled={element.fill === null}
              onChange={(event) => patch({ fill: event.target.value })}
              onBlur={endGroup}
            />
          </label>
          <label className="presentation-shape-toggle">
            <input
              type="checkbox"
              aria-label="No fill"
              checked={element.fill === null}
              onChange={(event) => patch({ fill: event.target.checked ? null : DEFAULT_FILL })}
              onBlur={endGroup}
            />
            No fill
          </label>
        </>
      )}
      <label>
        {linear ? 'Line color' : 'Stroke'}
        <input
          type="color"
          aria-label="Shape stroke color"
          value={element.stroke ?? DEFAULT_STROKE}
          disabled={element.stroke === null}
          onChange={(event) => patch({ stroke: event.target.value })}
          onBlur={endGroup}
        />
      </label>
      {linear ? null : (
        <label className="presentation-shape-toggle">
          <input
            type="checkbox"
            aria-label="No stroke"
            checked={element.stroke === null}
            onChange={(event) => patch({ stroke: event.target.checked ? null : DEFAULT_STROKE, strokeWidth: event.target.checked ? 0 : Math.max(1, element.strokeWidth) })}
            onBlur={endGroup}
          />
          No stroke
        </label>
      )}
      <label>
        {linear ? 'Line width' : 'Stroke width'}
        <input
          type="number"
          aria-label="Stroke width"
          min={1}
          max={40}
          step={1}
          value={Math.max(1, element.strokeWidth)}
          onChange={(event) => patch({ strokeWidth: Number(event.target.value) })}
          onBlur={endGroup}
        />
      </label>
    </div>
  )
}
