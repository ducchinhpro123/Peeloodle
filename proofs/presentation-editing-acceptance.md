# Presentation editing acceptance — text fitting, presets and built-in layouts

**Date:** 2026-09-19
**Spec:** `docs/superpowers/specs/2026-09-19-presentation-editing-design.md`
**Plan:** `docs/superpowers/plans/2026-09-19-presentation-editing.md` (Tasks 1–7)
**Baseline:** clean tree at `756499c`; feature commits `f144a93`, `4ecc4d5`, `607f3ce`, `9a775d5`,
`2870af2`, `f261e73` (+ the Task 7 commit).

## What was built

- Optional `TextElement.autoGrow?: boolean` (schema stays version 1; absent means fixed, so old
  decks and shipped/catalog templates never reflow or re-save).
- Pure fitting (`src/lib/presentations/editor/textFit.ts`): `growTextToFit` (rotated page bounds,
  capped at the slide edge), `shrinkTextToFit` (explicit, proportional, floor
  `min(12, size)`, null when unreadable), `textBoxInsidePage`.
- The store fits changed auto-growing text inside the same command transaction
  (`commit`), with two validation passes, so history, save, canvas, raster/PDF and PPTX all
  consume one stored result. `updateText` routes through `updateElement`; sizing/text patches are
  refused on locked elements; `shrinkText` is one explicit undo entry.
- Layout corrections: repeated hard newlines are preserved, and authored small text is no longer
  floored at 18 units.
- Editing DOM: styled empty runs survive (zero-width placeholder, no invented text), paragraphs
  carry the paragraph-wide max size, the field rotates with the element, and paragraphs never
  flex-shrink.
- Inspector controls: `Text sizing` (Automatic height / Fixed box), `Shrink text to fit` with the
  actionable refusal, and `Grow box to fit` capped at the slide edge with an explicit message.
- Presets: `Add heading` (56), `Add subheading` (36, muted), `Add body text` (28) — theme fonts and
  colors, 1120-wide at x=80, 8 padding, 1.3 line height, `autoGrow: true`, empty styled run.
  `Add text` remains the body alias.
- Five built-in layouts (`src/lib/presentations/templates/builtinLayouts.ts`) inserted as one
  asset-free, undoable command after the active slide; the `Image + caption` area is an ordinary
  rectangle that `Add image here` replaces with a real image at identical geometry through the
  existing persist-first atomic path (upload UI stays hidden in template mode).
- `Add layout` dialog: real rasterizer previews of the actual layout slides, focus trap, Escape and
  focus restoration via the shared `Modal`, two columns → one at ≤600px, and a labeled fallback
  when a preview cannot render (insertion still works).

## Commands and results

| Command                                                                                                                                                                                                                                                                                      | Result                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run check`                                                                                                                                                                                                                                                                              | 0 errors / 0 warnings                                                                |
| `npm run lint`                                                                                                                                                                                                                                                                               | Prettier + ESLint clean                                                              |
| `npm run build`                                                                                                                                                                                                                                                                              | exit 0                                                                               |
| `npm run test:unit -- --run`                                                                                                                                                                                                                                                                 | **87 files / 760 tests passed** (baseline was 75 tests across the three named files) |
| `npx playwright test e2e/presentation-editing.spec.ts e2e/presentation-text.spec.ts e2e/presentation-transform.spec.ts e2e/presentation-slides.spec.ts e2e/presentation-image.spec.ts e2e/presentation-exports.spec.ts e2e/presentation-offline.spec.ts e2e/presentation-responsive.spec.ts` | **28 passed**                                                                        |
| `npx playwright test` (whole suite)                                                                                                                                                                                                                                                          | **77 passed, 3 gated skips** (2.6m)                                                  |

## Visual and reader evidence

| Item                                                       | Evidence                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout cards with real slide previews                      | `proofs/out/presentation-editing-layout-cards.png` (`LAYOUT_EVIDENCE=1`)                                                                                                                                                          |
| Representative layout deck (Title + body, Image + caption) | `proofs/out/presentation-editing-layouts.pptx` (`PPTX_LAYOUT_EVIDENCE=1`)                                                                                                                                                         |
| Reader open (LibreOffice Impress headless)                 | `proofs/out/presentation-editing-layouts.pdf`: **2 pages, 960.009 × 540 pts**, native text extracted (“Slide heading / Add your main points”, “Add a caption”)                                                                    |
| Overlay containment while typing                           | `e2e/presentation-editing.spec.ts` asserts every paragraph rect stays inside the field at real canvas metrics (fit zoom), for Vietnamese multiline, blank lines, an unbroken URL/emoji, 96-unit text, rotation and a width change |

PowerPoint/Google Slides/Keynote remain untested (no accounts/install), as in P44; the OOXML
assertions above are attached separately and are not a substitute for reader proof.

## Input → observed geometry (representative)

| Input                                  | Observed                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Add heading` then type + reopen       | run size 56, theme heading font, `autoGrow: true`, identical stored element after reload               |
| Body text at width 300                 | height grows inside the same command; deleting text does not shrink it                                 |
| Fixed box, overflow, `Grow box to fit` | height grows to measured content; at the page edge the notice says the text reaches the slide edge     |
| `Shrink text to fit`                   | proportional run reduction, `autoGrow: false`, no overflow; refusal leaves the document byte-identical |
| Locked text                            | sizing patches and shrink are no-ops                                                                   |
| Two columns layout                     | 3 elements, fresh ids, original slide unchanged, 2 slides total, offline                               |
| Image area + photo                     | same id/geometry, real cover crop, undo restores the rectangle                                         |

## Notes

- The plan's example code was typechecked and adapted where the repository differed (accessible
  names, autosave settling, the modal's real focus behaviour); each deviation is visible in the
  final diffs and tests.
- `npm run test:e2e` was **not** run as a whole here; the eight affected specs were (see below).
  The full-suite run is recorded in the milestone-7 proof and re-run after this work lands.
- Known flake: `presentation-offline.spec.ts` “a builder that cannot be fetched…” fails
  intermittently under contention and passes in isolation (also recorded in the milestone-7
  proof). No product regression was found for it.
- One test-suite adjustment was required by the empty-run placeholder: `presentation-slides.spec.ts`
  strips the zero-width space before comparing the field's text with the stored document, which is
  exactly what the bridge's read-back does.

## Independent review triage (standards + spec axes)

An independent two-axis review of `756499c...HEAD` ran before this commit. Findings and outcomes:

| Finding                                                                                      | Axis                     | Outcome                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BuiltinLayoutDialog` duplicated the page size instead of the exported constants             | Standards                | **Fixed**: imports `PRESENTATION_PAGE_WIDTH/HEIGHT`.                                                                                                                                                                                                                                             |
| Dialog cards ignored `disabled`                                                              | Spec (risky)             | **Fixed**: cards are disabled with the opener.                                                                                                                                                                                                                                                   |
| `TextOverflowNotice` claimed “reaches the slide edge” for a box that already starts off-page | Spec (risky)             | **Fixed**: an off-page box gets “outside the slide” guidance and is never grown.                                                                                                                                                                                                                 |
| `rasterizeSlide.svelte.test.ts` imported the factories module twice                          | Standards                | **Fixed**.                                                                                                                                                                                                                                                                                       |
| Spec requires IME coverage; none existed                                                     | Spec (missing)           | **Fixed**: added a composition round-trip bridge test (plus the existing first-keystroke test).                                                                                                                                                                                                  |
| Reader PDF not committed                                                                     | Spec (evidence)          | **Fixed**: `proofs/out/presentation-editing-layouts.pdf` committed next to its PPTX.                                                                                                                                                                                                             |
| The 18-unit floor removal reflows legacy paragraphs authored below 18 units                  | Spec (risky, deliberate) | **Accepted and recorded**: the spec (§ Verified current implementation) calls the floor a defect; the change makes authored small text measure at its real size. Existing decks keep their stored sizes; only the rendered line height of sub-18 text changes, which is the intended correction. |
| `insertSlide` duplicates `addSlide`'s anchor/splice shape                                    | Standards (smell)        | **Accepted**: `addSlide` builds a theme-aware slide and keeps its own path; the shared refusal/plan shape already lives in `slideInsertionRefusal`/`planSlideInsertion`.                                                                                                                         |
| `insertSlide(afterSlideId)` has no production caller                                         | Standards (smell)        | **Accepted**: symmetric with the existing `addSlide(afterSlideId)` API and covered by a test.                                                                                                                                                                                                    |
| Positional geometry params in `builtinLayouts.ts`                                            | Standards (smell)        | **Accepted**: mirrors the spec's layout table directly; a type would not clarify five one-off compositions.                                                                                                                                                                                      |
| Repeated fake measurer in tests                                                              | Standards (smell)        | **Accepted**: four lines per file; extracting a test helper for it was judged not worth a new shared module.                                                                                                                                                                                     |
| The zero-width placeholder differs from the plan's `<br>` example                            | Spec (scope)             | **Accepted**: `<br>` made an untouched empty paragraph read back as a stray newline run (verified in Chromium); the placeholder keeps the run's metrics and the reader strips it.                                                                                                                |
| Element renames (`Text` → `Body text`) touched four existing e2e specs                       | Spec (scope)             | **Accepted**: the spec mandates the visible preset actions; the specs now select the real name.                                                                                                                                                                                                  |
