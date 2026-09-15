# P35 — export snapshot and preflight

**Date:** 2026-09-13
**Plan row:** P35.
**Acceptance:** concurrent edit cannot mix revisions; missing assets/overflow yield clear actionable messages.
**Scope:** new `exports/snapshot.ts`, plus `exports/snapshot.test.ts`. No dependency change.

## What was built

| API                                       | Behaviour                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captureExportInput()`                    | Flushes the open text session, then reads the live document and the held media in one synchronous pass, so no await can straddle two revisions.                 |
| `createExportSnapshot(document, options)` | Awaits fonts, resolves every referenced image from held bytes or storage, decodes them, and returns `{ document, revision, images, media, warnings, dispose }`. |
| `collectExportWarnings`                   | One actionable entry per overflowing text element and per unknown font, naming the slide and element.                                                           |
| `PresentationPreflightError`              | `no-document`, `missing-media` (names the file), `decode-failed`; every already-decoded bitmap is closed before throwing.                                       |
| `prepareExportSnapshot(repository)`       | Capture + preflight in one call, for the export controller.                                                                                                     |

## Acceptance, as verified

| Criterion                      | Evidence                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No revision mixing             | Test: capture input, add a slide to the store, then snapshot the captured document; the snapshot keeps one slide while the live store has two. |
| Missing asset is actionable    | Test: an unpublished asset rejects with `missing-media` and the file's label in the message.                                                   |
| Held bytes win                 | Test: media supplied from `mediaForSave()` is used without asking the repository.                                                              |
| Decode failure releases memory | Test: two images, one throws; the successful bitmap is closed and `decode-failed` is returned.                                                 |
| Overflow and fonts warned      | Test: 600 characters in a 40-unit box and an unknown font id produce named warnings.                                                           |

## Checks run

`npm run typecheck` clean; `npx vitest run src/features/presentations/exports/snapshot.test.ts` 8 passed; full suite at the end of the milestone increment.

## Known gaps

- The default overflow measure is the editor's canvas measure; a Node caller must inject a measure.
- The snapshot holds decoded bitmaps until `dispose()`; callers must always dispose.
