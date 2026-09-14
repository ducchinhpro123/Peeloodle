# Implementation proofs

Temporary evidence artifacts for the presentation milestone plan
([`docs/slides-implementation-plan.md`](../docs/slides-implementation-plan.md)).

Everything in this directory is developer evidence, not user-facing functionality:

- `baseline.md` — P01: recorded repository scripts, routes and regression baseline.
- `p15-p16-basic-presentations.md` — P15/P16: local list/create/reopen routes,
  fixed slide rendering, responsive inspection, and view-only transform evidence.
- `p17-text-editing.md` — P17: insert/select/edit text through the proven DOM
  bridge, IME and paste handling, one undo entry per session, and the
  save/reopen round trip through the repository contract.
- `p18-p19-image-and-save.md` — P18/P19: personal image insertion, truthful
  autosave/Save, conflict recovery, and the guarded editor exit.
- `p20-library-operations.md` — P20: library rename, duplicate, safe delete and
  real first-slide thumbnails.
- `p21-milestone-journey.md` — P21: the full create → edit → save → reload →
  reopen browser journey with text and media.
- `p22-p23-slide-rail.md` — P22/P23: slide rail add/duplicate/reorder/delete,
  fresh duplicate IDs, persisted order, and the adjacent-survivor delete.
- `p24-element-transforms.md` — P24: element move/resize/rotate in document
  coordinates, with the frame, handles and numeric inspector agreeing.
- `p25-history-and-retention.md` — P25: toolbar/keyboard undo and redo, gesture
  grouping, and bounded held-media retention across history.
- `p26-text-formatting.md` — P26: selection bold/italic, font family, size and
  color through the bridge, surviving undo and reopen.
- `p27-paragraphs-links-overflow.md` — P27: paragraph alignment/bullets/line
  spacing, safe links, and actionable text-overflow feedback.
- `p28-shapes.md` — P28: rectangle, rounded rectangle, ellipse, line and arrow
  insertion with fill/stroke controls.
- `p29-image-adjust.md` — P29: non-destructive crop, flip and atomic photo
  replacement that preserves placement.
- `p30-layer-list.md` — P30: keyboard-accessible element list with order,
  duplicate, delete, visibility and lock controls.
- `p31-alignment-guides.md` — P31: snapping during move, view-only guide lines
  and explicit align-to-slide controls.
- `p32-backgrounds-theme.md` — P32: per-slide background and document theme
  defaults that do not restyle existing elements.
- `p33-sticker-snapshots.md` — P33: saved stickers composed once and placed as
  immutable presentation image assets.
- `p34-milestone2-verification.md` — P34: focused milestone verification, with
  the desktop/tablet browser journey explicitly deferred.
- `p35-export-snapshot.md` — P35: one synchronous capture plus preflight for
  edits, fonts, media and warnings.
- `p36-fixed-page-rasterizer.md` — P36: `rasterizeSlidePage`, the detached-stage
  renderer shared by thumbnails and PDF.
- `p37-pdf-export.md` — P37: ordered image-based PDF with progress and
  cancellation, and the documented PDF limitation.
- `p38-p39-pptx-export.md` — P38/P39: editable PPTX text, shapes and
  cropped/flipped/rotated images, asserted from the generated OOXML.
- `p40-export-dialog.md` — P40: lazy per-format loading, progress, cancellation,
  cleanup and the save-failure backup action.
- `p41-p43-backup-restore.md` — P41–P43: versioned backup writer/parser plus the
  library restore flow and recovery guidance.
- `p44-p45-readers-and-limits.md` — P44/P45: a LibreOffice UNO round trip over the
  exported PPTX (text edit, picture move, save, close, reopen and render the saved
  file), reader-versus-app raster agreement for a cropped/flipped/rotated picture,
  the multi-run paragraph export defect found by that pass and fixed, the measured
  large-document and network-disabled bounds, and the production-build offline run
  (`playwright.preview.config.ts` + `e2e/presentations-production-offline.spec.ts`:
  eight font faces fetched and loaded before readiness, first-use PDF/PPTX/backup
  exports after the disconnect, and a real aborted builder fetch). Both plan rows stay
  unchecked: no reader window screenshot exists and the 200 MiB media budget is
  unmeasured (an 18.85 MB byte-scale probe is 9.0% of it).
- `readers/libreoffice_roundtrip.py` — the P44 reader script (headless LibreOffice
  through UNO). Writes `out/p44-reader-report.json`, the round-trip PPTX and the
  reader-rendered PNGs; see the proof document for what it does and does not prove.
- `out/` — generated proof outputs (PPTX, PDF, PNG renders, reports) referenced from task evidence.
- Proof support modules live next to the code they exercise (for example
  `src/features/presentations/model/fixtures/`) so the same fixture is reused by tests and proofs.

Generated files are small and committed alongside the evidence so a reviewer can inspect them.
