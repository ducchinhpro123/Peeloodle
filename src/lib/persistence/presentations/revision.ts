/**
 * Revision rules for presentation writes, shared by both repository adapters.
 *
 * These rules live in one place because they previously diverged: the memory
 * adapter only checked a conflict when `baseRevision` was supplied, while the
 * IndexedDB adapter also refused to write an older revision over newer stored
 * work and refused to silently recreate a deleted row. A regression in the
 * memory adapter could therefore pass the whole unit suite and fail only in a
 * browser, which is exactly the kind of gap a test double is supposed to close.
 */

import { PersistenceError } from '../document'

export type RevisionGuardInput = {
  /** Presentation id, used in the error message. */
  id: string
  /** Revision of the document being written. */
  incomingRevision: number
  /** Revision currently stored, or `undefined` when no row exists. */
  storedRevision: number | undefined
  /** Revision the caller last read, when it tracks one. */
  baseRevision?: number
}

/**
 * Throws `PersistenceError('revision_conflict', ...)` when the write must not
 * be applied. Callers resolve `storedRevision` themselves, because the adapters
 * differ in how they read it (and IndexedDB rejects an unreadable row outright
 * with `invalid_document` before reaching this guard).
 */
export function assertRevisionWritable({ id, incomingRevision, storedRevision, baseRevision }: RevisionGuardInput): void {
  if (storedRevision === undefined) {
    // The row the caller loaded was removed; silently recreating it would hide that.
    if (baseRevision !== undefined && baseRevision >= 0) {
      throw new PersistenceError('revision_conflict', `Presentation ${id} no longer exists`)
    }
    return
  }

  if (storedRevision > incomingRevision) {
    throw new PersistenceError('revision_conflict', `Presentation ${id} is newer than this save`)
  }

  if (baseRevision !== undefined && storedRevision > baseRevision) {
    throw new PersistenceError('revision_conflict', `Presentation ${id} changed after revision ${baseRevision}`)
  }
}
