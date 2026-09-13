# P31 — alignment guides, snapping and explicit alignment controls

**Date:** 2026-09-13
**Plan row:** P31.
**Acceptance:** correct at multiple zoom levels; guides never enter saves/exports.
**Scope:** new `editor/alignmentGuides.ts` (pure geometry), `editor/store.ts` (view-only `guides`),
`editor/PresentationCanvas.tsx` (snap during move, render guide lines), `editor/ElementGeometryInspector.tsx`
(align-to-slide controls), `src/styles.css`, plus unit, store and UI tests. No schema change, no new
dependency.

## What was built

| File | Change |
| --- | --- |
| `editor/alignmentGuides.ts` | `snapToAlignment` snaps a moving rectangle's left/centre/right and top/middle/bottom to other elements and the page axes within a threshold and returns the matched lines; `alignToSlide` computes the explicit left/centre/right/top/middle/bottom position. Pure geometry, no DOM or store. |
| `editor/store.ts` | `view.guides` (view state) and `setGuides`; cleared on commit, on undo/redo and on slide change, so guides can never reach the document. |
| `editor/PresentationCanvas.tsx` | Move gestures pass the preview through `snapToAlignment` against visible sibling elements and the page, and set the guide lines; resize/rotate keep exact pointer geometry. Guides render as DOM lines positioned through the shared viewport mapping, so zoom and pan apply the same way as the selection frame. |
| `editor/ElementGeometryInspector.tsx` | Six explicit align buttons (Left/Center/Right/Top/Middle/Bottom) that commit one history entry each and are disabled for locked elements. |

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| Snap geometry | 11 unit tests: edge, centre and page-centre snaps, inside/outside threshold, both axes at once, no-snap identity, no input mutation, and every `alignToSlide` value. |
| Zoom independence | Guides are stored in document units and converted through `presentationViewport`, the same mapping the selection frame uses; store test asserts `setGuides` neither dirties nor revises the document. |
| Guides never enter saves/exports | Guides live in `view`, never in the document; `commitTransform` clears them, and `ensureView` resets them on undo/redo. The store test asserts the document reference and revision are untouched. |
| Explicit alignment | UI test aligns the fixture ellipse left/middle/bottom, reads the values back and undoes the last alignment as one entry. |

## Checks run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npx vitest run --environment jsdom ... alignmentGuides.test.ts` | 11 passed |
| `npm test` | **541 passed / 39 files** |
| `npm run build` | verified at the end of the milestone increment |

## Known gaps and deliberate ceilings

- Snapping applies to move gestures only; resize and rotate keep exact pointer geometry.
- Snapping uses unrotated axis-aligned bounds, so a rotated moving element snaps by its unrotated box.
- The canvas gesture wiring and guide rendering were not browser-verified this increment (the owner asked
  for fast jsdom checks); the snapping math and view-state separation are unit-tested, and the viewport
  mapping is the one P24 already verified in Chromium.
- Guides are single 1px lines with no distance label.
