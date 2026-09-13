# P22/P23 — slide rail: add, duplicate, reorder, delete

**Date:** 2026-09-13
**Plan rows:** P22 (slide rail with selection and add/duplicate) and P23 (reorder and delete with keyboard alternatives).
**Acceptance:** P22 — new IDs on duplicate, copied media stays valid, the current slide is clearly indicated. P23 — ordering persists, deleting the active slide selects a survivor, at least one slide remains.
**Scope:** `src/features/presentations/editor/store.ts` (slide commands), the presentation slide-rail markup in
`PresentationEditorPage.tsx`, the `.presentation-slide-*` rules in `src/styles.css`, and the existing unit and
browser specs. No schema change, no new dependency, no persistence-contract change.

## What was built

| File | Change |
| --- | --- |
| `editor/store.ts` | `addSlide` / `duplicateSlide` / `reorderSlide` / `removeSlide` commands; duplicates get fresh slide and element IDs while reusing the source's asset references; `removeSlide` refuses the last slide and moves selection to an adjacent survivor. |
| `editor/PresentationEditorPage.tsx` | Slide rail: `aria-current` selection, Add / Duplicate active / Move up / Move down / Delete actions, and focus management after delete. |
| `src/styles.css` | `.presentation-slide-rail*`, `.presentation-slide-card*`, and `.presentation-slide-item-actions` layout, including the active and focus states. |
| `editor/store.test.ts` | Slide add/duplicate/reorder/remove, last-slide guard, and the adjacent-survivor case. |
| `e2e/presentations.spec.ts` | One browser journey at 1280×768: duplicate → add → reorder → reload/reopen → delete. |

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| New IDs on duplicate | Browser test reads the live store: the copy is a distinct slide id and the copied element-ID set is disjoint from the source's. |
| Copied media stays valid | The duplicate keeps `assetId: fixture-asset-transparent`; after reload/reopen the reused asset id list is unchanged and the reopened copy paints its transparent PNG (`sampleCanvas` mint pixels > 500). |
| Current slide indicated | `aria-current="true"` on the active card; asserted after duplicate, add, and reorder. |
| Ordering persists | Browser test reorders slide 3 up, then reloads and reopens: the stored `slides[].id` order equals the expected moved order. |
| Deleting active selects a survivor | Unit test deletes the middle of three slides and asserts the next slide is selected, then deletes the last and asserts the previous; the browser journey deletes the active slide and asserts focus moves to the surviving card. |
| At least one slide remains | Unit test refuses `removeSlide` on the only slide; the browser journey deletes down to one and asserts Move up/down/Delete are all disabled and the stored slide count is 1. |

## Review correction (adjacent survivor)

The first implementation computed the survivor from the list *after* filtering the removed slide, so
`findIndex(removedId)` was always `-1` and deletion always selected the first slide. Fixed in
`store.ts` to index the removed slide in the original list and pick the slide that takes its place (the
previous slide when the last one is removed). The browser journey previously asserted "slide 1 is
focused"; it now asserts the slide that moved into the deleted slot is focused, which is what the fix
produces.

## Checks run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npm test` | **474 passed / 36 files** |
| `npx vitest run ... store.test.ts` (focused) | 37 passed |
| `npm run build` | `✓ built in 2.47s` |
| `npx playwright test e2e/presentations.spec.ts --grep "adds, duplicates, reorders, and deletes slides" --workers=1` | **1 passed** (4.6s) |

Browser run: Chromium at `/usr/bin/chromium` via `playwright.config.ts`, viewport **1280×768**, Vite dev
server on `127.0.0.1:4173`, P02 fixture presentation (`fixture-slide-1`, `fixture-slide-2`,
`fixture-asset-transparent`).

## Known gaps

- No screenshots were captured for P22/P23; the evidence is assertions on live DOM, store state and
  IndexedDB rows, not committed images.
- Keyboard alternatives are covered as focusable buttons with accessible names (the rail is a list of
  buttons, so Tab/Enter reach add, duplicate, move and delete); drag-and-drop reordering is not offered.
- Tablet/phone rail layout was not re-measured here; it is covered by the shared presentation responsive
  checks and the P20 containment captures.
