import { expect, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { crc32, deflateSync } from 'node:zlib'

function pngChunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  return Buffer.concat([len, typeBuf, data, crc])
}

export function encodeRgbaPng(width: number, height: number, fill: [number, number, number, number] | ((x: number, y: number) => [number, number, number, number])) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  const color = typeof fill === 'function' ? fill : () => fill
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x += 1) {
      const i = y * (width * 4 + 1) + 1 + x * 4
      const pixel = color(x, y)
      raw[i] = pixel[0]
      raw[i + 1] = pixel[1]
      raw[i + 2] = pixel[2]
      raw[i + 3] = pixel[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

export type PixelReport = {
  width: number
  height: number
  colorType: number
  corner: number[]
  center: number[]
  maxAlpha: number
  opaqueCount: number
  transparentCount: number
  greenCount: number
  chroma: number
}

export async function waitForEditor(page: Page) {
  await expect(page.getByText('Opening sticker…')).toHaveCount(0)
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await expect(page.getByLabel('Sticker title')).toBeVisible()
}

export async function openBlankEditor(page: Page) {
  await page.goto('/create')
  await page.waitForURL(/\/editor\/[0-9a-f-]+/i)
  await waitForEditor(page)
}

export async function waitForCanvasInk(page: Page, minOpaque = 80) {
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="editor-canvas"] canvas') as HTMLCanvasElement | null
    if (!canvas) return 0
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let opaque = 0
    for (let i = 3; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 16) opaque += 1
    return opaque
  })).toBeGreaterThan(minOpaque)
}

export async function samplePreviewCenter(page: Page): Promise<number[]> {
  await page.locator('[data-testid="editor-canvas"]').click({ position: { x: 8, y: 8 } })
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="editor-canvas"] canvas') as HTMLCanvasElement | null
    if (!canvas) throw new Error('missing editor canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('missing 2d context')
    const { width, height } = canvas
    const pixels = ctx.getImageData(0, 0, width, height).data
    let minX = width, minY = height, maxX = 0, maxY = 0, found = false
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3]! <= 16) continue
        found = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    if (!found) throw new Error('preview has no opaque artwork')
    const cx = Math.round((minX + maxX) / 2)
    const cy = Math.round((minY + maxY) / 2)
    return Array.from(ctx.getImageData(cx, cy, 1, 1).data)
  })
}

export async function inspectPngBytes(page: Page, bytes: Buffer): Promise<PixelReport> {
  expect(bytes[0]).toBe(0x89)
  expect(bytes[1]).toBe(0x50)
  const colorType = bytes[25] ?? 0
  const report = await page.evaluate(async (base64) => {
    const binary = atob(base64)
    const array = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i)
    const bitmap = await createImageBitmap(new Blob([array], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no ctx')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const corner = Array.from(ctx.getImageData(0, 0, 1, 1).data)
    let maxAlpha = 0
    let opaqueCount = 0
    let transparentCount = 0
    let greenCount = 0
    let chromaSum = 0
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4
        const alpha = data[i + 3] ?? 0
        if (alpha > maxAlpha) maxAlpha = alpha
        if (alpha <= 16) {
          transparentCount += 1
          continue
        }
        opaqueCount += 1
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        const r = data[i] ?? 0
        const g = data[i + 1] ?? 0
        const b = data[i + 2] ?? 0
        chromaSum += Math.max(r, g, b) - Math.min(r, g, b)
        if (alpha > 180 && g > 180 && r < 80 && b < 80) greenCount += 1
      }
    }
    const cx = opaqueCount ? Math.round((minX + maxX) / 2) : Math.floor(canvas.width / 2)
    const cy = opaqueCount ? Math.round((minY + maxY) / 2) : Math.floor(canvas.height / 2)
    const mid = (cy * canvas.width + cx) * 4
    const center = [data[mid] ?? 0, data[mid + 1] ?? 0, data[mid + 2] ?? 0, data[mid + 3] ?? 0]
    return {
      width: canvas.width,
      height: canvas.height,
      corner,
      center,
      maxAlpha,
      opaqueCount,
      transparentCount,
      greenCount,
      chroma: opaqueCount ? chromaSum / opaqueCount : 0,
    }
  }, bytes.toString('base64'))
  return { ...report, colorType }
}

export async function downloadPng(page: Page, size: 512 | 1024 = 1024): Promise<Buffer> {
  const dialog = page.getByRole('dialog', { name: 'Export sticker' })
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: /export and share/i }).click()
  }
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(`Up to ${size} px longest edge`).check()
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click()
  const download = await pending
  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = await readFile(path!)
  await expect(dialog.getByRole('status')).toContainText(/download started/i)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return bytes
}

export async function setSlider(root: Locator | Page, name: string, value: number) {
  const slider = root.getByRole('slider', { name })
  await expect(slider).toBeVisible()
  await slider.focus()
  const current = Number(await slider.getAttribute('aria-valuenow'))
  const min = Number(await slider.getAttribute('aria-valuemin'))
  const max = Number(await slider.getAttribute('aria-valuemax'))
  const clamped = Math.max(min, Math.min(max, value))
  if (!Number.isFinite(current)) throw new Error(`slider ${name} has no value`)
  const key = clamped > current ? 'ArrowRight' : 'ArrowLeft'
  let guard = 0
  while (Number(await slider.getAttribute('aria-valuenow')) !== clamped) {
    await slider.press(key)
    guard += 1
    if (guard > 240) throw new Error(`could not set ${name} to ${clamped}`)
  }
}

export function channelDiff(a: number[], b: number[]) {
  return Math.max(...[0, 1, 2, 3].map((i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0))))
}

export const probeMagenta: [number, number, number, number] = [200, 40, 80, 255]
export const probePng = encodeRgbaPng(120, 120, probeMagenta)

/** Top-left red, top-right blue, bottom-left green, bottom-right yellow. */
export const asymmetricPng = encodeRgbaPng(120, 120, (x, y) => {
  const left = x < 60
  const top = y < 60
  if (left && top) return [220, 16, 16, 255]
  if (!left && top) return [16, 40, 220, 255]
  if (left && !top) return [16, 200, 40, 255]
  return [220, 200, 16, 255]
})

export type GridCompare = {
  compared: number
  mismatches: number
  ratio: number
  silhouette: number
  previewGreen: number
  exportGreen: number
  previewQuadrant: number[][]
  exportQuadrant: number[][]
  previewBox: { w: number; h: number }
  exportBox: { w: number; h: number }
}

export async function comparePreviewExportGrid(page: Page, pngBytes: Buffer, grid = 128): Promise<GridCompare> {
  await page.locator('[data-testid="editor-canvas"]').click({ position: { x: 8, y: 8 } })
  await page.waitForFunction(() => {
    const stage = (window as unknown as { Konva?: { stages: Array<{ find: (name: string) => Array<{ nodes: () => unknown[] }> }> } }).Konva?.stages[0]
    if (!stage) return true
    return stage.find('Transformer').every((node) => node.nodes().length === 0)
  }).catch(() => undefined)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(async ({ base64, gridSize }) => {
    const sample = (data: Uint8ClampedArray, width: number, height: number) => {
      const xs: number[] = []
      const ys: number[] = []
      let green = 0
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4
          const alpha = data[i + 3] ?? 0
          if (alpha > 180 && (data[i + 1] ?? 0) > 180 && (data[i] ?? 0) < 80 && (data[i + 2] ?? 0) < 80) green += 1
          if (alpha < 128) continue
          xs.push(x)
          ys.push(y)
        }
      }
      if (xs.length < 20) throw new Error('no opaque artwork')
      xs.sort((a, b) => a - b)
      ys.sort((a, b) => a - b)
      const trim = Math.floor(xs.length * 0.01)
      const minX = xs[trim]!
      const maxX = xs[xs.length - 1 - trim]!
      const minY = ys[trim]!
      const maxY = ys[ys.length - 1 - trim]!
      const bw = Math.max(1, maxX - minX + 1)
      const bh = Math.max(1, maxY - minY + 1)
      const source = document.createElement('canvas')
      source.width = width
      source.height = height
      source.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0)
      const normalized = document.createElement('canvas')
      normalized.width = gridSize
      normalized.height = gridSize
      const ctx = normalized.getContext('2d')
      if (!ctx) throw new Error('no ctx')
      ctx.imageSmoothingEnabled = true
      ctx.clearRect(0, 0, gridSize, gridSize)
      const scale = gridSize / Math.max(bw, bh)
      const fitW = Math.max(1, Math.round(bw * scale))
      const fitH = Math.max(1, Math.round(bh * scale))
      const ox = Math.floor((gridSize - fitW) / 2)
      const oy = Math.floor((gridSize - fitH) / 2)
      ctx.drawImage(source, minX, minY, bw, bh, ox, oy, fitW, fitH)
      const resized = ctx.getImageData(0, 0, gridSize, gridSize).data
      const cells: number[] = []
      for (let i = 0; i < resized.length; i += 1) cells.push(resized[i] ?? 0)
      const average = (x0: number, y0: number, x1: number, y1: number) => {
        let r = 0, g = 0, b = 0, a = 0, n = 0
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * gridSize + x) * 4
            r += resized[i] ?? 0
            g += resized[i + 1] ?? 0
            b += resized[i + 2] ?? 0
            a += resized[i + 3] ?? 0
            n += 1
          }
        }
        return n ? [r / n, g / n, b / n, a / n] : [0, 0, 0, 0]
      }
      const mid = Math.floor(gridSize / 2)
      return {
        cells,
        green,
        box: { w: bw, h: bh },
        quadrant: [
          average(0, 0, mid, mid),
          average(mid, 0, gridSize, mid),
          average(0, mid, mid, gridSize),
          average(mid, mid, gridSize, gridSize),
        ],
      }
    }

    const host = document.querySelector('[data-testid="editor-canvas"]')
    const Konva = (window as unknown as { Konva?: { stages: Array<{ getLayers: () => Array<{ getCanvas: () => { _canvas: HTMLCanvasElement } }> }> } }).Konva
    const canvas = (
      Konva?.stages[0]?.getLayers()[0]?.getCanvas()._canvas
      ?? host?.querySelector('.konvajs-content canvas')
      ?? host?.querySelector('canvas')
    ) as HTMLCanvasElement | null
    if (!canvas) throw new Error('missing editor canvas')
    const previewCtx = canvas.getContext('2d')
    if (!previewCtx) throw new Error('missing 2d context')
    const previewData = previewCtx.getImageData(0, 0, canvas.width, canvas.height).data
    const preview = sample(previewData, canvas.width, canvas.height)

    const binary = atob(base64)
    const array = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i)
    const bitmap = await createImageBitmap(new Blob([array], { type: 'image/png' }))
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = bitmap.width
    exportCanvas.height = bitmap.height
    const exportCtx = exportCanvas.getContext('2d')
    if (!exportCtx) throw new Error('no ctx')
    exportCtx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const exportData = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height).data
    const exported = sample(exportData, exportCanvas.width, exportCanvas.height)

    let mismatches = 0
    let compared = 0
    let silhouetteXor = 0
    let silhouetteUnion = 0
    for (let i = 0; i < preview.cells.length; i += 4) {
      const pa = preview.cells[i + 3] ?? 0
      const ea = exported.cells[i + 3] ?? 0
      const previewInk = pa > 80
      const exportInk = ea > 80
      if (previewInk || exportInk) {
        silhouetteUnion += 1
        if (previewInk !== exportInk) silhouetteXor += 1
      }
      if (pa < 16 && ea < 16) continue
      compared += 1
      const diff = Math.max(
        Math.abs((preview.cells[i] ?? 0) - (exported.cells[i] ?? 0)),
        Math.abs((preview.cells[i + 1] ?? 0) - (exported.cells[i + 1] ?? 0)),
        Math.abs((preview.cells[i + 2] ?? 0) - (exported.cells[i + 2] ?? 0)),
        Math.abs(pa - ea),
      )
      if (diff > 40) mismatches += 1
    }
    return {
      compared,
      mismatches,
      ratio: compared ? mismatches / compared : 1,
      silhouette: silhouetteUnion ? silhouetteXor / silhouetteUnion : 1,
      previewGreen: preview.green,
      exportGreen: exported.green,
      previewQuadrant: preview.quadrant,
      exportQuadrant: exported.quadrant,
      previewBox: preview.box,
      exportBox: exported.box,
    }
  }, { base64: pngBytes.toString('base64'), gridSize: grid })
}

function textCompareScript() {
  return async ({
    base64,
    family,
    lines,
    fontSize,
    color,
    gridSize,
    live,
  }: {
    base64?: string
    family: string
    lines: string[]
    fontSize: number
    color: string
    gridSize: number
    live?: { dataUrl: string; width: number; height: number }
  }) => {
    const quoted = /[^\w-]/.test(family) ? JSON.stringify(family) : family
    await document.fonts.load(`${Math.max(12, fontSize)}px ${quoted}`).catch(() => undefined)
    const sample = (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no ctx')
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const xs: number[] = []
      const ys: number[] = []
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if ((data[(y * canvas.width + x) * 4 + 3] ?? 0) < 80) continue
          xs.push(x)
          ys.push(y)
        }
      }
      if (xs.length < 10) throw new Error('no opaque artwork')
      xs.sort((a, b) => a - b)
      ys.sort((a, b) => a - b)
      const trim = Math.floor(xs.length * 0.01)
      const minX = xs[trim]!
      const maxX = xs[xs.length - 1 - trim]!
      const minY = ys[trim]!
      const maxY = ys[ys.length - 1 - trim]!
      const bw = Math.max(1, maxX - minX + 1)
      const bh = Math.max(1, maxY - minY + 1)
      const normalized = document.createElement('canvas')
      normalized.width = gridSize
      normalized.height = gridSize
      const nctx = normalized.getContext('2d')
      if (!nctx) throw new Error('no ctx')
      const scale = gridSize / Math.max(bw, bh)
      nctx.drawImage(
        canvas,
        minX, minY, bw, bh,
        Math.floor((gridSize - Math.round(bw * scale)) / 2),
        Math.floor((gridSize - Math.round(bh * scale)) / 2),
        Math.max(1, Math.round(bw * scale)),
        Math.max(1, Math.round(bh * scale)),
      )
      return nctx.getImageData(0, 0, gridSize, gridSize).data
    }
    const paint = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(64, Math.ceil(fontSize * 24))
      canvas.height = Math.max(64, Math.ceil(fontSize * lines.length * 2.5))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no ctx')
      ctx.font = `${fontSize}px ${quoted}`
      ctx.fillStyle = color
      ctx.textBaseline = 'top'
      lines.forEach((line, index) => ctx.fillText(line, 8, 8 + index * fontSize))
      return canvas
    }
    let subject: HTMLCanvasElement
    if (live) {
      subject = document.createElement('canvas')
      subject.width = live.width
      subject.height = live.height
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('live text crop failed'))
        image.src = live.dataUrl
      })
      subject.getContext('2d')!.drawImage(image, 0, 0)
    } else {
      const binary = atob(base64!)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i)
      const bitmap = await createImageBitmap(new Blob([array], { type: 'image/png' }))
      subject = document.createElement('canvas')
      subject.width = bitmap.width
      subject.height = bitmap.height
      subject.getContext('2d')!.drawImage(bitmap, 0, 0)
      bitmap.close()
    }
    const a = sample(subject)
    const b = sample(paint())
    let xor = 0
    let union = 0
    let colorMismatch = 0
    let compared = 0
    for (let i = 0; i < a.length; i += 4) {
      const aa = a[i + 3] ?? 0
      const ba = b[i + 3] ?? 0
      if (aa > 80 || ba > 80) {
        union += 1
        if ((aa > 80) !== (ba > 80)) xor += 1
      }
      if (aa < 16 && ba < 16) continue
      compared += 1
      const diff = Math.max(
        Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
        Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
        Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
        Math.abs(aa - ba),
      )
      if (diff > 40) colorMismatch += 1
    }
    return {
      silhouette: union ? xor / union : 1,
      ratio: compared ? colorMismatch / compared : 1,
      compared,
    }
  }
}

export async function compareLiveTextToPaintedFamily(page: Page, family: string, grid = 128) {
  await page.locator('[data-testid="editor-canvas"]').click({ position: { x: 8, y: 8 } })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const live = await page.evaluate(() => {
    const stage = (window as unknown as {
      Konva?: {
        stages: Array<{
          width: () => number
          getLayers: () => Array<{ getCanvas: () => { _canvas: HTMLCanvasElement } }>
          findOne: (name: string) => {
            text: () => string
            fontSize: () => number
            fill: () => string
            getAbsoluteScale: () => { x: number; y: number }
            getClientRect: () => { x: number; y: number; width: number; height: number }
          } | null
        }>
      }
    }).Konva?.stages[0]
    const node = stage?.findOne('Text')
    const canvas = stage?.getLayers()[0]?.getCanvas()._canvas
    if (!stage || !node || !canvas) throw new Error('missing live text')
    const box = node.getClientRect()
    const ratio = canvas.width / Math.max(1, stage.width())
    const x = Math.max(0, Math.floor(box.x * ratio) - 2)
    const y = Math.max(0, Math.floor(box.y * ratio) - 2)
    const w = Math.min(canvas.width - x, Math.ceil(box.width * ratio) + 4)
    const h = Math.min(canvas.height - y, Math.ceil(box.height * ratio) + 4)
    const crop = document.createElement('canvas')
    crop.width = Math.max(1, w)
    crop.height = Math.max(1, h)
    crop.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h)
    const scale = Math.abs(node.getAbsoluteScale().y || node.getAbsoluteScale().x || 1)
    return {
      dataUrl: crop.toDataURL(),
      width: crop.width,
      height: crop.height,
      fontSize: node.fontSize() * scale,
      color: node.fill(),
      lines: node.text().split('\n'),
    }
  })
  return page.evaluate(textCompareScript(), {
    family,
    lines: live.lines,
    fontSize: live.fontSize,
    color: live.color,
    gridSize: grid,
    live: { dataUrl: live.dataUrl, width: live.width, height: live.height },
  })
}

export async function comparePngTextToPaintedFamily(
  page: Page,
  pngBytes: Buffer,
  family: string,
  lines: string[],
  fontSize = 64,
  color = '#111111',
  grid = 128,
) {
  return page.evaluate(textCompareScript(), {
    base64: pngBytes.toString('base64'),
    family,
    lines,
    fontSize,
    color,
    gridSize: grid,
  })
}

export async function doubleClickArtwork(page: Page) {
  const point = await page.evaluate(() => {
    const stage = (window as unknown as {
      Konva?: {
        stages: Array<{
          container: () => HTMLElement
          findOne: (name: string) => { getClientRect: () => { x: number; y: number; width: number; height: number } } | null
        }>
      }
    }).Konva?.stages[0]
    const node = stage?.findOne('Text') ?? stage?.findOne('Image')
    if (!stage || !node) throw new Error('no artwork node')
    const box = node.getClientRect()
    const host = stage.container().getBoundingClientRect()
    return { x: host.x + box.x + box.width / 2, y: host.y + box.y + box.height / 2 }
  })
  await page.mouse.dblclick(point.x, point.y)
}
