/**
 * Actionable text-overflow feedback (P27). The layout service already knows when
 * a text element's content is taller than its box; this shows the amount and
 * offers the one-click fix, growing the box to the measured content height.
 */

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { layoutTextElement } from '../rendering/textLayout'
import type { TextElement } from '../model/types'
import { usePresentationStore } from './store'
import { measureTextWidth } from './textMeasure'

export function TextOverflowNotice({ element }: { element: TextElement }) {
  const layout = useMemo(() => layoutTextElement(element, measureTextWidth), [element])
  if (!layout.overflow) return null

  const boxHeight = Math.max(0, element.height - element.padding * 2)
  const overflowUnits = Math.ceil(layout.contentHeight - boxHeight)
  const fitHeight = Math.ceil(layout.contentHeight + element.padding * 2)

  return (
    <div className="presentation-overflow-notice" role="status">
      <p>Text overflows this box by about {overflowUnits} document units.</p>
      {/* Keeping focus in the text field stops the blur from ending the session
          before the click lands; growing the box should not interrupt editing. */}
      <Button
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => usePresentationStore.getState().updateElement(element.id, { height: fitHeight })}
      >
        Grow box to fit
      </Button>
    </div>
  )
}
