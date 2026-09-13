# Handoff — presentation work

Updated 2026-09-13. Full scope: [`docs/slides-implementation-plan.md`](docs/slides-implementation-plan.md);
contracts: [`docs/slides-architecture.md`](docs/slides-architecture.md).

## Where the work stands

- **Milestone 0 (P01–P07) complete** — proofs and artifacts in `proofs/`
  (PPTX, PDF, backup ZIP, fonts, processing benchmark).
- **P08 blocked** — no authorized preview deployment. A unit-tested harness is
  ready at `server/processing/probe.ts`; see `proofs/p08-deployment-blocked.md`.
  Do not add catalog/admin ingestion before preview evidence exists.
- **Milestone 1 is complete (P01–P21)** — model, parser, command store, repository
  contract (memory + IndexedDB at schema v5), local library/blank creation/editor
  routes, fixed 16:9 rendering, basic wrapped text editing, personal image
  insertion, truthful save/autosave, library rename/duplicate/safe delete with real
  first-slide thumbnails, and the milestone journey verified at desktop and tablet
  widths with the persisted output inspected. Evidence:
  `proofs/p15-p16-basic-presentations.md`, `proofs/p17-text-editing.md`,
  `proofs/p18-p19-image-and-save.md`, `proofs/p20-library-operations.md`,
  `proofs/p21-milestone-journey.md`.
- **Milestone 2 is implemented through P33; P34 is partially verified.** Slide
  rail, element transforms, undo/redo with bounded media retention, text
  formatting, paragraphs/links/overflow, shapes, image flip/crop/replace, the
  layer list, snapping alignment guides, slide backgrounds/theme defaults and
  sticker snapshots are all in. Evidence:
  `proofs/p22-p23-slide-rail.md` through `proofs/p33-sticker-snapshots.md`.
  P34's focused checks pass (549 tests); its desktop/tablet Playwright journey
  was **not** re-run at the owner's request, so the plan row stays unticked
  (`proofs/p34-milestone2-verification.md`).
- **Milestone 3 is implemented through P43.** One synchronous export capture
  (`exports/snapshot.ts`) preflights edits, fonts and media and never mixes
  revisions; `rendering/rasterizeSlide.ts` is the fixed-page renderer shared by
  thumbnails and PDF; `exports/pdf.ts` writes ordered 960×540pt pages with
  progress and cancellation; `exports/pptx.ts` writes editable text, shapes and
  cropped/flipped/rotated images; `editor/usePresentationExport.ts` +
  `ExportDialog` load builders lazily and never download partial files; and the
  library restores `.stickerlab.zip` backups as new decks while a failed save
  offers "Download backup". Evidence:
  `proofs/p35-export-snapshot.md` … `proofs/p41-p43-backup-restore.md`.
- Latest full checks: `npm run typecheck` clean, `npm run lint` 0 errors
  (5 pre-existing-category warnings), `npm test` ~580 tests across 45 files,
  `npm run build` OK.
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

## Start here: P44/P45 verification, then Milestone 4 (P46 — catalog schema)

**P35–P43 are done** (see the proofs listed above). The export builders and
backup flow are covered by focused tests that assemble and inspect real PDF
pages and the generated OOXML package.

**P44 — verify the export compatibility fixture across available readers.** Open
a generated `.pptx` and `.pdf` in an available app (PowerPoint, LibreOffice
Impress, Google Slides), edit a text run and move a picture, save, and record
app/version/OS plus screenshots. Report untested apps honestly. The P38/P39
proof records exactly what was and was not verified.

**P45 — large-document limits and network-disabled local editing/export** follows
the P44 pass. Neither was run; both need a browser/reader session.

**Milestone 4 starts at P46 — catalog collection/item/version, template/version,
job and event schema migrations** (depends P08, P10). P08 is still blocked on an
authorized preview deployment, so do not start catalog ingestion code before
that evidence exists.

**Owner preference:** do not run Playwright repeatedly; it is slow. Use focused
jsdom/Vitest tests and run a browser spec only for a task's one critical journey.

**P21 note, kept for the next increment:** run browser specs from a clean worktree when another writer is
editing the shared checkout, and stop any dev server on 4173 first — `reuseExistingServer: true` will
otherwise serve the shared tree through HMR module URLs.

## Interfaces to build on

| Need | Use |
| --- | --- |
| Document contract | `src/features/presentations/model/types.ts` |
| Create/clone | `model/factories.ts` (`createPresentationDocument`, `clonePresentationDocumentWithNewIds`) |
| Validate on every boundary | `model/parse.ts` (`serializePresentationDocument`, `validatePresentationDocument`) |
| Mutations + undo | `editor/store.ts` (`usePresentationStore`; view state never dirties). History is whole-document snapshots; one completed gesture = one entry via `historyGroup`. `reconcileHeldMedia` keeps `pendingMedia` only while the current document or a history snapshot references it, and trims the oldest snapshot first when over `mediaRetentionBytes` |
| Undo/redo controls | Toolbar buttons in `editor/PresentationEditorPage.tsx` and `editor/usePresentationShortcuts.ts` (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y); both call the same store commands and are ignored inside fields/sliders/dialogs |
| Persistence | `lib/persistence/presentations/repository.ts` (memory) and `.../idb.ts` |
| Text | `rendering/textLayout.ts` + `editor/textBridge.ts` + `rendering/fonts.ts` (`ensurePresentationFonts()` before measuring) |
| Text editing | `editor/TextEditOverlay.tsx` + `editor/textEditSession.ts`; commits go through `store.updateText` with `textHistoryGroup`, one entry per session |
| Text formatting | `editor/textFormat.ts` (`applyRunStyleToSelection` wraps the bridge's `data-*` attributes; `readSelectionStyle` for active states) + `editor/TextFormatToolbar.tsx`, connected by the `registerActiveTextEditFormat` controller seam. Paragraphs, bullets and links use the same module; overflow feedback is `editor/TextOverflowNotice.tsx` + `editor/textMeasure.ts` |
| Shapes | `editor/shapeTools.ts` (insert presets) + `editor/ShapeStyleInspector.tsx`; `renderShape` already draws every `ShapeKind` |
| Image adjust | `editor/ImageAdjustInspector.tsx`; `coverCrop`/`imageReplaceRefusal`/`planImageReplacement` in `store.ts` and `persistReplace` in `usePresentationSave.ts` |
| Layer list | `editor/ElementLayerList.tsx` + `store.duplicateElement`; mounted in the slide rail |
| Alignment guides | `editor/alignmentGuides.ts` (pure snap/align) + `view.guides` in `store.ts` + `editor/PresentationCanvas.tsx`; explicit controls in `ElementGeometryInspector.tsx` |
| Backgrounds/theme | `editor/ThemeControls.tsx` + the slide-background control in `PresentationEditorPage.tsx`; `store.setSlideBackground`/`setTheme` take a history group |
| Sticker snapshots | `editor/insertStickerSnapshot.ts` (composes through `exports/renderDocument`) + `editor/StickerPickerDialog.tsx`; inserted through the shared `runImageWrite` path |
| Image insertion | `editor/insertImageAsset.ts` (`preparePresentationImage`), then `usePresentationSave.persistInsert` (check → plan → persist document + bytes → adopt → decode). `store.insertImage` is the local-only command and is **not** the UI path. Caps and the 200 MB budget live in `model/limits.ts` + `store.checkImageInsert`; held bytes live in `store.pendingMedia` and reach a repository only via `store.mediaForSave()` |
| Saving | `editor/usePresentationSave.ts` (750 ms autosave + explicit Save, plus `saveBeforeLeave` and `keepMineAsCopy`); `baseRevision` is read inside the serialized task, and media is cleared using the ids from the persisted snapshot |
| Leaving the editor | `editor/leaveGuard.ts`, consumed by `GuardedLink` in `src/main.tsx`; browser Back/Forward and `navigate()` stay unguarded while the app uses a plain `BrowserRouter` |
| Revision rules | `lib/persistence/presentations/revision.ts` (`assertRevisionWritable`) — both adapters must call it; never re-implement the checks in one adapter only |
| Page rendering | `rendering/renderSlide.ts` + `editor/PresentationCanvas.tsx`; stage transforms are view-only |
| Canvas view controls | `editor/PresentationCanvasControls.tsx` + `editor/viewGeometry.ts` (shared 0.25–4 clamp) |
| Current routes | `library/PresentationsPage.tsx` and `editor/PresentationEditorPage.tsx` |
| Exports | `exports/snapshot.ts` (synchronous capture + preflight), `rendering/rasterizeSlide.ts` (shared fixed-page raster), `exports/pdf.ts` / `exports/pptx.ts` / `exports/backup.ts` (builders), `editor/usePresentationExport.ts` + `editor/ExportDialog.tsx` (lazy loading, progress, cancel, cleanup); restore lives in `library/restoreBackup.ts` |

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
one `e2e/fonts-stickers.spec.ts` 1440 px case and
`e2e/foundation.spec.ts` "Dashboard composition at 1440x900" (horizontal
overflow) — recorded in `proofs/baseline.md`. The foundation failure was
re-confirmed as unrelated to the editor work by reproducing it with a pristine
`src/main.tsx`. The `e2e/ui-polish.spec.ts` wide-width overflow checks that used
to appear in this list are fixed: the overflow came from the shell header and is
resolved by `.header { overflow-x: clip }` (see `docs/ui-audit.md`, packs library
redesign).
