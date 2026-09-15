# P34 — Milestone 2 verification (focused checks; browser evidence deferred)

**Date:** 2026-09-13
**Plan row:** P34 (multi-slide gestures, keyboard access, long content and delayed fonts).
**Acceptance:** focused tests and desktop/tablet browser evidence; no canvas shortcuts in dialogs/text input.
**Status: focused checks pass. The desktop/tablet browser evidence was not re-run** because the owner asked
to stop using Playwright for this milestone (it is slow). The plan row stays unticked until that journey is
run.

## Focused coverage, by acceptance area

| Area                                      | Evidence                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-slide gestures                      | `transformGeometry.test.ts` (move/resize/rotate math, zoom equivalence, clamping), `alignmentGuides.test.ts` (snap geometry), `store.test.ts` (one entry per completed gesture, undo across slides, locked elements refuse transforms).                                       |
| Keyboard access                           | Layer list UI test drives select, move up/down, duplicate, lock, hide and delete through labelled buttons; element geometry inputs and align buttons are keyboard-reachable; every toolbar control has an accessible name.                                                    |
| Long content                              | Overflow UI test lays out 600 characters, shows the measured overflow and grows the box to fit; `textLayout.test.ts` covers wrapping, justify, bullets and missing fonts.                                                                                                     |
| Delayed fonts                             | The editor awaits `ensurePresentationFonts()` before it reports ready, and export/render paths await fonts before measuring (P15/P18 behaviour, unchanged). The layout service reports unknown font ids instead of silently substituting. No new delayed-font test was added. |
| No canvas shortcuts in dialogs/text input | `presentations.test.tsx` P34 test: Ctrl+Z inside the Theme dialog and inside a dialog field never touches history; P25 covers the text field; the shortcut handler exempts fields, sliders and dialogs.                                                                       |

## Commands run

| Command             | Result                                            |
| ------------------- | ------------------------------------------------- |
| `npm run typecheck` | clean                                             |
| `npm run lint`      | 0 errors, 4 pre-existing `react-refresh` warnings |
| `npm test`          | **549 passed / 40 files**                         |
| `npm run build`     | `✓ built in 2.32s`                                |

## Browser evidence still to run (one critical journey)

When a browser run is acceptable, the smallest useful journey is:

```bash
npx playwright test e2e/presentations.spec.ts e2e/presentations-transform.spec.ts --workers=2
```

This covers the desktop 1280×768 and tablet-width editor route, the rail, text editing, undo/redo,
formatting, the image and sticker insert paths that can run without cloud credentials, and the transform
handles. The P22–P27 browser journeys were run and passed during their increments; P28–P33 were not.

## Known gaps

- No desktop/tablet Playwright pass for the P28–P33 UI (shapes, image adjust, layer list, guides, theme,
  sticker picker).
- No physical-device or Firefox/WebKit pass, and no delayed-font browser run for this milestone.
- The phone-width presentation view is a preview by design; authoring remains desktop-oriented.
