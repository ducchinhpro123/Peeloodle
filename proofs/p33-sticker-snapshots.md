# P33 — saved stickers as immutable image snapshots

**Date:** 2026-09-13
**Plan row:** P33.
**Acceptance:** editing/deleting source sticker does not break presentation; original sticker remains editable.
**Scope:** new `editor/insertStickerSnapshot.ts` and `editor/StickerPickerDialog.tsx`, an Add sticker action
in `PresentationEditorPage.tsx`, `src/app/repository.tsx` (`useOptionalRepository`), and
`.presentation-sticker-picker` styles, plus module and UI tests. No schema change, no new dependency.

## What was built

| File                                | Change                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editor/insertStickerSnapshot.ts`   | Loads one sticker project, its referenced assets and masks, composes it once through the same `renderDocument` pipeline used for user PNG exports, and prepares the result as a presentation image (content-addressed id, SHA-256, bytes). |
| `editor/StickerPickerDialog.tsx`    | Lists the real local sticker projects (newest first) with layer counts; empty and unreadable states are explicit.                                                                                                                          |
| `editor/PresentationEditorPage.tsx` | Add sticker flows through the same `runImageWrite` persist-then-adopt path as uploads, so the presentation and the snapshot bytes are written in one transaction.                                                                          |

## Acceptance, as verified

| Criterion                            | Evidence                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot is composed, not referenced | Module test injects a renderer, asserts it receives the project with its assets and masks, and reads the prepared bytes back as a valid PNG.                                                         |
| Presentation owns its bytes          | UI test seeds a sticker project, places it, and asserts the presentation's stored assets contain only the snapshot id and its media bytes; the source sticker's layer still points at its own asset. |
| Source stays editable                | The presentation never stores a sticker reference; the UI test asserts the source project is unchanged after placement.                                                                              |
| Each asset/mask loaded once          | Module test with two layers sharing one asset and mask asserts one `getAsset` and one `getMask` call.                                                                                                |

## Checks run

| Command                                                                | Result                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------- |
| `npm run typecheck`                                                    | clean                                             |
| `npm run lint`                                                         | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npx vitest run --environment jsdom ... insertStickerSnapshot.test.ts` | 3 passed                                          |
| `npm test`                                                             | **549 passed / 40 files**                         |
| `npm run build`                                                        | `✓ built in 2.32s`                                |

## Known gaps and deliberate ceilings

- The picker lists projects by title and layer count; there are no thumbnail previews (the sticker library
  itself renders previews in the sticker editor).
- The snapshot is rasterized at 1024px with tight artwork bounds; there is no vector/PPTX-native sticker
  path yet (P38/P39).
- The render pipeline needs a real canvas, so the route test injects the prepared snapshot; the compositor
  itself is covered by the existing export suites.
- No Playwright run for this task (owner requested fast jsdom checks).
