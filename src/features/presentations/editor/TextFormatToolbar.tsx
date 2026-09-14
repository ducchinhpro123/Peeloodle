/**
 * Text formatting toolbar (P26/P27). It reads and writes the live editing
 * session through the controller `TextEditOverlay` registers, so it never
 * reaches into the DOM field itself. Buttons keep the field focused; selects,
 * the color control and the link field may take focus, and the overlay restores
 * the cached selection for them.
 */

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, IndentDecrease, IndentIncrease, Italic, Link2, Link2Off, List, ListOrdered } from 'lucide-react'
import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { PRESENTATION_FONT_FAMILIES } from '../rendering/fonts'
import { useTextEditSession } from './TextEditSessionContext'
import type { ParagraphFormatState, ParagraphStylePatch, RunStylePatch, TextFormatState } from './textFormat'

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96]
const LINE_HEIGHTS = [1, 1.15, 1.5, 2]

export function TextFormatToolbar() {
  const session = useTextEditSession()
  const controller = useSyncExternalStore(session.subscribeFormat, session.format, () => null)
  const [format, setFormat] = useState<TextFormatState | null>(null)
  const [paragraph, setParagraph] = useState<ParagraphFormatState | null>(null)
  const [lineHeight, setLineHeight] = useState(1)
  const [linkValue, setLinkValue] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const active = session.format()
    if (!active) {
      setFormat(null)
      setParagraph(null)
      return
    }
    setFormat(active.read())
    setParagraph(active.readParagraph())
    setLineHeight(active.lineHeight())
  }, [session])

  useEffect(() => {
    if (!controller) {
      setFormat(null)
      setParagraph(null)
      return
    }
    refresh()
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [controller, refresh])

  if (!controller || !format || !paragraph) return null

  const apply = (patch: RunStylePatch) => {
    controller.apply(patch)
    refresh()
  }

  const applyParagraph = (patch: ParagraphStylePatch) => {
    controller.applyParagraph(patch)
    refresh()
  }

  const submitLink = (event: FormEvent) => {
    event.preventDefault()
    const value = linkValue.trim()
    if (!value) {
      setLinkError('Enter a link address, or use Remove link.')
      return
    }
    const result = controller.applyLink(value)
    if (!result.ok) {
      setLinkError(result.message)
      return
    }
    setLinkError(null)
    setLinkValue('')
    refresh()
  }

  const removeLink = () => {
    controller.applyLink(null)
    setLinkError(null)
    setLinkValue('')
    refresh()
  }

  const knownFont = format.fontId !== null && PRESENTATION_FONT_FAMILIES.some((family) => family.id === format.fontId)
  const knownSize = format.size !== null && FONT_SIZES.includes(format.size)
  const level = paragraph.bulletLevel ?? 0
  const knownLineHeight = LINE_HEIGHTS.includes(lineHeight)

  return (
    <div className="presentation-text-toolbar" data-text-toolbar role="toolbar" aria-label="Text formatting">
      <div className="presentation-text-toolbar-group" role="group" aria-label="Character">
        <Button
          className="icon"
          aria-label="Bold"
          aria-pressed={format.bold}
          title="Bold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply({ bold: !format.bold })}
        >
          <Bold size={16} aria-hidden="true" />
        </Button>
        <Button
          className="icon"
          aria-label="Italic"
          aria-pressed={format.italic}
          title="Italic"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply({ italic: !format.italic })}
        >
          <Italic size={16} aria-hidden="true" />
        </Button>
        <label className="presentation-text-toolbar-field">
          <span className="sr-only">Font family</span>
          <select aria-label="Font family" value={format.fontId ?? ''} onChange={(event) => apply({ fontId: event.target.value })}>
            {format.fontId === null ? <option value="">Mixed</option> : null}
            {!knownFont && format.fontId !== null ? <option value={format.fontId}>{format.fontId}</option> : null}
            {PRESENTATION_FONT_FAMILIES.map((family) => (
              <option key={family.id} value={family.id}>{family.displayName}</option>
            ))}
          </select>
        </label>
        <label className="presentation-text-toolbar-field">
          <span className="sr-only">Font size</span>
          <select aria-label="Font size" value={format.size ?? ''} onChange={(event) => apply({ size: Number(event.target.value) })}>
            {format.size === null ? <option value="">Mixed</option> : null}
            {!knownSize && format.size !== null ? <option value={format.size}>{format.size}</option> : null}
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <label className="presentation-text-toolbar-field presentation-text-toolbar-color">
          <span className="sr-only">Text color</span>
          <input type="color" aria-label="Text color" value={format.color ?? '#08152f'} onChange={(event) => apply({ color: event.target.value })} />
        </label>
      </div>

      <div className="presentation-text-toolbar-group" role="group" aria-label="Paragraph">
        {(['left', 'center', 'right', 'justify'] as const).map((alignment) => {
          const Icon = alignment === 'left' ? AlignLeft : alignment === 'center' ? AlignCenter : alignment === 'right' ? AlignRight : AlignJustify
          return (
            <Button
              key={alignment}
              className="icon"
              aria-label={`Align ${alignment}`}
              aria-pressed={paragraph.alignment === alignment}
              title={`Align ${alignment}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyParagraph({ alignment })}
            >
              <Icon size={16} aria-hidden="true" />
            </Button>
          )
        })}
        <Button
          className="icon"
          aria-label="Bulleted list"
          aria-pressed={paragraph.bullet === 'bullet'}
          title="Bulleted list"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyParagraph({ bullet: paragraph.bullet === 'bullet' ? 'none' : 'bullet' })}
        >
          <List size={16} aria-hidden="true" />
        </Button>
        <Button
          className="icon"
          aria-label="Numbered list"
          aria-pressed={paragraph.bullet === 'number'}
          title="Numbered list"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyParagraph({ bullet: paragraph.bullet === 'number' ? 'none' : 'number' })}
        >
          <ListOrdered size={16} aria-hidden="true" />
        </Button>
        <Button
          className="icon"
          aria-label="Decrease indent"
          title="Decrease indent"
          disabled={paragraph.bullet === 'none' || level === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyParagraph({ bulletLevel: Math.max(0, level - 1) as 0 | 1 | 2 })}
        >
          <IndentDecrease size={16} aria-hidden="true" />
        </Button>
        <Button
          className="icon"
          aria-label="Increase indent"
          title="Increase indent"
          disabled={level === 2}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyParagraph({ bullet: paragraph.bullet === 'none' ? 'bullet' : undefined, bulletLevel: Math.min(2, level + 1) as 0 | 1 | 2 })}
        >
          <IndentIncrease size={16} aria-hidden="true" />
        </Button>
        <label className="presentation-text-toolbar-field">
          <span className="sr-only">Line spacing</span>
          <select aria-label="Line spacing" value={lineHeight} onChange={(event) => {
            const next = Number(event.target.value)
            controller.setLineHeight(next)
            setLineHeight(next)
          }}>
            {!knownLineHeight ? <option value={lineHeight}>{lineHeight}</option> : null}
            {LINE_HEIGHTS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>

      <form className="presentation-text-toolbar-group presentation-text-toolbar-link" onSubmit={submitLink}>
        <label className="presentation-text-toolbar-field">
          <span className="sr-only">Link URL</span>
          <input
            type="text"
            inputMode="url"
            aria-label="Link URL"
            placeholder="https://…"
            value={linkValue}
            onChange={(event) => {
              setLinkValue(event.target.value)
              setLinkError(null)
            }}
          />
        </label>
        <Button type="submit" title="Add link" onMouseDown={(event) => event.preventDefault()}>
          <Link2 size={16} aria-hidden="true" /> Add link
        </Button>
        {format.link ? (
          <Button type="button" aria-label="Remove link" title="Remove link" onMouseDown={(event) => event.preventDefault()} onClick={removeLink}>
            <Link2Off size={16} aria-hidden="true" />
          </Button>
        ) : null}
        {linkError ? <p className="presentation-text-toolbar-error" role="alert">{linkError}</p> : null}
      </form>
    </div>
  )
}
