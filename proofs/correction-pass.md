# Correction pass after independent review

Date: 2026-09-10. The foundation commit `4977a4d` was reviewed against
`4edb313`; the review found 3 standards issues and 6 spec issues (one overlap).
Every finding below is reproduced as a test that failed before the fix and
passes now.

## 1. Repository could replace another presentation's media (High)

- **Defect**: `savePresentation` accepted media records for arbitrary asset IDs
  and overwrote whatever bytes were stored under that ID.
- **Fix** (`src/lib/persistence/presentations/repository.ts`): submitted media
  must correspond to an asset in the incoming document; the MIME type must match
  the document asset; existing bytes that differ are never replaced (byte
  comparison); an identical re-save stays idempotent.
- **Tests**: `repository.test.ts` — "refuses media that is not referenced…",
  "refuses to replace existing media with different bytes", "accepts an
  idempotent media re-save and rejects a MIME mismatch".

## 2. Serializer accepted documents that later JSON parsing rejected (High)

- **Defect**: the document size budget applied only to string inputs, so an
  oversized object could serialize and then fail when reloaded from IndexedDB.
- **Fix** (`src/features/presentations/model/parse.ts`): one budget
  (`PRESENTATION_LIMITS.maxDocumentChars`) is enforced for object and string
  entry points, and after validation the document is stringified to prove the
  round trip.
- **Tests**: `parse.test.ts` — "applies one size budget for object and string
  entry points", "serializes a large but accepted document into JSON that
  reloads identically".

## 3. No-op commands erased redo history (Medium)

- **Defect**: commands always bumped the revision and pushed history, so
  reordering a slide to its current position discarded redo.
- **Fix** (`src/features/presentations/editor/store.ts`): updaters return
  `false` for a no-op; the commit helper then leaves revision, dirty state and
  history untouched. Applied to slide reorder/rename/background, element
  update/reorder/remove, text, theme and toggles.
- **Tests**: `store.test.ts` — three new cases, including "does not erase redo
  history on a no-op command".

## 4. SVG bounds check was bypassable via nested `<svg>` (High, P07)

- **Defect**: any `<svg>` element overwrote the recorded root dimensions, so a
  100000×100000 root containing a nested 100×100 SVG passed inspection.
- **Fix** (`server/processing/svg.ts`): only the depth-1 root defines recorded
  width/height/viewBox.
- **Tests**: "rejects nested SVG that would shrink the recorded root bounds",
  "allows an ordinary nested SVG inside bounded root dimensions".

## 5. Raster derivatives reported source dimensions (Medium, P07)

- **Defect**: a 5000×10 input produced a 4096×8 derivative but reported
  5000×10, which would corrupt catalog placement metadata.
- **Fix** (`server/processing/raster.ts`): the derivative's real dimensions come
  from the encoder output (`info.width/height`); source dimensions are kept as
  `sourceWidth/sourceHeight`.
- **Tests**: "returns the actual derivative dimensions for a downscaled source".

## 6. Backup validation was incomplete (Medium, P06)

- **Defects**: arbitrary bytes were accepted as PNG media; removing
  `document.json` from the manifest skipped checksum verification; unreferenced
  archive entries were ignored.
- **Fix** (`src/features/presentations/exports/backup.ts`): the manifest must
  describe `document.json` exactly once; every extracted entry must be covered
  by the manifest; media must correspond to a document asset, match its declared
  MIME type, carry valid magic bytes, and (for PNG/WebP) match the declared
  dimensions. New codes: `unexpected_entry`, `invalid_media`.
- **Tests**: `backup.test.ts` — five new cases including recomputed-checksum
  tampering and dimension mismatches. The P06 browser proof now parses the
  fixture archive with the real document parser.

## 7. Paste lost adjacent formatting; bullets disagreed with layout (Medium, P04)

- **Defects**: inline top-level elements (`<b>bold</b> <i>italic</i>` without a
  block wrapper) lost their own styling because the reader never applied the
  element's style; generated bullet HTML carried no indentation, so a level-2
  bullet sat at 18 px in the DOM while layout placed it at 90 px.
- **Fix** (`src/features/presentations/editor/textBridge.ts`): extracted
  `collectRuns`, which applies an element's own style for inline nodes; bullet
  markup now mirrors the layout's hanging indent (`padding-left` =
  `level*32 + 26`, `text-indent: -26`, marker box fixed at 26).
- **Tests**: `textBridge.test.ts` — "keeps bold and italic separate across
  adjacent inline tags", "indents bullet levels in generated HTML to match the
  layout service".

## 8. P04 proof extended to real editing behavior

`e2e/proofs/text-bridge.spec.ts` now also:

- compares a dense bullets element (4 lines including a nested level) between
  DOM line boxes and layout — all deltas < 0.02 px, nested bullet at x=32,
  indent=58;
- verifies a real caret position, typed insertion through the editing pipeline
  (`execCommand('insertText')`), and IME accounting: no commit while composing,
  exactly one commit at `compositionend`, final text `Kết quả mớiế`;
- keeps adjacent bold/italic on paste and drops `javascript:` links.

A physical OS-level IME cannot be automated headlessly; the proof exercises the
editor contract (composition events + commit policy) rather than the OS IME UI.
This remains an explicit limitation.

## 9. P08 dependency cycle corrected

`proofs/p08-deployment-blocked.md` no longer requires P54–P57 first. A minimal,
unit-tested preview harness (`server/processing/probe.ts` + `probe.test.ts`)
covers native packaging and a Storage round trip; deployment evidence is still
missing and P08 remains open.

## Verification after the pass

```bash
npm run typecheck   # PASS (app, node, server projects)
npm run lint        # PASS — 0 errors, 4 pre-existing warnings
npm test            # PASS — see milestone handoff for the count
npm run build       # PASS
npx playwright test e2e/proofs --workers=1   # PASS (both proofs with real parser)
```

---

# Second correction pass (after review of 4977a4d..8c29638)

All findings were reproduced as failing tests before the fix.

## 1. Media metadata could still change across presentations (Medium)

- **Defect**: identical bytes re-declared with another MIME replaced the stored
  record, and a save supplying no media could leave stored metadata disagreeing
  with the document.
- **Fix** (`repository.ts`): stored media metadata is now part of the immutable
  identity — a differing stored MIME is rejected, and the completeness check
  compares the stored MIME with every document asset even when no new media is
  submitted.
- **Tests**: "refuses to re-declare stored media with another format even when
  bytes match", "refuses a save with no media that changes the declared asset
  format".

## 2. Remaining no-op commands (Medium)

- **Defects**: `updateElement` used `Object.is` for nested patches (equal
  paragraphs compared as changed), and `removeSlide` committed for an unknown id.
- **Fix** (`store.ts`): structural `sameValue` comparison for patches, an
  existence check before removing a slide, and a duplicate-id guard when adding
  an element.
- **Tests**: "treats structurally identical nested patches as no-ops",
  "removing an unknown slide is a no-op that preserves redo", "refuses to add an
  element with an id that already exists".

## 3. SVG dimensions disagreed with the renderer (High)

- **Defect**: `height="1e5"` was unparseable by inspection and silently fell back
  to the viewBox, while resvg understood exponent notation.
- **Fix** (`server/processing/svg.ts`): one number parser with scientific
  notation and absolute units; explicit root width/height that cannot be
  interpreted are rejected (`unsupported_feature`) instead of falling back.
- **Tests**: scientific-notation parity, percentage/garbage rejection, unit
  conversion and over-limit rejection.

## 4. Backup accepted undecodable media (Medium)

- **Defect**: truncated PNGs and a three-byte JPEG signature passed header-only
  checks.
- **Fix**: `src/lib/imageFormat.ts` gained `inspectImageBytes` (PNG chunk walk
  with CRC-32 verification, WebP container/animation checks, JPEG SOF + EOI
  checks) and the backup parser gained a pluggable `MediaVerifier` that performs
  a real `createImageBitmap` decode in browsers and structural validation
  elsewhere, enforcing format, dimensions and the 25 MP limit before commit.
- **Tests**: new `imageFormat.test.ts` (7 cases) plus three backup tampering
  cases (truncated PNG, JPEG signature, corrupted chunk CRC) and an injected
  verifier failure.

## 5. Paste dropped the space between inline elements (Medium)

- **Defect**: the whitespace-only text node between `<b>` and `<i>` was trimmed
  away, producing `bolditalic`.
- **Fix** (`textBridge.ts`): whitespace-only top-level nodes are kept when they
  join inline content and ignored between block elements.
- **Tests**: full-text assertions (`bold italic`, `one two three four`) alongside
  the run-style assertions.

## 6. P08 harness did not exercise the real transport (Medium) and its body cap

was wrong (Low)

- **Defect**: the probe received base64 image bytes in the function body, so it
  proved the opposite of the required transport; the cap calculation also allowed
  ~6 MB of base64.
- **Fix** (`server/processing/probe.ts`): `handleStagedProcessProbe` accepts only
  `{ path }`, resolves bucket/prefix from server env, downloads the staged
  object, processes it, and writes the PNG derivative back to Storage. Request
  bodies are measured JSON references capped at 64 KB.
- **Tests**: staged success with derivative written, prefix/traversal/bucket
  isolation, typed 404/422/413 failures, upload-failure reporting, plus the
  existing round-trip and env tests (8 cases).
