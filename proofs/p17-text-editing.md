# P17 — basic wrapped text editing

Verified 2026-09-11 on this Linux x86_64 workspace with headless Chromium 152.

## Implemented

- **Insert** — the editor bar's “Add text” action builds a real `TextElement`
  through `createTextElement()` and `usePresentationStore.addElement()`, then
  opens the editor for it. Insert is one history entry.
- **Select** — the renderer makes text elements hit-testable
  (`renderSlide({ listening: true })`, `createKonvaTextForRun(..., listening)`);
  shapes and images stay inert until P24. A text element gets a full-box hit
  region, so an empty or cleared box is still selectable; Konva paints that
  rect's colour key on the hit canvas only, so nothing extra is drawn. A canvas
  click selects, an empty-canvas click clears the selection, and a DOM outline
  shows the selected box. Double click (or the bar's “Edit text” button) opens
  the editor.
- **Edit** — `TextEditOverlay` renders one `contenteditable` field positioned
  over the element in document units and scaled as a whole, so fit, zoom, and
  pan never re-seed the field or move the caret. The field is seeded from
  `paragraphsToHtml` and every commit reads back through
  `readParagraphsFromDom`; the paragraph/run model stays authoritative and the
  DOM tree is never persisted.
- **One session, one history entry** — commits share
  `textHistoryGroup(elementId)` and `endHistoryGroup()` runs when the session
  ends (blur, Escape, or unmount), so typing ten characters and pressing Escape
  leaves exactly one undo entry. The store clears the editing target when the
  element or its slide is removed, on a slide switch, and after undo/redo, so
  the target cannot go stale.
- **English/Vietnamese input** — IME composition commits once on
  `compositionend` instead of per keystroke, and Escape during composition is
  left to the IME. Paste is intercepted, normalized through
  `htmlToParagraphs`/`plainTextToParagraphs`, and inserted as plain text with
  line breaks kept as `<br>`; pasted markup (including `javascript:` links and
  `<script>`) never reaches the field or the document. A stale DOM selection
  left over from another element cannot swallow the paste.
- **Rejected commits stay recoverable** — a command the document rejects (for
  example text past the 20 000-character limit) shows an honest in-editor alert
  and keeps the session open instead of throwing out of the React handler and
  stranding the editor.
- **Text sessions are view state** — the editing target lives in
  `view.editingElementId`; opening, closing, or losing it never dirties the
  document.
- The edited element's geometry (`x`, `y`, `width`, `height`) is untouched, and
  text typed into a paragraph with no seeded run uses the element's first-run
  style, falling back to the document theme's body font and text colour.
- While the field is focused, wheel zoom over the canvas keeps working and the
  field travels with the element; canvas clicks and drags follow the usual
  blur-to-commit rule and end the session.

### Save and reopen

P17 deliberately adds no Save control and no autosave: `docs/slides-implementation-plan.md`
assigns truthful autosave, explicit Save, and revision conflicts to P19, and the
editor's status pill already reports the honest `Unsaved changes` state derived
from `dirty`. The P17 acceptance (“blur/save/reopen without losing content or
position”) is proven against the persistence contract instead: the edited
document is saved through `PresentationRepository.savePresentation(document, [],
{ baseRevision: savedRevision })` and reopened from IndexedDB, and the reopened
element's text, geometry, and rendered pixels are asserted.

## Acceptance evidence

`e2e/presentations.spec.ts` — `inserts, edits, saves, and reopens a text box
without moving it` drives the real Konva canvas and the real DOM bridge:

- insert → the overlay opens focused, type `Xin chào Việt Nam — hello`;
- click the canvas: the session ends, one history entry exists, the status shows
  `Unsaved changes`, and zoom/pan are still `1`/`{x:0,y:0}`;
- click the text line on the canvas: `data-selected-element` becomes the element
  id (real hit testing, not a test seam); double click reopens the editor;
- wheel-zoom over the canvas while editing: the dashed field still matches the
  element box within 2 px, ArrowLeft ×2 followed by typing inserts inside the
  word (`hel~lo`) instead of resetting the caret to the end;
- insert a second box, blur it without typing, and click it again: the empty box
  is still selectable through its hit region;
- save through the repository with `baseRevision` and reopen from
  `/presentations`: the document JSON keeps the same `x/y/width/height`, and the
  reopened canvas paints dark text pixels inside the saved box and none in a
  region below it.

Unit coverage:

- `presentations.test.tsx` — insert + edit with one history entry and unchanged
  geometry; IME commits once and only on `compositionend`; pasted markup is
  stripped of links and scripts; pasted line breaks survive (even with a stale
  selection present); a rejected over-limit commit shows an alert and leaves the
  session recoverable; opening and closing without typing changes neither
  history nor revision nor `dirty`; theme body font/colour reach the typed run;
  an existing rich text element keeps its `spectral`/72/white/bold run and its
  geometry; the status reports `Unsaved changes`.
- `editor/store.test.ts` — `startTextEdit`/`endTextEdit` are view state only,
  reject non-text and unknown ids, close on slide switch, and the target is
  dropped when its element or slide is removed or undo removes the element.

Committed captures: `proofs/out/p17-editor-editing-1280x768.png`,
`proofs/out/p17-editor-reopened-1280x768.png`.

## Checks

```text
git diff --check                                      passed
npm run typecheck                                     passed
npm run lint                                          passed, 4 existing Fast Refresh warnings
npm test                                              passed, 31 files / 352 tests
npm run build                                         passed
npx playwright test e2e/presentations.spec.ts --workers=1
                                                      passed, 5 tests
npx playwright test e2e/proofs --workers=1            passed, 2 tests
npx playwright test e2e/editor.spec.ts --workers=1    passed, 6 tests (sticker regression)
```

The P04 text-bridge and P06 PDF/backup proofs build their own Konva nodes and do
not call `renderSlide`, so the hit-testing change does not touch them. Inside the
renderer, `listening` still defaults to `false`; `PresentationCanvas` is the only
caller that opts in, and `renderSlide` keeps shapes and images inert either way.

## Remaining boundary

P18 (image insertion), P19 (autosave and explicit Save), P20 (library
management) are not started. Within text editing specifically:

- Moving, resizing, and rotating the box is P24; formatting runs (bold, size,
  colour, family) is P26; bullets, alignment, spacing, and link editing is P27.
  Alignment, bullets, and per-run styling survive an edit but cannot be changed
  from the UI yet, and a paragraph created with Enter reads back as left-aligned.
- Selection is pointer-only: there is no keyboard path to select an existing box
  until the element list in P30, and `locked` elements are still editable for the
  same reason.
- Interacting with the canvas (click or drag) blurs the field and commits the
  session; only wheel zoom keeps editing uninterrupted. An explicit edit mode is
  a later-editing concern.
- The overlay is not clipped to the slide page, so text overflowing the slide
  edge is visible while editing and clipped once the session ends.
- Each keystroke clones, re-serializes, and re-validates the document and
  rebuilds the canvas page. That is fine at P17 scale and is the obvious place to
  measure before P19 adds autosave.
