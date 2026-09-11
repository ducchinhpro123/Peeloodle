# P15–P16 — basic local presentations

Verified 2026-09-11 on this Linux x86_64 workspace with headless Chromium 152.

## Implemented

- A presentation-only repository provider keeps presentation documents separate
  from sticker and cloud workspace repositories; blank documents are saved
  before the editor opens.
- `/presentations` lists real IndexedDB summaries, creates a blank document with
  an atomic save, and exposes loading, empty, write-failure, and retry states.
- `/presentations/:presentationId` loads and validates the document and every
  referenced media record before hydrating the command store. Missing document,
  missing artwork (retryable), unsupported version, and other load failures are
  distinct recoverable states; the document fetch and the media fetch are
  diagnosed separately.
- The editor renders the fixed 1280×720 page through Konva. Background, shapes,
  wrapped rich text, crop/flip image nodes, opacity, and rotation come from the
  serializable document, and the slide rail renders the document's slide list
  and switches the active slide through `selectSlide`.
- One shared control component (`PresentationCanvasControls`) owns fit, zoom in,
  and zoom out, so button, wheel, and future gesture entry points share the
  0.25–4 zoom range.
- Fit, zoom, wheel zoom, and pointer pan update only presentation view state;
  the stage owns those transforms and the renderer continues to use document
  units. Slide switching is view state too.
- A slide that cannot be drawn (for example an element whose media is not
  decoded) reports an in-editor alert instead of unmounting the application.
- The routes reuse the shared shell, buttons, cards, tokens, and responsive
  breakpoints. Phone presentation routes provide an honest desktop-authoring
  notice while retaining a readable preview, navigation, and the zoom controls.

## Acceptance evidence

`e2e/presentations.spec.ts` (4 tests) drives the app through IndexedDB and covers:

- empty library → create blank → editor → library → reopen the same ID, plus the
  zoom and fit controls;
- the stored fixture on the title slide: per-colour pixel counts prove the dark
  page, the panel shape, the white title text, the yellow accent circle, and the
  stored transparent mint PNG were all painted. The assertions were falsified
  deliberately during verification by dropping `renderText` children (test
  failed) and by dropping `renderShape` children (test failed), then restoring
  the renderer;
- switching to the second fixture slide re-renders the page (white-page pixel
  count rises above the title slide's) while the persisted JSON stays
  byte-identical across zoom, pointer pan, and slide switching;
- pointer-up releases the panning cursor state (`is-panning`);
- containment, a reachable preview, and visible zoom controls at 390×844;
- a long Vietnamese/English title in the library and editor at 1024×768.

Unit coverage in `src/features/presentations/presentations.test.tsx` adds
create/reopen, long titles, missing document, missing artwork with retry, the
unsupported-version state, write failure, view-only zoom/pan, the shared zoom
clamp, slide-rail switching, decoded-artwork release on unmount, and disposal of
media decoded by an abandoned `StrictMode` mount. `viewGeometry.test.ts` covers
the fit/zoom/pan mapping, the zero-size fallback, and the zoom clamp.

Committed visual evidence (`proofs/out/`):

- `p15-library-empty-1440x900.png`, `p15-library-1440x900.png`,
  `p15-editor-blank-1440x900.png`, `p15-editor-1440x900.png`
- `p15-library-1024x768.png`, `p15-editor-1024x768.png`
- `p15-library-390x844.png`, `p15-editor-390x844.png`
- `p16-fixture-slide1-1280x768.png`, `p16-fixture-slide2-1280x768.png`

## Checks

```text
git diff --check                                      passed
npm run typecheck                                     passed
npm run lint                                          passed, 4 existing Fast Refresh warnings
npm test                                              passed, 31 files / 341 tests
npm run build                                         passed
npx playwright test e2e/presentations.spec.ts --workers=1
                                                      passed, 4 tests
npx playwright test e2e/proofs --workers=1            passed, 2 tests
npx playwright test e2e/editor.spec.ts --workers=1    passed, 6 tests
```

The known lint warnings remain in the existing sticker repository/workspace
provider files. No presentation export code changed, so the P05 stress generator
was not rerun. `e2e/ui-polish.spec.ts` was not extended: it already fails 12
pre-existing desktop-width checks recorded in `proofs/baseline.md`, and the new
routes are covered at 1440×900, 1280×768, 1024×768, and 390×844 by this spec
instead.

## Remaining boundary

P15–P16 provide creation, reopening, a real slide list, and a read-only rendered
page. Presentation text editing (P17), personal image insertion (P18), truthful
edit autosave/manual save (P19), and library management (P20) are not yet
user-facing.

Known limitations kept for later increments:

- Opening a presentation decodes every declared asset up front and keeps the
  bitmaps for the session. `PRESENTATION_LIMITS.maxAssets` bounds the count (200)
  but there is no per-media byte cap yet; decode-on-demand is needed before P18
  adds uploads.
- The properties inspector is hidden below 1150 px without a replacement sheet;
  nothing essential is lost while the inspector is read-only.
- The editor shell is still the shared sticker editor shell, so its tool links
  leave the presentation context.
