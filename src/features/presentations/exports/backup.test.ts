// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import {
  BACKUP_FORMAT,
  BACKUP_LIMITS,
  BackupError,
  createBackupArchive,
  mediaPathForAsset,
  parseBackupArchive,
  type BackupMedia,
} from './backup'
import { createFixturePresentation, fixtureImagePng } from '../model/fixtures/fixture'
import type { PresentationDocument } from '../model/types'

const parseDocument = (value: unknown) => value as PresentationDocument

function fixtureMedia(): BackupMedia {
  return new Map([['fixture-asset-transparent', fixtureImagePng()]])
}

function decode(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}

function rezip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files)
}

describe('presentation backup archive', () => {
  it('round-trips the fixture document and media', async () => {
    const document = createFixturePresentation()
    const media = fixtureMedia()
    const bytes = await createBackupArchive(document, media, { createdAt: '2026-09-10T09:00:00.000Z' })
    const parsed = await parseBackupArchive(bytes, { parseDocument })
    expect(parsed.document).toEqual(document)
    expect(parsed.manifest.format).toBe(BACKUP_FORMAT)
    expect(parsed.manifest.entries.map((entry) => entry.path)).toEqual(['document.json', mediaPathForAsset(document.assets[0]!)])
    const restored = parsed.media.get('fixture-asset-transparent')
    expect(restored).toBeDefined()
    expect(Array.from(restored!)).toEqual(Array.from(fixtureImagePng()))
  })

  it('contains only the manifest, document and required media', async () => {
    const document = createFixturePresentation()
    const bytes = await createBackupArchive(document, fixtureMedia())
    const names = Object.keys(decode(bytes)).sort()
    expect(names).toEqual(['document.json', 'manifest.json', 'media/fixture-asset-transparent.png'])
  })

  it('fails when required media is missing instead of writing a partial backup', async () => {
    await expect(createBackupArchive(createFixturePresentation(), new Map())).rejects.toMatchObject({ code: 'missing_media' })
  })

  it('rejects checksum mismatches', async () => {
    const bytes = await createBackupArchive(createFixturePresentation(), fixtureMedia())
    const files = decode(bytes)
    const mediaPath = 'media/fixture-asset-transparent.png'
    files[mediaPath] = new Uint8Array([...files[mediaPath]!.slice(0, 8), 0, 1, 2, 3])
    await expect(parseBackupArchive(rezip(files), { parseDocument })).rejects.toMatchObject({ code: 'hash_mismatch' })
  })

  it('rejects future backup versions', async () => {
    const bytes = await createBackupArchive(createFixturePresentation(), fixtureMedia())
    const files = decode(bytes)
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']!))
    manifest.backupVersion = 99
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    await expect(parseBackupArchive(rezip(files), { parseDocument })).rejects.toMatchObject({ code: 'unsupported_version' })
  })

  it('rejects path traversal and absolute paths', async () => {
    const bytes = await createBackupArchive(createFixturePresentation(), fixtureMedia())
    const files = decode(bytes)
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']!))
    manifest.entries[1].path = '../evil.png'
    delete files['media/fixture-asset-transparent.png']
    files['../evil.png'] = fixtureImagePng()
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    await expect(parseBackupArchive(rezip(files), { parseDocument })).rejects.toMatchObject({ code: 'invalid_path' })
  })

  it('rejects nested archives', async () => {
    const bytes = await createBackupArchive(createFixturePresentation(), fixtureMedia())
    const files = decode(bytes)
    files['media/inner.zip'] = new Uint8Array([1, 2, 3])
    await expect(parseBackupArchive(rezip(files), { parseDocument })).rejects.toMatchObject({ code: 'nested_archive' })
  })

  it('rejects media larger than the per-file limit before use', async () => {
    const document = createFixturePresentation()
    const media = new Map([['fixture-asset-transparent', new Uint8Array(BACKUP_LIMITS.maxMediaBytes + 1)]])
    await expect(createBackupArchive(document, media)).rejects.toMatchObject({ code: 'media_too_large' })
  })

  it('rejects archives without a manifest and malformed JSON', async () => {
    await expect(parseBackupArchive(zipSync({ 'document.json': new Uint8Array([123, 125]) }), { parseDocument })).rejects.toMatchObject({ code: 'missing_manifest' })
    const files = decode(await createBackupArchive(createFixturePresentation(), fixtureMedia()))
    files['manifest.json'] = new TextEncoder().encode('{not json')
    await expect(parseBackupArchive(rezip(files), { parseDocument })).rejects.toMatchObject({ code: 'malformed_manifest' })
  })

  it('surfaces an injected document parser failure as invalid_document', async () => {
    const bytes = await createBackupArchive(createFixturePresentation(), fixtureMedia())
    await expect(
      parseBackupArchive(bytes, {
        parseDocument: () => {
          throw new Error('unsupported schema')
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_document' })
  })

  it('uses its own error type for all failures', async () => {
    const failure = await parseBackupArchive(new Uint8Array([1, 2]), { parseDocument }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(BackupError)
  })
})
