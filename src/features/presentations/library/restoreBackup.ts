/**
 * Safe backup restore (P43). A parsed backup never overwrites stored work: it is
 * cloned with fresh document, slide, element and asset ids and saved as a new
 * presentation, with its media re-keyed by content hash. A failed parse or save
 * leaves existing presentations untouched.
 */

import type { PresentationMediaRecord, PresentationRepository } from '@/lib/persistence/presentations/repository'
import { browserMediaVerifier, parseBackupArchive, type ParsedBackup } from '../exports/backup'
import { clonePresentationDocumentWithNewIds } from '../model/factories'
import { parsePresentationDocument } from '../model/parse'
import type { PresentationDocument } from '../model/types'

export type RestoreOutcome =
  | { ok: true; document: PresentationDocument }
  | { ok: false; message: string }

/** Parses, validates and saves one backup archive as a new presentation. */
export async function restoreBackupArchive(repository: PresentationRepository, bytes: Uint8Array): Promise<RestoreOutcome> {
  let parsed: ParsedBackup
  try {
    parsed = await parseBackupArchive(bytes, { parseDocument: parsePresentationDocument, verifyMedia: browserMediaVerifier })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'This backup could not be read.' }
  }

  const copy = clonePresentationDocumentWithNewIds(parsed.document, {
    title: `${parsed.document.title} (restored)`.slice(0, 300),
  })
  const originalIdBySha = new Map(parsed.document.assets.map((asset) => [asset.sha256, asset.id]))
  const media: PresentationMediaRecord[] = []
  for (const asset of copy.assets) {
    const originalId = originalIdBySha.get(asset.sha256)
    const record = originalId ? parsed.media.get(originalId) : undefined
    if (!record) return { ok: false, message: 'This backup is missing artwork for one of its slides.' }
    media.push({ assetId: asset.id, bytes: record, mimeType: asset.mimeType })
  }

  try {
    await repository.savePresentation(copy, media)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'This backup could not be saved.' }
  }
  return { ok: true, document: copy }
}
