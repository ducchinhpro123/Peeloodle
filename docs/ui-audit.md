# UI audit and refresh

Direction: lively, vivid, engaging—an original sticker-workshop interpretation of the four supplied references, not an exact clone. Existing local documents, editing commands, persistence, and exports remain the functional foundation.

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

## Boundaries

No new dependencies, cloud setup, or database migrations. Source PNGs and the source ZIP are preserved. The UI refresh uses nine optimized WebP derivatives for decoration; the editor catalog now offers all 25 supplied cutouts plus eight new illustrated graphics for explicit insertion. Decoration does not replace editable template data or pretend to be saved user stickers. Artwork rights still need owner review before public distribution; a new layout is not legal clearance.

Firefox/WebKit and physical mobile devices were not verified. The mobile editor retains its horizontally scrollable tool rail and properties dialog. Native messenger installation and cloud sharing remain unavailable. The eight illustrations remain sticker-tray assets. Templates now contain 12 photo/caption/decoration compositions with actual generated previews. Replace photo, caption editing, undo/redo, save/reopen, and PNG export are covered at all three viewport sizes. All layouts currently reuse the licensed sample cat; photo backgrounds are not removed automatically.
