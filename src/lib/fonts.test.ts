import { afterEach, expect, it, vi } from 'vitest'
import { cssFont, loadFont, measureTextEditBox, measureTextLayout, waitForFonts } from './fonts'

afterEach(() => vi.unstubAllGlobals())

it('loads each requested font once and waits for the actual font face', async () => {
  let complete!: (faces: object[]) => void
  const load = vi.fn(() => new Promise<object[]>((resolve) => { complete = resolve }))
  vi.stubGlobal('document', { fonts: { load } })
  let ready = false
  const pending = waitForFonts(['Baloo 2', 'Baloo 2']).then(() => { ready = true })
  await Promise.resolve()
  expect(ready).toBe(false)
  expect(load).toHaveBeenCalledTimes(1)
  expect(load).toHaveBeenCalledWith('16px "Baloo 2"')
  complete([{}])
  await pending
  expect(ready).toBe(true)
  expect(cssFont(64, 'Luckiest Guy')).toBe('64px "Luckiest Guy"')
})

it('sizes the text editor from CSS line boxes, not tiny glyph ink', () => {
  const ctx = {
    font: '',
    measureText: () => ({
      width: 18,
      actualBoundingBoxLeft: 1,
      actualBoundingBoxRight: 17,
      actualBoundingBoxAscent: 4,
      actualBoundingBoxDescent: 2,
    }),
  }
  const box = measureTextEditBox(ctx, '...', 'Georgia', 28)
  expect(box.height).toBe(28)
  expect(box.width).toBeCloseTo(21.24, 5)
})

it('includes glyph overhangs instead of using advance width alone', () => {
  const ctx = {
    font: '',
    measureText: () => ({
      width: 40,
      actualBoundingBoxLeft: 8,
      actualBoundingBoxRight: 46,
      actualBoundingBoxAscent: 30,
      actualBoundingBoxDescent: 12,
    }),
  }
  expect(measureTextLayout(ctx, 'f', 'Pacifico', 32)).toEqual({ x: -8, y: -30, width: 54, height: 42 })
})

it('rejects unavailable bundled fonts instead of silently exporting a fallback', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Network failure')).mockResolvedValue([])
  vi.stubGlobal('document', { fonts: { load } })
  await expect(loadFont('Pacifico')).rejects.toThrow('Could not load Pacifico')
  await expect(loadFont('Fredoka')).rejects.toThrow('Could not load Fredoka')
  await expect(loadFont('Georgia')).resolves.toBeUndefined()
})
