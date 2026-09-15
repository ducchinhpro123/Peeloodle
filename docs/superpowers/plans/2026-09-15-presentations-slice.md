# Presentations slice (design slice 3) — port plan

Status: **complete as written** (2026-09-15). Increments 1–6 (model, local storage, rendering, the
library route, the `/presentations/<id>` editor, its snapshot/PDF/PPTX/backup exports and every
source presentation journey) are implemented and verified; 65 browser journeys are green. The only
source item not ported is the P44 reader-fixture proof, which is source proof infrastructure, not
app behaviour — see `docs/migration-progress.md`. This completion covers slice 3 of the design only;
cloud/Supabase (slice 4) and parity hardening (slice 5) are separate work.

Authority: `docs/superpowers/specs/2026-09-14-react-to-svelte-design.md` §"Implementation slices",
item 3. Source: `../Peeloodle` (read-only) at `54eae61c`, feature root
`../Peeloodle/src/features/presentations/` (~14.6k lines including tests) plus
`../Peeloodle/src/lib/persistence/presentations/` (~640 lines) and `../Peeloodle/src/app/presentation*.ts*`.

## Why this is its own session

The slice needs new runtime dependencies the source ships for its exports (`pdf-lib`, `pptxgenjs`
and `fflate`; the source's `package.json` also declares `fast-xml-parser`, but no `src/` file
imports it, so the port does not install it), a second editor with its own canvas/geometry/save
coordinator, and the source's 1.6k-line Playwright-equivalent suite as ported journeys. It should
land in increments with the usual checkpoint discipline (test-first, checks, MCP autofixer, honest
docs), not as one overnight change.

## Source inventory (by port increment)

| Increment          | Source files (tests in parentheses)                                                                                                                                                                                                                                                                                                                                                                                                                                              | Target home (suggested)                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Model + storage | `model/{types,parse,factories,geometry,limits,links}.ts` (parse 214, factories 64, geometry 48), `lib/persistence/presentations/{repository,idb,mediaPolicy,revision}.ts` (repository 190, idb 223, mediaPolicy 49, revision 56), `app/presentationRepository*`, `app/presentationOffline.ts` (102)                                                                                                                                                                              | `src/lib/presentations/model/*`, `src/lib/presentations/persistence/*`                                                                          |
| 2. Rendering       | `rendering/{fonts,konvaText,textLayout,decodedArtwork,renderSlide,rasterizeSlide}.ts` (textLayout 181, fonts 61, decodedArtwork 85, rasterizeSlide 24), `presentation-fonts.css`                                                                                                                                                                                                                                                                                                 | `src/lib/presentations/rendering/*` (reuse `$lib/fonts`, `renderDocument` helpers where equivalent)                                             |
| 3. Library route   | `library/{PresentationsPage,PresentationThumb,presentationThumbnails,libraryActions,restoreBackup}.ts(x)` (thumbnails 318, restoreBackup 62)                                                                                                                                                                                                                                                                                                                                     | `src/lib/components/PresentationsPage.svelte`, `PresentationThumb.svelte`, `src/routes/presentations/+page.svelte`                              |
| 4. Editor          | `editor/{PresentationEditorPage,PresentationCanvas,PresentationCanvasControls,PresentationSelectionFrame}.tsx` plus `transformGeometry` (193), `viewGeometry` (39), `textMeasure`, `textBridge` (192), `textFormat` (177), `textEditSession`, `TextEditOverlay`, `TextFormatToolbar`, `TextOverflowNotice`, `ThemeControls`, `usePresentationShortcuts`, `usePresentationSave` (71) + its 910-line test, `presentationSaving.ts`, `useLeaveBlock.ts`, `usePresentationExport.ts` | `src/lib/components/presentation/*.svelte`, `src/lib/presentations/editor/*.ts`, route `src/routes/presentations/[presentationId]/+page.svelte` |
| 5. Exports         | `exports/{snapshot,backup,pdf,pptx,loaders}.ts` (snapshot 161, backup 207, pdf 68, pptx 307) + `editor/usePresentationExport.test.tsx`                                                                                                                                                                                                                                                                                                                                           | `src/lib/presentations/exports/*` with `pdf-lib`, `pptxgenjs`, `fflate` added to `package.json`                                                 |
| 6. Journeys        | `e2e/presentations*.spec.ts` (library, reader limits, save guard, shell guard, transform, image, milestone journey, production offline), `e2e/presentations.ts` helpers                                                                                                                                                                                                                                                                                                          | `e2e/presentations.spec.ts` (or a small set), plus `ui-polish` additions                                                                        |

`presentations.test.tsx` (1,628 lines) is the editor's component contract; port its cases into the
target's browser-project tests (`*.svelte.test.ts`) rather than importing React testing-library
patterns.

## Port order and seams

1. **Model + storage first**, with the source's own tests as the regression set. Keep
   `ProjectDocument` and the presentation model separate (design §"Data, editing and rendering");
   do not reuse the sticker document schema. The presentation repository is a separate IndexedDB
   surface (`src/lib/persistence/presentations/idb.ts` in the source names its stores — keep the
   source store/key conventions).
2. **Rendering** next, using direct Konva (no react-konva) and the target's existing font loading
   (`$lib/fonts`) and decode helpers where they are byte-equivalent; otherwise port the source
   functions verbatim with their tests.
3. **Library route** (**complete 2026-09-15**): the `/presentations` page with create/duplicate/rename/delete, thumbnails,
   backup restore, and the honest empty state. Follow the established props-only URL seam
   (`TemplatesPage`/`PacksPage` pattern) so the component renders without `$app` mocks.
4. **Editor route** `/presentations/<id>` (**complete 2026-09-15**): canvas + selection frame + inspector (theme, layout),
   rich-text bridge/toolbar/overlay, geometry (transform/view), shortcuts, the save coordinator
   (`presentationSaving` keeps the sticker `draftSaving` rules: flush before replacement, failed
   flush retains the draft, revision-specific `markSaved`), and the leave guard. Reuse `Modal`,
   `Slider`, `ColorField` from the component library; do not fork them.
5. **Exports** (**complete 2026-09-15**): snapshot (sticker snapshots stay immutable), backup ZIP
   (`fflate`), PDF (`pdf-lib`, 960×540 pt image pages) and PPTX (`pptxgenjs`, native text runs,
   hyperlinks, bullets, preset shapes, cropped/flipped/rotated pictures), with cancellation,
   preflight warnings and offline readiness. Exported file contents are verified, not download
   clicks (design §Verification).
6. **Journeys** (**complete 2026-09-15**): every source `e2e/presentations*.spec.ts` journey is
   ported or recorded as superseded — guards, library actions, library thumbnails, image bytes, the
   milestone journey, transforms, the responsive sweep, `presentation-text.spec.ts` (text
   insert/format, paragraph formatting + links + overflow, caret placement, autosave/reopen),
   `presentation-slides.spec.ts` (the accessible slide rail, and undo/redo through the toolbar, the
   keyboard and an open text field), the view-state journey (`presentation-view-state.spec.ts`), the
   P45 ceilings (`presentation-scale-limits.spec.ts`) and all three production-offline journeys,
   including the pre-warm-up disconnect and the failed builder fetch. The source
   `presentations-reader-limits.spec.ts` third test (dev-server offline) is superseded by the
   production-build journey; its P44 reader-fixture test is source proof infrastructure (an external
   LibreOffice round trip) and is deliberately not ported. Keep the desktop 1440×900 / tablet
   1024×768 / phone 390×844 sweep, keyboard focus and reduced motion where applicable.

## Scope exclusions kept

- Presentation templates/admin catalog, public sharing, billing, native messenger installation and
  automatic background removal stay deferred (design §"Implementation slices", final paragraph).
- Cloud persistence for presentations is **not** invented; keep them local until slice 4 decides
  what the source actually supports (design §"Supabase and compatibility").
- No live backend mutation or credentials; Supabase/cloud work belongs to slice 4 and its own
  approval step.

## Entry checklist for the session that starts this

- Read `CONTEXT.md` (boundaries, seams, verification protocol), then the design spec, then this plan.
- Take a fresh backup archive into `/home/vdc/Projects/.peeloodle-svelte-backups/`.
- Follow the Svelte MCP protocol on every touched component/module (see CONTEXT), and keep
  `README.md` + `docs/migration-progress.md` honest at each checkpoint.
- The first increment ends with: model/parse/factories/geometry/limits tests ported and green,
  `npm run check`/`lint`/`test:unit -- --run` clean, and a checkpoint entry that does **not** claim
  the presentations feature is ported yet.
