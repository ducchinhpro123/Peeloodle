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
- **Review-driven hardening landed on top of P19** (details and the review
  findings in `proofs/p18-p19-image-and-save.md`): image insertion is now atomic
  (document + bytes in one repository transaction, adopt then decode, nothing
  partial on failure); the 200 MB media budget is enforced before mutation and
  charged once per unique asset; a revision conflict has a real recovery path
  ("Keep my copy" writes an independent copy, then reopens the newer revision);
  and leaving the editor flushes text and awaits the write. Leaving is guarded on
  the header Back link and every shell link (`editor/leaveGuard.ts` +
  `GuardedLink`). **The browser Back/Forward buttons and programmatic
  `navigate()` calls remain unguarded** because the app renders a plain
  `BrowserRouter`; closing that means a data-router migration, not a patch.

## Start here: P21, which closes Milestone 1

**P20 — presentation library operations — is done** (`f56695b` plus the thumbnails commit): rename,
duplicate and safe delete (shared dialog, safe action focused first, focus restored to a surviving
control), real first-slide thumbnails rendered through the same `renderSlide` the editor uses, cached by
`documentId:revision` and lazily drawn two at a time. Evidence, including what was *not* measured, is in
`proofs/p20-library-operations.md`.

**P21 — milestone browser journey** (acceptance: composition and media survive
reload at desktop and tablet widths; inspect persisted output):

- Extend `e2e/presentations-image.spec.ts`, which already proves
  insert → paint → IndexedDB → reload → reopen for a single image, into the full
  create → edit → save → reload → reopen journey at 1440×900 and 1024×768,
  including the library operations landing in the same journey.
- This is the check that closes Milestone 1. Regenerate the committed P15–P17
  captures when the presentation UI changes (they are current as of the P20
  commit) and never commit a capture that raced a loading state.

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
| Image insertion | `editor/insertImageAsset.ts` (`preparePresentationImage`), then `usePresentationSave.persistInsert` (check → plan → persist document + bytes → adopt → decode). `store.insertImage` is the local-only command and is **not** the UI path. Caps and the 200 MB budget live in `model/limits.ts` + `store.checkImageInsert`; held bytes live in `store.pendingMedia` and reach a repository only via `store.mediaForSave()` |
| Saving | `editor/usePresentationSave.ts` (750 ms autosave + explicit Save, plus `saveBeforeLeave` and `keepMineAsCopy`); `baseRevision` is read inside the serialized task, and media is cleared using the ids from the persisted snapshot |
| Leaving the editor | `editor/leaveGuard.ts`, consumed by `GuardedLink` in `src/main.tsx`; browser Back/Forward and `navigate()` stay unguarded while the app uses a plain `BrowserRouter` |
| Revision rules | `lib/persistence/presentations/revision.ts` (`assertRevisionWritable`) — both adapters must call it; never re-implement the checks in one adapter only |
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
  `view.editingElementId` is view state. `TextEditOverlay` registers its own
  flush via `registerActiveTextEditFlush` so a save includes on-screen text —
  keep that registration when touching the overlay, or saves silently stop
  flushing.
- The P15/P16 browser spec writes its captures into `proofs/out/`; keep that
  evidence current when the presentation UI changes.
- Presentation text uses Be Vietnam Pro / Spectral only (Vietnamese coverage);
  the sticker fonts are Latin-only and must not be used for presentation text.
- `docs/editor-library-research.md` is committed owner work (part of `c136845`).
- Keep `proofs/` evidence current; update the plan checkboxes when a task's
  acceptance check really passes.

## Verification

```bash
npm run typecheck && npm run lint && npm test && npm run build
npx playwright test e2e/proofs --workers=1            # P04/P06 proofs
npx playwright test e2e/presentations.spec.ts --workers=1
npx playwright test e2e/presentations-image.spec.ts e2e/presentations-save-guard.spec.ts e2e/presentations-shell-guard.spec.ts --reporter=line   # insert/save/leave evidence
npx playwright test e2e/editor.spec.ts --workers=1    # sticker regression
npx vite-node proofs/pptx/generateStress.ts           # only when export code changes
```

Known pre-existing failures (do not "fix" as part of presentation work):
`e2e/ui-polish.spec.ts` overflow checks at ≥1440 px, one
`e2e/fonts-stickers.spec.ts` 1440 px case, and
`e2e/foundation.spec.ts` "Dashboard composition at 1440x900" (horizontal
overflow) — recorded in `proofs/baseline.md`. The foundation failure was
re-confirmed as unrelated to the editor work by reproducing it with a pristine
`src/main.tsx`.
