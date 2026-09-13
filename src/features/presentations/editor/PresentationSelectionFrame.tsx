import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PresentationViewport } from './viewGeometry'
import { transformFrameInView, type ResizeHandle, type TransformGeometry } from './transformGeometry'

const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'ne', 'se', 'sw']

export type SelectionGestureKind = 'resize' | 'rotate'

type SelectionFrameProps = {
  /** Committed geometry, or the live preview while a gesture is in progress. */
  geometry: TransformGeometry
  viewport: PresentationViewport
  /** Locked elements keep their frame, but expose no handle that could move them. */
  locked: boolean
  /** Starts the gesture; pointer capture and the rest of it belong to the canvas. */
  onGestureStart: (kind: SelectionGestureKind, handle: ResizeHandle | null, event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * The selected element's frame and manipulation handles. They are plain DOM on
 * top of the canvas, positioned through the shared viewport mapping, so what the
 * user grabs is exactly what the inspector numbers describe. Nothing here reads
 * or writes the document.
 */
export function PresentationSelectionFrame({ geometry, viewport, locked, onGestureStart }: SelectionFrameProps) {
  const frame = transformFrameInView(geometry, viewport)
  return (
    <div
      className="presentation-selection-outline"
      data-testid="presentation-selection-frame"
      aria-hidden="true"
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
      }}
    >
      {locked ? null : (
        <>
          {RESIZE_HANDLES.map((handle) => (
            <span
              key={handle}
              className={`presentation-transform-handle presentation-transform-${handle}`}
              data-testid={`presentation-handle-${handle}`}
              onPointerDown={(event) => onGestureStart('resize', handle, event)}
            />
          ))}
          <span
            className="presentation-transform-handle is-rotate"
            data-testid="presentation-handle-rotate"
            onPointerDown={(event) => onGestureStart('rotate', null, event)}
          />
        </>
      )}
    </div>
  )
}
