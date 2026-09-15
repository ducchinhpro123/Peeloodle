# P13/P14 — IndexedDB presentation stores

Date: 2026-09-10.

## What changed

| File                                       | Purpose                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/persistence/idb.ts`               | Shared opener and transaction helpers. `STICKERLAB_DB_VERSION = 5` adds `presentations` and `presentationMedia`; the upgrade only creates missing stores, so existing sticker rows are never rewritten. Also exports `idbRequest`, `transactionDone`, `runTransaction`, `blobToArrayBuffer`, `arrayBufferToBytes`, `bytesEqual`. |
| `src/lib/persistence/repository.ts`        | Sticker adapter now uses the shared helpers (behaviour unchanged; version bump is additive).                                                                                                                                                                                                                                     |
| `src/lib/persistence/presentations/idb.ts` | `IdbPresentationRepository` implementing the P12 contract: summaries, load, atomic save with validation and revision checks, delete, independent duplicate, media access.                                                                                                                                                        |

A save validates the document, checks revisions inside the transaction, verifies
submitted media against the document and stored rows (referenced asset, MIME
match, immutable bytes/metadata, completeness), then writes media and document
in a single transaction. Any failure aborts the whole transaction.

## Acceptance evidence (`idb.test.ts`, 8 tests)

1. **Additive upgrade of a populated v4 database** — seeds a v4 database with a
   sticker project and asset using raw IndexedDB, then opens it through both
   repositories: the sticker project/asset load unchanged, a presentation saves
   and reloads, and the final database version is 5.
2. **Round trip** — documents, media bytes and newest-first summaries.
3. **Revision conflicts** — a stale `baseRevision`, an older revision, and a
   save that would silently recreate a row deleted in another tab all fail with
   `revision_conflict`; brand-new documents are still allowed.
4. **Atomic rollback** — a simulated `put` failure on the document store after
   media writes aborts the transaction: the new media never lands and the
   previous document plus its media are intact.
5. **Immutable media** — replacing bytes, re-declaring the MIME, submitting
   unreferenced media, or changing the declared asset type with no media all
   fail with `invalid_asset`.
6. **Independent duplicate** — new document/asset IDs, copied media, original
   untouched.
7. **Delete** — removes the document, keeps shared media.
8. **Corrupt row handling** — listings skip an unreadable row; a direct load
   reports `unsupported_schema`.

## Other verification

- Sticker persistence tests (16) still pass after the shared-helper refactor and
  version bump; browser sticker journeys (editor, mask brush) pass.
- `npm run typecheck`, `npm run lint` (0 errors), `npm test` (326), `npm run build`.

## Follow-ups

- The editor-facing autosave/save-state wiring lands with P19; P14's conflict
  handling is already enforced at the repository boundary.
- Media cleanup for deleted presentations (orphan collection) is scheduled for
  P61; deletion intentionally keeps shared immutable media for now.
