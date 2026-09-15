# Research: canvas + image-processing capability for the StickerLab sticker pipeline

**Dimension covered:** (a) in-browser decode/encode + high-resolution processing and worker
offload, (b) automatic cutout / alpha matting, (c) alpha-silhouette outline, contour tracing,
feathering/blur and where WebGL/WASM filters beat the hand-rolled path, (d) sticker-sheet /
collage / sprite-sheet and print helpers, (e) Konva-layer helper libraries and documented stage
perf patterns, (f) image metadata and format support.

**Explicitly out of scope (already settled elsewhere, not revisited):** canvas-engine
replacement, text layout, persistence, general UI libraries [S6].

## Runtime limitation disclosure (read this before trusting any external fact)

This subagent ran with **file-read and file-write tools only. No `web_search`, no fetch, no
`source_check`, no shell.** Therefore:

- **Every external fact** (licence, latest version, release date, maintenance signal, model size,
  bundle size, benchmark) is marked **`TODO-VERIFY`** and is _not_ asserted. The parent
  orchestrator has web tools and owns that fact pass; a mechanical checklist for it is in
  [§9](#9-mechanical-verification-checklist).
- **No URL is cited as verified.** Candidate external URLs are listed in
  [§10](#10-external-urls-to-verify-parent-fact-pass) as _unverified leads copied from repo docs_,
  not as sources. Per the brief's rule ("verify every URL resolves before citing it"), they are
  not numbered sources.
- **Fetch date** is therefore unavailable for this run. All numbered sources are local
  repository files read in this session; their in-repo dates are quoted where the file states one.
- All repo-grounded claims are backed by `[S#]` pointing at a file I actually read. Where I only
  read part of a file (a `limit` was applied), that is stated in the source list.
- Every non-obvious causal claim is labelled **Inference**.

---

## 1. Numbered source list

Local repository files under `/home/vdc/Projects/Peeloodle`, source type **repo file**, all read
in this session (path is the URL-equivalent; no HTTP fetch occurred).

| ID    | Path                                           | Type                                                            | Read scope                                  | File's own date                              |
| ----- | ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| [S1]  | `AGENTS.md`                                    | repo file (project instructions = binding constraints)          | full                                        | n/a                                          |
| [S2]  | `CONTEXT.md`                                   | repo file (glossary)                                            | full                                        | n/a                                          |
| [S3]  | `HANDOFF.md`                                   | repo file (current increment)                                   | full                                        | "Updated 2026-09-11"                         |
| [S4]  | `package.json`                                 | repo file (dependency manifest)                                 | full                                        | n/a                                          |
| [S5]  | `package-lock.json`                            | repo file (lockfile)                                            | first 40 lines only (root dependency block) | lockfileVersion 3                            |
| [S6]  | `docs/editor-library-research.md`              | repo file (prior research, engine decision)                     | full                                        | "Researched 2026-09-10"                      |
| [S7]  | `docs/core-tools-plan.md`                      | repo file (sticker tool plan + cutout audit table)              | full                                        | "Audit date: 2026-09-08"                     |
| [S8]  | `docs/slides-implementation-plan.md`           | repo file (presentation plan P01–P83)                           | full                                        | "scope confirmed… 2026-09-10"                |
| [S9]  | `docs/ui-audit.md`                             | repo file (UI/verification evidence)                            | first 80 lines                              | dated sections up to presentation follow-ups |
| [S10] | `README.md`                                    | repo file (behaviour + verification claims)                     | full                                        | n/a                                          |
| [S11] | `src/features/exports/renderDocument.ts`       | source (shared compositor: crop→mask→filter→outline, trim, PNG) | full (~580 lines)                           | n/a                                          |
| [S12] | `src/features/editor/maskPainter.ts`           | source (tiled alpha painting + per-stroke diff)                 | full                                        | n/a                                          |
| [S13] | `src/features/editor/useMaskBrush.ts`          | source (pointer lifetime, stroke commit, mask write)            | full                                        | n/a                                          |
| [S14] | `src/features/editor/maskUtils.ts`             | source (image-local mapping, brush radii, mask encode)          | full                                        | n/a                                          |
| [S15] | `src/features/editor/KonvaCanvas.tsx`          | source (Konva view layer, preview rasters, text overlay)        | full                                        | n/a                                          |
| [S16] | `src/features/assets/validateUpload.ts`        | source (upload validation + decode sizing)                      | full                                        | n/a                                          |
| [S17] | `src/lib/imageFormat.ts`                       | source (byte-level format sniff/validate, header dimensions)    | full                                        | n/a                                          |
| [S18] | `src/features/exports/zipExport.ts`            | source (hand-rolled ZIP + pack manifest)                        | full                                        | n/a                                          |
| [S19] | `src/features/presentations/exports/backup.ts` | source (fflate-based bounded ZIP)                               | first 40 lines only                         | n/a                                          |
| [S20] | `src/types/domain.ts`                          | source (serializable document contract)                         | first 30 lines only                         | n/a                                          |
| [S21] | `vite.config.ts`                               | source (build config)                                           | full                                        | n/a                                          |
| [S22] | `node_modules/konva/package.json`              | installed dependency manifest                                   | version field + head                        | version `9.3.20`                             |
| [S23] | `proofs/p07-processing.md`                     | repo file (measured Node processing proof)                      | full                                        | "Date: 2026-09-10"                           |
| [S24] | `proofs/baseline.md`                           | repo file (recorded build/runtime baseline)                     | first 60 lines                              | "P01 — Repository baseline (2026-09-10)"     |
| [S25] | `server/processing/probe.ts`                   | source (P08 preview probe, not mounted)                         | full                                        | n/a                                          |

Negative-evidence probe: `node_modules/comlink/package.json` → `ENOENT` in this session, i.e. no
Comlink installed; `node_modules/konva/package.json` → present, so `node_modules` is populated
and the ENOENT is meaningful rather than a missing install tree.

---

## 2. What the repo already does (grounding for every recommendation)

| Concern              | Current implementation                                                                                                                                                             | Evidence                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Decode               | `createImageBitmap(blob, { imageOrientation: 'from-image', resizeQuality: 'high', premultiplyAlpha: 'none' })`, falling back to plain `createImageBitmap`, then `HTMLImageElement` | [S11] `defaultDecodeImage`                                                |
| Decode (validation)  | same `imageOrientation: 'from-image'` first, then plain bitmap, then `Image`                                                                                                       | [S16] `decodeImageSize`                                                   |
| Encode               | `canvas.toBlob(..., 'image/png')` on an `HTMLCanvasElement`; the compositor's duck type also accepts `convertToBlob`                                                               | [S11] `canvasToPng`; [S14] `canvasToPngBlob`                              |
| Canvas injection     | `createCanvas` and `decodeImage` are callables on `RenderDocumentOptions`; `CanvasLike` only needs `width`, `height`, `getContext`, `toBlob` **or** `convertToBlob`                | [S11]                                                                     |
| Compositing          | one 2D path shared by canvas preview and PNG/ZIP export: crop → destination-in mask → CSS `ctx.filter` → alpha-silhouette outline → layer opacity → transform                      | [S11] `paintImage`/`createImageSurface`; compose order documented in [S7] |
| Filters              | `formatCssFilter()` emits `brightness()/contrast()/saturate()/grayscale()` strings assigned to `ctx.filter`                                                                        | [S11]; filter fields in [S20]                                             |
| Outline              | hand-rolled separable **box-max dilation** over the alpha plane, ring built as `dilated - coverage`, source bounds inflated by `ceil(outline.width)`                               | [S11] `dilateMaxAlpha`, `drawOutlinedImage`, `measureArtwork`             |
| Outline perf comment | code carries an explicit `ponytail:` note: "separable box max (O(WH)); Euclidean DT if round corners matter"                                                                       | [S11]                                                                     |
| Mask model           | image-local white-on-transparent alpha canvas at **full asset resolution**; defaults opaque white; mask dims must equal asset dims                                                 | [S14] `createDefaultMaskCanvas`; [S11] `assertMaskDimensions`             |
| Mask painting        | 128 px tile diffing via `getImageData` on first touch, stroke painted with round caps in inverse-scaled space, one `hasChanges()` sweep at stroke end                              | [S12]                                                                     |
| Mask persistence     | one `canvas.toBlob` PNG per completed stroke, then `applyMask(layerId, uuid, blob)`                                                                                                | [S13] `finish()`                                                          |
| Preview raster cap   | preview rasters capped at 1024 px longest edge; "mask data and exports remain full-resolution"                                                                                     | [S15] `previewRatio`; [S10]                                               |
| Upload allowlist     | PNG / JPEG / static WebP only; 15 MB; 25 MP; GIF, SVG, APNG, animated WebP actively rejected; sniffed bytes must match declared MIME                                               | [S16], [S17]                                                              |
| Header dims          | `pngDimensions` / `webpDimensions` / `jpegDimensions` / `inspectImageBytes` parse **container headers only**; PNG chunk CRCs verified; JPEG requires SOF + EOI trailer             | [S17]                                                                     |
| EXIF                 | no EXIF/APP1 parsing anywhere in `imageFormat.ts` (whole file read)                                                                                                                | [S17]                                                                     |
| Pack archive         | hand-rolled STORE-only ZIP writer + `manifest.json`, fail-fast on any member error                                                                                                 | [S18]                                                                     |
| Other archive        | presentation backup uses `fflate` `zipSync`/`unzipSync` with bounded expansion limits                                                                                              | [S19]                                                                     |
| Dependencies         | `fflate ^0.8.3`, `pdf-lib ^1.17.1`, `konva ^9.3.20` (installed 9.3.20 [S22]), `react-konva ^18.2.10`, `sharp ^0.35.4` (server/probe only)                                          | [S4], [S5], [S22]                                                         |
| Server processing    | sharp 0.35.4 (libvips 8.18.6) + @resvg/resvg-js 2.2.6, Node 24.21.0; JPEG **rejected** as `unsupported_type` server-side; probe route intentionally unmounted                      | [S23], [S25]                                                              |
| Workers              | no worker entry, no worker plugin/config in `vite.config.ts` (whole file read); no worker-helper library installed; README never mentions a worker                                 | [S21], [S10], ENOENT probe                                                |
| Bundle baseline      | largest chunk `KonvaCanvas` 314 kB (97 kB gzip), 1873 modules                                                                                                                      | [S24]                                                                     |
| Auto cutout          | not implemented and intentionally unavailable; "never a fake cutout"                                                                                                               | [S1], [S7], [S10]                                                         |

---

## 3. Facts table — licence / version / maintenance intentionally left `TODO-VERIFY`

Per the supervisor's steer and the brief's hard rule, **no cell below asserts a licence, version,
release date, maintenance signal or size that I could not fetch.** Repo-asserted values are quoted
as _repo claims_ in the caveats column only, never promoted into the fact cells.

### (a) Decode / encode / high-resolution processing / worker offload

| Option                                                                               | Licence                                                 | Latest version + release date          | Maintenance signal | What it replaces or adds in THIS repo                                                                   | Effort | Risk and caveats                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform: `createImageBitmap` + `OffscreenCanvas`/`convertToBlob`** (already used) | `TODO-VERIFY` (platform feature, no dependency licence) | `TODO-VERIFY` (browser support matrix) | `TODO-VERIFY`      | Nothing to add — already the decode path [S11][S16]; `CanvasLike` already accepts `convertToBlob` [S11] | S      | Off-main-thread encode is achievable with zero dependencies; **Inference:** benefit is bounded by full-res copies (~100 MB RGBA at 25 MP)                                                                        |
| `comlink`                                                                            | `TODO-VERIFY`                                           | `TODO-VERIFY`                          | `TODO-VERIFY`      | Only sugar over `postMessage` for a single encode worker; not installed today                           | S      | Adds a dependency for ~30 lines of hand-written message plumbing; requires `transfer` care                                                                                                                       |
| `workerpool` / `threads` / `p-queue` (worker pools)                                  | `TODO-VERIFY`                                           | `TODO-VERIFY`                          | `TODO-VERIFY`      | A pool only matters for multi-image batch work (pack ZIP export) [S18]                                  | M      | Pool + 25 MP rasters multiplies peak memory; the repo's own ZIP export is currently sequential and fail-fast [S18]                                                                                               |
| `jimp` (`@jimp/core`)                                                                | `TODO-VERIFY`                                           | `TODO-VERIFY`                          | `TODO-VERIFY`      | Would duplicate PNG/JPEG codecs; no replacement target in [S11]/[S16]                                   | M      | **Inference:** pure-JS codecs cannot beat the native decoder already in use; extra decode path must re-prove alpha/premultiply and ImageBitmap cleanup contracts (covered by `renderDocument.test.ts` per [S10]) |
| `wasm-vips` (libvips → wasm)                                                         | `TODO-VERIFY`                                           | `TODO-VERIFY`                          | `TODO-VERIFY`      | Would add browser equivalents of the sharp operations the server already performs [S23]                 | L      | Offline/first-load cost vs the local-first guarantee [S1]; server already has native libvips 8.18.6 [S23], so the browser build would be a second imaging stack                                                  |
| WebCodecs `ImageDecoder`                                                             | `TODO-VERIFY` (spec/browser)                            | `TODO-VERIFY`                          | `TODO-VERIFY`      | Alternative decode path returning `VideoFrame`                                                          | M      | Adds a second decode path for **zero** required format gain: the allowlist is PNG/JPEG/WebP with tests asserting APNG/animated-WebP rejection [S16][S17]                                                         |

### (b) Cutout / background removal / alpha matting

| Option                                    | Licence                                                                              | Latest version + release date | Maintenance signal | What it adds in THIS repo                                        | Effort | Risk and caveats                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------- | ------------------ | ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@imgly/background-removal`               | `TODO-VERIFY` — repo audit claims AGPL-3.0 with commercial licensing via IMG.LY [S7] | `TODO-VERIFY`                 | `TODO-VERIFY`      | Could _initialize_ an image-local mask through `applyMask` [S13] | L      | Repo audit already recorded it as **blocked** on AGPL/purchase, ~40–80 MB ONNX+WASM **(repo claim, unverified here)**, and hair/fur/glass cleanup [S7]                                 |
| `@mediapipe/tasks-vision` Image Segmenter | `TODO-VERIFY` — repo audit claims Apache-2.0 code, selfie/person only [S7]           | `TODO-VERIFY`                 | `TODO-VERIFY`      | Person/selfie mask seeding                                       | M      | Repo audit verdict: "legal but product-unfit" for pets/objects [S7] — StickerLab's own sample artwork is cats/dogs/drinks [S9][S10]                                                    |
| `transformers.js` + RMBG-1.4 / RMBG-2.0   | `TODO-VERIFY` (library and _both_ model licences are separately relevant)            | `TODO-VERIFY`                 | `TODO-VERIFY`      | General-object matte                                             | L      | Repo audit records RMBG-1.4 non-commercial and RMBG-2.0 CC BY-NC 4.0 + paid agreement: **weights licence, not library licence, decides this** [S7]                                     |
| `onnxruntime-web` + MODNet / U²-Net ports | `TODO-VERIFY` (runtime, and each port's weights licence)                             | `TODO-VERIFY`                 | `TODO-VERIFY`      | Portrait matting (MODNet) / salient-object (U²-Net)              | L      | Model size, first-run download and offline caching must be verified; multithreaded WASM may require cross-origin isolation — `TODO-VERIFY` (headers on the Vercel static deploy) [S10] |
| Hosted APIs (remove.bg et al.)            | `TODO-VERIFY`                                                                        | `TODO-VERIFY`                 | `TODO-VERIFY`      | None acceptable                                                  | —      | Uploads user photos and requires credentials; contradicts local-first/offline core [S1] and the repo's own audit [S7]                                                                  |

### (c) Outline / contour / feathering / blur / filters

| Option                                                         | Licence       | Latest version + release date | Maintenance signal | What it replaces or adds in THIS repo                                    | Effort | Risk and caveats                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------- | ----------------------------- | ------------------ | ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exact Euclidean distance transform (algorithm, no package)** | n/a           | n/a                           | n/a                | Replaces the box-max dilation in `dilateMaxAlpha` [S11]                  | S      | **Inference:** fixes square-footprint artefacts at large outline widths; must preserve preview ≡ export pixels (primary invariant, [S1], [S7])                                                                                                                    |
| `glfx` / `webgl-filter` / `filterous` (WebGL filter libs)      | `TODO-VERIFY` | `TODO-VERIFY`                 | `TODO-VERIFY`      | Effect variety (blur, hue, drop-shadow-like effects) beyond `ctx.filter` | M      | **Inference:** introduces a second compositor, which breaks the "one compositing path for preview and export" invariant [S11] and M4's "Preview = saved = PNG = ZIP" [S7]; browser `ctx.filter` already exposes `blur()`/`drop-shadow()`/`hue-rotate()` if wanted |
| `d3-contour` / marching-squares SVG contour tracing            | `TODO-VERIFY` | `TODO-VERIFY`                 | `TODO-VERIFY`      | Vector silhouette paths (SVG outline export, cut-lines)                  | M      | No requirement exists for either vector outline export or cut-line sheets in [S2], [S7] or [S8]                                                                                                                                                                   |
| `potrace`-style vectorization                                  | `TODO-VERIFY` | `TODO-VERIFY`                 | `TODO-VERIFY`      | Same as above                                                            | L      | Wrong job for a raster sticker export pipeline; SVG upload is actively rejected [S16][S17]                                                                                                                                                                        |

### (d) Sticker sheet / collage / sprite sheet / print sheet

| Option                                                  | Licence       | Latest version + release date | Maintenance signal | What it replaces or adds in THIS repo                                        | Effort | Risk and caveats                                                                                                                          |
| ------------------------------------------------------- | ------------- | ----------------------------- | ------------------ | ---------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Hand-rolled grid sheet over `renderDocument`**        | n/a           | n/a                           | n/a                | New: N-up sheet of already-exportable stickers                               | S      | **Inference:** ~40 lines (nested loop + `drawImage`), reuses the audited compositor rather than forking it                                |
| `pdf-lib` (already a client dependency)                 | `TODO-VERIFY` | `TODO-VERIFY`                 | `TODO-VERIFY`      | Printable A4/Letter sticker sheet with cut marks                             | S      | Already in `dependencies` for the presentation PDF path [S4][S8] — reuse, no new dependency                                               |
| `fflate` (already a dependency, used by backup)         | `TODO-VERIFY` | `TODO-VERIFY`                 | `TODO-VERIFY`      | Consolidate the pack ZIP writer [S18] onto the library already used in [S19] | S      | Two ZIP implementations already exist in-repo (`zipExport.ts` hand-rolled vs `backup.ts` fflate) — that is duplication, not a library gap |
| `spritesmith` / `free-tex-packer-core` / atlas builders | `TODO-VERIFY` | `TODO-VERIFY`                 | `TODO-VERIFY`      | Packed atlases with rect metadata                                            | M      | Build/Node-time tools for game atlases; StickerLab needs runtime uniform-grid sheets with a manifest that [S18] already defines           |

### (e) Konva-layer helpers only

| Option                                                                                              | Licence                                                | Latest version + release date | Maintenance signal | What it replaces or adds in THIS repo                    | Effort | Risk and caveats                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- | ------------------ | -------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-image` (react-konva image loader)                                                              | `TODO-VERIFY`                                          | `TODO-VERIFY`                 | `TODO-VERIFY`      | Would replace the ~14-line `useHtmlImage` hook [S15]     | S      | **Inference:** repository hook returns an `HTMLImageElement` deliberately so Konva draws it directly; a helper must not change that or the preview/export parity tests [S10] would have to be re-proven                                                                           |
| `react-konva-utils`                                                                                 | `TODO-VERIFY`                                          | `TODO-VERIFY`                 | `TODO-VERIFY`      | Possible conveniences (HTML overlay, pixel-ratio helper) | S      | The editor's DOM text overlay is an absolutely-positioned `textarea` outside the stage [S15]; no remaining need identified. **TODO-VERIFY** its current API before final dismissal                                                                                                |
| `konva` `Konva.Filters.*` + `node.cache()`                                                          | `TODO-VERIFY` (same package as installed 9.3.20 [S22]) | `TODO-VERIFY`                 | `TODO-VERIFY`      | GPU/CPU filter pipeline inside the Konva node            | M      | **Inference:** would be a _second_ filter implementation alongside `formatCssFilter`+`ctx.filter` [S11] — directly conflicts with [S7] M4 and [S1]'s shared-compositing rule                                                                                                      |
| `perfect-freehand` and brush-style helpers                                                          | `TODO-VERIFY`                                          | `TODO-VERIFY`                 | `TODO-VERIFY`      | Variable-width tapered ink strokes                       | M      | The brush is an alpha erase/restore mask with inverse-scaled circular radii [S14]; taper is the wrong model and would fight mask parity tests [S10]                                                                                                                               |
| Konva documented perf patterns (`batchDraw`, `listening=false`, `perfectDrawEnabled`, `node.cache`) | `TODO-VERIFY` (Konva docs)                             | `TODO-VERIFY`                 | `TODO-VERIFY`      | Guidance, not code                                       | S      | Repo already uses `batchDraw()` after raster swaps, one `Layer`, pre-rendered per-layer rasters, `Transformer` handles [S15]; `node.cache()` is **Inference**-risky here because caching bakes transforms and the repo deliberately re-rasterizes at `previewRatio` instead [S15] |

### (f) Metadata and format support

| Option                         | Licence                                                 | Latest version + release date | Maintenance signal | What it replaces or adds in THIS repo               | Effort | Risk and caveats                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------- | ----------------------------- | ------------------ | --------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exifr`                        | `TODO-VERIFY`                                           | `TODO-VERIFY`                 | `TODO-VERIFY`      | EXIF read (orientation, camera, GPS) in the browser | S      | Orientation is already applied at decode via `imageOrientation: 'from-image'` in **both** decode paths [S11][S16]; a metadata library is only justified by a real UI/metadata requirement, and it does **not** resolve the server header-vs-decode question below |
| `heic-decode` / `libheif-wasm` | `TODO-VERIFY`                                           | `TODO-VERIFY`                 | `TODO-VERIFY`      | HEIC support                                        | M      | Adds a format the allowlist deliberately excludes [S16][S17]; multi-MB wasm; must be verified against the offline guarantee [S1]                                                                                                                                  |
| AVIF (platform decode)         | Platform feature — `TODO-VERIFY` browser support matrix | n/a                           | n/a                | Wider input                                         | S      | Would require re-proving the sniff/animation tests that currently assert the PNG/JPEG/WebP contract [S16][S17][S10]                                                                                                                                               |

---

## 4. Findings

### (a) Decode/encode and high-resolution processing

1. **Claim:** the repo already uses the correct native decode primitive, including orientation and
   premultiply handling, with a two-step fallback. **Sources:** [S11] `defaultDecodeImage`, [S16]
   `decodeImageSize`. **Support:** direct evidence. **Confidence:** high. No decoder library
   replaces anything here.

2. **Claim:** the compositor's canvas abstraction is duck-typed and already accepts
   `OffscreenCanvas` (`convertToBlob`) plus injectable `createCanvas`/`decodeImage`. **Sources:**
   [S11] `CanvasLike`, `RenderDocumentOptions`. **Support:** direct evidence.
   **Inference:** worker offload is therefore an _injection + worker entry_ change, not a rewrite of
   `renderDocument`. **Confidence:** high (evidence) / medium (effort estimate).

3. **Claim:** the mask pipeline is the plausible high-resolution hotspot, not the paint loop. Each
   stroke paints at **full asset resolution** [S14], then encodes with `HTMLCanvasElement.toBlob`
   on the **main thread** [S14, called from S13], then writes the blob to IndexedDB. **Support:**
   direct evidence for the code paths; **Inference** for the cost ranking (no measured encode-path
   benchmark exists — the recorded measurements cover the _preview raster_ path only [S10], and
   README explicitly states masks/exports stay full-resolution [S10]). **Confidence:** high
   (mechanism) / medium (that it is user-visible).

4. **Claim:** at 25 MP, one RGBA plane is ~100 MB, so a worker offload trades main-thread jank for
   peak-memory pressure. **Support:** **Inference** from the 25 MP limit [S16] and from
   `createImageBitmap`/`drawImage` copy semantics; **no measurement taken in this run.**
   **Confidence:** medium, and it is the reason the recommendation below measures before it builds.

5. **Claim:** there is no worker anywhere in the paths inspected and no worker-helper library
   installed. **Sources:** [S21] (whole `vite.config.ts`, no worker config), ENOENT probe on
   `node_modules/comlink`, [S10] (no worker mentioned in the editor description).
   **Support:** direct evidence, **bounded** — a repo-wide grep was not possible without a shell.
   **Confidence:** high for "none in inspected files", medium for "none repo-wide".

### (b) Cutout

6. **Claim:** automatic cutout is blocked by **licensing and weights distribution**, not by a
   missing npm package. **Sources:** [S7] (option table: MediaPipe Apache-2.0 but person-only,
   `@imgly/background-removal` AGPL-3.0 → commercial licence via IMG.LY, BRIA RMBG-1.4
   non-commercial / RMBG-2.0 CC BY-NC + paid agreement, remove.bg paid + uploads photos), [S1]
   (never fake a cutout; licensing review required), [S10] (feature is honestly unavailable).
   **Support:** direct evidence _of what this repo recorded_; the underlying licence text, versions
   and model sizes are **TODO-VERIFY**. **Confidence:** high that this is the shape of the
   blocker; medium on any specific licence until the fact pass runs.

7. **Claim:** the honest feasibility picture is "achievable but not free, not general, and not
   offline-neutral". **Inference**, assembled from: person-only segmentation (MediaPipe, [S7]);
   hair/fur/glass still needing cleanup (repo audit, [S7]); weights needing to be **self-hosted and
   cached** because core editing must work offline and arbitrary remote hotlinks are disallowed
   ([S1]); multithreaded WASM possibly needing cross-origin isolation (**TODO-VERIFY**);
   25 MP inputs needing downscale/tiling ([S16]); and a hard requirement that any result be a real
   model output with progress/cancel/failure handling ([S1]). **Confidence:** medium-high on the
   constraint list, low on any specific runtime number.

8. **Claim:** if cutout ever ships, the integration seam already exists and is small —
   `applyMask(layerId, uuid, blob)` [S13] takes an image-local mask blob, and every downstream
   consumer (preview, export, ZIP) already handles `maskKey` [S11], [S18].
   **Support:** direct evidence. **Confidence:** high.

### (c) Outline / contour / feathering / filters

9. **Claim:** the outline is a separable **box** maximum filter, not a Euclidean distance
   transform, and the code itself flags the upgrade. **Sources:** [S11] `dilateMaxAlpha`,
   `slidingWindowMax`, and the `ponytail:` comment "separable box max (O(WH)); Euclidean DT if
   round corners matter". **Support:** direct evidence. **Confidence:** high.

10. **Claim:** the outline ring is computed as `dilated - coverage` normalised by `255 - coverage`,
    and the outline bounds are measured on the **un-outlined** silhouette and then inflated by
    `ceil(width)`. **Sources:** [S11] `drawOutlinedImage`, `measureArtwork`. **Support:** direct
    evidence. **Confidence:** high. **Inference:** this is already the cheap correct structure, so
    the only real upgrade is the distance metric, not the architecture.

11. **Claim:** a WebGL/WASM filter library would not beat the hand-rolled path for the _documented_
    filter set, and would break an invariant. **Sources:** [S11] `formatCssFilter` + `ctx.filter`
    shared by preview and export; [S20] filter fields are exactly brightness/contrast/saturation/
    grayscale; [S7] M4 "Preview = saved = PNG = ZIP"; [S1] "Reuse compositing logic for editor
    previews and exports". **Support:** direct evidence + **Inference** on the "would break"
    consequence. **Confidence:** high.

12. **Claim:** contour tracing has **no consumer** in this product. **Sources:** [S2] (glossary has
    no vector/cut-line concept), [S8] (presentation SVG is inserted/exported "as a single image"),
    [S16][S17] (SVG uploads rejected). **Support:** direct evidence of absence of requirement.
    **Confidence:** high.

### (d) Sheets

13. **Claim:** sheet generation needs no library; the repo should compose its own audited
    compositor and reuse `pdf-lib`/`fflate`. **Sources:** [S11] (per-sticker render already
    returns a trimmed transparent PNG blob), [S18] (pack ZIP + manifest exist), [S19] (fflate ZIP
    already used elsewhere), [S4] (`pdf-lib` already a client dependency). **Support:** direct
    evidence + **Inference** on the ~40-line estimate. **Confidence:** high on "no library needed",
    medium on the size estimate.

14. **Claim:** the repo already has **two** ZIP implementations. **Sources:** [S18] hand-rolled
    STORE-only writer; [S19] `fflate` `zipSync`/`unzipSync`. **Support:** direct evidence.
    **Confidence:** high. This is an in-repo consolidation opportunity, not a library upgrade.

### (e) Konva helpers

15. **Claim:** the repo's own image-loading and overlay code is smaller than the helpers that would
    replace it, and its behaviour is load-bearing. **Sources:** [S15] `useHtmlImage` (14 lines,
    returns `HTMLImageElement`), `CanvasTextEditor` (DOM `textarea` outside the stage),
    `HydratedImage` (pre-rendered raster swap + `batchDraw()`), `previewRatio` cap.
    **Support:** direct evidence + **Inference** that swapping in `use-image` would be behaviour-
    neutral at best. **Confidence:** medium-high; `use-image` semantics are **TODO-VERIFY**.

16. **Claim:** `Konva.Filters.*` would create a second filter implementation. **Sources:** [S11]
    (filters already applied via `ctx.filter` in the shared compositor), [S7] M4, [S1].
    **Support:** direct evidence + **Inference**. **Confidence:** high.

### (f) Metadata and formats

17. **Claim:** EXIF orientation is applied at decode in **both** browser decode paths
    (`imageOrientation: 'from-image'`), while the byte-level JPEG dimension parser reads raw SOF
    dimensions and contains **no** EXIF/APP1 handling. **Sources:** [S11], [S16], [S17] (whole file
    read — no EXIF logic present). **Support:** direct evidence. **Confidence:** high.

18. **Claim:** **Inference** — for an orientation-6/8 JPEG, header-derived dimensions and
    decode-derived dimensions can be transposed. Today that is latent, not live: upload validation
    uses the decode-derived size [S16] and the server **rejects JPEG entirely** [S23]. It becomes
    live at Node catalog ingestion (P56) or any header-only sizing, and it matters because asset
    `width`/`height` are persisted in the document [S20] and masks must match them exactly [S11]
    `assertMaskDimensions`. **Support:** **Inference** from the two code paths; not reproduced in
    this run. **Confidence:** medium — verifiable in one test (checklist item 9).

19. **Claim:** the format allowlist is deliberate and defended by tests; AVIF/HEIC/ImageDecoder
    are out of contract, not oversights. **Sources:** [S16], [S17], [S10]
    (`validateUpload.test.ts` rejects APNG and mislabeled BMP), [S1] ("Start with PNG, JPEG, and
    static WebP; do not silently accept animated or SVG uploads"). **Support:** direct evidence.
    **Confidence:** high.

20. **Claim:** `sharp` and `@resvg/resvg-js` are server/probe-only and must not leak into the
    browser path; the P08 probe is explicitly unmounted. **Sources:** [S25] (module doc: "not
    mounted by the application"), [S23], [S4] (`sharp` in `dependencies`, used through
    `server/`). **Support:** direct evidence. **Confidence:** high. **Inference:** this caps how
    much image-processing logic can be shared between browser and server; `imageFormat.ts` is the
    deliberately shared piece [S17].

---

## 5. Top recommendations (max 5, highest confidence first)

1. **Add zero dependencies; keep the native decode/encode path.**
   _Impact:_ avoids a whole class of regressions (second codec path, alpha/premultiply
   differences, ImageBitmap cleanup contract in `renderDocument.test.ts` [S10]).
   _Effort:_ none (decision only).
   _Why highest confidence:_ the decode path and its fallbacks are already correct and tested
   [S11][S16][S10]; no candidate library replaces an existing capability.

2. **Measure the stroke-end encode before touching the worker story.**
   _Impact:_ decides the single largest unresolved canvas-perf question (full-res mask PNG encode
   on the main thread [S14][S13]).
   _Effort:_ S — extend the existing measurement pattern
   (`npx playwright test e2e/mask-regressions.spec.ts -g '30 layers' --workers=1` records frame and
   pointer metrics [S10]) with one 25 MP mask stroke and record stroke-end latency + peak memory.
   _Confidence:_ high that this is the right next step, regardless of which way it lands.

3. **If (and only if) that measurement shows a real stall: move the encode off the main thread with
   Vite's built-in module worker — no library.**
   _Impact:_ M (interaction latency at stroke end).
   _Effort:_ S — the compositor already accepts an injected canvas factory and `convertToBlob`
   [S11]; the mask painter only needs the encode boundary (`canvasToPngBlob` [S14]) to move.
   _Risk:_ **Inference** — copying a 25 MP raster for the worker increases peak memory (~100 MB per
   RGBA plane); prefer `createImageBitmap(canvas)` + transfer over `getImageData` copies, and
   re-run the mask parity/undo suites [S10].
   _Documented alternative if memory, not CPU, is the binding constraint:_ cap the mask raster
   resolution at a stated ceiling (a `ponytail:`-style documented limit), which touches
   `assertMaskDimensions` [S11], `createDefaultMaskCanvas` [S14] and the brush-radius maths [S14].

4. **Upgrade the outline dilation to an exact Euclidean distance transform (algorithm, no
   package).**
   _Impact:_ M — removes square-footprint artefacts at larger outline widths; the mask brush is
   round-capped [S12], so round rings are the visually consistent result.
   _Effort:_ S — one function in `renderDocument.ts` [S11], retaining the existing
   `measureArtwork` bounds inflation.
   _Risk:_ preview/export pixel parity is a hard invariant [S1][S7]; re-run
   `e2e/render-parity.spec.ts` and `e2e/outline.spec.ts` [S24].
   _Confidence:_ high (the code itself names this upgrade [S11]).

5. **Sheets and archives: build them from what is already here.**
   _Impact:_ M — a sticker sheet/print sheet and a single ZIP strategy, with no new dependency.
   _Effort:_ S — grid compositor over `renderDocument` [S11]; `pdf-lib` for a printable sheet
   (already a client dependency [S4]); consolidate `zipExport.ts` [S18] onto `fflate` [S19].
   _Confidence:_ high on "no library needed", medium on the exact effort.

**Not ranked as a recommendation, deliberately:** automatic cutout. It stays unavailable until a
licence decision, self-hosted weights, progress/cancel UX and quality expectations are settled
[S1][S7].

---

## 6. Anti-recommendations

| Rejected                                                            | Reason                                                                                                                                                                                                  | Evidence              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `jimp`                                                              | Would duplicate codecs already handled natively; **Inference:** pure-JS decode cannot beat the native path the repo already uses, and it adds a second alpha/premultiply behaviour to re-verify         | [S11], [S16], [S10]   |
| `wasm-vips` / libvips-wasm in the browser                           | The server already runs native libvips (sharp 0.35.4 / libvips 8.18.6) behind an unmounted probe; a second imaging stack conflicts with the offline/local-first core and the small-footprint constraint | [S23], [S25], [S1]    |
| WebCodecs `ImageDecoder` for now                                    | Adds a decode path for zero required format gain; the allowlist and its rejection tests are explicit                                                                                                    | [S16], [S17], [S10]   |
| WebGL filter libs (`glfx`, `webgl-filter`, `filterous`)             | **Inference:** introduces a second compositor and breaks "one compositing path for preview and export" and M4 parity; `ctx.filter` already covers the documented filter set                             | [S11], [S7], [S1]     |
| `Konva.Filters.*` + `node.cache()`                                  | Same second-implementation problem inside the view layer; caching bakes transforms, while the repo deliberately re-rasterizes at `previewRatio`                                                         | [S11], [S15], [S7] M4 |
| `perfect-freehand` / tapered-brush helpers                          | Wrong model: the brush is an alpha erase/restore mask with inverse-scaled circular radii, not ink                                                                                                       | [S14], [S12]          |
| `react-konva-utils`, `use-image`                                    | The repo's own equivalents are ~14 lines and return the exact types the view layer needs (`HTMLImageElement`)                                                                                           | [S15]                 |
| `potrace` / `d3-contour` / marching squares                         | No vector-outline or cut-line requirement exists; SVG input is actively rejected                                                                                                                        | [S2], [S8], [S16]     |
| Atlas/sprite-sheet builders (`spritesmith`, `free-tex-packer-core`) | Build-time atlas tools for packed rects; the need is a runtime uniform grid plus the manifest [S18] already defines                                                                                     | [S18]                 |
| `JSZip` / `archiver`                                                | `fflate` is already a dependency and already used for a bounded ZIP                                                                                                                                     | [S4], [S19]           |
| `exifr` for the browser path                                        | Orientation is already applied at decode in both browser decode paths; a metadata library only helps if the UI must _display_ metadata                                                                  | [S11], [S16], [S17]   |
| `@imgly/background-removal` **as a now-decision**                   | Repo audit recorded AGPL-3.0 → commercial licence required, plus unverified weight size and edge-quality caveats                                                                                        | [S7], [S1]            |
| Any hosted cutout API                                               | Uploads user photos and needs credentials; contradicts local-first/offline core                                                                                                                         | [S1], [S7]            |
| A worker-pool library (`workerpool`, `threads`, `p-queue`) up front | YAGNI: one encode worker covers the plausible use; pooling multiplies peak memory for 25 MP rasters                                                                                                     | [S16], [S14]          |

---

## 7. Where NO good library exists (and the evidence I looked)

1. **Alpha-silhouette outline with preview/export pixel parity.** The prior survey catalogues
   Konva, Fabric, Polotno, CE.SDK, Pintura, Filerobot, TOAST UI and tldraw; for each, "alpha-
   silhouette outline" is either "you build it" or a **rectangle/box stroke** or `borderSize` on
   the element box [S6]. Evidence I looked: the full comparison table and the per-library sections
   in [S6]; the repo's own implementation and its `ponytail:` note [S11].
   → **Keep the hand-rolled path; upgrade the distance metric (recommendation 4).**

2. **Image-local erase/restore masks that survive crop, rotate, flip and zoom.** No reviewed
   library documents this model (Fabric has brushes, Polotno has framing/`clipSrc`, TOAST UI has a
   "mask filter" image, CE.SDK has `cutout` blocks for print masking) [S6].
   → **Keep hand-rolled** [S12][S13][S14].

3. **Artwork-bounded transparent PNG trimming at 512/1024 with export chrome excluded.** Not a
   library feature anywhere reviewed [S6]; Polotno/Fabric/CE.SDK export the artboard/scene.
   → **Keep hand-rolled** [S11].

4. **General-object, customer-facing, offline, permissively licensed in-browser cutout.** The
   repo's audit looked at MediaPipe (person-only), `@imgly/background-removal` (AGPL),
   BRIA RMBG-1.4/2.0 (non-commercial), remove.bg (hosted, paid, uploads photos) and found no
   option satisfying all of {permissive licence, self-hosted weights, offline, general quality}
   [S7]. Evidence I looked: the full option table and "Unresolved approvals" list in [S7], plus
   [S1]'s licensing/never-fake-a-cutout rules. Underlying licences and model sizes: **TODO-VERIFY.**
   → **Honest answer: no good library exists _yet_ for this combination.** This is a licensing and
   weights-distribution wall, not an npm gap [S7].

5. **Runtime sticker-sheet/print-sheet assembly.** Atlas tools are build-time and rect-packed
   [S4 check for alternatives: none present]; the repo's manifest contract is its own [S18].
   → **Keep hand-rolled** (recommendation 5).

**Evidence that I looked, stated plainly:** the searchable evidence available to me this session is
the repo plus its committed prior research. [S6] is a full survey of the canvas-engine and editor-SDK
market (10 named libraries compared against 17 capability rows). [S7] is a full survey of the
cutout market (5 named options with licence, quality, size/runtime, privacy, cost). [S8] enumerates
the presentation pipeline where PDF/PPTX/backup/sheet work lands. **Gap:** I could not search npm,
GitHub, caniuse or model hubs in this runtime, so claims of the form "no library exists for X"
are limited to _the libraries reviewed by the repo_ plus my own domain knowledge, and are labelled
as such. The parent's fact pass should specifically try to falsify items 1–5 above.

---

## 8. Contradictions and missing evidence

**Contradictions found:**

- None _within_ the repo files read. The repo is internally consistent, and this brief's
  recommendations do not contradict [S6]'s "keep Konva / keep the custom editor" conclusion or
  [S7]'s "auto-removal stays unavailable".

**Missing evidence (unresolved):**

1. Any measurement of the **mask encode path** (full-res `toBlob` + IDB write) at 25 MP. The only
   recorded browser numbers cover the _preview raster_ path (16.6 ms median / 17.3 ms p95 frame
   interval, 0.9 ms p95 pointer handler, 1440×900, one 2048 px photo + 29 shape layers) [S10].
   Those numbers do **not** transfer to the encode path; do not cite them for it.
2. Peak memory for a 25 MP asset + full-res mask + worker copy. **Inference only** in this brief.
3. Whether the Vercel deployment sends COOP/COEP headers (decides whether multithreaded WASM is
   even available for a future cutout model) [S10] — **TODO-VERIFY**.
4. Whether an orientation-6/8 JPEG produces transposed dimensions between `jpegDimensions` [S17]
   and `decodeImageSize` [S16] — **Inference**, not reproduced.
5. All external licences, versions, release dates, maintenance signals, model sizes and bundle
   sizes — **TODO-VERIFY** (§3, §9).
6. Whether any Konva-layer helper listed in §3(e) has a current API that materially changes the
   §6 rejection — **TODO-VERIFY**.
7. Repo-wide absence of Web Workers — only "absent from the files I inspected" [S21][S10], not a
   grep result.

---

## 9. Mechanical verification checklist (for the parent's fact pass)

Run in this order; each step produces a recordable artifact. Steps 1–4 are repo-only and can run
with the existing toolchain; steps 5–8 are the fact pass; steps 9–13 close the code questions.

1. `grep -rn "new Worker\|OffscreenCanvas\|transferControlToOffscreen\|convertToBlob\|navigator.hardwareConcurrency" src/ server/` — confirm no production worker exists (expected hits: `renderDocument.ts` `CanvasLike`, `renderDocument.test.ts` doubles). Record output verbatim.
2. `grep -rn "toBlob(\|createImageBitmap(" src/` — enumerate every encode/decode call site; confirm the mask encode in `maskUtils.canvasToPngBlob` is the only per-stroke one.
3. `grep -rniE "jimp|wasm-vips|comlink|onnxruntime|transformers|mediapipe|glfx|perfect-freehand|exifr|heic" src/ package.json` — expect zero hits; record.
4. `npx vite-node` (or a Vitest case under `src/lib/`) printing the tree of files that import `konva` — confirms the Konva surface is confined to the view layer.
5. For **each** row in §3: `npm view <pkg> version license time.modified time.created peerDependencies dist.unpackedSize` and `npm view <pkg> repository.url`. Record: version, licence string, last-publish date, declared peer React range, unpacked size. **Do not** report `dist.unpackedSize` as "bundle size".
6. React-18 gate: for each candidate, read its README/CHANGELOG for a React-19-only requirement; record the exact quoted line and URL. (Precedent: [S6] records Polotno 4.x as React 19 with a 3.x line for React 18 — the same trap applies to any React-facing helper.)
7. Model weights: open each model card, record licence name, exact file size in bytes, and whether commercial use is granted; record the pinned revision/commit hash that would be vendored. Do not accept a licence claim from a blog.
8. Headers: `curl -sI https://stickerlab-eta.vercel.app | grep -iE "cross-origin|coop|coep"` and confirm whether `crossOriginIsolated` would be true for a multithreaded-WASM cutout. Record the raw headers.
9. EXIF fixture test: generate a JPEG with EXIF orientation 6, then assert `decodeImageSize(blob)` vs `jpegDimensions(bytes)` and record whether they differ. Add as a Vitest case next to `validateUpload.test.ts`.
10. Mask encode benchmark: extend the measurement harness behind `npx playwright test e2e/mask-regressions.spec.ts -g '30 layers' --workers=1` [S10] with one 25 MP mask stroke; record median/p95 stroke-end latency and peak JS heap. **Decision gate for recommendation 3.**
11. Verify each URL in §10 resolves (HTTP 200, not a redirect to a paywall/homepage) and stamp the fetch date; only then may those become numbered sources.
12. If any dependency is added: `npm ls --depth=0`, then `npm run typecheck && npm run lint && npm test && npm run build`, and re-run `npx playwright test e2e/render-parity.spec.ts e2e/mask-regressions.spec.ts e2e/outline.spec.ts e2e/artwork-export.spec.ts --workers=1` [S24].
13. Invariant audit for any added library: does it own or mutate the serializable document, persist framework/DOM objects, or hold object URLs? [S1]. Record the API surface reviewed.

---

## 10. External URLs to verify (parent fact pass) — **NOT verified, NOT numbered sources**

Copied from repo docs as leads only; none was fetched in this run. Verify before citing.

- `https://github.com/imgly/background-removal-js` (and its `LICENSE.md`) — from [S6], [S7]
- `https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter` — from [S7]
- `https://huggingface.co/briaai/RMBG-1.4`, `https://huggingface.co/briaai/RMBG-2.0` — from [S7]
- `https://www.remove.bg/tos`, `https://www.remove.bg/api` — from [S7]
- `https://konvajs.org/docs/guides/best-canvas-library.html` — from [S6]
- Package pages for `comlink`, `jimp`, `wasm-vips`, `onnxruntime-web`, `@huggingface/transformers`,
  `exifr`, `workerpool`, `pdf-lib`, `fflate`, `react-konva-utils`, `use-image`,
  `perfect-freehand` — **no URL known-good; construct from npm and verify**
- MDN entries for `createImageBitmap`, `OffscreenCanvas.convertToBlob`, `CanvasRenderingContext2D.filter`,
  `ImageDecoder`, AVIF/HEIC support — **TODO-VERIFY**
- Konva perf documentation and `Konva.Filters` list — **TODO-VERIFY**

---

## 11. 15-line summary

1. This session had **no web tools**, so every external fact is `TODO-VERIFY`; only repo-file claims are asserted, and every inference is labelled.
2. The repo already decodes with `createImageBitmap({ imageOrientation: 'from-image' })` plus two fallbacks [S11][S16] — no decoder library replaces anything.
3. The compositor's `CanvasLike` duck type already accepts `convertToBlob` and injectable canvas/decode factories [S11], so a worker offload is an injection change, not a rewrite.
4. **Inference:** the real high-resolution hotspot is the per-stroke full-resolution mask PNG encode on the main thread [S14][S13], not the paint loop — and no benchmark covers that path [S10].
5. Recommendation 1: add no dependency; keep the native decode/encode path.
6. Recommendation 2: measure the 25 MP stroke-end encode **before** building any worker.
7. Recommendation 3: if it stalls, use Vite's built-in module worker and `convertToBlob` — no Comlink, no pool; watch the extra ~100 MB RGBA copy.
8. Recommendation 4: replace the box-max dilation with an exact Euclidean distance transform; the code itself names this upgrade [S11], and it needs no package.
9. Recommendation 5: build sheets from `renderDocument` + `pdf-lib` (already a dependency) and consolidate ZIP on `fflate` — the repo currently has two ZIP writers [S18][S19].
10. Filters: `ctx.filter` already covers the documented filter set, and a WebGL filter lib would fork the single preview/export compositor [S11][S7].
11. Konva-layer helpers (`use-image`, `react-konva-utils`, `Konva.Filters`) have no remaining need here; the repo's own equivalents are ~14 lines and return the types the view layer needs [S15].
12. Cutout stays off: the blocker is **licences and weights distribution** (AGPL / non-commercial / hosted-and-paid), not a missing package [S7], and offline self-hosting is required [S1].
13. **No good library exists** for alpha-silhouette outlines, image-local erase masks, artwork-bounded transparent export, or permissively licensed offline general cutout — keep those hand-rolled.
14. New code question worth one test: EXIF-rotated JPEGs can size differently between the header parser [S17] and the decode path [S16]; latent today because the server rejects JPEG [S23].
15. Net: this dimension needs **no new dependency**; it needs one measurement, one algorithm upgrade, and one archive consolidation.

---

## Acceptance report

Review gate: required by reviewer. I produced a research artifact only; no repository file was
modified. The repository's project instructions (AGENTS.md) govern code changes, not this brief.

Evidence note for the reviewer: `changedFiles` lists the artifact path only, which is **outside**
the worktree (`/home/vdc/.pi/agent/sessions/...`), so no repo file changed. I could not run
`git status` because this runtime exposes no shell; `noStagedFiles: true` is asserted on that basis.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Wrote exactly the requested artifact at the authoritative output path covering dimensions (a)-(f). No scope widening: did not re-open canvas-engine replacement, text layout, persistence or UI libraries; explicitly deferred those in the header. Repo-grounded analysis, TODO-VERIFY fact table, mechanical checklist, 15-line summary."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "25 numbered local sources [S1]-[S25] with read scope and in-file dates; every factual claim carries an inline [S#]; a runtime-limitation disclosure explains why no external licence/version/date is asserted; contradictions and 7 missing-evidence items listed; 13-step mechanical checklist; unverified external URLs quarantined in a clearly-labelled non-source section."
    }
  ],
  "changedFiles": [
    "/home/vdc/.pi/agent/sessions/--home-vdc-Projects-Peeloodle--/subagent-artifacts/outputs/349ed5c8-59af-45db-97f8-a6a1b65cd7c4/outputs/library-upgrade-scan-research-canvas.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read AGENTS.md, CONTEXT.md, HANDOFF.md, package.json, README.md, docs/editor-library-research.md, docs/core-tools-plan.md, docs/slides-implementation-plan.md, docs/ui-audit.md, proofs/baseline.md, proofs/p07-processing.md",
      "result": "passed",
      "summary": "Context and prior-research constraints read; cutout audit table and build baseline harvested"
    },
    {
      "command": "read src/features/exports/renderDocument.ts, maskPainter.ts, useMaskBrush.ts, maskUtils.ts, KonvaCanvas.tsx, assets/validateUpload.ts, lib/imageFormat.ts, exports/zipExport.ts, presentations/exports/backup.ts, types/domain.ts, vite.config.ts, server/processing/probe.ts",
      "result": "passed",
      "summary": "Decode/encode, compositing, outline dilation, mask pipeline, Konva view layer and archive paths inspected as direct evidence"
    },
    {
      "command": "read node_modules/konva/package.json ; read node_modules/comlink/package.json",
      "result": "passed",
      "summary": "konva installed at 9.3.20; comlink ENOENT (node_modules is populated, so absence is meaningful)"
    },
    {
      "command": "web_search / fetch / source_check",
      "result": "not-run",
      "summary": "No web or shell tool is exposed to this subagent; external facts intentionally left TODO-VERIFY per the brief's hard rule"
    }
  ],
  "validationOutput": [
    "Deliverable file written to the authoritative path with: numbered source list, comparison table with TODO-VERIFY fact cells, inline [S#] on every claim, 5 ranked recommendations, 13 anti-recommendations, 5 'no good library exists' findings with the evidence reviewed, contradictions/missing-evidence section, 13-step verification checklist, quarantined unverified URLs, 15-line summary.",
    "Repo-grounded anchors: createImageBitmap({imageOrientation:'from-image'}) in both decode paths [S11][S16]; CanvasLike accepts convertToBlob and injectable factories [S11]; separable box-max dilation with an in-code Euclidean-DT upgrade note [S11]; full-resolution main-thread mask encode via HTMLCanvasElement.toBlob [S14][S13]; no worker config in vite.config.ts [S21]; two ZIP implementations (hand-rolled [S18] vs fflate [S19]); upload allowlist PNG/JPEG/static-WebP with APNG/animated-WebP rejection [S16][S17]; no EXIF logic in the header parser [S17]; KonvaCanvas chunk 314 kB / 97 kB gzip baseline [S24]."
  ],
  "residualRisks": [
    "No external licence, version, release date, maintenance signal, model size or benchmark is asserted anywhere in the artifact; the comparison table is deliberately unusable until the parent's fact pass fills it.",
    "No shell/search tool was available, so 'repo-wide absence of Web Workers' is only established for the files inspected (vite.config.ts, README, the editor/export modules).",
    "No measurement of the 25 MP mask-encode path was taken; the encode-is-the-hotspot ranking is explicitly labelled Inference and gates recommendation 3 behind a measurement.",
    "The EXIF orientation-6/8 header-vs-decode dimension mismatch is Inference, not reproduced; it is a checklist item, not a reported bug.",
    "The 'no good library exists' claims are bounded by the libraries the repo already reviewed plus my domain knowledge, since no package registry search was possible.",
    "git status could not be run (no shell); noStagedFiles is asserted on the basis that the only file written is outside the worktree."
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository files changed. One new Markdown artifact written outside the worktree at the authoritative output path.",
  "reviewFindings": [
    "No blockers in scope: the artifact satisfies the requested structure and the supervisor's mid-run steer (repo-grounded analysis + ranking, TODO-VERIFY fact cells, mechanical checklist).",
    "Reviewer note: judge only the repo-grounded claims and the ranking; the fact table is intentionally empty of numbers.",
    "Reviewer note: item 5 of the missing-evidence list (all external licences/versions/dates) is the only requirement of the original brief not satisfied, and it is satisfied-by-disclosure rather than by fabrication."
  ],
  "manualNotes": "The single most useful next action is checklist item 10 (25 MP mask-stroke encode measurement) — it is the only decision gate that changes the ranking. Second most useful is item 9 (EXIF orientation-6 fixture), a one-test question. Everything else in my dimension resolves to 'no new dependency'."
}
```
