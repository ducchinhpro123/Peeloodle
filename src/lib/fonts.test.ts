import { afterEach, expect, it, vi } from 'vitest'
import { cssFont, loadFont, waitForFonts } from './fonts'

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

it('rejects unavailable bundled fonts instead of silently exporting a fallback', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Network failure')).mockResolvedValue([])
  vi.stubGlobal('document', { fonts: { load } })
  await expect(loadFont('Pacifico')).rejects.toThrow('Could not load Pacifico')
  await expect(loadFont('Fredoka')).rejects.toThrow('Could not load Fredoka')
  await expect(loadFont('Georgia')).resolves.toBeUndefined()
})
