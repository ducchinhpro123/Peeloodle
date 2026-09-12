# Handoff — presentation work

Updated 2026-09-11. Full scope: [`docs/slides-implementation-plan.md`](docs/slides-implementation-plan.md);
contracts: [`docs/slides-architecture.md`](docs/slides-architecture.md).

## Where the work stands

- **Milestone 0 (P01–P07) complete** — proofs and artifacts in `proofs/`
  (PPTX, PDF, backup ZIP, fonts, processing benchmark).
- **P08 blocked** — no authorized preview deployment. A unit-tested harness is
  ready at `server/processing/probe.ts`; see `proofs/p08-deployment-blocked.md`.
  Do not add catalog/admin ingestion before preview evidence exists.
- **Milestone 1 through P19 complete** — model, parser, command store,
  repository contract (memory + IndexedDB at schema v5), local library/blank
  creation/editor routes, fixed 16:9 rendering, basic wrapped text editing,
  personal image insertion, and truthful save/autosave are implemented with tests.
- `/presentations` creates and reopens real local documents (blank documents are
  saved at creation). The editor renders the active slide, lists the document's
  slides, switches between them, edits text boxes through the DOM bridge, inserts
  personal PNG/JPEG/static-WebP images, and autosaves after completed commands.
  Browser-verified end to end: an inserted image is actually painted, its bytes
  reach IndexedDB, and both it and a typed edit survive reload and reopen.
- Evidence: `proofs/p15-p16-basic-presentations.md`,
  `proofs/p17-text-editing.md` and `proofs/p18-p19-image-and-save.md` (including
  committed captures in `proofs/out/`) plus the earlier foundation and
  correction proofs.

## Start here: P20, then P21

**P20 — presentation library operations** (acceptance: duplicate independent;
delete cancels safely and restores focus; sticker projects untouched):

- Add thumbnails, rename, duplicate and safe delete in the library
  (`src/features/presentations/library/PresentationsPage.tsx`).
- Reuse the repository's `duplicatePresentation`; it already assigns new
  document/slide/element/asset IDs and copies media. Do not clone JSON by hand.
- Destructive delete uses the shared dialog system, focuses the safe action
  first, and restores focus to the opener or a surviving control afterwards.
- Guardrail: that page currently carries uncommitted, unrequested hero-artwork
  changes from another writer. Preserve them; do not fold them into P20.

**P21 — milestone browser journey** (acceptance: composition and media survive
reload at desktop and tablet widths; inspect persisted output):

- Extend `e2e/presentations-image.spec.ts`, which already proves
  insert → paint → IndexedDB → reload → reopen for a single image, into the full
  create → edit → save → reload → reopen journey at 1440×900 and 1024×768.
- This is the check that closes Milestone 1. Do not re-run the P15–P17 capture
  specs casually: they rewrite committed files in `proofs/out/`.

## Interfaces to build on

| Need | Use |
| --- | --- |
| Document contract | `src/features/presentations/model/types.ts` |
| Create/clone | `model/factories.ts` (`createPresentationDocument`, `clonePresentationDocumentWithNewIds`) |
| Validate on every boundary | `model/parse.ts` (`serializePresentationDocument`, `validatePresentationDocument`) |
| Mutations + undo | `editor/store.ts` (`usePresentationStore`; view state never dirties) |
| Persistence | `lib/persistence/presentations/repository.ts` (memory) and `.../idb.ts` |
| Text | `rendering/textLayout.ts` + `editor/textBridge.ts` + `rendering/fonts.ts` (`ensurePresentationFonts()` before measuring) |
| Text editing | `editor/TextEditOverlay.tsx` + `editor/textEditSession.ts`; commits go through `store.updateText` with `textHistoryGroup`, one entry per session |
| Image insertion | `editor/insertImageAsset.ts` (`preparePresentationImage`) + `store.insertImage`; held bytes live in `store.pendingMedia` and reach a repository only via `store.mediaForSave()` |
| Saving | `editor/usePresentationSave.ts` (750 ms autosave + explicit Save); always pass `baseRevision`, and clear media using the ids from the persisted snapshot |
| Page rendering | `rendering/renderSlide.ts` + `editor/PresentationCanvas.tsx`; stage transforms are view-only |
| Canvas view controls | `editor/PresentationCanvasControls.tsx` + `editor/viewGeometry.ts` (shared 0.25–4 clamp) |
| Current routes | `library/PresentationsPage.tsx` and `editor/PresentationEditorPage.tsx` |
| Exports (later) | `exports/pdf.ts`, `exports/backup.ts` |

## Guardrails

- Presentations are a **separate document kind**; never weaken sticker
  validation or reuse `ProjectDocument`.
- Route every document mutation through store commands; selection/zoom/pan must
  not mark the document dirty.
- IndexedDB stays **additive**: `STICKERLAB_DB_VERSION` lives in
  `src/lib/persistence/idb.ts`; adding stores is fine, rewriting sticker rows is
  not. Re-run sticker persistence tests after any version change.
- Use shared UI primitives (`src/components/ui/`) and tokens in
  `src/styles.css`; no page-local lookalikes.
- Keep canvas zoom/fit in `PresentationCanvasControls` and its limits in
  `viewGeometry.ts`; do not add a second zoom implementation or clamp.
- Text edits go through `TextEditOverlay` + `textBridge` and commit with
  `store.updateText` inside `textHistoryGroup(id)`; never persist the DOM tree.
  `view.editingElementId` is view state, and nothing may save yet (P19).
- The P15/P16 browser spec writes its captures into `proofs/out/`; keep that
  evidence current when the presentation UI changes.
- Presentation text uses Be Vietnam Pro / Spectral only (Vietnamese coverage);
  the sticker fonts are Latin-only and must not be used for presentation text.
- `docs/editor-library-research.md` is unrelated untracked work: preserve it,
  do not delete or commit it.
- Keep `proofs/` evidence current; update the plan checkboxes when a task's
  acceptance check really passes.

## Verification

```bash
npm run typecheck && npm run lint && npm test && npm run build
npx playwright test e2e/proofs --workers=1            # P04/P06 proofs
npx playwright test e2e/presentations.spec.ts --workers=1
npx playwright test e2e/editor.spec.ts --workers=1    # sticker regression
npx vite-node proofs/pptx/generateStress.ts           # only when export code changes
```

Known pre-existing failures (do not "fix" as part of presentation work):
`e2e/ui-polish.spec.ts` overflow checks at ≥1440 px and one
`e2e/fonts-stickers.spec.ts` 1440 px case — recorded in `proofs/baseline.md`.
