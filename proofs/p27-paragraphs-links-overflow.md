# P27 — bullets, alignment, links and overflow feedback

**Date:** 2026-09-13
**Plan row:** P27.
**Acceptance:** long English/Vietnamese paragraphs render correctly; unsafe links rejected; overflow is actionable.
**Scope:** `editor/textFormat.ts` (paragraph and link helpers), `editor/TextFormatToolbar.tsx` (paragraph
controls and link field), `editor/TextEditOverlay.tsx` (selection capture, paragraph re-seed, caret
restore), `editor/TextOverflowNotice.tsx` + `editor/textMeasure.ts` (new), `editor/ElementGeometryInspector.tsx`,
`editor/textBridge.ts` (empty-paragraph placeholder and link clearing), `src/styles.css`, plus the unit, UI
and browser specs. No schema change, no new dependency, no persistence-contract change.

## What was built

| File                            | Change                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editor/textFormat.ts`          | `applyParagraphStyleToSelection`/`readParagraphStyle` set and read `data-align`/`data-bullet`/`data-level` on the paragraph blocks the selection touches, including browser-created blocks without `data-p`; `caretOffsetInParagraph`/`placeCaretAtParagraphOffset` restore the caret after a re-seed. |
| `editor/TextEditOverlay.tsx`    | Paragraph commands commit then re-seed the field from the model with the caret put back; the toolbar selection is captured on key/mouse/selectionchange and restored when a control owns focus; the caret seeds inside the last paragraph.                                                             |
| `editor/TextFormatToolbar.tsx`  | Alignment buttons, bullet/number toggles, indent/outdent and a line-spacing select, plus a link field with "Add link"/"Remove link" and a visible refusal.                                                                                                                                             |
| `editor/TextOverflowNotice.tsx` | When the shared layout service reports overflow, shows the amount and a "Grow box to fit" action that sets the element height to the measured content height.                                                                                                                                          |
| `editor/textMeasure.ts`         | Offscreen canvas measurement with the same CSS font string the layout service uses; a documented estimate in jsdom.                                                                                                                                                                                    |
| `editor/textBridge.ts`          | Empty paragraphs serialize with a placeholder `<br>` (so the block has a real editing line) that the reader normalizes back to no runs; a `data-link`/anchor value now clears an inherited link, which is how removal works.                                                                           |
| `src/styles.css`                | Toolbar groups, link field and the warning notice, with `--warning-*` tokens replacing the repeated alert colors.                                                                                                                                                                                      |

## Acceptance, as verified

| Criterion                        | Evidence                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long paragraphs render correctly | The shared `textLayout` service already wraps/measures long text; the overflow notice is computed from it. Unit tests cover paragraph HTML round-trips and the empty-paragraph placeholder; UI tests use a 600-character Vietnamese/English string. |
| Unsafe links rejected            | Unit tests cover link apply/clear through the bridge; the UI test enters `javascript:alert(1)` and asserts the visible "Only http, https and mailto links can be added." message while the existing link is unchanged.                              |
| Overflow is actionable           | UI test asserts the notice text and that "Grow box to fit" increases the element height and clears the notice; browser test does the same in Chromium.                                                                                              |

## Checks run

| Command                                                                                 | Result                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run typecheck`                                                                     | clean                                                                     |
| `npm run lint`                                                                          | 0 errors, 4 pre-existing `react-refresh` warnings                         |
| `npm test`                                                                              | **495 passed / 37 files** (baseline 488 + 3 bridge + 3 UI + 1 formatting) |
| `npm run build`                                                                         | `✓ built in 2.83s`                                                        |
| `npx playwright test e2e/presentations.spec.ts --grep "paragraph formatting and links"` | **1 passed** (Chromium 1280×768, run once for this increment)             |

## Known gaps and deliberate ceilings

- The line-spacing control only offers 1 / 1.15 / 1.5 / 2; a document value outside that list shows as its
  own option but cannot be typed in the toolbar.
- Alignment/bullets apply to the paragraphs the selection touches; the toolbar reads mixed paragraph
  values as no active button.
- Links are run-level and validated by `safeLink`; there is no link preview or editing an existing URL in
  place (remove, then add).
- The overflow notice lives in the element inspector/properties dialog, not floating over the canvas.
- Per the owner's request, later increments use fast jsdom tests rather than repeated Playwright runs;
  the browser journey above was verified once for this task.
