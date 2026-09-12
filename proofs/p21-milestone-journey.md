# P21 — the Milestone 1 browser journey

**Date:** 2026-09-12
**Plan row:** P21 (verify the milestone's create/edit/save/reload/reopen browser journey).
**Acceptance:** composition and media survive reload at desktop and tablet widths; inspect persisted output.
**Scope:** one new browser spec plus additive helpers in `e2e/presentations.ts`. No application code changed.

## What the journey does

`e2e/presentations-milestone-journey.spec.ts` runs the whole milestone flow at **1440×900** and
**1024×768**:

1. Create a presentation from the library.
2. Add a text box and type; insert a real repo PNG through the real file input.
3. Let it save, rename the deck **from the library**, then reload the page and reopen the deck.
4. Assert the composition survived: the text is present, the image element keeps the same
   `x/y/width/height` as before the reload, the reopened document is clean at the renamed revision, and the
   canvas **paints again** — measured as artwork pixels inside the image's own canvas rect (>1000), inside
   the text's line rect (>100), and exactly **0** in an empty control region, so the two positive numbers
   mean "painted" rather than "not blank".
5. Inspect the persisted output: the stored row's title, revision, slide count, text runs, and the asset's
   `sha256` + `byteLength`, plus `getMedia` bytes whose SHA-256 and length are compared against the
   **uploaded file hashed Node-side** — identity against the source file, not self-consistency with the
   document's own field.

## What this proves that the earlier specs did not

| Earlier spec | What it covered | What P21 adds |
| --- | --- | --- |
| `presentations-image.spec.ts` | insert → paint → IndexedDB → reload → reopen, one image, 1280×768, width/height only, bytes compared to the document's own `sha256` | both widths in one journey, text **and** media surviving one reload on the same document id, full geometry (`x/y/width/height`) equality, and the Node-side hash/size of the uploaded file as the identity anchor |
| `presentations.spec.ts` | text only, 1280×768, repository saved by hand | the editor's own autosave and the library rename landing on the same row, with revision continuity asserted |
| `presentations-library-actions.spec.ts` | library operations with no editor content | library operations inside a journey that also carries canvas content and media |

## Mutation evidence (proving the acceptance is really asserted)

Both mutations were applied in a clean worktree and reverted byte-identically:

1. **Reopen skips fetching stored media.** Both tests fail at the post-reopen canvas check
   (`.presentation-canvas-error` count 1), because `renderSlide` refuses to draw an element with no loaded
   source. Right reason: the reopened canvas has no artwork.
2. **That, plus making `renderSlide` skip a missing source silently**, so no error banner can catch it.
   Both tests still fail — at `paintedPixelsInRect(imageRect) > 1000`, receiving `0`. This is the important
   one: it shows the **pixel measurement itself** carries the acceptance, rather than passing on the
   strength of an error message.

## Checks run

| Command | Where | Result |
| --- | --- | --- |
| `npx tsc -b` | clean worktree at HEAD | clean |
| `npx eslint e2e/presentations-milestone-journey.spec.ts e2e/presentations.ts` | clean worktree | clean |
| `npx playwright test e2e/presentations-milestone-journey.spec.ts` | clean worktree | **2 passed** (repeated 4× by the implementing pass, once by the lead) |
| `npx playwright test` (the other five presentation specs) | clean worktree | **12 passed** |
| `npx vitest run --environment jsdom --exclude 'e2e/**'` | clean worktree | **452 passed** |

**Why the worktree:** another writer was mid-edit in the shared checkout (`src/main.tsx`,
`e2e/editor.spec.ts`, `e2e/ui-polish.spec.ts`, plus a My Sticker Packs redesign). Running these specs from a
detached worktree at HEAD means the evidence cannot have been produced by their in-flight work. The dev
server on port 4173 was stopped before each isolated run, because `reuseExistingServer: true` would
otherwise have served the shared tree's edited `main.tsx` through HMR module URLs.

## Known gaps and risks

- **No committed capture accompanies this proof.** The journey is machine-measured (pixels, geometry, stored
  bytes) rather than eyeballed, and the P15–P17 captures already cover the presentation routes visually.
- The pixel regions are document-space constants tied to today's blank-slide layout (text inserted at
  140,240 sized 1000×160; images centred at natural size). P24's transform work may need them adjusted — a
  break would fail loudly, not silently.
- `paintedPixelsInRect` reads the first `canvas`, which is correct while the editor renders a single Konva
  layer.
- Revision numbers are asserted for continuity (+1), never pinned to an absolute value.
- "Tablet" here is 1024×768; authoring at phone width is deliberately out of scope (the route already tells
  the user authoring is designed for a laptop, while keeping the controls reachable).
- The journey does not cover concurrent-tab conflicts, quota failures, or export — those are P18/P19 unit
  territory and later milestones.

## Milestone 1 status

The milestone's stated result — `/presentations` → blank presentation → edit text/image → save → reload →
reopen, preserving existing sticker flows — is now implemented **and** browser-verified at desktop and
tablet widths, with the persisted output inspected. Voice/Braille aside, one honest limitation carries
forward: the browser Back/Forward buttons and programmatic `navigate()` remain unguarded, because the app
renders a plain `BrowserRouter` (see `proofs/p18-p19-image-and-save.md`).

**Next:** P22 — slide rail with selection and add/duplicate actions (Milestone 2: make multi-slide editing
useful).
