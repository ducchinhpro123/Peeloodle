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
- `out/` — generated proof outputs (PPTX, PDF, PNG renders, reports) referenced from task evidence.
- Proof support modules live next to the code they exercise (for example
  `src/features/presentations/model/fixtures/`) so the same fixture is reused by tests and proofs.

Generated files are small and committed alongside the evidence so a reviewer can inspect them.
