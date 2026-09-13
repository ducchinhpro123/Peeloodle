# P24 — element move, resize and rotate

**Date:** 2026-09-13
**Plan row:** P24 (add element move/resize/rotate with document-coordinate transforms).
**Acceptance:** same result at different zoom levels; handles and numeric properties agree.
**Scope:** one pure geometry module, one store command pair + view field, canvas gesture
handling, a DOM selection frame with handles, five numeric inspector fields, `renderSlide`
listening for every element kind, scoped styles. No dependency added.

## What changed

| File | Change |
| --- | --- |
| `editor/transformGeometry.ts` (new) | Pointer→document conversion, frame→view conversion, move/resize/rotate math, and `normalizeTransform` (the guard that keeps geometry finite and positive). |
| `editor/store.ts` | `view.transformPreview` (live gesture, view state only), `setTransformPreview`, `commitTransform` (one grouped history entry, refuses locked elements and unusable geometry). |
| `editor/PresentationCanvas.tsx` | Hit-tests the element under the pointer, starts move/resize/rotate gestures, previews them on the Konva group (rendering layer only), and draws the frame. Background drags still pan. |
| `editor/PresentationSelectionFrame.tsx` (new) | DOM frame, four corner resize handles, one rotate handle; locked elements get the frame without handles. |
| `editor/ElementGeometryInspector.tsx` (new) | X/Y/Width/Height/Rotation fields; they read the live preview and write through `commitTransform`. This is also the keyboard path to the same values. Locked elements show the numbers disabled rather than offering a command that would be refused. |
| `rendering/renderSlide.ts` | Every visible element kind is hit-testable when `listening` is on (was text only). |
| `styles.css` | Handle/field/frame styles inside the existing `.presentation-*` block, using existing tokens. |
| `e2e/presentations-transform.spec.ts` (new) | Browser evidence: zoom equivalence, handle/numeric agreement, transient preview, kinds, locks, persistence. |
| `e2e/presentations.spec.ts` | The P16 pan test now pans from the slide background: dragging an element moves it (below). |

Behaviour change worth stating: **dragging an element moves it; dragging the slide background still
pans.** The P16 fixture's panel shape covers almost the whole slide, so its pan step was updated to
start from the background above the slide. The document-unchanged assertion in that test is unchanged
and still passes.

## How the acceptance is met

- **Document coordinates.** Pointer positions become document units with
  `(viewPoint − viewport)/viewport.scale`, i.e. the same `presentationViewport` the renderer uses.
  Zoom and pan never enter the document.
- **Same result at every zoom.** The browser test performs a 40×16-unit move at 100% and at 125%
  view scale (screen deltas 40·s and 40·s′) and requires the document deltas to differ by ≤1 unit.
- **Handles and numbers agree.** The frame is drawn through `transformFrameInView` from the same
  geometry the inspector shows; the test asserts the frame's client rect matches the stored geometry
  within 1 px, each handle centre sits on its element corner within 3 px, and the input values equal
  the stored numbers — during a gesture (live preview), after the gesture, and after a resize.
- **Transient preview, one history entry.** Mid-gesture the document elements are byte-identical to
  their pre-gesture values, `view.transformPreview` holds the candidate geometry, and the rendered
  Konva group already follows the pointer; the pointer-up writes one command, so three intermediate
  pointer moves plus the release produce exactly one history entry.
- **Locked elements.** `commitTransform` refuses them and the canvas starts no gesture; the browser
  test drags a locked ellipse and requires unchanged geometry, unchanged history, and unchanged pan.
- **Nothing view-only is persisted.** After autosave the stored row's element keys equal the live
  element's keys, the JSON contains no `transformPreview`, and the top-level keys contain no zoom or
  pan; a reload reopens at 100% with no pan.

## RED → GREEN evidence

Unit cycles (each test added and run before the code it needs; vitest, jsdom):

1. Frame mapping — RED: `Failed to resolve import "./transformGeometry"`. GREEN after the module.
2. Move — RED: `TypeError: moveTransform is not a function` (3 tests, 1 failed). GREEN.
3. Resize (opposite corner pinned, rotated axes, minimum size) — RED: three ×
   `TypeError: resizeTransform is not a function`. GREEN.
4. Rotate about the centre — RED: `TypeError: rotateTransform is not a function`. GREEN.
5. Store preview — RED: `state(...).setTransformPreview is not a function`. GREEN.
6. Commit grouping — RED: the test asserted `history + 1` but the lock toggle is itself an entry
   (`expected ... to have a length of 2 but got 3`); the assertion was made precise about the toggle,
   then GREEN. (The `commitTransform` body landed together with the preview field because the store
   module must compile against `normalizeTransform`; the grouping behaviour is covered by the
   mutation below.)
7. Rotation across the half turn — RED: `TypeError: rotationDelta is not a function`. GREEN after the
   shortest-turn helper, so a pointer circling past ±180° keeps turning instead of jumping 360°.

Browser cycle (`e2e/presentations-transform.spec.ts`, run before the UI existed):

- RED: test 1 timed out waiting for `getByLabel('X position')` (no numeric inspector);
  test 2 got `data-selected-element=""` after clicking the fixture image (shapes/images were inert).
  `2 failed`.
- GREEN after the canvas/frame/inspector wiring: `2 passed`.

Mutation evidence (applied in this worktree, observed, then reverted byte-identically):

| Mutation | Failure it produced |
| --- | --- |
| `renderSlide` listening back to text-only | browser test 2: expected `data-selected-element` `fixture-image-sticker`, received `""` |
| `commitTransform` without `endHistoryGroup()` | store unit test: expected history 3, got 2; browser test 1: `expect(moved.history).toBe(start.history + 1)` got the previous entry merged |
| `documentPointFromView` without `/ viewport.scale` | unit test: expected `{100,200}`, got `{75,150}`; browser test 1: move off by 17 units (expected ≤1) |

## Commands run

```bash
npx vitest run --environment jsdom --exclude 'e2e/**'      # 467 passed (453 before P24)
npm run typecheck                                          # clean
npm run lint                                               # 0 errors, 4 pre-existing warnings
npx playwright test e2e/presentations-transform.spec.ts --workers=1   # 2 passed
npx playwright test e2e/presentations.spec.ts --workers=1  # 7 passed (pan step updated)
npx playwright test e2e/presentations-image.spec.ts e2e/presentations-save-guard.spec.ts \
  e2e/presentations-shell-guard.spec.ts e2e/presentations-library-actions.spec.ts \
  e2e/presentations-library-thumbnails.spec.ts e2e/presentations-milestone-journey.spec.ts --workers=1  # 14 passed
npx playwright test e2e/editor.spec.ts --workers=1         # 6 passed (sticker regression)
npm run build                                              # vite build clean
npm run board                                              # tasks.html regenerated, 23 done
```

Captures: `proofs/out/p24-element-handles-1280x768.png` (frame, four corner handles, rotate handle,
inspector showing 200/200/320/160/0) and `proofs/out/p24-element-rotated-1280x768.png` (rotation 90,
frame swapped to 190×380 client px, rotate handle now right of the centre). Re-running the P15–P17
specs refreshed their committed captures, which is why they are part of this commit.

## Limits and follow-ups

- Resizing previews by scaling the rendered group (text scales rather than reflows until the commit
  re-renders it). The committed document is never scaled.
- The rotate handle can leave the visible panel when a zoomed element sits at the slide's top edge;
  the rotation field in the inspector always works (P31 alignment/tooling can add a smarter handle).
- Dragging is the only way to pan away from an element when an element covers the whole slide; a
  space/middle-button pan and alignment guides are P31.
- Text formatting, layers, locks UI, snapping and multi-select remain P25–P31, as planned.
