# Implementation proofs

Temporary evidence artifacts for the presentation milestone plan
([`docs/slides-implementation-plan.md`](../docs/slides-implementation-plan.md)).

Everything in this directory is developer evidence, not user-facing functionality:

- `baseline.md` — P01: recorded repository scripts, routes and regression baseline.
- `p15-p16-basic-presentations.md` — P15/P16: local list/create/reopen routes,
  fixed slide rendering, responsive inspection, and view-only transform evidence.
- `out/` — generated proof outputs (PPTX, PDF, PNG renders, reports) referenced from task evidence.
- Proof support modules live next to the code they exercise (for example
  `src/features/presentations/model/fixtures/`) so the same fixture is reused by tests and proofs.

Generated files are small and committed alongside the evidence so a reviewer can inspect them.
