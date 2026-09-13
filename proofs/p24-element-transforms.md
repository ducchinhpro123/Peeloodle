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

## Fix round 1 — review findings

Four Important review findings were fixed on top of the original commit. Nothing from P25 was added;
the preview/history/lock/pan behaviour above is unchanged and still covered by the same tests.

### 1. Rotation from an already-rotated element used the wrong centre

`elementWorldCenter(geometry)` (the rotation-aware visual centre) and
`withRotation(geometry, rotation)` (replaces the angle while keeping that centre) are now the one
shared calculation used by the canvas gesture (`PresentationCanvas`) and by the numeric Rotation
field (`ElementGeometryInspector`); `rotateTransform(start, delta)` is
`withRotation(start, start.rotation + delta)`. The old centre was `x + width/2, y + height/2`, which
is only the visual centre at 0°: an element stored at `{x:250,y:50,width:200,height:100,rotation:90}`
has its centre at `(200,150)` — not `(350,100)` — and the next turn used the wrong one.

- Unit RED: `TypeError: elementWorldCenter is not a function` (3 tests) → GREEN, 14 passed:
  `{250,50,200,100,90}` + 90° = `{300,200,200,100,180}` with the centre at `(200,150)` before and
  after, plus a 37°→143° turn whose centre holds within half a unit (only the stored origin rounds).
- Browser RED before the fix: typing `90` into Rotation left the stored origin at `{200,200}`
  (`expected {x:440,y:120}, received {x:200,y:200}`), moving the element's centre. GREEN now: the
  field writes `(440,120)`, the frame centre stays within 2px, and a second 85° canvas drag on the
  quarter-turned element reaches 175° with the centre still within 3px (one history entry).

### 2. Continuous rotation recomputed from the first pointer angle

The gesture now tracks the previous pointer angle and accumulates successive shortest deltas
(`nextRotationStep(previousAngle, angle, accumulated)`), so a pointer crossing ±180° keeps turning the
same way and the turn may pass a half turn. RED: `TypeError: nextRotationStep is not a function` →
GREEN: the 170° → −170° → −90° → −10° → 80° sequence accumulates 20, 100, 180, 270. A stored rotation
is periodic, so the accumulator's continuity is proven at unit level; the canvas path stays covered by
the quarter-turn and second-quarter-turn browser drags above.

### 3. Narrow widths lost the numeric path and had 14–16px handles

- The same numeric fields open through the shared `Dialog` from an “Element properties” trigger in the
  editor action bar wherever `.presentation-inspector` is hidden (1150px and below). The trigger uses
  the shared `.properties-toggle` class; the fixed bottom-right corner position now belongs to the
  sticker editor alone (`.editor-workspace .properties-toggle`), and that editor's own 1024/390px
  specs still pass.
- Handles keep their 14px (16px rotate) visual size and centre; a transparent `::before` grows only
  the pointer target — see fix round 2 for the corrected extent (the round-1 `-15px` was 40px, not 44px).
- Browser RED: the trigger did not exist (30s timeout waiting for it). Hit-area mutation (removing
  only the `::before` rule): `expected > 320, received 320` — the press outside the square no
  longer resized. GREEN at 1024×768 and 390×844: the pane fields are hidden, the dialog opens, typing
  X commits exactly one history entry, and a press outside the 14px SE square starts a resize
  that grows the width with x/y pinned and +1 history entry.
- New captures: `proofs/out/p24-element-properties-1024x768.png` and
  `p24-element-properties-390x844.png` show the dialog with the live values at both widths.

### 4. Resize reversed direction after crossing the pinned corner

`resizeTransform` now projects the pointer onto the handle's own outward axes (signed) and clamps at
`MIN_ELEMENT_SIZE`, instead of taking absolute projections that flipped the element to the far side of
the pinned corner. Unit RED before the fix: a south-east drag to `(80,80)` with the north-west corner
pinned at `(100,100)` returned a 40×40 box (and 80×60 at 37°) instead of clamping → GREEN: for every
corner at 0° and at 37°, the pinned corner stays within 0.75 units, the dragged corner follows the
pointer within 0.75 units, and crossing the pinned corner clamps to 8×8 on both axes.

### Fix-round commands

```bash
npx vitest run --environment jsdom src/features/presentations/editor/transformGeometry.test.ts  # 9 → 15 tests
npx vitest run --environment jsdom --exclude 'e2e/**'                                          # 473 passed
npx playwright test e2e/presentations-transform.spec.ts --workers=1                            # 4 passed
npx playwright test e2e/presentations.spec.ts --workers=1                                      # 7 passed
npx playwright test e2e/presentations-image.spec.ts e2e/presentations-save-guard.spec.ts \
  e2e/presentations-shell-guard.spec.ts e2e/presentations-library-actions.spec.ts \
  e2e/presentations-library-thumbnails.spec.ts e2e/presentations-milestone-journey.spec.ts --workers=1  # 14 passed
npx playwright test e2e/editor.spec.ts --workers=1                                             # 6 passed
npx playwright test e2e/illustrated-templates.spec.ts --workers=1 -g 'at 1024px|at 390px'      # 2 passed (sticker toggle)
npm run typecheck && npm run lint && npm run build && npm run board && git diff --check
```

No legacy capture was re-committed in this round: the presentation specs rewrite their screenshots on
every run, and the five files they touched differed from the committed ones only by 3–53 pixels at
max channel delta 2 (re-rendering noise), so they were restored byte-identically.

## Fix round 2 — the handle pointer target was 40px/42px, not 44px

The reviewer was right. Global `* { box-sizing: border-box }` puts the handle's 2px border *inside*
its border box, and an absolutely positioned child resolves against its parent's **padding** box. So
`::before { inset: -15px }` grew the target to 10 + 30 = **40px** on the 14px corner handles and
12 + 30 = **42px** on the 16px rotate handle, not 44px. The round-1 test pressed 16px out along each
axis—a point that stays inside even a 40px box, whose half extent is 20px—so it could not see the
shortfall.

- `styles.css`: `inset: -17px`, i.e. 10 + 34 = 44px corner targets and 12 + 34 = 46px rotate targets,
  and the comment above the rule now shows that arithmetic. Only the pseudo-element's extent changed:
  the visible 14px/16px handles, their centres on the element's own corners (32px above the frame's
  top edge for the rotate handle), and every frame/inspector value are untouched.
- `e2e/presentations-transform.spec.ts`: new focused test “gives every handle a 44px pointer target
  without moving its visual centre”. At 390×844 it selects an element and, for all four corners and the
  rotate handle, (1) reads the resolved `::before` box with `getComputedStyle(handle, '::before')` and
  requires at least 44×44, (2) requires the visible handle to stay 14px (16px rotate) with its centre on
  the corner — or 32px above the frame's top edge — and (3) hit-tests a real point 21px from the centre
  (22px for the shorter rotate target) with `document.elementFromPoint`, so the target is proven by the
  browser's own hit testing, not by the CSS value alone. The existing narrow-width test now presses 21px
  from the SE centre before dragging, so a 40px target can no longer pass the gesture path either.

RED before the CSS change (focused run, `-g '44px'`): `2 failed`.

- `gives every handle a 44px pointer target …`: `nw/ne/se/sw pointer width|height` →
  `Expected: >= 44, Received: 40`; `rotate pointer width|height` → `Expected: >= 44, Received: 42`;
  `nw at 21px from centre` (and ne/se/sw/rotate) → `Expected: "presentation-handle-nw", Received: null`.
- `keeps the numeric geometry path and 44px handles …`: the 21px press started no resize —
  `Expected: > 320, Received: 320`.

GREEN after `inset: -17px`: the same two tests pass, and a temporary probe of the new test's loop in the
same run reported `nw 44x44`, `ne 44x44`, `se 44x44`, `sw 44x44`, `rotate 46x46`.

```bash
npx playwright test e2e/presentations-transform.spec.ts --workers=1 -g '44px'   # RED 2 failed → GREEN 2 passed
npx playwright test e2e/presentations-transform.spec.ts --workers=1            # 5 passed
npx vitest run --environment jsdom src/features/presentations/editor/transformGeometry.test.ts \
  src/features/presentations/editor/store.test.ts                               # 51 passed
npx vitest run --environment jsdom --exclude 'e2e/**'                           # 473 passed
npm run typecheck && npm run lint && npm run build && npm run board && git diff --check
```

Typecheck clean, lint 0 errors / 4 pre-existing warnings, `vite build` clean, `npm run board`
regenerated `tasks.html` byte-identically (92 tasks, 23 done), `git diff --check` silent.

Capture note: the two 1280×768 captures were re-rendering noise (max channel delta 1–3, no geometry
change) and were restored byte-identically. `p24-element-properties-390x844.png` genuinely changed
(`402`/`213` → `409`/`189`) because the strengthened 1024px gesture now leaves the element a different
height when the 390px capture is taken, so the refreshed capture is committed.

## Limits and follow-ups

- Resizing previews by scaling the rendered group (text scales rather than reflows until the commit
  re-renders it). The committed document is never scaled.
- The rotate handle can leave the visible panel when a zoomed element sits at the slide's top edge;
  the Rotation field stays reachable at every width (the pane above 1150px, the properties dialog
  below it), and P31 alignment/tooling can add a smarter handle.
- The 44–46px targets of neighbouring handles overlap once an element is smaller than about 45px on
  screen (roughly 280 document units at the 390px viewport's fit zoom). The shared pixels go to the
  handle later in the DOM, and the numeric fields remain exact; zooming in separates the targets.
- Dragging is the only way to pan away from an element when an element covers the whole slide; a
  space/middle-button pan and alignment guides are P31.
- Text formatting, layers, locks UI, snapping and multi-select remain P25–P31, as planned.
