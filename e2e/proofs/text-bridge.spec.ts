/**
 * P04 proof — wrapped rich text with DOM editing and Konva rendering.
 *
 * Runs in Chromium against the Vite dev server. Imports the real layout/bridge
 * modules through Vite, measures the DOM's actual line boxes with Range rects,
 * and compares them with the shared layout result. Also proves Konva text
 * measurement matches the same canvas metrics, reads text after simulated
 * Vietnamese IME composition, and normalizes pasted HTML.
 *
 * Evidence: proofs/out/p04-*.png and this spec's assertions.
 */

import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'proofs', 'out')

test.describe('P04 text bridge proof', () => {
  test('DOM line boxes agree with shared layout; Konva, IME and paste behave', async ({ page }) => {
    await page.goto('/')
    // The Vite dev client performs one dep-optimizer reload shortly after first
    // load; wait it out so the evaluation below cannot be destroyed mid-run.
    await page.waitForLoadState('load')
    await page.waitForTimeout(900)
    const report = await page.evaluate(async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const layoutModule: any = await import('/src/features/presentations/rendering/textLayout.ts')
      const bridge: any = await import('/src/features/presentations/editor/textBridge.ts')
      const fonts: any = await import('/src/features/presentations/rendering/fonts.ts')
      const fixture: any = await import('/src/features/presentations/model/fixtures/fixture.ts')

      await fonts.ensurePresentationFonts()

      const measureCanvas = document.createElement('canvas').getContext('2d')!
      const measure = (text: string, spec: { fontId: string; size: number; bold: boolean; italic: boolean }) => {
        measureCanvas.font = layoutModule.cssFontFor(spec)
        return measureCanvas.measureText(text).width
      }

      const documentModel = fixture.createFixturePresentation()
      const title: any = documentModel.slides[0].elements.find((element: any) => element.id === 'fixture-text-title')

      // --- DOM editing overlay (same HTML the editor will use) ---
      const host = document.createElement('div')
      host.id = 'p04-overlay'
      host.style.cssText = `position:fixed;left:20px;top:20px;width:${title.width}px;height:${title.height}px;padding:${title.padding}px;box-sizing:border-box;line-height:${title.lineHeight};background:#0b1f3b;font-kerning:normal;text-rendering:auto;z-index:10000;`
      host.innerHTML = bridge.paragraphsToHtml(title.paragraphs, { scale: 1, lineHeight: title.lineHeight })
      document.body.appendChild(host)
      await document.fonts.ready

      const hostRect = host.getBoundingClientRect()

      // Recover the DOM's real line boxes from per-character client rects.
      // Range rects are glyph boxes, so cluster by vertical centre instead of top.
      const charRects: Array<{ char: string; rect: DOMRect }> = []
      for (const span of host.querySelectorAll('span')) {
        const node = span.firstChild
        if (!node || node.nodeType !== 3) continue
        const text = node.textContent ?? ''
        const range = document.createRange()
        for (let i = 0; i < text.length; i += 1) {
          range.setStart(node, i)
          range.setEnd(node, i + 1)
          const rect = range.getClientRects()[0]
          if (rect && rect.width >= 0) charRects.push({ char: text[i]!, rect })
        }
      }
      charRects.sort((a, b) => (a.rect.top + a.rect.bottom) / 2 - (b.rect.top + b.rect.bottom) / 2 || a.rect.left - b.rect.left)
      const clusters: Array<{ center: number; height: number; entries: typeof charRects }> = []
      for (const entry of charRects) {
        const center = (entry.rect.top + entry.rect.bottom) / 2
        const last = clusters.at(-1)
        if (last && Math.abs(center - last.center) <= Math.max(last.height, entry.rect.height) * 0.5 + 2) {
          last.entries.push(entry)
          last.center = (last.center * (last.entries.length - 1) + center) / last.entries.length
          last.height = Math.max(last.height, entry.rect.height)
        } else {
          clusters.push({ center, height: entry.rect.height, entries: [entry] })
        }
      }
      const domLines = clusters
        .sort((a, b) => a.center - b.center)
        .map((cluster) => {
          const ordered = [...cluster.entries].sort((a, b) => a.rect.left - b.rect.left)
          return {
            text: ordered.map((entry) => entry.char).join(''),
            top: Math.min(...ordered.map((entry) => entry.rect.top)),
            bottom: Math.max(...ordered.map((entry) => entry.rect.bottom)),
            center: cluster.center,
            left: Math.min(...ordered.map((entry) => entry.rect.left)),
            right: Math.max(...ordered.map((entry) => entry.rect.right)),
          }
        })

      // --- Shared layout result ---
      const layout = layoutModule.layoutTextElement(title, measure)

      const padding = title.padding
      const layoutCenters = layout.lines.map((line: any) => line.y + line.height / 2)
      const lineComparisons = layout.lines.map((line: any, index: number) => {
        const dom = domLines[index]
        return {
          index,
          layoutText: line.text,
          domText: dom?.text ?? null,
          textMatches: (dom?.text ?? '').trim() === line.text.trim(),
          // Glyph boxes differ in height per font; compare line-to-line spacing instead.
          centerDelta: dom ? (dom.center - domLines[0]!.center) - (layoutCenters[index] - layoutCenters[0]) : null,
          leftDelta: dom ? dom.left - hostRect.left - (padding + line.indent) : null,
          rightDelta: dom ? dom.right - hostRect.left - (padding + line.indent + line.width) : null,
          domLineCount: domLines.length,
          layoutLineCount: layout.lines.length,
        }
      })

      // --- Konva rendering against the same layout ---
      const konvaModule: any = await import('/src/features/presentations/rendering/konvaText.ts')
      const Konva: any = konvaModule.Konva
      const stageHost = document.createElement('div')
      stageHost.id = 'p04-konva'
      stageHost.style.cssText = 'position:fixed;left:20px;top:300px;z-index:10000;'
      document.body.appendChild(stageHost)
      const stage = new Konva.Stage({ container: stageHost, width: title.width, height: title.height })
      const layer = new Konva.Layer()
      stage.add(layer)
      layer.add(new Konva.Rect({ x: 0, y: 0, width: title.width, height: title.height, fill: documentModel.slides[0].background, listening: false }))
      const konvaComparisons: any[] = []
      for (const line of layout.lines) {
        for (const run of line.runs) {
          const textNode = new Konva.Text({
            x: run.x,
            y: line.y,
            text: run.text,
            fontFamily: fonts.fontFamilyFor(run.run.fontId),
            fontSize: run.run.size,
            fontStyle: `${run.run.bold ? 'bold' : 'normal'} ${run.run.italic ? 'italic' : 'normal'}`,
            fill: run.run.color,
            lineHeight: 1,
            listening: false,
          })
          layer.add(textNode)
          const konvaWidth = textNode.getTextWidth()
          const directWidth = measure(run.text, {
            fontId: run.run.fontId,
            size: run.run.size,
            bold: !!run.run.bold,
            italic: !!run.run.italic,
          })
          konvaComparisons.push({
            text: run.text,
            layoutWidth: run.width,
            konvaWidth,
            measureWidth: directWidth,
            widthDelta: konvaWidth - run.width,
          })
        }
      }
      layer.draw()
      const stageDataUrl: string = stage.toDataURL({ pixelRatio: 1 })

      // --- Simulated Vietnamese IME composition ---
      const defaults = { fontId: 'be-vietnam-pro', size: 28, color: '#08152f' }
      const editable = document.createElement('div')
      editable.id = 'p04-ime'
      editable.contentEditable = 'true'
      editable.style.cssText = 'position:fixed;left:20px;top:640px;width:420px;font-size:28px;background:#fff;z-index:10000;'
      editable.innerHTML = bridge.paragraphsToHtml([
        { runs: [{ text: 'Kết quả', fontId: defaults.fontId, size: defaults.size, color: defaults.color }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
      ])
      document.body.appendChild(editable)
      const textNode = editable.querySelector('span')!.firstChild as Text
      const selection = window.getSelection()!
      const caret = document.createRange()
      caret.setStart(textNode, textNode.length)
      caret.collapse(true)
      selection.removeAllRanges()
      selection.addRange(caret)
      editable.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      textNode.insertData(textNode.length, 'ế')
      editable.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'ế' }))
      editable.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ế' }))
      const imeText = bridge.readParagraphsFromDom(editable, defaults)[0].runs.map((run: any) => run.text).join('')

      // --- Paste normalization ---
      let pasted: any[] = []
      editable.addEventListener('paste', (event: ClipboardEvent) => {
        event.preventDefault()
        const html = event.clipboardData?.getData('text/html') ?? ''
        const text = event.clipboardData?.getData('text/plain') ?? ''
        pasted = html ? bridge.htmlToParagraphs(html, defaults) : bridge.plainTextToParagraphs(text, defaults)
      })
      const transfer = new DataTransfer()
      transfer.setData('text/html', '<h1>Heading</h1><p>Pasted <b>bold</b> <a href="javascript:alert(1)">bad</a></p>')
      transfer.setData('text/plain', 'Heading Pasted bold bad')
      editable.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }))
      const pastedRuns = pasted.flatMap((paragraph) => paragraph.runs)

      return {
        layoutLineCount: layout.lines.length,
        domLineCount: domLines.length,
        lineComparisons,
        domLines,
        konvaComparisons,
        stageDataUrlLength: stageDataUrl.length,
        stageDataUrl,
        imeText,
        pastedText: pasted.map((paragraph) => paragraph.runs.map((run: any) => run.text).join('')).join('\n'),
        pastedBold: pastedRuns.find((run: any) => run.text === 'bold')?.bold ?? false,
        pastedUnsafeLink: pastedRuns.find((run: any) => run.text === 'bad')?.link ?? null,
      }
    })

    await writeFile(join(OUT, 'p04-report.json'), `${JSON.stringify({ ...report, stageDataUrl: undefined }, null, 2)}\n`)

    // --- Assertions: same line breaks, same geometry within tolerance ---
    expect(report.layoutLineCount).toBeGreaterThanOrEqual(2)
    expect(report.domLineCount).toBe(report.layoutLineCount)
    for (const line of report.lineComparisons) {
      expect(line.textMatches, `line ${line.index}: layout=${JSON.stringify(line.layoutText)} dom=${JSON.stringify(line.domText)}`).toBe(true)
      expect(Math.abs(line.centerDelta ?? 99)).toBeLessThanOrEqual(2)
      expect(Math.abs(line.leftDelta ?? 99)).toBeLessThanOrEqual(2.5)
      expect(Math.abs(line.rightDelta ?? 99)).toBeLessThanOrEqual(3)
    }

    // --- Konva agrees with the shared canvas metrics ---
    for (const comparison of report.konvaComparisons) {
      expect(Math.abs(comparison.konvaWidth - comparison.measureWidth)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(comparison.widthDelta)).toBeLessThanOrEqual(3)
    }
    expect(report.stageDataUrlLength).toBeGreaterThan(1000)

    // --- IME and paste ---
    expect(report.imeText).toBe('Kết quảế')
    expect(report.pastedText).toContain('Heading')
    expect(report.pastedText).toContain('Pasted bold bad')
    expect(report.pastedBold).toBe(true)
    expect(report.pastedUnsafeLink).toBeNull()

    await page.locator('#p04-overlay').screenshot({ path: join(OUT, 'p04-dom-overlay.png') })
    await page.locator('#p04-konva').screenshot({ path: join(OUT, 'p04-konva.png') })
    const png = Buffer.from(report.stageDataUrl.split(',')[1]!, 'base64')
    await writeFile(join(OUT, 'p04-konva-stage.png'), png)
  })
})
