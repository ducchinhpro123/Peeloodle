# Handoff — presentation work

Updated 2026-09-11. Full scope: [`docs/slides-implementation-plan.md`](docs/slides-implementation-plan.md);
contracts: [`docs/slides-architecture.md`](docs/slides-architecture.md).

## Where the work stands

- **Milestone 0 (P01–P07) complete** — proofs and artifacts in `proofs/`
  (PPTX, PDF, backup ZIP, fonts, processing benchmark).
- **P08 blocked** — no authorized preview deployment. A unit-tested harness is
  ready at `server/processing/probe.ts`; see `proofs/p08-deployment-blocked.md`.
  Do not add catalog/admin ingestion before preview evidence exists.
- **Milestone 1 through P17 complete** — model, parser, command store,
  repository contract (memory + IndexedDB at schema v5), local library/blank
  creation/editor routes, fixed 16:9 rendering, and basic wrapped text editing
  are implemented with tests.
- `/presentations` creates and reopens real local documents (blank documents are
  saved at creation). The editor renders the active slide, lists the document's
  slides, switches between them, and edits text boxes through the DOM bridge.
  Image insertion arrives in P18 and truthful save/autosave in P19, so edits
  currently stay in memory and the status pill reports `Unsaved changes`.
- Evidence: `proofs/p15-p16-basic-presentations.md` and
  `proofs/p17-text-editing.md` (including committed captures in `proofs/out/`)
  plus the earlier foundation and correction proofs.

## Start here: P18, then P19

**P18 — personal image insertion** (acceptance: supported upload is stored and
inserted atomically; failure leaves no broken element):

- Reuse the existing upload byte/format/dimension validation where its contract
  matches PNG, JPEG, and static WebP. Do not accept SVG or animation.
- Hash and create a document-local immutable `PresentationAsset`, then save the
  media and document together before exposing an apparently complete image.
- Extend the current media decode/dispose path; never persist object URLs.

**P19 — truthful save/autosave** (acceptance: dirty → saving → saved locally;
failed writes retain editable work):

- Add explicit Save and ~750 ms autosave after completed text/image commands.
- Flush active text/gesture/media work before save and route replacement.
- Use `savedRevision`/`baseRevision`; surface revision conflicts without silently
  overwriting another tab. Do not reuse sticker `draftSaving` wholesale.
- Extend `e2e/presentations.spec.ts` from the P17 repository-contract round trip
  into the real UI save flow (edit → save → reload → reopen).

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
