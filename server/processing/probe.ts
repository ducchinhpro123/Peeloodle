/**
 * Temporary P08 preview harness.
 *
 * Purpose: prove that the native processing dependencies (sharp, resvg) package
 * and execute in an authorized preview deployment, and that the real transport
 * works: the client uploads image bytes directly to a private Storage object and
 * the function receives only a *reference*, downloads the staged object, then
 * writes a derivative back to Storage. Image bytes never enter the request body.
 *
 * This module is intentionally not mounted by the application; a preview deploy
 * wraps `handleStagedProcessProbe` in a throwaway `api/` route guarded by a
 * secret and a fixed bucket/prefix. Delete it once P08 evidence exists and the
 * real processing endpoint (P54+) covers the same ground.
 */

import { processAssetBytes, sha256Hex, type ProcessedAsset } from './index'
import { isProcessingError } from './errors'

/**
 * Request bodies are small JSON references, so this is a defensive cap rather
 * than the documented 4.5 MB function limit that applies to byte payloads.
 */
export const PROBE_MAX_REQUEST_BYTES = 64 * 1024

export type ProbeResponse =
  | {
      ok: true
      sourceFormat: ProcessedAsset['sourceFormat']
      width: number
      height: number
      sourceSha256: string
      pngBytes: number
      thumbnailBytes: number
      derivativePath?: string
    }
  | { ok: false; code: string; message: string }

/** Narrow Storage surface so the probe is testable without credentials. */
export interface ProbeStorageClient {
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>
  download(bucket: string, path: string): Promise<Uint8Array>
  remove(bucket: string, path: string): Promise<void>
}

export type StagedProbeDeps = {
  storage: ProbeStorageClient
  /** Fixed bucket from server-only env; client input never selects a bucket. */
  bucket: string
  /** Only objects under this prefix may be read. */
  sourcePrefix: string
  /** When set, the processed PNG is written under this prefix. */
  derivativePrefix?: string
}

function invalidPath(path: string, prefix: string): string | null {
  if (!path || path.length > 200) return 'path must be a non-empty string under 200 characters'
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'path must be relative'
  if (path.split('/').some((part) => part === '..' || part === '.')) return 'path traversal is not allowed'
  if ([...path].some((char) => char.charCodeAt(0) < 32) || path.includes('\\')) return 'path contains invalid characters'
  if (!path.startsWith(prefix)) return `path must start with ${prefix}`
  return null
}

function derivativePathFor(sourcePath: string, prefix: string): string {
  const name = sourcePath.split('/').pop() ?? 'asset'
  const stem = name.replace(/\.[a-zA-Z0-9]+$/, '')
  return `${prefix}${stem}.png`
}

/** Function-shaped entry: `{ path }` reference in, small metadata out. */
export async function handleStagedProcessProbe(body: unknown, deps: StagedProbeDeps): Promise<{ status: number; json: ProbeResponse }> {
  let serialized: string
  try {
    serialized = JSON.stringify(body) ?? ''
  } catch {
    return { status: 400, json: { ok: false, code: 'invalid_request', message: 'Body must be JSON' } }
  }
  if (serialized.length > PROBE_MAX_REQUEST_BYTES) {
    return { status: 413, json: { ok: false, code: 'request_too_large', message: 'Probe requests carry only an object reference' } }
  }
  if (!body || typeof body !== 'object' || typeof (body as { path?: unknown }).path !== 'string') {
    return { status: 400, json: { ok: false, code: 'invalid_request', message: 'path is required' } }
  }
  const path = (body as { path: string }).path
  const pathError = invalidPath(path, deps.sourcePrefix)
  if (pathError) return { status: 400, json: { ok: false, code: 'invalid_request', message: pathError } }

  let bytes: Uint8Array
  try {
    bytes = await deps.storage.download(deps.bucket, path)
  } catch {
    return { status: 404, json: { ok: false, code: 'not_found', message: 'Staged object could not be read' } }
  }
  if (!bytes || bytes.length === 0) return { status: 400, json: { ok: false, code: 'invalid_request', message: 'Staged object is empty' } }

  let result: ProcessedAsset
  try {
    result = await processAssetBytes(bytes)
  } catch (error) {
    if (isProcessingError(error)) return { status: 422, json: { ok: false, code: error.code, message: error.message } }
    return { status: 500, json: { ok: false, code: 'unexpected', message: error instanceof Error ? error.message : 'Probe failed' } }
  }

  let derivativePath: string | undefined
  if (deps.derivativePrefix) {
    derivativePath = derivativePathFor(path, deps.derivativePrefix)
    try {
      await deps.storage.upload(deps.bucket, derivativePath, result.png, 'image/png')
    } catch {
      return { status: 500, json: { ok: false, code: 'upload_failed', message: 'Derivative upload failed' } }
    }
  }

  return {
    status: 200,
    json: {
      ok: true,
      sourceFormat: result.sourceFormat,
      width: result.width,
      height: result.height,
      sourceSha256: result.sourceSha256,
      pngBytes: result.png.length,
      thumbnailBytes: result.thumbnail.length,
      ...(derivativePath ? { derivativePath } : {}),
    },
  }
}

export type StorageProbeResult = {
  uploadedBytes: number
  downloadedBytes: number
  matches: boolean
  removed: boolean
}

/**
 * Uploads bytes to a private bucket, downloads them again, verifies identity
 * and removes the probe object. Never logs bytes or credentials.
 */
export async function probeStorageRoundTrip(
  client: ProbeStorageClient,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType = 'image/png',
): Promise<StorageProbeResult> {
  await client.upload(bucket, path, bytes, contentType)
  const downloaded = await client.download(bucket, path)
  const matches = downloaded.length === bytes.length && sha256Hex(downloaded) === sha256Hex(bytes)
  let removed = false
  try {
    await client.remove(bucket, path)
    removed = true
  } catch {
    removed = false
  }
  return { uploadedBytes: bytes.length, downloadedBytes: downloaded.length, matches, removed }
}

export type ProbeEnv = { url?: string; serviceKey?: string; bucket?: string }

export function readProbeEnv(env: Record<string, string | undefined> = process.env): ProbeEnv {
  return { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.CATALOG_PROBE_BUCKET }
}

export function requireProbeEnv(env: Record<string, string | undefined> = process.env): { url: string; serviceKey: string; bucket: string } {
  const { url, serviceKey, bucket } = readProbeEnv(env)
  if (!url || !serviceKey || !bucket) {
    throw new Error('Preview probe requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CATALOG_PROBE_BUCKET (server-only env; never VITE_*)')
  }
  return { url, serviceKey, bucket }
}
