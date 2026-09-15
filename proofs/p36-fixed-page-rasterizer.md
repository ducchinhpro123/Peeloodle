# P36 — shared fixed-page slide rasterizer

**Date:** 2026-09-13
**Plan row:** P36.
**Acceptance:** exact aspect/order/background, no artwork trim, viewport transform or handles.
**Scope:** new `rendering/rasterizeSlide.ts`; `library/presentationThumbnails.ts` now uses it. No dependency change.

## What was built

`rasterizeSlidePage({ slide, pageSize, images, width, height, pixelRatio })` draws the same
`renderSlide` group the editor canvas uses on a detached stage and returns `{ bytes, dataUrl, width, height }`.
Konva is dynamically imported; the page aspect comes from `width / pageSize.width` on the Stage, and the
container div is never attached to the document, so no selection frame, guide, handle or viewport pan can
appear. The library thumbnail is now a call to this function at 480×270, so previews and PDF pages are
literally the same renderer.

## Acceptance, as verified

| Criterion                        | Evidence                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Exact aspect/background, no trim | `renderSlide` is unchanged and already covered by the P15/P16 pixel evidence; the rasterizer adds only stage sizing.                |
| Handles/guides/viewport excluded | The stage is detached and `renderSlide` is built from the document alone; guides and handles are DOM overlays outside the renderer. |
| Shared by previews               | Thumbnail suite (15 tests) passes with the new call; the thumbnail seam tests still exercise the cache/queue.                       |

## Checks run

`npx vitest run .../rasterizeSlide.test.ts` 3 passed (data-URL decode, invalid input); thumbnail suite 15 passed; full suite at the end of the increment.

## Known gaps

- Rasterizing real slides needs a browser canvas; jsdom only covers the non-Konva paths. The pixel claim
  rests on the earlier P15/P16 Chromium evidence for the same `renderSlide`.
