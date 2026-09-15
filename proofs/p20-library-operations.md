# P20 — library operations: rename, duplicate, safe delete, thumbnails

**Date:** 2026-09-12
**Plan row:** P20 (thumbnails, rename, duplicate and safe delete in the presentation library).
**Acceptance:** duplicate is independent; delete cancels safely and restores focus; sticker projects untouched.
**Scope:** `src/features/presentations/library/**`, the `.presentation-card*` rules in `src/styles.css`,
and the presentation browser specs. No schema change, no new dependency, no persistence-contract change.

Delivered in two slices: operations (`f56695b`) and thumbnails (this commit).

## What was built

| File                                           | Change                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library/libraryActions.ts`                    | `renamedDocument` (trim, next revision, fresh `updatedAt`, `null` when blank) and `describeLibraryFailure` (plain-language reason per failure).                                                       |
| `library/PresentationThumb.tsx`                | Lazy card thumbnail: IntersectionObserver, renders nothing until a raster exists, keeps the paper preview otherwise.                                                                                  |
| `library/presentationThumbnails.ts`            | Cache + render + release: LRU of 24 keyed by `documentId:revision`, in-flight dedupe, failures not cached, at most 2 renders at once, and a rasterizer that reuses `renderSlide` on a detached stage. |
| `library/PresentationsPage.tsx`                | Cards hold the open link plus **sibling** action buttons, the rename dialog, the destructive confirm dialog, and the thumbnail in the existing `aria-hidden` preview slot.                            |
| `src/styles.css`                               | Five lines in the `.presentation-card*` family: the thumbnail overlay, its image, and `z-index` for the `16:9 SLIDES` badge.                                                                          |
| `e2e/presentations-library-actions.spec.ts`    | 3 browser tests, every claim read back from IndexedDB.                                                                                                                                                |
| `e2e/presentations-library-thumbnails.spec.ts` | 3 browser tests: real pixels per deck, deletion removes the thumbnail, no overflow at 1024×768 or 390×844.                                                                                            |

## Acceptance, as verified

| Criterion                  | Evidence                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate is independent   | Browser test: the copy is its own stored row with a different document id **and** a different slide id, while the source row's title, revision and slide id are unchanged. The copy comes from `repository.duplicatePresentation`, not hand-cloned JSON. |
| Delete cancels safely      | Browser test: the confirmation opens with the **safe action focused**; Escape closes it, restores focus to the button that opened it, and leaves all rows in place.                                                                                      |
| Delete restores focus      | After confirming, focus lands on a surviving control (the neighbouring card's action button), not the document body. Mutation-checked: a naive `opener.focus()` restore fails this test.                                                                 |
| Sticker projects untouched | Delete removes only presentation rows; the sticker side is not touched by this code path at all.                                                                                                                                                         |
| Thumbnails                 | Real render of the deck's first slide at 480×270 (`naturalWidth > 0`), drawn 249 px wide inside the card, and two different decks produce different pixels.                                                                                              |

## Checks run

| Command                                         | Result                                                        |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `npm run typecheck`                             | clean                                                         |
| `npm run lint`                                  | 0 errors, 4 pre-existing `react-refresh` warnings             |
| `npm test`                                      | **452 passed / 35 files** (baseline 437 + 15 thumbnail tests) |
| `npm run build`                                 | `✓ built in 2.99s`                                            |
| `npx playwright test` (5 presentation specs)    | **12 passed**                                                 |
| `npx playwright test e2e/presentations.spec.ts` | **6 passed**                                                  |

Mutation checks, each restored and proven by sha256: the delete dialog's safe-action focus and the focus
restore; the thumbnail cache key dropping the revision (a bumped revision served the old pixels); and the
failure fallback removed (the rejection escaped instead of keeping the paper preview).

## Two defects found while verifying (not by the tests)

1. **Thumbnail layering.** The paper preview carries `z-index: 1`, so it painted _over_ the real render —
   half slide, half sticker art. Found by looking at the page, fixed with `z-index: 2` on the thumbnail
   overlay and `3` on the badge. Worth stating plainly: the unit tests and the pixel assertions both passed
   while the card looked wrong, because they measured the `<img>`, not the composited card.
2. **The phone-width proof could commit a loading state.** `e2e/presentations.spec.ts` screenshotted
   immediately after `goto('/presentations')` with no wait, so it once captured the lazy route's Suspense
   fallback ("Opening presentations…") as the phone-width evidence. Fixed with a deterministic wait for the
   library itself, and the capture was verified to be byte-stable afterwards.

## Layout checks

Measured in a real browser: `documentElement.scrollWidth` equals `innerWidth` at **1024×768** and
**390×844** with eight cards present, so the grid, the action row and the thumbnails are contained. At
**1440×900** the page reports 1442 px, i.e. a 2 px overflow — but it is **identical with the cards removed
(0 cards) and is not caused by any element inside the viewport**, so it belongs to the shell and matches
the ≥1440 px overflow already recorded as pre-existing in `HANDOFF.md`. It is not a P20 regression.

## Known gaps and deliberate ceilings

- **Laziness measured informally only**: with 12 decks the grid painted immediately, the first thumbnail
  appeared ~25 ms later, and 3 of 12 slots had rendered at the first poll. No frame timings, long-task
  measurements, memory readings, or large-photo decks were measured, and nothing on a throttled device.
- **Missing media** is covered in jsdom (`getMedia` rejects → `null`, paper stays, no bitmap left open) but
  not in a browser, because the repository refuses to store a document that references absent media.
  Rendering is all-or-nothing per slide: one undecodable image keeps the paper preview for that card.
- **A first slide with no visible elements keeps the paper preview by design**, since a flat page would be a
  blank card and the paper carries the deck's own title. Consequence: an empty deck is re-read
  (`getPresentation`, no decode) on every mount and never cached.
- Only the finished raster is cached (a small data URL); decoded bitmaps are closed as soon as the raster is
  drawn, so the LRU bounds tens of KB per deck rather than decoded megapixels. Asserted by close counts, not
  measured in a browser.
- Untested: reduced motion, RTL and long-locale text beyond the Vietnamese titles already covered, and
  keyboard traversal order beyond the asserted DOM order (card link → rename → duplicate → delete).

## Next

P21 — the milestone's create → edit → save → reload → reopen browser journey at desktop and tablet widths,
which closes Milestone 1.
