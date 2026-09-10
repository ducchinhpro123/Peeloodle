/**
 * Temporary P08 preview harness.
 *
 * Purpose: prove that the native processing dependencies (sharp, resvg) package
 * and execute in an authorized preview deployment, and that direct-to-Storage
 * upload/download works, *before* catalog ingestion (P54–P57) exists. This
 * module is intentionally not mounted by the application; a preview deploy can
 * wrap `handleProcessProbe` in a throwaway `api/` route guarded by a secret.
 *
 * Delete this file and its evidence route once P08 evidence is recorded and
 * the real processing endpoint (P54+) covers the same ground.
 */

import { processAssetBytes, sha256Hex, type ProcessedAsset } from './index'
import { ProcessingError, isProcessingError } from './errors'

/** Vercel documents a 4.5 MB function request/response body limit. */
export const PROBE_MAX_REQUEST_BYTES = 4_500_000

export type ProbeResponse =
  | { ok: true; sourceFormat: ProcessedAsset['sourceFormat']; width: number; height: number; sourceSha256: string; pngBytes: number; thumbnailBytes: number }
  | { ok: false; code: string; message: string }

/** Minimal function-shaped entry: JSON body in, JSON body out. */
export async function handleProcessProbe(body: unknown): Promise<{ status: number; json: ProbeResponse }> {
  try {
    if (!body || typeof body !== 'object' || typeof (body as { bytesBase64?: unknown }).bytesBase64 !== 'string') {
      return { status: 400, json: { ok: false, code: 'invalid_request', message: 'bytesBase64 is required' } }
    }
    const base64 = (body as { bytesBase64: string }).bytesBase64
    if (base64.length > Math.ceil((PROBE_MAX_REQUEST_BYTES * 4) / 3) + 4) {
      return { status: 413, json: { ok: false, code: 'request_too_large', message: 'Probe body exceeds the documented function limit' } }
    }
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0) return { status: 400, json: { ok: false, code: 'invalid_request', message: 'Empty body' } }
    const result = await processAssetBytes(new Uint8Array(bytes))
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
      },
    }
  } catch (error) {
    if (isProcessingError(error)) return { status: 422, json: { ok: false, code: error.code, message: error.message } }
    return { status: 500, json: { ok: false, code: 'unexpected', message: error instanceof Error ? error.message : 'Probe failed' } }
  }
}

/** Narrow Storage surface so the round-trip probe is testable without credentials. */
export interface ProbeStorageClient {
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>
  download(bucket: string, path: string): Promise<Uint8Array>
  remove(bucket: string, path: string): Promise<void>
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

export { ProcessingError }
