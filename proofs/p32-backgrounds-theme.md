# P32 — slide backgrounds and copied document theme defaults

**Date:** 2026-09-13
**Plan row:** P32.
**Acceptance:** changes do not alter another presentation/template; existing element styles remain predictable.
**Scope:** `store.setSlideBackground`/`setTheme` history groups and theme-backed new slides, new
`editor/ThemeControls.tsx`, a Theme dialog and slide-background control in `PresentationEditorPage.tsx`,
theme-accent shape insertion, and `src/styles.css`, plus store and UI tests. No schema change, no new
dependency.

## What was built

| File                                | Change                                                                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor/store.ts`                   | `setSlideBackground` and `setTheme` accept a history group, so a color-picker drag is one undo entry; `addSlide` seeds the new slide from the document theme's background instead of the factory default. |
| `editor/ThemeControls.tsx`          | Heading/body font selects and text/accent/background color inputs; copy states plainly that they are defaults for new slides and text.                                                                    |
| `editor/PresentationEditorPage.tsx` | A Theme dialog in the header and a slide-background color input in the inspector; new shapes take the document accent.                                                                                    |

## Acceptance, as verified

| Criterion                            | Evidence                                                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slide background is per slide        | UI test changes the active slide's background, asserts the second slide is unchanged, and waits for the stored row to carry it.                                                                                            |
| Theme is a default, not a restyle    | Store test clones the existing element before a theme change and asserts it is byte-identical after; UI test does the same for the fixture title and then types into a new box that uses the new body font and text color. |
| Another presentation keeps its theme | UI test saves a second document through the repository and asserts its `bodyFontId` is still the factory default.                                                                                                          |
| One entry per editing session        | Store test groups two background changes into one entry and a later ungrouped change into a second.                                                                                                                        |

## Checks run

| Command             | Result                                            |
| ------------------- | ------------------------------------------------- |
| `npm run typecheck` | clean                                             |
| `npm run lint`      | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npm test`          | **549 passed / 40 files**                         |
| `npm run build`     | `✓ built in 2.32s`                                |

## Known gaps and deliberate ceilings

- Theme edits reach the current document only; there is no "apply to all slides" action and no theme
  import/export until templates (P65+).
- The background control is a single color, not gradients or an image background; the model only stores a
  color today.
- No Playwright run for this task (owner requested fast jsdom checks).
