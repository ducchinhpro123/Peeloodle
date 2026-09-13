/**
 * Presentation editor keyboard shortcuts (P25): undo and redo.
 *
 * Events that originate inside a text field, a slider or an open dialog are left
 * alone — the field's own undo is the right one there, and a dialog owns its
 * keys. The store handles the rest, so a shortcut and the toolbar buttons run
 * exactly the same command.
 */

import { useEffect } from 'react'
import { usePresentationStore } from './store'

const SHORTCUT_EXEMPT = 'input, textarea, select, [contenteditable="true"], [role="slider"], [data-slot="slider"], [role="dialog"]'

export function usePresentationShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest(SHORTCUT_EXEMPT)) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      event.preventDefault()
      const store = usePresentationStore.getState()
      // Ctrl/Cmd+Shift+Z and Ctrl+Y both redo; plain Ctrl/Cmd+Z undoes.
      if (key === 'y' || event.shiftKey) store.redo()
      else store.undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
