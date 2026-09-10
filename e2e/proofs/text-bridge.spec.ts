/**
 * P04 proof — wrapped rich text with DOM editing and Konva rendering.
 *
 * Runs in Chromium against the Vite dev server and imports the real layout and
 * bridge modules through Vite:
 *
 * 1. DOM line boxes (per-character Range rects) are compared with the shared
 *    layout result for the title fixture *and* a dense bullets element with a
 *    nested level.
 * 2. Konva text measurement is compared with the same canvas metrics.
 * 3. An editing session exercises a real caret, typed insertion through the
 *    editing pipeline, and IME composition accounting (no commit while
 *    composing, one commit when composition ends).
 * 4. Paste normalization keeps adjacent bold/italic runs and drops unsafe links.
 *
 * Evidence: proofs/out/p04-*.png and p04-report.json.
 */

import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'proofs', 'out')

test.describe('P04 text bridge proof', () => {
  test('DOM line boxes agree with shared layout; Konva, caret, IME and paste behave', async ({ page }) => {
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
      const measure = (text: string, spec: any) => {
        measureCanvas.font = layoutModule.cssFontFor(spec)
        return measureCanvas.measureText(text).width
      }

      const documentModel = fixture.createFixturePresentation()
      const title: any = documentModel.slides[0].elements.find((element: any) => element.id === 'fixture-text-title')
      const bullets: any = documentModel.slides[1].elements.find((element: any) => element.id === 'fixture-text-bullets')

      let overlayTop = 20
      const mountOverlay = (id: string, element: any, background: string) => {
        const host = document.createElement('div')
        host.id = id
        host.style.cssText = `position:fixed;left:20px;top:${overlayTop}px;width:${element.width}px;height:${element.height}px;padding:${element.padding}px;box-sizing:border-box;line-height:${element.lineHeight};background:${background};z-index:10000;`
        overlayTop += element.height + 20
        host.innerHTML = bridge.paragraphsToHtml(element.paragraphs, { scale: 1, lineHeight: element.lineHeight })
        document.body.appendChild(host)
        return host
      }

      const titleHost = mountOverlay('p04-overlay', title, '#0b1f3b')
      const bulletsHost = mountOverlay('p04-bullets-overlay', bullets, '#ffffff')
      await document.fonts.ready

      // Recover the DOM's real line boxes from per-character client rects.
      // Range rects are glyph boxes, so cluster by vertical centre; marker spans
      // are excluded because the layout renders them separately.
      const domLinesFor = (host: HTMLElement) => {
        const charRects: Array<{ char: string; rect: DOMRect }> = []
        for (const span of host.querySelectorAll('span:not([data-marker])')) {
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
        return clusters
          .sort((a, b) => a.center - b.center)
          .map((cluster) => {
            const ordered = [...cluster.entries].sort((a, b) => a.rect.left - b.rect.left)
            // Trailing whitespace at a wrap point is collapsed by the layout; drop it here too.
            let end = ordered.length
            while (end > 0 && /\s/.test(ordered[end - 1]!.char)) end -= 1
            const trimmed = ordered.slice(0, end)
            return {
              text: trimmed.map((entry) => entry.char).join(''),
              center: cluster.center,
              left: Math.min(...trimmed.map((entry) => entry.rect.left)),
              right: Math.max(...trimmed.map((entry) => entry.rect.right)),
            }
          })
      }

      const compare = (host: HTMLElement, element: any) => {
        const layout = layoutModule.layoutTextElement(element, measure)
        const hostRect = host.getBoundingClientRect()
        const domLines = domLinesFor(host)
        const layoutCenters = layout.lines.map((line: any) => line.y + line.height / 2)
        const comparisons = layout.lines.map((line: any, index: number) => {
          const dom = domLines[index]
          return {
            index,
            layoutText: line.text,
            domText: dom?.text ?? null,
            textMatches: (dom?.text ?? '').trim() === line.text.trim(),
            centerDelta: dom ? (dom.center - domLines[0]!.center) - (layoutCenters[index] - layoutCenters[0]) : null,
            leftDelta: dom ? dom.left - hostRect.left - (element.padding + line.indent) : null,
            rightDelta: dom ? dom.right - hostRect.left - (element.padding + line.indent + line.width) : null,
          }
        })
        return { layoutLineCount: layout.lines.length, domLineCount: domLines.length, comparisons }
      }

      const titleReport = compare(titleHost, title)
      const bulletsReport = compare(bulletsHost, bullets)
      const nestedBullet = layoutModule.layoutTextElement(bullets, measure).lines.find((line: any) => line.bullet?.level === 1)

      // --- Konva rendering against the same layout ---
      const konvaModule: any = await import('/src/features/presentations/rendering/konvaText.ts')
      const Konva = konvaModule.Konva
      const stageHost = document.createElement('div')
      stageHost.id = 'p04-konva'
      stageHost.style.cssText = 'position:fixed;left:1440px;top:20px;z-index:10000;'
      document.body.appendChild(stageHost)
      const stage = new Konva.Stage({ container: stageHost, width: title.width, height: title.height })
      const layer = new Konva.Layer()
      stage.add(layer)
      layer.add(new Konva.Rect({ x: 0, y: 0, width: title.width, height: title.height, fill: documentModel.slides[0].background, listening: false }))
      const konvaComparisons: any[] = []
      const titleLayout = layoutModule.layoutTextElement(title, measure)
      for (const line of titleLayout.lines) {
        for (const run of line.runs) {
          const textNode = new Konva.Text({
            x: run.x,
            y: line.y + (line.height - run.run.size) / 2,
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
          const directWidth = measure(run.text, { fontId: run.run.fontId, size: run.run.size, bold: !!run.run.bold, italic: !!run.run.italic })
          konvaComparisons.push({ text: run.text, layoutWidth: run.width, konvaWidth, measureWidth: directWidth, widthDelta: konvaWidth - run.width })
        }
      }
      layer.draw()
      const stageDataUrl: string = stage.toDataURL({ pixelRatio: 1 })

      // --- Editing session: caret, typing, IME accounting ---
      const defaults = { fontId: 'be-vietnam-pro', size: 28, color: '#08152f' }
      const session = document.createElement('div')
      session.id = 'p04-session'
      session.contentEditable = 'true'
      session.style.cssText = 'position:fixed;left:1440px;top:320px;width:420px;font-size:28px;background:#fff;z-index:10000;'
      session.innerHTML = bridge.paragraphsToHtml([
        { runs: [{ text: 'Kết quả', fontId: defaults.fontId, size: defaults.size, color: defaults.color }], alignment: 'left', bullet: 'none', bulletLevel: 0 },
      ])
      document.body.appendChild(session)

      const commits: string[] = []
      let composing = false
      const commit = () => commits.push(bridge.paragraphsToPlainText(bridge.readParagraphsFromDom(session, defaults)))
      session.addEventListener('compositionstart', () => {
        composing = true
      })
      session.addEventListener('compositionend', () => {
        composing = false
        commit()
      })
      session.addEventListener('input', () => {
        if (!composing) commit()
      })

      session.focus()
      const firstSpanNode = session.querySelector('span')!.firstChild as Text
      const selection = window.getSelection()!
      const caret = document.createRange()
      caret.setStart(firstSpanNode, firstSpanNode.length)
      caret.collapse(true)
      selection.removeAllRanges()
      selection.addRange(caret)
      const caretAtEnd = selection.getRangeAt(0).startOffset === firstSpanNode.length && selection.getRangeAt(0).collapsed

      document.execCommand('insertText', false, ' mới')
      const afterTyping = bridge.paragraphsToPlainText(bridge.readParagraphsFromDom(session, defaults))
      const commitsAfterTyping = commits.length

      session.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      document.execCommand('insertText', false, 'ế')
      session.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'ế' }))
      session.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ế' }))
      const afterComposition = bridge.paragraphsToPlainText(bridge.readParagraphsFromDom(session, defaults))
      const commitsAfterComposition = commits.length

      // --- Paste normalization ---
      const pasted = bridge.htmlToParagraphs('<p>Pasted <b>bold</b> <i>italic</i> <a href="javascript:alert(1)">bad</a></p>', defaults)
      const pastedRuns = pasted.flatMap((paragraph: any) => paragraph.runs)

      return {
        titleReport,
        bulletsReport,
        nestedBullet: nestedBullet ? { x: nestedBullet.bullet.x, indent: nestedBullet.indent, marker: nestedBullet.bullet.marker } : null,
        konvaComparisons,
        stageDataUrl,
        caretAtEnd,
        afterTyping,
        commitsAfterTyping,
        afterComposition,
        commitsAfterComposition,
        pastedText: bridge.paragraphsToPlainText(pasted),
        pastedBold: pastedRuns.find((run: any) => run.text === 'bold')?.bold ?? false,
        pastedItalic: pastedRuns.find((run: any) => run.text === 'italic')?.italic ?? false,
        pastedUnsafeLink: pastedRuns.find((run: any) => run.text === 'bad')?.link ?? null,
      }
    })

    await page.locator('#p04-overlay').screenshot({ path: join(OUT, 'p04-dom-overlay.png') })
    await page.locator('#p04-bullets-overlay').screenshot({ path: join(OUT, 'p04-bullets-overlay.png') })
    await page.locator('#p04-konva').screenshot({ path: join(OUT, 'p04-konva.png') })
    await writeFile(join(OUT, 'p04-konva-stage.png'), Buffer.from(report.stageDataUrl.split(',')[1]!, 'base64'))
    await writeFile(join(OUT, 'p04-report.json'), `${JSON.stringify({ ...report, stageDataUrl: undefined }, null, 2)}\n`)

    // Line agreement for both the title and the dense bullets element.
    for (const [name, block] of [
      ['title', report.titleReport],
      ['bullets', report.bulletsReport],
    ] as const) {
      expect(block.layoutLineCount, `${name} lines`).toBeGreaterThanOrEqual(1)
      expect(block.domLineCount, `${name} DOM lines`).toBe(block.layoutLineCount)
      for (const line of block.comparisons) {
        expect(line.textMatches, `${name} line ${line.index}: layout=${JSON.stringify(line.layoutText)} dom=${JSON.stringify(line.domText)}`).toBe(true)
        expect(Math.abs(line.centerDelta ?? 99), `${name} line ${line.index} center`).toBeLessThanOrEqual(2)
        expect(Math.abs(line.leftDelta ?? 99), `${name} line ${line.index} left`).toBeLessThanOrEqual(2.5)
        expect(Math.abs(line.rightDelta ?? 99), `${name} line ${line.index} right`).toBeLessThanOrEqual(3)
      }
    }
    // Nested bullet geometry is shared between layout and DOM markup.
    expect(report.nestedBullet).toMatchObject({ x: 32, indent: 32 + 26 })

    for (const comparison of report.konvaComparisons) {
      expect(Math.abs(comparison.konvaWidth - comparison.measureWidth)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(comparison.widthDelta)).toBeLessThanOrEqual(3)
    }

    // Editing: real caret, typed text, composition committed exactly once.
    expect(report.caretAtEnd).toBe(true)
    expect(report.afterTyping).toBe('Kết quả mới')
    expect(report.commitsAfterTyping).toBe(1)
    expect(report.afterComposition).toBe('Kết quả mớiế')
    expect(report.commitsAfterComposition).toBe(2)

    // Paste: adjacent formatting survives, unsafe link dropped.
    expect(report.pastedText).toContain('Pasted bold italic bad')
    expect(report.pastedBold).toBe(true)
    expect(report.pastedItalic).toBe(true)
    expect(report.pastedUnsafeLink).toBeNull()
  })
})
