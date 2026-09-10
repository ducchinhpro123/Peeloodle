# Milestone 0 handoff — risky contracts proven

Date: 2026-09-10. Scope: P01–P07 completed with evidence; P08 blocked.

## What changed

All additions are additive; no sticker behavior or saved sticker data changed.

| Area | Files |
| --- | --- |
| Presentation model + fixture | `src/features/presentations/model/{types,geometry}.ts`, `model/fixtures/{fixture,png,stress}.ts` |
| Text layout + DOM bridge + Konva text | `src/features/presentations/rendering/{textLayout,fonts,konvaText}.ts`, `editor/textBridge.ts`, `rendering/presentation-fonts.css` |
| Exports | `src/features/presentations/exports/{pdf,backup}.ts` |
| Node processing | `server/processing/{limits,errors,raster,svg,index}.ts` |
| Shared byte helpers | `src/lib/imageFormat.ts` (also used by `validateUpload.ts`) |
| Proofs / evidence | `proofs/**`, `e2e/proofs/{text-bridge,pdf-backup}.spec.ts` |
| Build/tooling | `tsconfig.server.json`, Node ESLint override, Vite watch/optimizeDeps, `pdf-lib`, `fflate`, `pptxgenjs`, `sharp`, `@resvg/resvg-js`, `fast-xml-parser` deps |
| Docs | `docs/assets-provenance.md` (font provenance), plan checkboxes P01–P07 |

## Verification (exact commands)

```bash
npm run typecheck   # PASS (app + node + server projects)
npm run lint        # PASS — 0 errors, 4 pre-existing react-refresh warnings
npm test            # PASS — 22 files, 238 tests
npm run build       # PASS — bundle unchanged in size; no server/native deps in browser output
npx playwright test e2e/editor.spec.ts e2e/tool-entry.spec.ts e2e/proofs --workers=2   # PASS
python3 -m http.server  # not used
```

Evidence artifacts: `proofs/baseline.md`, `p05-fonts.md`, `p06-pdf-backup.md`,
`p07-processing.md`, `p08-deployment-blocked.md`, and `proofs/out/*`
(PPTX/PDF/ZIP/PNG renders, benchmark and proof reports).

## Proven contracts

1. **Editable PPTX** (PptxGenJS 4.0.1): native text runs, mixed bold/italic,
   bullets, numbered lists with explicit start values, external hyperlink,
   native shapes and separately stored images; 1280×720 → 13⅓×7.5 in.
   Opened and rendered in LibreOffice 26.8.0.3.
2. **Rich text** (P04): shared layout and DOM line boxes agree within 0.1 px on
   the fixture; Konva widths match exactly; Vietnamese IME composition and
   paste normalization verified in Chromium.
3. **Fonts** (P05): Be Vietnam Pro + Spectral, static regular/bold/italic,
   full Vietnamese coverage, upstream hashes verified, OFL licenses bundled.
4. **PDF/backup** (P06): real 2-page 960×540 pt PDF from rendered slides;
   bounded backup ZIP verified independently (2/2 SHA-256 matches).
5. **Processing** (P07): PNG/WebP normalization, header-level bomb and animation
   rejection, 13 hostile SVG vectors rejected, measured CPU/RSS.

## Known limitations / blocked

- **P08 blocked**: no authorized preview deployment or credentials; endpoint and
  Storage integration are Milestone 4/5 work. Do not advertise catalog uploads
  yet.
- PPTX fonts are referenced by name; a viewer without the fonts substitutes.
  PowerPoint desktop, Keynote and Google Slides were unavailable for testing.
- PDF is image-based by contract; text is not selectable.
- Pre-existing browser failures at ≥1440 px (overflow checks in
  `ui-polish.spec.ts` and one `fonts-stickers.spec.ts` case) reproduce without
  any presentation changes and are recorded in `proofs/baseline.md`.
- Sticker fonts remain Latin-only; only presentation text may use the new faces.

## Next

Milestone 1 continued: IndexedDB adapter (P13–P14), then the first editor
route (P15–P16). The foundation below is complete and tested.

# Milestone 1 foundation (P09–P12)

Added after the Milestone 0 proofs; no user-facing route yet.

| Task | Deliverable | Tests |
| --- | --- | --- |
| P09 | `model/factories.ts`: blank document/slide/text/shape/image factories, `DEFAULT_THEME`, `clonePresentationDocumentWithNewIds`, `nextSlideName` | `factories.test.ts` (4) |
| P10 | `model/limits.ts` + `model/parse.ts`: versioned parser/serializer and non-throwing `validatePresentationDocument`; rejects versions, duplicate IDs, non-finite geometry, bad runs/colors, unsafe links (`model/links.ts`), missing asset refs and oversized input | `parse.test.ts` (11) |
| P11 | `editor/store.ts`: Zustand command store, view state, revision-bumping commands, grouped/bounded undo-redo (50 entries + byte ceiling) | `store.test.ts` (11) |
| P12 | `lib/persistence/presentations/repository.ts`: `PresentationRepository` contract + memory adapter with atomic save, media completeness, base-revision conflicts, independent duplicate, delete | `repository.test.ts` (9) |

Verification: `npm run typecheck`, `npm run lint` (0 errors),
`npm test` (273 tests), `npm run build` — all pass. Presentation text uses
`model/links.ts` for link policy, shared by the DOM bridge.

Known follow-ups for P13+: the IndexedDB adapter is additive over
`stickerlab-local` v4 (stores will be added at v5), and P14 adds atomic media
writes plus tab conflict handling on top of the memory adapter's checks.
