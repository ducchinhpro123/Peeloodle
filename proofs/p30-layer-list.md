# P30 — accessible element list, order, duplicate, delete and locks

**Date:** 2026-09-13
**Plan row:** P30.
**Acceptance:** keyboard can select/reorder/edit properties; locked elements ignore canvas drags.
**Scope:** `store.duplicateElement`, new `editor/ElementLayerList.tsx`, mounted in the editor slide rail,
and `.presentation-layer-*` rules in `src/styles.css`, plus store and UI tests. No schema change, no new
dependency.

## What was built

| File | Change |
| --- | --- |
| `editor/store.ts` | `duplicateElement`: clones with a fresh id, offsets by 24 units, suffixes the name with "copy", selects the copy and records one undo entry; refuses a missing element or a full slide. |
| `editor/ElementLayerList.tsx` | Top-first list of the active slide's elements (front-most first). Each row is a labelled select button plus Hide/Show, Lock/Unlock, Move up/down, Duplicate and Delete buttons; empty and full states have text. |
| `editor/PresentationEditorPage.tsx` | Mounts the list under the slide rail, so it is reachable at every editor width. |

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| Keyboard select/reorder/properties | Every action is a real button with an accessible name; the UI test clicks the row's select button, moves Panel up and down, duplicates, locks, hides and deletes through those names. |
| Ordering | UI test asserts the store order changes with Move up and is restored by undo. |
| Duplication | Store test asserts fresh id, offset position, name suffix, selection and one undo entry; UI test duplicates and deletes the copy by name. |
| Locked elements ignore canvas drags | UI test locks Panel, calls `commitTransform` and asserts the element geometry is unchanged; the store already refuses locked transforms (P24). |
| Visibility | UI test hides the element from the list and reads `visible: false` back. |

## Checks run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npm test` | **541 passed / 39 files** (includes the new duplicate and layer-list tests) |
| `npm run build` | verified at the end of the milestone increment |

## Known gaps and deliberate ceilings

- Ordering is button-based (Move up/down); there is no drag-and-drop in the list.
- Delete is immediate and undoable, matching the slide rail; no confirmation dialog.
- A slide at the 200-element cap renders 200 rows (7 buttons each). It is contained by the rail's scroll,
  but the list is not virtualized.
- No Playwright run for this task (owner requested fast jsdom checks).
