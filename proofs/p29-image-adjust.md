# P29 — image crop, replacement and flip

**Date:** 2026-09-13
**Plan row:** P29.
**Acceptance:** replace preserves intended placement; crop data stays non-destructive; undo restores original.
**Scope:** `editor/store.ts` (`coverCrop`, `imageReplaceRefusal`, `planImageReplacement`, `replaceImage`,
`adoptPersistedReplacement`), `editor/usePresentationSave.ts` (`persistReplace`), new
`editor/ImageAdjustInspector.tsx`, `editor/ElementGeometryInspector.tsx`, `editor/PresentationEditorPage.tsx`
(shared image-write path and replace picker), `src/styles.css`, plus store and UI tests. No schema change,
no new dependency; `renderSlide` already applied crop and flips.

## What was built

| File | Change |
| --- | --- |
| `editor/store.ts` | `coverCrop` computes a centred crop that fills the element's box without stretching; `planImageReplacement` keeps id/placement/rotation/opacity/flips and swaps asset + alt + crop; `replaceImage`/`adoptPersistedReplacement` mirror the insert commands, including the revision-race replay. |
| `editor/usePresentationSave.ts` | `persistReplace` writes the new artwork and the document in one transaction before the element switches asset, and reports the same refusal/failure vocabulary as insert. |
| `editor/ImageAdjustInspector.tsx` | Flip horizontal/vertical toggles, four crop percentage fields with a 5% minimum visible area, Reset crop, and a Replace photo action. Crop/flip changes group into one history entry per session. |
| `editor/PresentationEditorPage.tsx` | One `runImageWrite` path for insert and replace so neither can report success for a half-written change; the Replace photo action reuses the existing file input with a target element. |

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| Replace preserves placement | Store test plans a replacement on a moved/resized/flipped element and asserts x/y/width/height/flip are unchanged; UI test replaces through the real file input and asserts the same. |
| Aspect preserved | `coverCrop` unit test: an 800×200 image in a 300×300 box crops to `x 0.375, width 0.25` rather than stretching; store test: a 200×400 image in a 400×300 box crops to `y 0.3125, height 0.375`. |
| Crop is non-destructive | Crop is normalized 0..1 document data; the UI test edits and resets it and reads the model, and the stored row keeps the original asset bytes. |
| Undo restores original | Store test replaces then undoes and asserts the original assetId and full crop; UI test does the same through the editor. |
| Atomic replacement | `persistReplace` writes document + bytes through `persistDocument`; the store test asserts the new media is held for save and the UI test reads the stored row's alt text back. |

## Checks run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npm test` | **536 passed / 39 files** (includes the new store and UI replacement tests) |
| `npm run build` | verified at the end of the milestone increment |

## Known gaps and deliberate ceilings

- Crop is numeric percentage fields, not drag handles on the canvas.
- Replacement reuses the existing `decodeImageBitmap` stub in jsdom; the real-browser decode path is the
  same one P18/P19 verified.
- Flips and crops are grouped per editing session; a rapid sequence of separate edits collapses to one
  undo entry until the control blurs.
- No Playwright run for this task (owner requested fast jsdom checks).
