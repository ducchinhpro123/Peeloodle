import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Theme, TextElement } from '../model/types'
import { fontStackFor } from '../rendering/fonts'
import { usePresentationStore } from './store'
import { bridgeDefaultsFor, textHistoryGroup } from './textEditSession'
import { useTextEditSession } from './TextEditSessionContext'
import {
  applyParagraphStyleToSelection,
  applyRunStyleToSelection,
  caretOffsetInParagraph,
  isApplicablePatch,
  paragraphBlockForNode,
  paragraphBlocks,
  placeCaretAtParagraphOffset,
  readParagraphStyle,
  readSelectionStyle,
} from './textFormat'
import { safeLink } from '../model/links'
import {
  BRIDGE_ATTR,
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
  // Inside the last paragraph block, not after it: a caret at the end of the host
  // would let typing insert a bare text node outside any paragraph.
  const target = host.lastElementChild ?? host
  range.selectNodeContents(target)
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
  const session = useTextEditSession()
  const hostRef = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const finished = useRef(false)
  const seededElementId = useRef<string | null>(null)
  /** Last selection inside this field, so a toolbar control can restore it. */
  const formatRange = useRef<Range | null>(null)
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
  // component. The session's flush lives exactly as long as the field is open, so
  // nothing else has to reach into the markup to find it.
  useEffect(() => {
    session.registerFlush(() => commit())
    return () => session.registerFlush(null)
  }, [commit, session])

  // Track the field's selection so a toolbar control can act after focus moved to
  // it: a native color/select control takes focus without ending the session.
  // Key/mouse handlers capture it synchronously; `selectionchange` alone can be
  // delivered after focus has already left the field.
  const captureSelection = useCallback(() => {
    const host = hostRef.current
    const selection = window.getSelection?.()
    if (!host || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (host.contains(range.commonAncestorContainer)) formatRange.current = range.cloneRange()
  }, [])

  useEffect(() => {
    const onSelectionChange = () => {
      const host = hostRef.current
      const active = document.activeElement
      // Only cache selections made while the field owns focus: moving focus to a
      // toolbar control can collapse the field's selection, and that collapse must
      // not overwrite the range the control is about to act on.
      if (!host || !(active instanceof Node && host.contains(active))) return
      captureSelection()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [captureSelection])

  /** Re-renders the field from the committed model, keeping the caret in place. */
  const reseed = useCallback((paragraphIndex: number, offset: number) => {
    const host = hostRef.current
    if (!host) return
    const { element: current } = latest.current
    const updated = usePresentationStore.getState().document?.slides
      .flatMap((slide) => slide.elements)
      .find((candidate) => candidate.id === current.id)
    const source = updated?.kind === 'text' ? updated : current
    host.innerHTML = paragraphsToHtml(source.paragraphs, { lineHeight: source.lineHeight })
    const block = host.querySelector<HTMLElement>(`[${BRIDGE_ATTR.paragraph}="${paragraphIndex}"]`)
    if (block) placeCaretAtParagraphOffset(block, offset)
  }, [])

  // The formatting toolbar reads and writes through this controller for exactly
  // as long as the session is open.
  useEffect(() => {
    const restoreRange = (): boolean => {
      const host = hostRef.current
      const selection = window.getSelection?.()
      if (!host || !selection) return false
      const active = document.activeElement
      const focusedInHost = active instanceof Node && host.contains(active)
      const live = selection.rangeCount > 0 && host.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0) : null
      // Focus still in the field: the live selection is the truth.
      if (focusedInHost && live) return true
      // A toolbar control owns focus; the field's selection may have collapsed, so
      // restore the last selection made inside it.
      const saved = formatRange.current
      if (saved && host.contains(saved.commonAncestorContainer)) {
        selection.removeAllRanges()
        selection.addRange(saved)
        return true
      }
      if (live) {
        selection.removeAllRanges()
        selection.addRange(live)
        return true
      }
      return false
    }
    const caretPosition = (): { paragraphIndex: number; offset: number } => {
      const host = hostRef.current
      const selection = window.getSelection?.()
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
      const block = range && host ? paragraphBlockForNode(host, range.startContainer) : null
      const blocks = block && host ? paragraphBlocks(host) : []
      return {
        paragraphIndex: block ? Math.max(0, blocks.indexOf(block)) : 0,
        offset: block && range ? caretOffsetInParagraph(block, range.startContainer, range.startOffset) : 0,
      }
    }
    session.registerFormat({
      apply(patch) {
        const host = hostRef.current
        if (!host || !isApplicablePatch(patch) || !restoreRange()) return
        if (applyRunStyleToSelection(host, patch)) commit(host)
      },
      read() {
        const host = hostRef.current
        if (!host) {
          const { fontId, size, color } = latest.current.defaults
          return { bold: false, italic: false, fontId, size, color, link: null }
        }
        restoreRange()
        return readSelectionStyle(host, latest.current.defaults)
      },
      applyParagraph(patch) {
        const host = hostRef.current
        if (!host || !restoreRange()) return
        const position = caretPosition()
        if (!applyParagraphStyleToSelection(host, patch)) return
        commit(host)
        // Alignment and bullet markers are structural, so the field is rebuilt
        // from the committed model with the caret put back.
        reseed(position.paragraphIndex, position.offset)
      },
      readParagraph() {
        const host = hostRef.current
        if (!host) return { alignment: null, bullet: null, bulletLevel: null }
        restoreRange()
        return readParagraphStyle(host)
      },
      applyLink(href) {
        const host = hostRef.current
        if (!host || !restoreRange()) return { ok: false, message: 'Select some text before adding a link.' }
        if (href === null) {
          if (applyRunStyleToSelection(host, { link: '' })) commit(host)
          return { ok: true }
        }
        const safe = safeLink(href)
        if (!safe) return { ok: false, message: 'Only http, https and mailto links can be added.' }
        if (applyRunStyleToSelection(host, { link: safe })) commit(host)
        return { ok: true }
      },
      setLineHeight(value) {
        const host = hostRef.current
        const { element: current } = latest.current
        const next = Math.min(3, Math.max(0.8, Math.round(value * 100) / 100))
        if (!host || next === current.lineHeight) return
        const position = caretPosition()
        usePresentationStore.getState().updateElement(current.id, { lineHeight: next }, { historyGroup: textHistoryGroup(current.id) })
        reseed(position.paragraphIndex, position.offset)
      },
      lineHeight() {
        return latest.current.element.lineHeight
      },
    })
    return () => session.registerFormat(null)
  }, [commit, reseed, session])

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
        onKeyUp={captureSelection}
        onMouseUp={captureSelection}
        onBlur={(event) => {
          // The blur can arrive before the selection collapses; keep it for the
          // toolbar control that is taking focus.
          captureSelection()
          // Focus moving into the formatting toolbar is not leaving the session:
          // a select or color control takes focus while the selection stays live.
          const next = event.relatedTarget as HTMLElement | null
          if (next?.closest('[data-text-toolbar]')) return
          finish()
        }}
      />
      {commitError ? <p className="presentation-text-editor-alert" role="alert">{commitError}</p> : null}
    </div>
  )
}
