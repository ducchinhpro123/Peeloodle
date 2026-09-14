import { describe, expect, it, vi } from 'vitest'
import { createDecodedArtwork, decodeArtworkBatch, type ArtworkBytes, type DecodeMedia, type DecodedSource, type DecodedArtworkSources } from './decodedArtwork'
import type { PresentationImageSource } from './renderSlide'

function record(assetId: string): ArtworkBytes {
  return { assetId, bytes: new Uint8Array([1, 2]), mimeType: 'image/png' }
}

/** A decoded source that records its disposal, standing in for a bitmap or <img>. */
function decodedSource(): { decoded: DecodedSource; dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn()
  const source = { width: 4, height: 4 } as unknown as PresentationImageSource
  return { decoded: { source, dispose }, dispose }
}

describe('decoded artwork session', () => {
  it('replaces a repeated asset id and closes each source exactly once', async () => {
    const first = decodedSource()
    const second = decodedSource()
    const other = decodedSource()
    const queue = [first.decoded, second.decoded, other.decoded]
    const artwork = createDecodedArtwork(async () => queue.shift()!)

    await artwork.add([record('a')])
    expect(artwork.images.get('a')).toBe(first.decoded.source)

    await artwork.add([record('a'), record('b')])
    expect(artwork.images.get('a')).toBe(second.decoded.source)
    expect(artwork.images.get('b')).toBe(other.decoded.source)
    // The same id's previous source is released immediately, not at close.
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).not.toHaveBeenCalled()

    artwork.dispose()
    artwork.dispose()
    expect(second.dispose).toHaveBeenCalledTimes(1)
    expect(other.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the artwork already on screen when an incremental add fails', async () => {
    const kept = decodedSource()
    let calls = 0
    const artwork = createDecodedArtwork(async () => {
      calls += 1
      if (calls === 2) throw new Error('cannot display')
      return kept.decoded
    })

    await artwork.add([record('kept')])
    await expect(artwork.add([record('broken')])).rejects.toThrow('cannot display')

    expect(artwork.images.get('kept')).toBe(kept.decoded.source)
    expect(kept.dispose).not.toHaveBeenCalled()

    artwork.dispose()
    expect(kept.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('decoded artwork batch', () => {
  it('keys every decoded record and closes each source once', async () => {
    const a = decodedSource()
    const b = decodedSource()
    const decode: DecodeMedia = async (input) => (input.assetId === 'a' ? a.decoded : b.decoded)

    const artwork: DecodedArtworkSources = await decodeArtworkBatch([record('a'), record('b')], decode)

    expect([...artwork.images.keys()]).toEqual(['a', 'b'])
    artwork.dispose()
    artwork.dispose()
    expect(a.dispose).toHaveBeenCalledTimes(1)
    expect(b.dispose).toHaveBeenCalledTimes(1)
  })

  it('closes every fulfilled bitmap when one record fails to decode', async () => {
    const ok = decodedSource()
    const decode: DecodeMedia = async (input) => {
      if (input.assetId === 'bad') throw new Error('corrupt')
      return ok.decoded
    }

    await expect(decodeArtworkBatch([record('ok'), record('bad')], decode)).rejects.toThrow('corrupt')
    expect(ok.dispose).toHaveBeenCalledTimes(1)
  })
})
