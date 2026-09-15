# P41/P42/P43 — backup writer, bounded parser and restore UI

**Date:** 2026-09-13
**Plan rows:** P41 (backup writer), P42 (bounded parser), P43 (backup/restore UI and recovery guidance).
**Acceptance:** P41 — inspect archive, all required bytes/metadata present, no temporary URLs or unrelated
documents. P42 — corrupt/oversized/duplicate-path/future-version archives fail without changing saved work.
P43 — restore works in a fresh browser profile; work can be downloaded after a local save failure.
**Scope:** writer/parser already live in `exports/backup.ts` from the P06 work (19 tests); this increment
adds `library/restoreBackup.ts`, the Restore control in `library/PresentationsPage.tsx`, the backup format
in `editor/usePresentationExport.ts`, the "Download backup" recovery action and
`.stickerlab.zip` download naming, plus tests.

## What was built

| File                                | Change                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exports/backup.ts`                 | Unchanged writer/parser: versioned ZIP with manifest, per-entry SHA-256 and bounded extraction (`archive_too_large`, `too_many_entries`, `expanded_too_large`, `invalid_path`, `duplicate_path`, `nested_archive`, `missing_manifest`, hash-verified entries, `unsupported_version`). |
| `library/restoreBackup.ts`          | Parses with `parsePresentationDocument` + `browserMediaVerifier`, clones with fresh ids via `clonePresentationDocumentWithNewIds`, re-keys media by content hash, and saves as a NEW presentation; parse/save failures leave existing work untouched.                                 |
| `library/PresentationsPage.tsx`     | "Restore backup" file input, restoring state, success note and error alert.                                                                                                                                                                                                           |
| `editor/usePresentationExport.ts`   | A `backup` format in the same lazy/progress/cancel/cleanup controller, downloading `<title>.stickerlab.zip`.                                                                                                                                                                          |
| `editor/PresentationEditorPage.tsx` | "Download backup" beside a failed save, so unsaved work can still leave the browser.                                                                                                                                                                                                  |

## Acceptance, as verified

| Criterion             | Evidence                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Writer contents       | Existing P06 backup suite (19 tests): manifest entries match document + media, hashes verified, archive sizes bounded.                                                           |
| Parser safety         | Same suite: corrupt, oversized, duplicate-path, nested and future-version archives fail closed; the new restore test asserts a corrupt archive leaves the stored list unchanged. |
| Restore as a new deck | Test: a backup restores to a different document id, "(restored)" title, fresh asset id with the same SHA-256, two slides, and byte-identical stored media.                       |
| Restore UI            | UI test drives the file input and asserts the new card, the status note and the stored row.                                                                                      |
| Recovery guidance     | UI test asserts "Download backup" appears with the failed-save status.                                                                                                           |

## Checks run

`npx vitest run library/restoreBackup.test.ts` 2 passed; backup suite 19 passed; UI restore test passed;
full suite at the end of the increment.

## Known gaps

- Restore is verified against the memory repository in jsdom; a fresh browser profile / IndexedDB round-trip
  was not run in this increment.
- The restorer does not yet surface a per-entry failure table; the parser's first failure message is shown.
