# P40 — lazy export loading, progress, cancellation and cleanup

**Date:** 2026-09-13
**Plan row:** P40.
**Acceptance:** failures do not download partial files; repeated export releases URLs/canvases; main editor
stays usable.
**Scope:** new `editor/usePresentationExport.ts` and `editor/ExportDialog.tsx`,
`editor/PresentationEditorPage.tsx` wiring, `exports/pdf.ts` cancellation options,
`features/exports/download.ts` revoke timing, `src/styles.css`, and the hook/UI tests.

## What was built

- The PDF, PPTX and backup builders are loaded with dynamic `import()` only when that format is chosen;
  opening the editor never loads pdf-lib, PptxGenJS or fflate's archive code.
- One controller runs one export at a time. Progress comes from the PDF rasterizer per slide; the dialog
  shows "Rendering slides… n/total", a Cancel button, preflight warnings, and an honest failure message.
- The snapshot is always disposed in `finally`; download happens only after the full byte array exists.
- `downloadBlob` now revokes the object URL on the next task so the browser can start the download first.
- Cancellation between slides throws the shared `PresentationExportCancelledError`, so the controller
  reports "cancelled" and never downloads.
- On a local save failure, the editor shows a "Download backup" action beside the failure message, so
  work can still leave the browser.

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| No partial downloads | Hook tests: a rejected build and a cancelled build both leave the download spy uncalled; dispose still runs. |
| Progress | Hook test asserts `onProgress` values flow into `completed/total`; the dialog renders them. |
| One at a time | Hook test starts two exports; only one build and one download happen. |
| Cleanup | Dispose is asserted on success, failure and cancellation. |
| Editor stays usable | The hook is page-level state; the dialog only disables its own buttons. |
| Lazy loading | Each format is a dynamic import; production build emits `renderDocument`/ppt library chunks separately (build output inspected). |
| Recovery after save failure | UI test asserts the "Download backup" button appears with the failure status. |

## Checks run

`npx vitest run editor/usePresentationExport.test.tsx` 5 passed; the export dialog UI test passes in
`presentations.test.tsx`; full suite at the end of the increment.

## Known gaps

- PPTX writing is a single call, so Cancel can only stop before it starts or after it finishes; PDF
  cancels between slides.
- No real download was triggered in a browser in this increment; jsdom tests assert the call, not a saved
  file.
