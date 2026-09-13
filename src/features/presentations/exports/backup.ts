/**
 * Portable presentation backup: versioned ZIP with a manifest, the presentation
 * JSON and every required media file.
 *
 * Writer and parser are isomorphic (browser + Node). The parser is bounded:
 * archive bytes, entry count, cumulative expanded bytes, entry names, nested
 * archives and per-image limits are enforced before/while extracting, and every
 * entry's SHA-256 must match the manifest. Invalid archives fail without
 * touching any existing work — the caller only commits after a successful parse.
 */

import { unzipSync, zipSync } from 'fflate'
import { inspectImageBytes } from '../../../lib/imageFormat'
import { decodeImageBitmap } from '../../../lib/imageDecode'
import type { PresentationAsset, PresentationDocument } from '../model/types'

export const BACKUP_FORMAT = 'stickerlab-presentation-backup'
export const BACKUP_VERSION = 1

export const BACKUP_LIMITS = {
  maxArchiveBytes: 250 * 1024 * 1024,
  maxExpandedBytes: 300 * 1024 * 1024,
  maxEntries: 5000,
  maxPathLength: 200,
  maxMediaBytes: 15 * 1024 * 1024,
  maxMediaPixels: 25_000_000,
} as const

export type BackupErrorCode =
  | 'archive_too_large'
  | 'too_many_entries'
  | 'expanded_too_large'
  | 'invalid_path'
  | 'duplicate_path'
  | 'nested_archive'
  | 'missing_manifest'
  | 'unsupported_version'
  | 'malformed_manifest'
  | 'missing_entry'
  | 'unexpected_entry'
  | 'invalid_media'
  | 'hash_mismatch'
  | 'missing_media'
  | 'media_too_large'
  | 'unsupported_media'
  | 'invalid_document'

export class BackupError extends Error {
  readonly code: BackupErrorCode

  constructor(code: BackupErrorCode, message: string) {
    super(message)
    this.name = 'BackupError'
    this.code = code
  }
}

export type BackupManifestEntry = {
  path: string
  kind: 'document' | 'media'
  bytes: number
  sha256: string
  /** For media entries: the document asset this file belongs to. */
  assetId?: string
}

export type BackupManifest = {
  format: typeof BACKUP_FORMAT
  backupVersion: number
  schemaVersion: number
  createdAt: string
  documentId: string
  title: string
  entries: BackupManifestEntry[]
  fonts: Array<{ fontId: string; displayName: string; license: string }>
}

export type BackupMedia = Map<string, Uint8Array>

export type HashFn = (bytes: Uint8Array) => Promise<string>

export const sha256Hex: HashFn = async (bytes) => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new BackupError('malformed_manifest', 'SHA-256 is unavailable in this environment')
  const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const DOCUMENT_PATH = 'document.json'
const MANIFEST_PATH = 'manifest.json'
const MEDIA_PREFIX = 'media/'

const EXTENSION_BY_MIME: Record<PresentationDocument['assets'][number]['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export { EXTENSION_BY_MIME }

export function mediaPathForAsset(asset: { id: string; mimeType: PresentationDocument['assets'][number]['mimeType'] }): string {
  return `${MEDIA_PREFIX}${asset.id}.${EXTENSION_BY_MIME[asset.mimeType]}`
}

export type CreateBackupOptions = { createdAt?: string; hash?: HashFn; compressLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }

/** Builds a complete backup archive. Throws when media is missing. */
export async function createBackupArchive(
  document: PresentationDocument,
  media: BackupMedia,
  options: CreateBackupOptions = {},
): Promise<Uint8Array> {
  const hash = options.hash ?? sha256Hex
  const entries: BackupManifestEntry[] = []
  const files: Record<string, Uint8Array> = {}
  const documentBytes = new TextEncoder().encode(JSON.stringify(document, null, 2))
  files[DOCUMENT_PATH] = documentBytes
  entries.push({ path: DOCUMENT_PATH, kind: 'document', bytes: documentBytes.length, sha256: await hash(documentBytes) })

  for (const asset of document.assets) {
    const bytes = media.get(asset.id)
    if (!bytes || bytes.length === 0) throw new BackupError('missing_media', `Backup is missing media for asset ${asset.id}`)
    if (bytes.length > BACKUP_LIMITS.maxMediaBytes) throw new BackupError('media_too_large', `Asset ${asset.id} exceeds the backup media limit`)
    const path = mediaPathForAsset(asset)
    files[path] = bytes
    entries.push({ path, kind: 'media', bytes: bytes.length, sha256: await hash(bytes), assetId: asset.id })
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    schemaVersion: document.schemaVersion,
    createdAt: options.createdAt ?? new Date().toISOString(),
    documentId: document.id,
    title: document.title,
    entries,
    fonts: [
      { fontId: 'be-vietnam-pro', displayName: 'Be Vietnam Pro', license: 'SIL OFL 1.1' },
      { fontId: 'spectral', displayName: 'Spectral', license: 'SIL OFL 1.1' },
    ],
  }
  files[MANIFEST_PATH] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  return zipSync(files, { level: options.compressLevel ?? 6 })
}

export type ParsedBackup = { document: PresentationDocument; media: BackupMedia; manifest: BackupManifest }

/** Decodes or structurally verifies media before a restore commits. */
export type MediaVerifier = (bytes: Uint8Array, mimeType: PresentationAsset['mimeType']) => Promise<{ width: number; height: number }>

/** Structural verifier: no pixel decode, but rejects truncated/spoofed files. */
export const structuralMediaVerifier: MediaVerifier = async (bytes, mimeType) => {
  const inspection = inspectImageBytes(bytes)
  if (!inspection || inspection.format !== mimeType) throw new BackupError('invalid_media', 'Media is not a decodable static image')
  return { width: inspection.width, height: inspection.height }
}

/**
 * Browser verifier: a real decode when the platform supports it, falling back
 * to structural validation in Node/tests. EXIF orientation is requested the
 * same way upload validation does, so dimensions match document metadata.
 */
export const browserMediaVerifier: MediaVerifier = async (bytes, mimeType) => {
  if (typeof createImageBitmap !== 'function') return structuralMediaVerifier(bytes, mimeType)
  let bitmap: ImageBitmap
  try {
    bitmap = await decodeImageBitmap(new Blob([bytes], { type: mimeType }))
  } catch {
    throw new BackupError('invalid_media', 'Media could not be decoded')
  }
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

export type ParseBackupOptions = {
  parseDocument: (value: unknown) => PresentationDocument
  hash?: HashFn
  /** Override for tests or a Node restore path with a full decoder. */
  verifyMedia?: MediaVerifier
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateEntryPath(path: string): void {
  if (!path || path.length > BACKUP_LIMITS.maxPathLength) throw new BackupError('invalid_path', `Invalid backup path length: ${path.slice(0, 40)}`)
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) throw new BackupError('invalid_path', `Absolute paths are not allowed: ${path}`)
  if (path.split('/').some((part) => part === '..' || part === '.')) throw new BackupError('invalid_path', `Path traversal is not allowed: ${path}`)
  if ([...path].some((char) => char.charCodeAt(0) < 32) || path.includes('\\')) throw new BackupError('invalid_path', `Control characters are not allowed: ${path}`)
  if (/\.(zip|tar|gz|tgz|rar|7z)$/i.test(path)) throw new BackupError('nested_archive', `Nested archives are not allowed: ${path}`)
}

function parseManifest(value: unknown): BackupManifest {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) throw new BackupError('malformed_manifest', 'Backup manifest is missing or has an unknown format')
  if (typeof value.backupVersion !== 'number') throw new BackupError('malformed_manifest', 'Backup manifest has no version')
  if (value.backupVersion > BACKUP_VERSION) throw new BackupError('unsupported_version', `Backup version ${value.backupVersion} is newer than this app supports`)
  if (!Array.isArray(value.entries)) throw new BackupError('malformed_manifest', 'Backup manifest has no entries')
  const entries: BackupManifestEntry[] = []
  for (const raw of value.entries) {
    if (!isRecord(raw)) throw new BackupError('malformed_manifest', 'Backup entry must be an object')
    const path = typeof raw.path === 'string' ? raw.path : ''
    const sha = typeof raw.sha256 === 'string' ? raw.sha256 : ''
    const bytes = typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : -1
    const kind = raw.kind === 'media' ? 'media' : raw.kind === 'document' ? 'document' : null
    if (!path || !sha || bytes < 0 || !kind) throw new BackupError('malformed_manifest', `Malformed backup entry ${JSON.stringify(raw).slice(0, 80)}`)
    entries.push({ path, kind, bytes, sha256: sha, ...(typeof raw.assetId === 'string' ? { assetId: raw.assetId } : {}) })
  }
  return {
    format: BACKUP_FORMAT,
    backupVersion: value.backupVersion,
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 0,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    documentId: typeof value.documentId === 'string' ? value.documentId : '',
    title: typeof value.title === 'string' ? value.title : '',
    entries,
    fonts: Array.isArray(value.fonts)
      ? value.fonts.flatMap((font) =>
          isRecord(font) && typeof font.fontId === 'string'
            ? [{ fontId: font.fontId, displayName: typeof font.displayName === 'string' ? font.displayName : font.fontId, license: typeof font.license === 'string' ? font.license : '' }]
            : [],
        )
      : [],
  }
}

/** Bounded parse + verification. Never mutates existing documents. */
export async function parseBackupArchive(bytes: Uint8Array, options: ParseBackupOptions): Promise<ParsedBackup> {
  const hash = options.hash ?? sha256Hex
  if (bytes.length === 0) throw new BackupError('missing_manifest', 'Backup archive is empty')
  if (bytes.length > BACKUP_LIMITS.maxArchiveBytes) throw new BackupError('archive_too_large', 'Backup archive exceeds the size limit')

  const seen = new Set<string>()
  let entryCount = 0
  let expandedBytes = 0
  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(bytes, {
      filter: (file) => {
        validateEntryPath(file.name)
        if (seen.has(file.name)) throw new BackupError('duplicate_path', `Duplicate archive path: ${file.name}`)
        seen.add(file.name)
        entryCount += 1
        if (entryCount > BACKUP_LIMITS.maxEntries) throw new BackupError('too_many_entries', 'Backup archive has too many entries')
        expandedBytes += file.originalSize
        if (expandedBytes > BACKUP_LIMITS.maxExpandedBytes) throw new BackupError('expanded_too_large', 'Backup expands beyond the size limit')
        if (file.name.startsWith(MEDIA_PREFIX) && file.originalSize > BACKUP_LIMITS.maxMediaBytes) {
          throw new BackupError('media_too_large', `Media entry exceeds the size limit: ${file.name}`)
        }
        return true
      },
    })
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('malformed_manifest', 'Backup archive could not be read')
  }

  const manifestBytes = extracted[MANIFEST_PATH]
  if (!manifestBytes) throw new BackupError('missing_manifest', 'Backup archive has no manifest.json')
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(new TextDecoder().decode(manifestBytes))
  } catch {
    throw new BackupError('malformed_manifest', 'manifest.json is not valid JSON')
  }
  const manifest = parseManifest(manifestRaw)

  // The manifest must describe the document exactly once, and must cover every
  // extracted entry. Without this, edited contents could bypass verification.
  const documentEntries = manifest.entries.filter((entry) => entry.kind === 'document')
  if (documentEntries.length !== 1 || documentEntries[0]!.path !== DOCUMENT_PATH) {
    throw new BackupError('missing_entry', `Backup manifest must include exactly one ${DOCUMENT_PATH}`)
  }
  const manifestPaths = new Set<string>()
  for (const entry of manifest.entries) {
    if (entry.path === MANIFEST_PATH) throw new BackupError('malformed_manifest', 'The manifest must not list itself')
    if (manifestPaths.has(entry.path)) throw new BackupError('malformed_manifest', `Duplicate manifest entry: ${entry.path}`)
    manifestPaths.add(entry.path)
  }
  for (const path of Object.keys(extracted)) {
    if (path === MANIFEST_PATH) continue
    if (!manifestPaths.has(path)) throw new BackupError('unexpected_entry', `Backup contains an entry that is not in the manifest: ${path}`)
  }

  const media: BackupMedia = new Map()
  for (const entry of manifest.entries) {
    validateEntryPath(entry.path)
    const file = extracted[entry.path]
    if (!file) throw new BackupError('missing_entry', `Backup is missing ${entry.path}`)
    if (entry.bytes >= 0 && file.length !== entry.bytes) throw new BackupError('hash_mismatch', `Size mismatch for ${entry.path}`)
    const digest = await hash(file)
    if (digest !== entry.sha256) throw new BackupError('hash_mismatch', `Checksum mismatch for ${entry.path}`)
    if (entry.kind === 'media') {
      if (!entry.assetId) throw new BackupError('malformed_manifest', `Media entry ${entry.path} has no assetId`)
      if (media.has(entry.assetId)) throw new BackupError('duplicate_path', `Duplicate media for asset ${entry.assetId}`)
      media.set(entry.assetId, file)
    }
  }

  const documentFile = extracted[DOCUMENT_PATH]!
  let document: PresentationDocument
  try {
    document = options.parseDocument(JSON.parse(new TextDecoder().decode(documentFile)))
  } catch (cause) {
    throw new BackupError('invalid_document', cause instanceof Error ? cause.message : 'Backup document is invalid')
  }

  // Media must correspond to a document asset, be the declared type and decode
  // to the declared dimensions (pixel decode in browsers, structural
  // validation with CRC/shape checks elsewhere).
  const verifyMedia = options.verifyMedia ?? browserMediaVerifier
  const assetsById = new Map(document.assets.map((asset) => [asset.id, asset]))
  for (const [assetId, file] of media) {
    const asset = assetsById.get(assetId)
    if (!asset) throw new BackupError('invalid_media', `Backup contains media for unknown asset ${assetId}`)
    let dimensions: { width: number; height: number }
    try {
      dimensions = await verifyMedia(file, asset.mimeType)
    } catch (error) {
      if (error instanceof BackupError) throw error
      throw new BackupError('invalid_media', error instanceof Error ? error.message : `Media for ${assetId} could not be decoded`)
    }
    if (
      !Number.isFinite(dimensions.width) ||
      !Number.isFinite(dimensions.height) ||
      dimensions.width <= 0 ||
      dimensions.height <= 0 ||
      dimensions.width > 20_000 ||
      dimensions.height > 20_000 ||
      dimensions.width * dimensions.height > BACKUP_LIMITS.maxMediaPixels
    ) {
      throw new BackupError('invalid_media', `Media for ${assetId} has unsupported dimensions`)
    }
    if (dimensions.width !== asset.width || dimensions.height !== asset.height) {
      throw new BackupError('invalid_media', `Media for ${assetId} is ${dimensions.width}×${dimensions.height}, expected ${asset.width}×${asset.height}`)
    }
  }

  for (const asset of document.assets) {
    if (!media.has(asset.id)) throw new BackupError('missing_media', `Backup is missing media for asset ${asset.id}`)
  }
  return { document, media, manifest }
}
