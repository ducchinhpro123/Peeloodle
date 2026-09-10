// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PROBE_MAX_REQUEST_BYTES, handleProcessProbe, probeStorageRoundTrip, requireProbeEnv, type ProbeStorageClient } from './probe'
import { fixtureImagePng } from '../../src/features/presentations/model/fixtures/fixture'

const validPngBase64 = Buffer.from(fixtureImagePng()).toString('base64')

function memoryStorage(): ProbeStorageClient & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>()
  return {
    objects,
    async upload(bucket, path, bytes) {
      objects.set(`${bucket}/${path}`, bytes.slice())
    },
    async download(bucket, path) {
      const value = objects.get(`${bucket}/${path}`)
      if (!value) throw new Error('missing object')
      return value
    },
    async remove(bucket, path) {
      objects.delete(`${bucket}/${path}`)
    },
  }
}

describe('P08 preview probe', () => {
  it('processes a small PNG through the function-shaped entry', async () => {
    const { status, json } = await handleProcessProbe({ bytesBase64: validPngBase64 })
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: true, sourceFormat: 'png', width: 256, height: 256 })
  })

  it('returns typed failures instead of throwing', async () => {
    const bad = await handleProcessProbe({ bytesBase64: Buffer.from('not an image').toString('base64') })
    expect(bad.status).toBe(422)
    expect(bad.json).toMatchObject({ ok: false, code: 'unsupported_type' })
    const missing = await handleProcessProbe({})
    expect(missing.status).toBe(400)
  })

  it('rejects request bodies beyond the documented function limit', async () => {
    const oversized = 'A'.repeat(Math.ceil((PROBE_MAX_REQUEST_BYTES * 4) / 3) + 8)
    const result = await handleProcessProbe({ bytesBase64: oversized })
    expect(result.status).toBe(413)
  })

  it('round-trips bytes through an injected Storage client and verifies identity', async () => {
    const client = memoryStorage()
    const result = await probeStorageRoundTrip(client, 'private-probe', 'probe/fixture.png', fixtureImagePng())
    expect(result).toMatchObject({ matches: true, removed: true })
    expect(client.objects.size).toBe(0)
  })

  it('reports a mismatch instead of claiming success', async () => {
    const client = memoryStorage()
    client.download = async () => new Uint8Array([1, 2, 3])
    const result = await probeStorageRoundTrip(client, 'private-probe', 'probe/fixture.png', fixtureImagePng())
    expect(result.matches).toBe(false)
  })

  it('requires server-only credentials and never falls back to browser env names', () => {
    expect(() => requireProbeEnv({ VITE_SUPABASE_URL: 'https://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'y' })).toThrow(/SUPABASE_URL/)
    const env = requireProbeEnv({ SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', CATALOG_PROBE_BUCKET: 'b' })
    expect(env).toEqual({ url: 'https://x', serviceKey: 'k', bucket: 'b' })
  })
})
