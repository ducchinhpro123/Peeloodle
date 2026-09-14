# P44/P45 — reader compatibility, large-document limits, network-disabled local work

**Date:** 2026-09-14 (a first correction pass on the same day's evidence, then a
review-driven second pass that added the production-build offline run)
**Plan rows:** P44 (reader compatibility fixture) and P45 (large-document limits and
network-disabled local editing/export). **Both rows stay unchecked:** P44's plan
row asks for app/version/OS **and screenshots**, and no screenshot of a reader
application window exists (see *Evidence gaps*); P45 depends on P44 and its media
budget is deliberately not reached.
**Result:** P44's reader checks pass against the exported files with one export
defect found and fixed; P45 has measured bounds for two document axes, a
dev-server network-disabled journey, and — since the second pass — a production-build
network-disabled journey with all eight presentation font faces verified as fetched
and loaded.

A review pass found three claims in the first version of this evidence that the
measurements did not support, plus a unit-test gap and stale plan rows. This
document was corrected and the affected browser/reader evidence regenerated; see
*Correction pass* at the end for the finding-by-finding record.

A second review of the follow-up increment (offline readiness plus the production
spec) raised five findings. One of them — “no `@font-face` rule registers Be Vietnam
Pro or Spectral” — does not hold: the rules live in
`src/features/presentations/rendering/presentation-fonts.css`, imported by
`src/main.tsx`, while `src/styles.css` and `index.html` only register the sticker UI
faces. The readiness *verification* gap behind that finding was real and is fixed.
See *Second correction pass* at the end.

## Environment

| Item | Value |
| --- | --- |
| Reader | LibreOffice 26.8.0.3 680(Build:3), **headless through its own UNO API** (no GUI window) |
| Reader scripting | `python3` 3.14.7 with the distribution's `python3-uno` |
| OS | Linux 7.2.3-arch1-3 (Omarchy/Arch), `osRelease: NAME="Omarchy"` |
| PDF tooling | poppler 26.08 (`pdfinfo`, `pdftoppm`, `pdftotext`), ImageMagick for blob measurement |
| Browser | Chromium via Playwright (`/usr/bin/chromium`), viewport 1440×900 |
| Fonts in the reader | read-only `FONTCONFIG_FILE` override pointing at `public/fonts/presentations`; no system font install, no user config touched |
| Not available | PowerPoint, Google Slides, any readable GUI session (`Xvfb`/`xdotool` absent; no window was opened on the owner's desktop) |

## Commands run

```bash
npx playwright test e2e/presentations-reader-limits.spec.ts -g "P44:" --workers=1          # fixture files
npx playwright test e2e/presentations-reader-limits.spec.ts -g "network disabled" --workers=1  # offline journey
python3 proofs/readers/libreoffice_roundtrip.py                                           # reader round trip, 25/25 checks
npx vitest run src/features/presentations/exports/pptx.test.ts                            # 8 passed
npm run typecheck && npm run lint && npm run build                                        # clean / 0 errors / built
```

The two large-deck probes (aggregate ceilings and byte-scale) were **not** rerun in
the correction pass, and neither was any full browser suite. Their reports are the
same day's original run and the numbers in *P45 — measured bounds* are unchanged;
the two `proofs/out/p45-*-report.json` files still contain the pre-correction
`coverage`/fixture-name text, which the spec and this document now supersede and
which the next probe run will rewrite.

## P44 — what the reader actually did

The browser spec exports the P02 fixture (plus the two cases P39 left unverified: a
cropped + flipped + rotated picture, and a rotated text box) through the production
Export dialog, writes `proofs/out/p44-reader-fixture.pptx` (320,143 B) and
`proofs/out/p44-reader-fixture.pdf` (128,437 B), then
`proofs/readers/libreoffice_roundtrip.py` opens the PPTX in LibreOffice, edits one
text run, moves the picture by one inch, saves a new file, closes the still-open
object, **reopens the saved file and renders that reopened document**.

**25/25 reader checks pass** (`proofs/out/p44-reader-report.json`):

| Check | Evidence |
| --- | --- |
| Slide count and 16:9 page size | 2 slides; pages 33867×19050 (1/100 mm) |
| Vietnamese/English text is native text | every expected string present; 7 text frames, not a raster |
| Bold/italic runs survive | 3 bold, 1 italic run |
| Hyperlink run | linked run arrives underlined; `https://example.edu/guide` is still in the reader's own re-saved package (`hlinkClick` + relationship) |
| Picture is one independent object | one `GraphicObjectShape` named “Sample sticker” |
| Picture box | reader (23285, 10584) 6772×6772 vs exported element box (23283, 10583) 6773×6773 (≤2 units = 0.02 mm) |
| Flip | `IsMirrored = true` |
| Rotation | reader `RotateAngle = 34800` → 1200 clockwise = the exported 12° (the two APIs use opposite sign conventions) |
| Non-destructive crop | `GraphicCrop` (677, 1354, 813, 1761) vs expected (677, 1355, 813, 1761) |
| Fonts | Spectral + Be Vietnam Pro, exactly the bundled faces |
| Text edit | `" trước khi nộp bài."` → `" sau khi chỉnh sửa trong LibreOffice."`, still present after save + reopen |
| Picture move | intended (25825, 13124); after reopen (25826, 13123) |
| Unedited picture properties survive the reader's own save | size 6772×6772 → 6771×6771; crop identical; flip identical; rotation identical |
| Unedited text and aggregate style counts after the reader's own save | every unedited expected string present; bold 3→3, italic 1→1; 2 pages before and after. Counts do not establish per-run font, size or style preservation. |
| Still editable after the round trip | same 7 text frames, 1 picture |
| Source file untouched | SHA-256 before == after; round-trip file 25,028 B |

The round-trip geometry checks are made against `p44-reader-roundtrip-*.png`, which
are rendered from the **reopened saved file**, not from the still-open object the
reader wrote from. The earlier version rendered the open object, so those PNGs said
nothing about what was on disk; that is the second correction below.

### Rendering comparison (browser evidence, not a screenshot)

Both files are rendered by the same external rasterizer, so the numbers are
comparable. Region `420x480+819+339` of page 1, bounding box of the mint artwork:

| Source | Artwork bounding box |
| --- | --- |
| LibreOffice rendering **our** PPTX | `247x256+15+97` |
| The app's own PDF raster | `246x255+16+98` |

That is agreement within one pixel for a cropped, flipped, rotated picture
(`proofs/out/p44-reader-import-1.png` vs `proofs/out/p44-app-pdf-1.png`).

The round-tripped file's picture measures `247x188+111+193`, i.e. **+96/+96 px** —
exactly the one-inch move the script applied (96 px at 96 dpi,
`rendering.roundtripGeometry.matchesIntendedMove = true`). Its visible height is 68 px
smaller only because the moved picture is clipped by the slide edge. Before
subtracting the intended move the two bounding boxes look unrelated, which is why
the comparison is recorded with the move explicit rather than as a difference
between renderers.

Because the round-trip file is written by LibreOffice's *own* PPTX exporter, its
bytes are not evidence about our export. The measured agreement above is between
**our file's import** and the app's own raster, and the intended one-inch move is
the only geometry change observed in the reopened re-save.

Page 2 was inspected in the three PNGs rather than inferred from XML: with the
paragraph fix below, the reader import (`p44-reader-import-2.png`), the reopened
round-trip render (`p44-reader-roundtrip-2.png`) and the app's own raster
(`p44-app-pdf-2.png`) all show `• Tóm tắt kết quả: …`, the indented
`• Xem hướng dẫn …` line and `1. Kết luận và đề xuất.`. The intentionally lengthened
edited run wraps onto a second line in the reopened round-trip image; this is not
an unchanged-content wrapping comparison. The reader places the level-1 bullet a few pixels further right than the app's raster;
text layout is otherwise not measured here, and the bounding-box comparison covers
only the page-1 artwork.

The retained `proofs/out/p45-media-scale-report.json` is from the earlier probe and
still contains an incorrect “1/8” description. Its measured 18,851,664 bytes are
9.0% of 200 MiB. That generated artifact has not been regenerated; correcting this
annotation does not represent a new probe run. Per-run style preservation also
remains unverified beyond the recorded aggregate counts.

### Defect found and fixed while verifying

A text paragraph with several runs that was **not** the element's last paragraph
lost its bullet glyph and indentation in the reader. The cause is in PptxGenJS
4.0.1, not in the document model: `genXmlTextBody` calls
`genXmlParagraphProperties` **once per text object**, so every run emits its own
`<a:pPr>` block, and a run whose options lack a bullet writes
`indent="0" marL="0"` + `<a:buNone/>`
(`node_modules/pptxgenjs/dist/pptxgen.es.js`, `genXmlTextBody` step 6 and
`genXmlParagraphProperties` around the bullet branch). The first attempt at this
fix put the paragraph options only on the first run; the later runs then
contradicted it, and LibreOffice applied the later `buNone` — visible in the
first-version `p44-reader-import-2.png`, where the two bulleted paragraphs rendered
without glyphs or indentation while the app's own PDF kept them. An earlier
symptom of the same serializer behaviour was an extra rendered line: a run whose
`align` differs from the run before it starts a *new* paragraph.

`paragraphRuns` in `exports/pptx.ts` now gives **every** run the paragraph's own
options (`align`, `indentLevel`, bullet/numbering with its start value) and adds
`breakLine` only to the last run of a paragraph that is not the element's last.
`exports/pptx.test.ts` gained “writes a multi-run paragraph as one paragraph with
identical options on every run”: it parses every `<a:pPr>` block of five
multi-run paragraphs (centred; bulleted level 0; numbered level 1; numbered
level 0; a consecutive numbered paragraph) and requires each block to carry
exactly the paragraph's alignment, indent and bullet/number marker — a missing
alignment, `buNone` or a restarting number fails the test. After the fix the
reader renders the same text as the app's PDF, including the `•` glyphs that were
missing; the regenerated `p44-reader-import-2.png` and
`p44-reader-roundtrip-2.png` are the visual evidence.

### Other P44 observations

* **PDF**: 2 pages, 960×540 pt, producer/creator StickerLab, not encrypted, and no
  text layer (`pdftotext` returns only form feeds) — the documented image-based PDF
  behaviour, confirmed in a real file rather than asserted.
* **Reader API limit**: LibreOffice 26.8 exposes neither a hyperlink property on the
  text portion nor a text field for this import, so the URL itself could not be read
  back through UNO. It was verified from the reader's own re-saved package instead;
  the URL assertions remain the OOXML-based P38 tests.
* **Dev-server fix (not product evidence)**: `vite.config.ts` now pre-bundles
  `pptxgenjs` alongside `pdf-lib`/`fflate`/`konva`. Before it, the first PPTX export
  triggered a Vite re-optimization and a page reload that threw away every module the
  page had loaded — which made "already-loaded local work" impossible to demonstrate
  and would also surprise a student during local development. This is a development
  server behaviour; it is **not** evidence about a production build, offline startup,
  or cold lazy imports.

## P45 — measured bounds

Fixtures are built in the page and saved through the repository, then exported
through the same dialog a student uses. Large files stay in `/tmp/stickerlab-p45`.

| Axis | Fixture | PDF | PPTX |
| --- | --- | --- | --- |
| Three aggregate ceilings reached | 50 slides, 2 000 elements (400 text, 200 image, 1 400 shape), 200 assets, 7.41 MB media, 579 KB document JSON. 40 of the 200 elements per slide and the 8 MiB document limit are **not** reached | 8 636 ms, 6 499 555 B, 50 pages at 960×540 pt, 173 ms/slide | 758 ms, 8 790 859 B, 435 package entries (50 slide XMLs, 200 media files), 15 ms/slide |
| Byte-scale probe | 8 × 1024² incompressible PNGs = 18 851 664 B media (mean 2 356 458 B) = **9.0%** of the 200 MiB media budget | 2 818 ms, 22 261 069 B, 8 pages | 1 327 ms, 18 940 282 B, media/package ratio 1.00 |

* Progress proves the sequential packaging: the PDF path reported 51 samples from
  0/50 to 50/50, monotonic. PptxGenJS builds the whole package in one pass, so the
  PPTX path announces rendering and completes; its slide/media counts are asserted
  from the package instead.
* Editor open for the 50-slide document: 1 082 ms; repository save of the 200-asset
  document: 42 ms.
* LibreOffice accepts both large decks: 50 pages and 8 pages at 960×540 pt
  (`/tmp/stickerlab-p45/{structural-max,byte-heavy}-libreoffice-import.pdf`).
* **Coverage limits:** the 200 MiB media budget is **not** measured — the byte-scale
  probe reaches 18 851 664 B, i.e. 9.0% of it — and this probe reports bytes for
  eight incompressible PNGs; it is not an upper bound for PNG/JPEG/WebP decoding or
  rasterization. Neither is the per-slide element ceiling (40/200) or the document
  JSON limit (579 KB/8 MiB) probed. No memory figure is reported: Chromium quantizes
  `performance.memory` without `--enable-precise-memory-info`, so a heap number here
  would not be evidence. The earlier idea of a 2 000-element *and* near-budget media
  document was not attempted.

## P45 — network disabled (Vite dev server, pre-increment run)

`proofs/out/p45-offline-report.json`, one browser on the **dev server** with the
network stack disabled after warming the editor, the library route and one export
builder. The dev server is not what a static host serves, so this table is retained
as the original measurement only; the production-build run is the section below.

| Step | Result |
| --- | --- |
| External-origin requests during the whole session | **none** (`externalRequests: []`) |
| Typing + autosave with no network | “Saved locally”; the text is in the reopened document |
| Artwork from IndexedDB | 18 128 painted pixels in the picture region, measured in the editor **after navigating back to the library, reopening the presentation and while still offline** (the warm pre-navigation control measured the same 18 128) |
| PPTX export with the warmed builder | 320 087 B, 2 slides, downloaded offline |
| PDF export with a **cold** builder | refused with the browser's own message (`Failed to fetch dynamically imported module: …/exports/pdf.ts`); **no file downloaded** |
| After reconnecting | warmed PPTX still exports; the cold PDF stays refused in the same page until the presentation is reopened, then exports (116 306 B, 2 pages) |

Limitations this records rather than hides:

* A route chunk or export builder that was never loaded cannot be fetched while the
  network is disabled. There is no service worker or app-shell cache, so offline
  startup is out of scope for this release; the verified claim is editing, reopening
  and exporting **already-loaded** local work.
* A failed module import is cached for the life of the page, so one offline blip can
  leave a format refusing to export until the page reloads. That run predates the
  normalized failure copy: the dialog now shows its own message (and, in an editor
  holding unwritten work, one that refuses to suggest a reload at all) instead of the
  browser's developer-facing string — measured in the production run below.
* The Vite pre-bundling fix above only removes a *dev-server* reload. It is a
development-server behaviour and is not evidence about a production build; the
production-build offline run below is the evidence for a static host.

## P45 — production build, network disabled (added in the second pass)

`npm run build` + `vite preview` (`playwright.preview.config.ts`), one worker, the
real UI only:

| Report | What it measured |
| --- | --- |
| `proofs/out/p45-production-offline-report.json` | Library → create → edit → ready → disconnect → offline edit/autosave → first-use PDF, PPTX and backup export → offline reopen |
| `proofs/out/p45-production-offline-pre-readiness-report.json` | A disconnect that lands before readiness (the idle callback is stubbed by the test): nothing is fetched, so nothing is poisoned, and a same-page reconnect still exports |
| `proofs/out/p45-production-offline-failed-fetch-report.json` | Three builder fetches held and then aborted as the browser goes offline: the dialog reports how to recover, a same-page retry cannot work, and a reload while online recovers |
| `proofs/out/p45-production-offline-{ready,reopened,pre-readiness,failed-fetch}.png` | The four UI states (ready, reopened offline artwork, pre-readiness, failed export) |

What the production run establishes:

* **All eight presentation font faces are real, fetched and loaded before readiness
  reports “Ready for offline use.”** The report records the eight `.ttf` requests
  (`fontFilesFetched`: Be Vietnam Pro regular/bold/italic/bold-italic, Spectral
  regular/bold/italic/bold-italic) and the eight `FontFace` descriptors read back from
  `document.fonts` with `status: "loaded"`, both before and after the disconnect.
  `document.fonts.check` is no longer used anywhere in this spec: it answers `true`
  from a fallback face, which is the false positive the review identified.
* **Readiness fetches exactly three builders itself.** `readinessBuilderChunks` is
  `snapshot`, `pdf` and `pptx`. `backup` is **route-loaded**: `PresentationsPage`
  statically imports `restoreBackup` → `exports/backup`, so it is fetched with the
  library chunk (`routeLoadedChunks` records all four route-time chunks). The first
  backup export still works offline, but not because readiness warmed it — the reports
  and the spec wording now say so.
* **First-use PDF, PPTX and backup exports after the disconnect** produced files that
  were inspected, not just downloaded: PDF 1 page at 960×540 pt; PPTX one slide whose
  XML contains the offline edit and one media part; backup whose `document.json`
  contains the edit and whose media part is byte-identical to the uploaded PNG.
* **Reload guidance is save-aware.** Both recovery texts are composed from the
  editor's write state: with unwritten work they require a completed local save
  (“Saved locally”) before reloading, and with a failing save they say not to reload
  or close the tab. The failed-fetch run above is the no-unsaved-work case and records
  the plain instruction.
* **Each report carries a build fingerprint** (`git rev-parse HEAD`, whether the
  working tree was dirty, and the content-hashed `dist/assets` names and sizes) and is
  written only after the test's assertions, so a failing run leaves no report.

Limitations this run keeps explicit, and does not claim otherwise:

* **No cold app startup and no offline reload.** The verified claim is a page that
  warmed while online: there is no service worker or app-shell cache, so reloading
  while offline and a first visit while offline stay unsupported. The spec still
  demonstrates the contrast by driving a deliberately unwarmed route into the router's
  error state.
* The bundle the reports name is a **dirty working tree** at revision `e215ce8` (the
  fingerprint records `workingTreeDirty: true`), not a release commit.

## Checks run for this increment

| Command | Result |
| --- | --- |
| `npx playwright test e2e/presentations-reader-limits.spec.ts -g "P44:" --workers=1` | 1 passed (4.3 s) |
| `npx playwright test e2e/presentations-reader-limits.spec.ts -g "network disabled" --workers=1` | 1 passed (7.3 s) |
| `python3 proofs/readers/libreoffice_roundtrip.py` | 25 checks passed, 0 failed |
| `npx vitest run src/features/presentations/exports/pptx.test.ts` | 8 passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 8 `react-refresh/only-export-components` warnings, all in files this increment does not touch (`src/app/repository.tsx`, `src/app/routes.tsx`, `src/features/auth/Workspace.tsx`, `src/features/presentations/editor/TextEditSessionContext.tsx`) |
| `npm run build` | built in 4.16 s |

Not run in the correction pass: the two large-deck probes, `npm test`, the
sticker/browser regression specs, and the other `e2e/presentations*.spec.ts`
journeys.

## Evidence gaps and unrun checks

* **No reader screenshot exists.** The plan row asks for app/version/OS *and*
  screenshots; the owner's machine has no display session set up for a GUI reader and
  no window was opened on their desktop. The PNGs here are rendered by the reader
  itself (LibreOffice PDF export → `pdftoppm`), which is rendering evidence, not a
  window screenshot. **P44 stays unchecked.**
* **PowerPoint and Google Slides were not exercised at all**; no universal
  compatibility claim is supported.
* **P45's media budget is unmeasured** (9.0% probed), memory is unmeasured, and the
  per-slide element and document-size limits are not probed, as recorded above.
* The two `proofs/out/p45-*-report.json` files still carry the pre-correction
  `coverage`/fixture-name text until the probes are rerun; the spec and this document
  are the corrected source.
* The reader files are single-app evidence: an independent reader (PowerPoint or
  Google Slides) is still needed before any release-compatibility statement.
* Offline is scoped to already-loaded work in a warmed page: there is no service
  worker, no cold app startup and no offline reload, and a failed module import stays
  failed for the life of the page. The production-build run exists now; the dev-server
  run above is retained only as its predecessor.

## Correction pass

The first version of this evidence was reviewed and five findings were confirmed and
corrected:

1. **The paragraph fix dropped bullets in the reader.** Confirmed against the
   installed serializer and in the committed reader render; `exports/pptx.ts` now
   puts the paragraph's options on every run, `breakLine` stays on the last run of a
   non-final paragraph only, the unit test asserts every emitted property block of
   centred/bulleted/numbered multi-run paragraphs, and the LibreOffice page-2 renders
   were regenerated and inspected.
2. **The offline report attributed a pre-reopen canvas measurement to IndexedDB
   rehydration.** The spec now measures the canvas again in the reopened editor while
   still offline and records it separately from the warm pre-navigation control.
3. **The round-trip render came from the still-open document.** The script now closes
   the object it wrote and renders the reopened saved file, and it compares the
   unedited size, crop, flip, rotation, text, run styles and page count before/after.
4. **The resource fixture wording exceeded the measurements.** The report now uses
   18 851 664 B = 9.0% of the 200 MiB budget, calls the byte probe a byte-scale probe
   rather than an upper bound, and names the three aggregate ceilings the structural
   fixture actually reaches.
5. **The plan and board still said P44/P45 were not run.** Both rows now describe the
   partial runs and remain unchecked; `tasks.html` was regenerated.

## Second correction pass

A second review of the follow-up increment (offline readiness and this production
spec) raised five findings. Four were confirmed and fixed; one did not hold.

1. **Font registration (mostly not confirmed; the verification gap was real).** The
   finding stated that no `@font-face` rule registers Be Vietnam Pro or Spectral and
   that `ensurePresentationFonts()` only calls `document.fonts.load`. Checked across
   the actual paths: `src/features/presentations/rendering/presentation-fonts.css`
   declares all eight faces and is imported by `src/main.tsx`; `src/styles.css` and
   `index.html` register only the sticker UI faces. The production run confirms the
   faces arrive: eight `.ttf` requests and eight `FontFace` entries with
   `status: "loaded"`. The real defect was the *check*: an empty `load()` result (no
   matching rule) counted as success, so readiness could publish “Ready for offline
   use.” and export against a system fallback. `ensurePresentationFonts()` now
   requires one matching, loaded face per declared descriptor, the spec reads the
   faces and the font requests instead of `document.fonts.check`, and
   `rendering/fonts.test.ts` covers the empty-match and not-loaded cases
   deterministically. The production reports were regenerated with this fix.
2. **Reload guidance could discard dirty work.** Confirmed: both recovery texts
   unconditionally told the student to reload. `offlineReadinessLabel()` and
   `exportFailureMessage()` now compose their instruction from the editor's live
   write state (`ReloadSafety`): unwritten work requires “Saved locally” before a
   reload, and a failing save says not to reload or close the tab. Covered in
   `presentationOffline.test.ts` and `usePresentationExport.test.tsx`.
3. **The backup chunk was attributed to readiness.** Confirmed and corrected: the
   library statically imports `restoreBackup` → `exports/backup`, so backup is
   route-loaded. The spec now separates `readinessBuilderChunks` (snapshot, pdf,
   pptx) from `routeLoadedChunks` (library, editor, canvas, backup) and the report
   notes say which one readiness fetched.
4. **Scratch and slow jsdom tests.** Confirmed: `src/app/scratch-offline.test.ts`
   (console-only, five seconds per source) is deleted, and the 30-second jsdom test
   that imported every real route and builder is replaced by injected-source tests
   (`presentationOffline.test.ts` with mocked sources, `offlineModules.test.ts` for
   the warm-up list, `fonts.test.ts` for the eight face requests). Real chunk and font
   verification stays in this production spec.
5. **Stale handoff and proof text.** Confirmed: `HANDOFF.md` and this document no
   longer say the offline failure message is the raw browser string or that no
   production offline run exists, and the P45 plan row now records the production
   evidence while both rows stay unchecked.

### Checks run in the second pass

| Command | Result |
| --- | --- |
| `npx vitest run src/app src/features/presentations` | 30 files, 389 tests passed |
| `npm test` | 55 files, 626 tests passed (18.1 s) |
| `npx vitest run src/app/presentationOffline.test.ts src/features/presentations/rendering/fonts.test.ts src/features/presentations/offlineModules.test.ts src/features/presentations/editor/usePresentationExport.test.tsx` | 4 files, 20 tests passed (≈0.9 s; the removed jsdom case alone budgeted 30 s) |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, the same 8 pre-existing `react-refresh` warnings |
| `npm run build` | built in 4.32 s |
| `npx playwright test -c playwright.preview.config.ts --list` | the production spec is discovered: 3 tests in 24 |
| `npx playwright test -c playwright.preview.config.ts e2e/presentations-production-offline.spec.ts --workers=1` | 3 passed (36.2 s; the first run of the same spec passed in 37.6 s, the second after scoping the font-request log to the reloaded page session) |

Not rerun in the second pass: the P44 reader script and reader spec, the two
large-deck probes, and the sticker/browser regression specs
(`e2e/ui-polish.spec.ts`, `e2e/foundation.spec.ts`, `e2e/fonts-stickers.spec.ts`,
`e2e/render-parity.spec.ts`).
