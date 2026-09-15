# P25 — undo/redo, gesture grouping and bounded media retention

**Date:** 2026-09-13
**Plan row:** P25.
**Acceptance:** one drag/slider/text session = one history entry; undo spans slides; removed media survives while history references it.
**Scope:** `src/features/presentations/editor/store.ts` (history and held-media reconciliation),
`editor/usePresentationShortcuts.ts` (new), the editor toolbar in `PresentationEditorPage.tsx`,
`model/limits.ts` (retention budget), and the store/UI/browser specs. No schema change, no new
dependency, no persistence-contract change.

## What was built

| File                                 | Change                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor/store.ts`                    | Exported `HistoryEntry` and `reconcileHeldMedia`: held bytes are kept only while the current document or an undo/redo snapshot references them; over the retention budget the oldest snapshots are dropped first so a reachable snapshot never points at released bytes. Wired into `commit`, `applyInsert`, `undo` and `redo`. The stale "bytes held until close" comment is gone. |
| `editor/usePresentationShortcuts.ts` | Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. Events from a text field, slider or open dialog are ignored, so the field's own undo is never stolen.                                                                                                                                                                                                                          |
| `editor/PresentationEditorPage.tsx`  | Toolbar Undo/Redo buttons with accessible names and titles, disabled from `past`/`future` length, calling the same store commands as the shortcuts.                                                                                                                                                                                                                                 |
| `model/limits.ts`                    | `mediaRetentionBytes` (64 MB) for not-yet-stored artwork across current state and history; the current document's own bytes are exempt because insertion already caps one document at `maxMediaBytes`.                                                                                                                                                                              |
| `editor/store.test.ts`               | Held bytes survive undo→redo, are released when a new command clears redo, and the pure reconciliation trims the oldest snapshot over budget, drops orphans, and never releases the current document's bytes.                                                                                                                                                                       |
| `presentations.test.tsx`             | Toolbar disabled/enabled states, click undo, Ctrl+Shift+Z/Ctrl+Y redo, and Ctrl+Z inside the text field leaving history untouched.                                                                                                                                                                                                                                                  |
| `e2e/presentations.spec.ts`          | Browser journey: duplicate → Undo → Ctrl+Shift+Z → Ctrl+Z, then Ctrl+Z inside the open text field keeps the box and caret alive.                                                                                                                                                                                                                                                    |

Gesture grouping (one drag/slider/text session = one entry) and whole-document history (undo across
slides, slide switching does not clear it) already existed from P11/P17/P24; this increment exposes
them in the UI and adds the missing retention bound. The existing grouping and cross-slide tests still
pass unchanged.

## Acceptance, as verified

| Criterion                                          | Evidence                                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One gesture = one entry                            | Store tests: three grouped `transformElement` calls add one entry, the next ungrouped call adds another; the text session adds one entry regardless of input events.                                    |
| Undo spans slides                                  | Store test: add element → add slide → add element, then undo twice walks back through both slides; `selectSlide` leaves `past` intact.                                                                  |
| Removed media survives while history references it | Insert → undo keeps `pendingMedia` and redo still has bytes to save; undo → redo → undo keeps them; the browser test redoes a duplicated slide after undo.                                              |
| Retention is bounded                               | `reconcileHeldMedia` unit tests: unreachable records drop without touching history; over budget the oldest snapshot is dropped and its bytes released; the current document's bytes are never released. |

## Checks run

| Command                                                                               | Result                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run typecheck`                                                                   | clean                                                     |
| `npm run lint`                                                                        | 0 errors, 4 pre-existing `react-refresh` warnings         |
| `npm test`                                                                            | **480 passed / 36 files** (baseline 474 + 5 store + 1 UI) |
| `npx vitest run ... store.test.ts` (focused)                                          | 42 passed                                                 |
| `npx vitest run ... presentations.test.tsx` (focused)                                 | 47 passed                                                 |
| `npm run build`                                                                       | `✓ built in 2.83s`                                        |
| `npx playwright test` (presentations, transform, library-actions, library-thumbnails) | **20 passed**, including the new undo/redo test           |

Browser run: Chromium at `/usr/bin/chromium` via `playwright.config.ts`, viewports 1280×768 and
1024×768, Vite dev server on `127.0.0.1:4173`, P02 fixture presentation.

## Known gaps and deliberate ceilings

- The retention budget is a constant (64 MB), not configurable in the app; the pure function takes a
  test-only `maxBytes` so the trim policy is proven without allocating large arrays.
- Dropping the oldest snapshot to stay under the media budget silently removes that undo step. That is
  deliberate — a snapshot whose bytes were released could not be saved — but no UI message says a
  step was dropped, and no browser test exercises a real over-budget session.
- The shortcuts are not advertised in an in-app shortcut list; the buttons carry `title` text.
- Ctrl+Z inside the text field is left to the browser; the app does not implement a document-level
  undo while the caret is in a field, and no test asserts the browser's own field undo content.
- No new screenshots were captured; evidence is assertions on store state, DOM and IndexedDB rows.
