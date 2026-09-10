// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PROBE_MAX_REQUEST_BYTES, handleStagedProcessProbe, probeStorageRoundTrip, requireProbeEnv, type ProbeStorageClient } from './probe'
import { fixtureImagePng } from '../../src/features/presentations/model/fixtures/fixture'

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

function deps(storage: ProbeStorageClient) {
  return { storage, bucket: 'private-probe', sourcePrefix: 'staging/', derivativePrefix: 'derivatives/' }
}

describe('P08 preview probe (staged object transport)', () => {
  it('processes a staged object and writes a derivative back to Storage', async () => {
    const storage = memoryStorage()
    storage.objects.set('private-probe/staging/fixture.png', fixtureImagePng())
    const { status, json } = await handleStagedProcessProbe({ path: 'staging/fixture.png' }, deps(storage))
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: true, sourceFormat: 'png', width: 256, height: 256 })
    expect(json.ok && json.derivativePath).toBe('derivatives/fixture.png')
    expect(storage.objects.has('private-probe/derivatives/fixture.png')).toBe(true)
    // The request/response carry no image bytes.
    expect(JSON.stringify(json).length).toBeLessThan(1000)
  })

  it('only reads objects under the configured prefix and never a client-chosen bucket', async () => {
    const storage = memoryStorage()
    storage.objects.set('private-probe/staging/fixture.png', fixtureImagePng())
    for (const path of ['../secrets.png', '/staging/x.png', 'other/fixture.png', 'staging/../../x.png', 'staging\\x.png']) {
      const result = await handleStagedProcessProbe({ path }, deps(storage))
      expect(result.status, path).toBe(400)
    }
  })

  it('returns typed failures for malformed requests and unreadable objects', async () => {
    const storage = memoryStorage()
    expect((await handleStagedProcessProbe({}, deps(storage))).status).toBe(400)
    expect((await handleStagedProcessProbe({ path: 'staging/missing.png' }, deps(storage))).status).toBe(404)
    storage.objects.set('private-probe/staging/text.png', new TextEncoder().encode('not an image'))
    const unsupported = await handleStagedProcessProbe({ path: 'staging/text.png' }, deps(storage))
    expect(unsupported.status).toBe(422)
    expect(unsupported.json).toMatchObject({ ok: false, code: 'unsupported_type' })
  })

  it('caps request bodies at the reference-only limit', async () => {
    const storage = memoryStorage()
    const oversized = { path: 'staging/x.png', padding: 'A'.repeat(PROBE_MAX_REQUEST_BYTES) }
    const result = await handleStagedProcessProbe(oversized, deps(storage))
    expect(result.status).toBe(413)
  })

  it('reports an upload failure instead of claiming success', async () => {
    const storage = memoryStorage()
    storage.objects.set('private-probe/staging/fixture.png', fixtureImagePng())
    storage.upload = async () => {
      throw new Error('bucket policy denied')
    }
    const result = await handleStagedProcessProbe({ path: 'staging/fixture.png' }, deps(storage))
    expect(result.status).toBe(500)
    expect(result.json).toMatchObject({ ok: false, code: 'upload_failed' })
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
