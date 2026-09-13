# P26 — mixed bold/italic selection and text style controls

**Date:** 2026-09-13
**Plan row:** P26.
**Acceptance:** run formatting survives undo/save/reopen; IME typing does not trigger canvas shortcuts.
**Scope:** new `editor/textFormat.ts` and `editor/TextFormatToolbar.tsx`, a `runStyleAtNode` helper and
`RunStyleState` export in `textBridge.ts`, the formatting-controller registry in `textEditSession.ts`,
the controller/selection handling in `TextEditOverlay.tsx`, the toolbar host in
`PresentationEditorPage.tsx`, and the `.presentation-text-toolbar` rules in `src/styles.css`. No schema
change, no new dependency, no persistence-contract change.

## What was built

| File | Change |
| --- | --- |
| `editor/textFormat.ts` | `applyRunStyleToSelection` splits the selected text nodes and wraps them in spans carrying the same `data-*` attributes `paragraphsToHtml` emits, so `readParagraphsFromDom` turns them into model runs. A collapsed caret expands to the word under it. `readSelectionStyle` reports uniform values or null for mixed. |
| `editor/textBridge.ts` | `runStyleAtNode` resolves the effective run style at a node with the same inheritance rules the reader uses; `RunStyleState` is exported. |
| `editor/textEditSession.ts` | `TextFormatController` registry (`register`/`active`/`subscribe`) so the page-level toolbar reaches the overlay's DOM field without querying it by test id. |
| `editor/TextEditOverlay.tsx` | Caches the field selection, restores it when a native control took focus, applies patches through the bridge then commits inside the existing text history group. Blur into `[data-text-toolbar]` no longer ends the session. |
| `editor/TextFormatToolbar.tsx` | Bold/Italic toggles with `aria-pressed`, font-family and font-size selects, and a color input; reads active state on `selectionchange`. |
| `PresentationEditorPage.tsx` | Renders the toolbar while a text element is being edited. |
| `src/styles.css` | `.presentation-text-toolbar` and its fields, using the shared tokens. |

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| Mixed bold/italic selection | Unit tests: selecting "Xin" in "Xin chào" and applying bold produces one bold run and one plain run; the same for italic; font/size/color apply only to the selected run; a collapsed caret formats the word. |
| Toggle off | Unit test applies bold then unbold and reads one plain run back. |
| Active state | UI test asserts the Bold button is `aria-pressed="true"` after the patch; `readSelectionStyle` reports false for a mixed paragraph. |
| Survives undo | UI test: undo restores the empty box, redo restores the bold run. |
| Survives save/reopen | UI test waits for the stored row to carry `bold: true`, reopens the editor and reads the mixed runs back; browser test does the same with bold + size 40 after a page reload, reading IndexedDB directly. |
| IME does not trigger shortcuts | The P25 shortcut handler exempts `[contenteditable="true"]`; the existing IME composition test still passes and the browser shortcut test types inside the field. |

## Checks run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npm test` | **488 passed / 37 files** (baseline 480 + 7 textFormat + 1 UI) |
| `npm run build` | `✓ built in 3.57s` |
| `npx playwright test e2e/presentations.spec.ts e2e/presentations-transform.spec.ts` | **15 passed**, including the new formatting journey |

Browser run: Chromium at `/usr/bin/chromium`, 1280×768, Vite dev server on `127.0.0.1:4173`.

## Known gaps and deliberate ceilings

- Only the two presentation families (Be Vietnam Pro, Spectral) and a fixed size list are offered; a
  size not in the list shows as its own option, but arbitrary sizes are typed only through the model.
- Formatting applies to the current selection or the word under a collapsed caret; there is no
  "format future typing" state.
- The toolbar is a page-level row, not a floating bar over the selection; on phone widths the editor is
  already a desktop-oriented view and the toolbar wraps.
- Hyperlinks, bullets and paragraph alignment are P27, not here.
- No new screenshots; evidence is unit/UI assertions plus the browser journey.
