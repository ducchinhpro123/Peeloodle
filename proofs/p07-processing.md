# P07 — Node image processing proof

Date: 2026-09-10. Task: "Prove Node processing of representative PNG/WebP/SVG
with actual decode limits and a hostile SVG fixture." Result: **passed**, with
one finding recorded for P56/P57.

## Code

| File | Responsibility |
| --- | --- |
| `server/processing/limits.ts` | Centralized `PROCESSING_LIMITS` (source bytes, pixels, dimensions, SVG nodes/depth, concurrency) |
| `server/processing/errors.ts` | `ProcessingError` with stable codes |
| `server/processing/raster.ts` | Header-only sniff/animation/dimension checks, then bounded sharp decode + PNG/WebP derivatives |
| `server/processing/svg.ts` | Strict static-subset validation (fast-xml-parser), resvg rasterization |
| `server/processing/index.ts` | `processAssetBytes` entry point; never accepts URLs or client MIME |
| `src/lib/imageFormat.ts` | Byte-level format/size/animation parsing shared with browser upload validation |

Runtime: Node 24.21.0, sharp 0.35.4 (libvips 8.18.6), @resvg/resvg-js 2.6.2,
fast-xml-parser 5.11.1. TypeScript coverage added through `tsconfig.server.json`
and a Node-globals ESLint override.

## Results

24 unit tests pass (`server/processing/processing.test.ts`):

- Valid fixture PNG → PNG derivative with alpha + WebP thumbnail (`hasAlpha: true`).
- Real static WebP (sharp-generated) accepted.
- Animated WebP (VP8X animation flag + ANIM) rejected **before decoding**.
- Animated PNG (`acTL` chunk) rejected before decoding.
- File header declaring 30000×30000 rejected as `dimension_too_large` before any
  pixel decode (no decompression bomb).
- GIF, JPEG and unknown bytes rejected as `unsupported_type`.
- 16 MB source rejected as `file_too_large`.
- Valid SVG rasterized to an alpha PNG with correct dimensions.
- 13 hostile SVG vectors rejected: `script`, `onload` handler, external
  `<image href>`, external `<use href>`, `foreignObject`, DOCTYPE/entity
  expansion, `@import`, `javascript:` url, `<text>`, 100000×100000 dimensions,
  5200 nodes, 70-deep nesting, unknown `<video>`.
- Malformed XML rejected; SVG > 2 MB rejected.

Measured benchmark (`npx vite-node proofs/processing/benchmark.ts`,
`proofs/out/p07-processing-report.json`, 20 iterations each):

| Case | Median | p95 | Output | RSS delta |
| --- | --- | --- | --- | --- |
| PNG 256×256 | 16.4 ms | 19.3 ms | 9.1 KB | +15.3 MB |
| WebP 320×240 | 9.1 ms | 11.4 ms | 1.0 KB | +14.3 MB |
| SVG 256×256 | 9.1 ms | 11.0 ms | 29.6 KB | +0.6 MB |
| Hostile SVG (rejected) | 0.01 ms | 0.03 ms | — | 0 MB |

These are single-file numbers on this machine; they justify the initial limits
(15 MB / 25 MP raster, 2 MB SVG, ≤ 4096 px render) and the two-jobs-concurrent
default, but are not capacity claims.

## Findings

1. `<text>` elements are rejected with `unsupported_feature` rather than
   rasterized: server-side font rendering would not be deterministic and could
   silently render boxes. P57 should decide whether to allow them with pinned
   embedded fonts or keep requiring paths.
2. Format detection now reads PNG/WebP dimensions from the header before
   decode; the decoded metadata must agree or processing fails
   (`decode_failed`), which also blocks polyglot/header-spoofing attempts.
3. `looksLikeSvgMarkup` was extended to recognize `<!DOCTYPE`-led SVG so the
   strict SVG policy (not a generic "unsupported type") reports those files.
4. Browser upload validation (`validateUpload.ts`) now shares the same byte
   parsers; its 6 unit tests still pass.

## Correction-pass fixes (2026-09-10 review)

5. **Nested `<svg>` could bypass the root bounds check.** Any `<svg>` element
   overwrote the recorded width/height, so a 100000×100000 root containing a
   100×100 nested SVG passed inspection while resvg received the original
   markup. Only the depth-1 root now defines recorded geometry; nested SVGs
   still render inside the bounded root. Tests: "rejects nested SVG that would
   shrink the recorded root bounds", "allows an ordinary nested SVG inside
   bounded root dimensions".
6. **Derivatives reported source dimensions.** A 5000×10 input produced a
   4096×8 PNG but reported 5000×10. `normalizeRaster` now returns the encoder's
   actual output size and keeps `sourceWidth/sourceHeight` separately for
   provenance. Test: "returns the actual derivative dimensions for a
   downscaled source".

Test count after the fixes: 27 in `processing.test.ts` (plus 6 probe tests in
`probe.test.ts` for the P08 preview harness).
