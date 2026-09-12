/**
 * Library actions for the presentation list (P20).
 *
 * Rename is the only library action that writes a whole document, so the
 * revision rule lives here in one place: read the stored revision, write the
 * renamed document with that revision as `baseRevision`, so a newer revision
 * written elsewhere is reported as a conflict instead of being overwritten.
 * Duplicate and delete go through the repository's own
 * `duplicatePresentation`/`deletePresentation`.
 */

import { isPersistenceError } from '@/lib/persistence/document'
import type { PresentationDocument } from '../model/types'

export const RENAME_EMPTY_TITLE_MESSAGE = 'Enter a name for this presentation before saving.'

/**
 * `document` carrying `rawTitle` at its next revision, or null when the field
 * holds nothing worth writing (a nameless presentation is never stored).
 */
export function renamedDocument(
  document: PresentationDocument,
  rawTitle: string,
  now = new Date().toISOString(),
): PresentationDocument | null {
  const title = rawTitle.trim()
  if (title.length === 0) return null
  return { ...document, title, revision: document.revision + 1, updatedAt: now }
}

export type LibraryAction = 'rename' | 'duplicate' | 'delete'

/** Plain-language reason a library action failed, in the user's terms. */
export function describeLibraryFailure(error: unknown, action: LibraryAction): string {
  if (isPersistenceError(error)) {
    if (error.code === 'revision_conflict') {
      return 'This presentation changed in another tab or window after this page was opened, so the newer version was kept and your change was not written. The list below has been refreshed with its current name.'
    }
    if (error.code === 'not_found') {
      return 'This presentation is no longer saved in this browser, so nothing was changed. The list below is up to date.'
    }
    if (error.code === 'missing_asset') {
      return 'Some of this presentation’s artwork is missing from this browser, so nothing was changed.'
    }
  }
  return `Could not ${action} this presentation. Nothing was changed; please try again.`
}
