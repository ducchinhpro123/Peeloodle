# P37 — ordered PDF generation

**Date:** 2026-09-13
**Plan row:** P37.
**Acceptance:** 16:9 page sizes and expected page count; visual content intact; image-based PDF limitation documented.
**Scope:** `exports/pdf.ts` gains `buildPresentationPdf` with progress/cancellation; `exports/pdf.test.ts`.
No dependency change (pdf-lib already present from the P06 proof).

## What was built

- `buildPresentationPdf(snapshot, rasterize?, { signal, onProgress })` rasterizes every slide in document
  order through the P36 renderer at 1920×1080 and packages them with the existing `buildRasterPdf`
  (960×540pt pages, one embedded PNG each). Slides are rendered one at a time on purpose: parallel
  1920×1080 canvases would spike memory for no gain.
- Cancellation is checked between slides and throws `PresentationExportCancelledError`, so the controller
  can stop without producing a partial file.
- The image-based limitation is stated in the module header (no PDF text selection or hyperlinks; PPTX is
  the editable path) and in the export dialog copy.

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| Page count and size | `pdf.test.ts`: a 3-slide snapshot produces 3 pages at 960×540pt; the low-level builder tests already assert exact 16:9 sizes and distinct embedded images. |
| Order | The injected rasterizer records slide ids and the test asserts `slide-0, slide-1, slide-2`. |
| No partial file | A rasterizer that throws rejects the build; an empty document reports `no_pages` instead of writing a zero-page file. |
| Limitation documented | Module header and dialog description. |

## Checks run

`npx vitest run exports/pdf.test.ts` 6 passed; full suite at the end of the increment.

## Known gaps

- Real page pixels were not re-inspected in a PDF reader in this increment (deferred with P44); the raster
  path is the same `renderSlide` the browser evidence already covers.
