# Handoff — presentation work

Updated 2026-09-10. Full scope: [`docs/slides-implementation-plan.md`](docs/slides-implementation-plan.md);
contracts: [`docs/slides-architecture.md`](docs/slides-architecture.md).

## Where the work stands

- **Milestone 0 (P01–P07) complete** — proofs and artifacts in `proofs/`
  (PPTX, PDF, backup ZIP, fonts, processing benchmark).
- **P08 blocked** — no authorized preview deployment. A unit-tested harness is
  ready at `server/processing/probe.ts`; see `proofs/p08-deployment-blocked.md`.
  Do not add catalog/admin ingestion before preview evidence exists.
- **Milestone 1 foundation (P09–P14) complete** — model, parser, command store,
  repository contract (memory + IndexedDB at schema v5), all with tests.
- **No user-facing presentation route exists yet.**
- Commits: `f7e84e6` (P13/P14), `fd33d9f` + `8c29638` (review corrections),
  `4977a4d` (proofs + foundation).

## Start here: P15, then P16

**P15 — list, blank creation and editor routes** (acceptance: create and reopen
from real local state; empty/long-title states usable):

1. `src/app/presentationRepository.tsx` — small context/provider handing out
   `createIdbPresentationRepository()`. Do **not** widen the sticker
   `RepositoryProvider` or mix the two document types.
2. `src/features/presentations/library/PresentationsPage.tsx` (`/presentations`)
   — list from `listPresentations()`, blank creation via
   `createPresentationDocument()` + `savePresentation(document)`, then navigate
   to `/presentations/:id`. Show real empty/error states. Leave rename/
   duplicate/delete and backup restore for P20/P43 (no dead-looking controls).
3. `src/features/presentations/editor/PresentationEditorPage.tsx`
   (`/presentations/:id`) — load document and media, `loadDocument(document,
   { saved: true })`, show the title and a recoverable missing/unsupported state.
4. Routes in `src/main.tsx`; navigation entry using existing shell components.

**P16 — fixed 16:9 slide rendering** (acceptance: view transforms never alter
stored coordinates; page bounds fixed):

- `src/features/presentations/rendering/renderSlide.ts` — render background,
  shapes, text (via `layoutTextElement` + `konvaText.ts`) and images (crop/flip)
  in slide order. Base this on the renderer already proven in
  `e2e/proofs/pdf-backup.spec.ts`.
- `src/features/presentations/editor/PresentationCanvas.tsx` — Konva stage;
  `view.zoom`/`view.pan` only, document units unchanged; fit the 1280×720 page
  into the viewport. Selection/handles come with P24.
- Extend `e2e/` with a presentations journey (create → library → reopen) that
  P21 will grow into the full save/reload check.

## Interfaces to build on

| Need | Use |
| --- | --- |
| Document contract | `src/features/presentations/model/types.ts` |
| Create/clone | `model/factories.ts` (`createPresentationDocument`, `clonePresentationDocumentWithNewIds`) |
| Validate on every boundary | `model/parse.ts` (`serializePresentationDocument`, `validatePresentationDocument`) |
| Mutations + undo | `editor/store.ts` (`usePresentationStore`; view state never dirties) |
| Persistence | `lib/persistence/presentations/repository.ts` (memory) and `.../idb.ts` |
| Text | `rendering/textLayout.ts` + `editor/textBridge.ts` + `rendering/fonts.ts` (`ensurePresentationFonts()` before measuring) |
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
npx playwright test e2e/editor.spec.ts --workers=1    # sticker regression
npx vite-node proofs/pptx/generateStress.ts           # only when export code changes
```

Known pre-existing failures (do not "fix" as part of presentation work):
`e2e/ui-polish.spec.ts` overflow checks at ≥1440 px and one
`e2e/fonts-stickers.spec.ts` 1440 px case — recorded in `proofs/baseline.md`.
