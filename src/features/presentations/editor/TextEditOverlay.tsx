import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Theme, TextElement } from '../model/types'
import { fontStackFor } from '../rendering/fonts'
import { usePresentationStore } from './store'
import { bridgeDefaultsFor, registerActiveTextEditFlush, textHistoryGroup } from './textEditSession'
import {
  htmlToParagraphs,
  paragraphsToHtml,
  paragraphsToPlainText,
  plainTextToParagraphs,
  readParagraphsFromDom,
} from './textBridge'

function placeCaretAtEnd(host: HTMLElement) {
  const selection = window.getSelection?.()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(host)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Inserts normalized plain text at the caret, keeping line breaks as <br>. */
function insertPlainText(host: HTMLElement, text: string) {
  if (!text) return
  const selection = window.getSelection?.()
  const candidate = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  // A selection left over from another element (or a detached tree) must not swallow
  // the paste; fall back to the end of this field.
  const range = candidate && host.contains(candidate.commonAncestorContainer) ? candidate : null
  const target = range ?? document.createRange()
  if (!range) {
    target.selectNodeContents(host)
    target.collapse(false)
  }
  target.deleteContents()
  const lines = text.split('\n')
  let last: Node | null = null
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      last = document.createElement('br')
      target.insertNode(last)
      target.setStartAfter(last)
      target.collapse(true)
    }
    if (!line) continue
    last = document.createTextNode(line)
    target.insertNode(last)
    target.setStartAfter(last)
    target.collapse(true)
  }
  if (selection && last) {
    selection.removeAllRanges()
    selection.addRange(target)
  }
}

type TextEditOverlayProps = {
  element: TextElement
  /** Stage scale and offset in screen pixels; the box itself stays in document units. */
  scale: number
  offsetX: number
  offsetY: number
  /** Document theme defaults for text typed without an existing run. */
  theme?: Pick<Theme, 'bodyFontId' | 'colors'>
}

/**
 * DOM editor for one text element (P17). The paragraph/run model stays
 * authoritative: the field is seeded from `paragraphsToHtml`, every commit
 * reads back through `readParagraphsFromDom`, and the DOM tree is never
 * persisted. The box keeps document-unit metrics and is scaled as a whole, so
 * zooming never re-seeds the field or moves the caret.
 */
export function TextEditOverlay({ element, scale, offsetX, offsetY, theme }: TextEditOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const finished = useRef(false)
  const seededElementId = useRef<string | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const defaults = useMemo(() => bridgeDefaultsFor(element, theme), [element, theme])
  const latest = useRef({ element, defaults })
  latest.current = { element, defaults }

  const commit = useCallback((host: HTMLElement | null = hostRef.current) => {
    if (!host) return
    const { element: current, defaults: currentDefaults } = latest.current
    try {
      usePresentationStore.getState().updateText(current.id, readParagraphsFromDom(host, currentDefaults), {
        historyGroup: textHistoryGroup(current.id),
      })
      setCommitError(null)
    } catch {
      // A rejected command (for example the element text limit) must not strand the
      // session or pretend the text was stored.
      setCommitError('This text is too long to save. Shorten it to keep editing.')
    }
  }, [])

  // A save must commit what is only on screen, and the DOM field belongs to this
  // component. The registry entry lives exactly as long as a session is open, so
  // nothing else has to reach into the markup to find it.
  useEffect(() => {
    registerActiveTextEditFlush(() => commit())
    return () => registerActiveTextEditFlush(null)
  }, [commit])

  const finish = useCallback((host: HTMLElement | null = hostRef.current) => {
    finished.current = true
    try {
      commit(host)
    } finally {
      const store = usePresentationStore.getState()
      store.endHistoryGroup()
      store.endTextEdit()
    }
  }, [commit])

  // Seed once per element so panning, zooming, or our own commits never reset the caret.
  // The element object changes on every commit, so the effect keys off the id.
  const elementId = element.id
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (seededElementId.current !== elementId) {
      seededElementId.current = elementId
      const { element: current } = latest.current
      host.innerHTML = paragraphsToHtml(current.paragraphs, { lineHeight: current.lineHeight })
    }
    // Focus and caret placement wait for the next frame: the double click that opens
    // this overlay also triggers the browser's own word selection, which would
    // otherwise replace what the caret is meant to do.
    const frame = requestAnimationFrame(() => {
      host.focus()
      placeCaretAtEnd(host)
    })
    return () => cancelAnimationFrame(frame)
  }, [elementId])

  // Flush anything still on screen if the overlay goes away without a blur. The
  // editing target itself is cleared by the store command that removed it (slide
  // switch, delete, undo), never here: StrictMode's simulated unmount would close
  // a freshly opened editor.
  useEffect(() => {
    const host = hostRef.current
    return () => {
      if (finished.current || !host) return
      commit(host)
      usePresentationStore.getState().endHistoryGroup()
    }
  }, [commit])

  const verticalAlignment = element.verticalAlign === 'middle' ? 'center' : element.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start'

  return (
    <div
      className="presentation-text-editor-layer"
      data-testid="text-edit-overlay"
      style={{ left: offsetX, top: offsetY, transform: `scale(${scale})` }}
    >
      <div
        ref={hostRef}
        className="presentation-text-editor"
        data-testid="text-edit-field"
        role="textbox"
        aria-multiline="true"
        aria-label="Text content"
        contentEditable
        suppressContentEditableWarning
        style={{
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          padding: element.padding,
          lineHeight: element.lineHeight,
          justifyContent: verticalAlignment,
          // Text typed straight into an empty paragraph inherits this style.
          fontFamily: fontStackFor(defaults.fontId),
          fontSize: defaults.size,
          color: defaults.color,
        }}
        onInput={(event) => {
          // IME composition commits once on compositionend instead of per keystroke.
          if (composing.current || (event.nativeEvent as InputEvent).isComposing) return
          commit()
        }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => {
          composing.current = false
          commit()
        }}
        onPaste={(event) => {
          event.preventDefault()
          const host = hostRef.current
          if (!host) return
          const clipboard = event.clipboardData
          const html = clipboard.getData('text/html')
          const paragraphs = html
            ? htmlToParagraphs(html, defaults)
            : plainTextToParagraphs(clipboard.getData('text/plain'), defaults)
          // Only normalized plain text enters the field; pasted markup never touches
          // the document, and line breaks stay line breaks.
          insertPlainText(host, paragraphsToPlainText(paragraphs))
          commit()
        }}
        onKeyDown={(event) => {
          // Escape cancels an IME candidate window; only a plain Escape ends the session.
          if (event.key !== 'Escape' || composing.current || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.currentTarget.blur()
        }}
        onBlur={() => finish()}
      />
      {commitError ? <p className="presentation-text-editor-alert" role="alert">{commitError}</p> : null}
    </div>
  )
}
