import { Minus, Plus, Scan } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePresentationStore } from './store'
import { clampPresentationZoom, PRESENTATION_MAX_ZOOM, PRESENTATION_MIN_ZOOM } from './viewGeometry'

/**
 * Shared canvas view controls. Both the Konva canvas and the test-mode host
 * render this component so zoom limits, labels, and fit behaviour are identical
 * everywhere.
 */
export function PresentationCanvasControls() {
  const zoom = usePresentationStore((state) => state.view.zoom)

  const zoomBy = (factor: number) => {
    usePresentationStore.getState().setZoom(clampPresentationZoom(usePresentationStore.getState().view.zoom * factor))
  }
  const fit = () => {
    usePresentationStore.getState().setZoom(1)
    usePresentationStore.getState().setPan({ x: 0, y: 0 })
  }

  return (
    <div className="presentation-canvas-controls" aria-label="Canvas view controls">
      <Button className="icon" aria-label="Zoom out" onClick={() => zoomBy(0.8)} disabled={zoom <= PRESENTATION_MIN_ZOOM}><Minus size={17} /></Button>
      <output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
      <Button className="icon" aria-label="Zoom in" onClick={() => zoomBy(1.25)} disabled={zoom >= PRESENTATION_MAX_ZOOM}><Plus size={17} /></Button>
      <Button className="icon" aria-label="Fit slide to window" onClick={fit}><Scan size={17} /></Button>
    </div>
  )
}
