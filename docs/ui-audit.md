# UI audit and refresh

Direction: lively, vivid, engaging—an original sticker-workshop interpretation of the four supplied references, not an exact clone. Existing local documents, editing commands, persistence, and exports remain the functional foundation.

The Dashboard hero is a scrapbook panel: original torn cream/mint paper, polaroid frames with code-drawn daisy/field scenes, and the supplied cat cutouts (crown, Meow!, Stay Cool are part of those stickers). Feature cards add a “Make it yours!” scrap, polaroid stack, and a torn edge on Share & Export. This is assembled from HTML/CSS/SVG, not a screenshot of the mockup.

## Findings and fixes

| Observed issue | Change |
| --- | --- |
| Heroes touched the header; artwork was a single flat collage | Inset, rounded hero panels with individually positioned transparent cat stickers, paper shapes, lettering, and decorative accents. Original headlines and layouts distinguish the app from the references. |
| Section headings crowded cards; gaps and corner treatments varied | Central spacing/radius tokens, predictable section margins, wider cards, consistent tool and pack grids. |
| Dialog headings looked like body text; description CSS targeted an attribute that was never rendered | Shared title/description slot styles, readable line heights, mint-tinted surface, unified form fields and action footers. |
| Pack deletion used a browser confirmation unrelated to the other dialogs | Styled confirmation with non-destructive initial focus, focus restoration, clear preservation of stickers, and visible errors. |
| Long dialogs could scroll the close control out of reach | Separate scrollable content inside a viewport-bounded dialog; fixed 44px close control and wrapping long titles. |
| Pack details and actions disappeared below 1150px | Stack the detail panel below the pack grid instead of hiding it. |
| Editor had both application and tool sidebars, squeezing the canvas | Remove the redundant application sidebar from the editor; retain header/mobile navigation. Add tool icons and a working upload prompt on the blank canvas. |
| Generic active-tab CSS also styled the asset panel | Scope active styling to tab triggers only. |
| Template preview was a custom keyboard button containing a favorite button | Use separate native preview/favorite buttons with accessible names. |
| Canvas shortcuts remained active on dialog buttons | Exclude dialog targets from editor keyboard shortcuts so Delete/arrow keys cannot mutate the canvas behind a modal. |
| Obsolete premium promotion and disabled filter controls took up space | Replace promotion with a creative prompt, remove nonfunctional sort/style controls, retain actual category/search functionality and accurate template counts. |

## Verification

- Chromium: all four routes at **1440×900**, **1024×768**, **390×844**; desktop/tablet/mobile screenshots generated and inspected.
- Dialog coverage: creation, template preview, export, nested information notice, add stickers, deletion cancellation; keyboard trapping and focus restoration.
- Long-title/short-viewport coverage at **390×480**; close button remains visible while content scrolls.
- Existing upload → edit → save → reopen → PNG and pack ZIP journeys retained in the browser suite, including real export-pixel checks.
- Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:browser -- --workers=2`.
- Screenshot evidence is local, not committed: `/tmp/stickerlab-ui-audit/` (`before-*.png`, route/viewport screenshots, and dialog screenshots).

## Scrapbook panel follow-up

The “Find your vibe. Make it yours.” panel is on `/templates` (not Dashboard). It now uses original textured SVG paper, HTML headline strips, layered existing cat cutouts, stars, gingham tape, and handwritten notes. Styling is scoped to the Templates collage; mobile stacks the copy above the artwork.

Verified with `npm run typecheck`, targeted ESLint on changed TSX/tests, `npm run build`, and `npm run test:browser -- e2e/ui-polish.spec.ts --grep 'scrapbook hero' --workers=3` (3 passed). Chromium hero screenshots inspected at 1440×900, 1024×768, and 390×844: `/tmp/stickerlab-ui-audit/scrapbook-*.png`. Focused tests also exercise search/no-results/reset.

The catalog name expectations, missing generated previews, and preview-script lint errors noted during the concurrent banner work have now been resolved by the layered-template update.

## Packs library redesign (2026-09-12)

The pack library below the hero was rebuilt to match the same scrapbook language as the other routes: pack cards
carry real collage covers built from the pack's own saved stickers (`ProjectThumb`), the selected pack gets a
sticky detail panel with a thumbnail gallery plus per-sticker reorder/remove controls, and the control bar gains a
working pack search and a Recent/Name sort with a no-results state. Reordering, removal, ZIP export, pack
create/edit/duplicate/delete, the sharing "not available yet" state and the export-history state all remain the
real controls they were; nothing was replaced with decoration.

The design concept is stored as a reference, not served: `docs/design/my-sticker-packs-redesign-concept.png` with
the exact prompt in `docs/design/my-sticker-packs-redesign-prompt.txt` and its provenance in
`docs/assets-provenance.md`. The implemented page uses real pack/project state and locally served artwork; empty
packs say "Ready for stickers" rather than showing invented collage covers, and no counts, names or subscription
content from the reference image were reproduced.

Verified: `npm run typecheck`, `npm run lint` (zero errors, four pre-existing Fast Refresh warnings), `npm test`
(453 passed), `npm run build`, `e2e/ui-polish.spec.ts` (28 passed, covering all four routes and phone/tablet/wide
widths including empty and populated packs, dialogs and focus restoration), the pack journey in
`e2e/editor.spec.ts`, and the 14 presentation browser tests. Containment re-measured at 1440x900, 1024x768 and
390x844.

Two test updates came with it, both correcting stale expectations rather than masking regressions: the dashboard
renders five feature doodles and the committed test expected four, and the pack detail now shows the count and the
Local/Private badge separately (`1 sticker`, `Local`) instead of the old combined `1 stickers · Local`, which had
counted a single sticker as plural.

The same change fixes the **pre-existing horizontal overflow at 1440px and above** that `HANDOFF.md` listed as a
known failure: the overflow came from the shell header, not from any page, and `.header { overflow-x: clip }`
removes it. Confirmed by measurement (1440/1024/390 all report `scrollWidth === innerWidth`) and by
`e2e/ui-polish.spec.ts`, which left 16 tests passing with the wide-width checks failing at the previous commit and
now passes all 28.

### Cover fidelity pass (follow-up against the stored concept)

Comparing the first implementation with `docs/design/my-sticker-packs-redesign-concept.png` showed four
differences, all addressed: pack covers now carry the pack's name **lettered onto the cover** in the script
face (the count badge that used to sit there is gone — the reference keeps the count on the card meta row and
in the detail panel heading); the transparency checkerboard no longer shows through the cover tiles, which are
white polaroid cards like the reference; the gallery was two columns wide at 1440px and the grid minimum is now
208px so 1440px shows three, as the reference does; and the card meta row gained the package icon while the
detail panel gained a **working** close control that collapses to the placeholder instead of sitting inert.

Deliberately not matched, with reasons: the cover tiles keep their white polaroid frame, because StickerLab
stickers are photo/text artwork and frameless tiles turn text stickers into floating words (tried, looked
worse, reverted); the hero keeps its taller art-backed proportion, because it is a container-query design
(`cqw` units, `packs-paper.svg` stretched to the container) that a shorter band would squash; and the
reference's per-card kebab menu is omitted because the app has no dropdown primitive and those actions live in
the detail panel.

Tests were updated where the reference genuinely moved information rather than to silence a failure: the pack
journey now asserts the count on the card's meta row and `Stickers (1)` in the detail panel, because the count
left the cover art. Verified with `npm run typecheck`, `npm run lint` (0 errors), `npm test` (453), `npm run
build`, and `e2e/ui-polish.spec.ts` (28 passed) plus the pack journey in `e2e/editor.spec.ts`; containment
re-checked at 1440/1024/390.

## Packs scrapbook reference follow-up

The `/my-stickers` hero now follows the supplied clipboard reference with textured torn mint/cream/yellow/lavender paper, larger two-line typography, taped polaroids, overlapping cat stickers, and handwritten-style notes. Collection pills have roomier spacing. New Pack, Import Photos, and collection navigation remain real controls; mobile stacks the artwork below the copy.

Playwright captures were visually compared at a matching 1815×866 content crop (2035px browser width includes the existing sidebar). Comparison: `/tmp/stickerlab-packs-comparison/comparison.png` (reference above implementation). Responsive hero captures inspected at 1440×900, 1024×768, and 390×844: `/tmp/stickerlab-ui-audit/packs-scrapbook-*.png`. Composition is closer, not pixel-identical: the existing illustrated polaroids, font, paper edges, and sticker proportions differ.

Verified: `npm run typecheck`, `npm run lint` (zero errors, five existing Fast Refresh warnings), `npm run build`, and `npm run test:browser -- e2e/ui-polish.spec.ts --grep 'packs scrapbook|pages and shared dialogs' --workers=3` (six passed). Coverage includes all four routes, empty/populated packs, creation/deletion dialogs, focus restoration, overflow, and import navigation. No dependencies, setup, or migrations added.

## Shared header reference follow-up

The header now follows the supplied scrapbook reference: mint paper/grain, cream grid-backed logo, outlined mint mascot, torn navigation paper, mint active-page tape/underline, pink-taped search, paper notification button, and taped account chip. A shared `--header-height` token keeps the sticky sidebar and desktop editor aligned. Below 901px, primary navigation uses the existing sheet; at phone sizes, a two-row header preserves search, notifications, and account actions. Search is implemented as a shared dialog (`src/components/GlobalSearch.tsx`, `Ctrl/Cmd+K`, filtering templates and saved packs, covered at 1440/1024/390px in `e2e/ui-polish.spec.ts`); notifications still honestly explain that they are not implemented (`src/main.tsx:110`).

**Correction (2026-09-12):** this section previously said that search and notifications both "still honestly explain that they are not implemented". That was stale for search, which had already shipped. The wrong line misled a later library-research pass into recommending that search be built (`docs/library-upgrade-scan.md`, §3); it is corrected here, and the orphaned `.search kbd` CSS rule that produced the appearance of an unbuilt shortcut hint was deleted from `src/styles.css` in the same change.

Playwright reference comparison at 1672px: `/tmp/stickerlab-header-comparison/comparison.png` (reference, before, after). Header screenshots inspected at 1672, 1440, 1024, 860, 390, and 320px; all four route headers inspected at the standard desktop/tablet/mobile viewports. The layout closely matches; procedural paper grain/edges and mascot geometry remain approximations. An additional browser resize sweep from 320–1920px, including breakpoint edges, found no header overflow.

Verified: `npm run typecheck`; `npm run lint` (zero errors, five existing Fast Refresh warnings); `npm test -- src/app.test.tsx` (18 passed); `npm run test:browser -- e2e/ui-polish.spec.ts --workers=3` (17 passed); `npm run build`. Browser checks cover header control bounds/non-overlap, keyboard notices/account dialogs and focus restoration, primary navigation, mobile sheet links, active-page semantics, sidebar/editor heights, and the existing cross-page/dialog regressions. No dependencies or migrations. Signed-in cloud sessions, Firefox/WebKit, and physical touch devices were not exercised in this visual change.

## Canvas visibility follow-up

Following the owner's clarification, the checkerboard fills the entire rectangular workspace; there is no export-square boundary. The fitted initial view still considers both available dimensions and leaves room for transform handles. Moving artwork beyond the former square no longer clips its preview or download.

PNG downloads, pack ZIP images, and saved-project thumbnails use the outermost visible artwork. Bounds account for source transparency, crops/masks, text glyphs, hidden/zero-opacity layers, rotation/flips, and outlines. Transparent margins are trimmed; aspect ratio is preserved with a longest edge up to 512px or 1024px (ZIP: up to 512px). Empty/fully erased work produces a recoverable message. Existing document coordinates, original image blobs, and template-preview framing remain unchanged; no migration or dependency is required. This supersedes the earlier square-export design and its dimension expectations.

Chromium screenshots cover 1440×900, 1440×600, 1024×768, and 390×844. Evidence: `/tmp/stickerlab-sticker-fit/`. The moved corgi exports as a transparent **931×975 PNG**, byte-identical before/after zoom and after mobile save/reopen; generated images were opened and inspected. `e2e/artwork-export.spec.ts` checks alpha-tight edges, separate out-of-artboard layers, transformed cropped/masked outlines, text, opaque photos, empty/erased work, and oversized-render rejection. PNG/ZIP pixel parity remains covered. Browser verification uses a frozen local-only source snapshot to avoid unrelated concurrent cloud edits triggering Vite reloads.

Checks: 85 local Chromium browser tests; 108 unit/integration tests; typecheck; production build; lint (five existing Fast Refresh warnings, no errors). The real-cloud second-browser upload/mask/font/save/reopen/export journey also passed with the new PNG sizing. Production remains unchanged. A stale foundation test expecting a 64px tablet header was corrected to the previously approved 72px height.

## Full-width banners at wide viewports

Home, Templates, and Explore now share the full available content width, like My Stickers. Removed the shared 1400px hero cap and the redundant packs override. Headings, artwork, and supporting copy scale at wide widths instead of stretching the paper around fixed-size content; mobile overrides remain intact.

Verified: 22 UI-polish browser tests, typecheck, build, lint (zero errors; five existing warnings), and `git diff --check`. New checks compare hero edges to the padded content edges on all four routes at 3200, 1920, 1440, 1024, and 390 CSS pixels. Wide CSS viewports exercise the extra layout space exposed by zooming out; native browser 60% zoom was not directly automated. Screenshots inspected under `/tmp/stickerlab-ui-audit/full-width-*.png`. No dependencies, migrations, or production changes.

## Presentation routes follow-up

`/presentations` now exists as a real, local-first route family. The library hero reuses the scrapbook language (mint/cream paper, taped note, outlined sticker art) while the editor stays calm: one status bar, a numbered slide rail, the fixed 16:9 page, and a read-only properties inspector. All controls are the shared `Button`/`Card` primitives and existing `--space-*`, `--line`, `--mint`, `--radius*`, and `--shadow*` tokens; the only decorative additions are paper/tape elements already used elsewhere.

Responsive behaviour: below 1150 px the inspector is dropped. At phone widths the slide rail reflows into a compact horizontal strip with the same selection and slide actions above the readable preview; the inspector remains hidden, while the honest desktop-authoring notice and shared zoom/fit controls remain. There is no page-level horizontal scrolling at 390×844, 1024×768, 1280×768, or 1440×900.

Evidence: `e2e/presentations.spec.ts` (5 tests, including insert → type → blur → save → reopen for a text box) plus committed captures in `proofs/out/` (`p15-*`, `p16-*`, `p17-*`) at 1440×900, 1024×768, 390×844, and 1280×768. `e2e/ui-polish.spec.ts` was deliberately not extended: 12 of its desktop-width checks already fail in `proofs/baseline.md`, and the new routes carry their own containment, keyboard, and pixel assertions. The presentation editor still uses the shared sticker editor shell, the tablet inspector has no sheet yet, and nothing here removes the existing sticker-page limitations or the unresolved artwork-rights review.

## Presentation text editing follow-up

The presentation editor bar now carries the two text actions — “Add text” and, when a text box is selected, “Edit text” — as shared `Button` primitives with the existing icons. The bar keeps them in the same actions group as the save status and wraps them below the title at phone widths, so the actions stay reachable instead of being hidden with the inspector. Selecting a box draws a mint outline over the canvas (view-only chrome that never enters a save or export), and editing opens a dashed-outline DOM field over the box using the shared bridge and the element's own font, size, and colour, so typed text keeps the document's styling. Interacting with the canvas follows the sticker editor's blur-to-commit rule: a click or drag ends the session, while wheel zoom keeps it open and the field stays aligned with the element.

Evidence: `e2e/presentations.spec.ts` (`inserts, edits, saves, and reopens a text box without moving it`) drives real canvas hit testing, typing, wheel zoom with a mid-word caret, Escape, an empty box that stays selectable, and the save/reopen round trip; captures are committed as `proofs/out/p17-editor-editing-1280x768.png` and `proofs/out/p17-editor-reopened-1280x768.png`. Known limits: the hit region is the element box but selection is pointer-only (no keyboard path until the P30 element list), `locked` elements are still editable, text overflowing the slide edge is visible while editing and clipped after blur, and there is still no Save control — the status pill honestly reports `Unsaved changes` until P19.

## Presentation library scrapbook redesign

The `/presentations` library now matches the visual language of Templates and My Stickers more closely: a full-width layered paper hero, a generated transparent cat-presenter cutout, real HTML copy and controls, device-local feature notes, a rounded collection/search bar, richer 16:9 project cards, and a composed empty state. Title search filters actual local presentation summaries and has a recoverable no-results state. The create and reopen flows are unchanged.

The hero artwork was created with the built-in imagegen tool specifically for this route; its prompt and provenance are recorded in `docs/design/presentation-library-hero-prompt.txt` and `docs/assets-provenance.md`. It remains decorative and does not stand in for a real slide preview.

Chromium captures were inspected at 1440×900, 1024×768, and 390×844 in `proofs/out/p15-library-*.png`; a 320–1920px containment sweep also confirmed the route itself stays within the viewport. The focused presentation route suite passed (23 tests), as did the three library-focused Playwright journeys, targeted ESLint, `npm run typecheck`, and `npm run build`. Repository-wide lint remains blocked only by an untracked `.p18p19-workflow.js` script outside this visual change; the changed presentation library and browser spec pass targeted lint.

## Boundaries

No new dependencies, cloud setup, or database migrations. Source PNGs and the source ZIP are preserved. The UI refresh uses nine optimized WebP derivatives for decoration; the editor catalog now offers all 25 supplied cutouts plus eight new illustrated graphics for explicit insertion. Decoration does not replace editable template data or pretend to be saved user stickers. Artwork rights still need owner review before public distribution; a new layout is not legal clearance.

Firefox/WebKit and physical mobile devices were not verified. The mobile editor retains its horizontally scrollable tool rail and properties dialog. Native messenger installation and cloud sharing remain unavailable. The eight illustrations remain sticker-tray assets and may also appear as template decorations. Six Sep 8 photo stickers are template stand-ins and tray assets. Templates contain 12 photo/caption/decoration compositions with distinct layouts, distinct stand-in subjects, and generated previews. Replace photo, caption editing, undo/redo, save/reopen, and PNG export are covered at all three viewport sizes. Photo backgrounds are not removed automatically.
