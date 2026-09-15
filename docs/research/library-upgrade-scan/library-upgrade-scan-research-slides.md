# Research: slides / text / document-content libraries for StickerLab

Dimension covered: **slides, text, and document content** — (a) text shaping/measurement consistency
between canvas and PPTX/PDF export, (b) slide-ready content primitives and export fidelity,
(c) PPTX/PDF generation and import, (d) thumbnailing and honest notes on server-side conversion,
(e) template/preview rendering and font loading.

Out of scope by instruction and by prior work: canvas engines, persistence/sync, general UI
libraries. `docs/editor-library-research.md` already settled the canvas engine [S24]; this brief
does not reopen it, does not propose replacing Konva/React/Vite/Zustand, and does not re-recommend
a full editor SDK.

---

## 0. Verification status of this document (read first)

**This subagent session had no `web_search`, fetch, or `source_check` capability registered.**
Only local file reading and writing were available. Therefore:

- **No external URL was fetched.** Nothing in this document was verified against a first-party
  website, npm registry page, or repository during this run.
- **Every external-package fact cell reads `TODO-VERIFY`** (licence, latest version, release date,
  maintenance signal, React 18 support, bundle cost). No version number, licence, date, or size is
  guessed anywhere in this document.
- Claims are labelled **Evidence** (read directly from a repository file this session),
  **Interpretation** (what a fetched source states, inferred by me from local artefacts), or
  **Inference** (my reasoning from local evidence plus general engineering knowledge).
- The only version/licence strings present are ones I read out of this repository's own
  `package.json` and `node_modules/*/package.json` files.
- §6 is a mechanical checklist the parent can run with web access to fill the `TODO-VERIFY` cells.

**Consequence:** the _ranking_ and _"no library needed / no library exists"_ conclusions below are
grounded in repo evidence and are safe to act on. The _fact table_ is not evidence yet.

---

## 1. Sources

### 1.1 Local first-party sources actually read this session

| ID    | Source                                                          | Type                                                                                                                                                                                                   | Status                             |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| [S1]  | `/home/vdc/Projects/Peeloodle/AGENTS.md`                        | Repo spec (binding constraints)                                                                                                                                                                        | Read in full                       |
| [S2]  | `/home/vdc/Projects/Peeloodle/package.json`                     | Repo manifest (declared dep versions, scripts)                                                                                                                                                         | Read in full                       |
| [S3]  | `node_modules/pptxgenjs/package.json`                           | Installed first-party package metadata → **pptxgenjs 4.0.1, `license: MIT`**                                                                                                                           | Read in full                       |
| [S4]  | `node_modules/pdf-lib/package.json`                             | Installed package metadata → **pdf-lib 1.17.1, `license: MIT`**; deps `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, `tslib`; **`@pdf-lib/fontkit` is a _devDependency_ only, not a runtime dep** | Read in full                       |
| [S5]  | `node_modules/fflate/package.json`                              | Installed package metadata → **fflate 0.8.3, `license: MIT`**                                                                                                                                          | Read in full                       |
| [S6]  | `node_modules/fast-xml-parser/package.json`                     | Installed package metadata → **fast-xml-parser 5.11.1, `license: MIT`**                                                                                                                                | Read in full                       |
| [S7]  | `node_modules/jszip/package.json`                               | Present transitively (pptxgenjs dep) → **jszip 3.10.2, `license: "(MIT OR GPL-3.0-or-later)"`**                                                                                                        | Read in full                       |
| [S8]  | `node_modules/image-size/package.json`                          | Present transitively (pptxgenjs dep) → **image-size 1.2.1, `license: MIT`**                                                                                                                            | Read in full                       |
| [S9]  | `node_modules/konva/package.json`                               | Context only (size-limit budgets, `license: MIT`, 9.3.20)                                                                                                                                              | Read in full                       |
| [S10] | `src/features/presentations/rendering/textLayout.ts`            | Repo source: the authoritative text layout service                                                                                                                                                     | Read in full                       |
| [S11] | `src/features/presentations/rendering/fonts.ts`                 | Repo source: font IDs, `@font-face` list, `ensurePresentationFonts()`                                                                                                                                  | Read in full                       |
| [S12] | `src/features/presentations/editor/textBridge.ts`               | Repo source: DOM ⇄ paragraph/run bridge                                                                                                                                                                | Read in full                       |
| [S13] | `src/features/presentations/rendering/konvaText.ts`             | Repo source: Konva text nodes + `konvaTextWidth`                                                                                                                                                       | Read in full                       |
| [S14] | `src/features/presentations/exports/pdf.ts`                     | Repo source: raster PDF via `pdf.embedPng`                                                                                                                                                             | Read in full                       |
| [S15] | `e2e/proofs/text-bridge.spec.ts`                                | Executed proof (P04): DOM line boxes vs shared layout, Konva widths, IME, paste                                                                                                                        | Read in full                       |
| [S16] | `proofs/p05-fonts.md`                                           | Proof record (P05): font choice, coverage, PPTX stress fixture through LibreOffice                                                                                                                     | Read in full                       |
| [S17] | `proofs/p17-text-editing.md`                                    | Proof record (P17): DOM overlay editing, one undo entry per session, save/reopen                                                                                                                       | Read in full                       |
| [S18] | `proofs/pptx/exportFixture.ts`, `proofs/pptx/generateStress.ts` | Proof code (P03/P05): the exact pptxgenjs API surface used and confirmed                                                                                                                               | Read in full                       |
| [S19] | `docs/slides-architecture.md`                                   | Repo architecture contract (text, export, catalog, limits)                                                                                                                                             | Read in full                       |
| [S20] | `docs/slides-implementation-plan.md`                            | Repo plan: included vs **deferred** scope (native charts/tables/equations, import)                                                                                                                     | Read in full                       |
| [S21] | `docs/core-tools-plan.md`                                       | Repo plan/bug record for the sticker editor (licence review discipline, catalog assets)                                                                                                                | Read in full                       |
| [S22] | `HANDOFF.md`                                                    | Current increment, interfaces, guardrails                                                                                                                                                              | Read in full                       |
| [S23] | `node_modules/@pdf-lib/fontkit/` → **absent** (`ENOENT`)        | Negative evidence: pdf-lib custom-font support is _not_ installed                                                                                                                                      | Verified by failed read            |
| [S24] | `docs/editor-library-research.md`                               | Prior art: canvas-engine question already settled                                                                                                                                                      | Read in full (scope boundary only) |

### 1.2 External verification targets — **URLs NOT FETCHED in this run**

Listed so the parent's fact pass has the exact targets. **These are not citations**; no claim in this
document rests on their content. Fetch date for all: _not fetched (no web tool in this session)_.

| Target                        | URL to fetch                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| PptxGenJS (installed)         | https://github.com/gitbrent/PptxGenJS · https://gitbrent.github.io/PptxGenJS/                   |
| pdf-lib                       | https://github.com/Hopding/pdf-lib · https://pdf-lib.js.org/                                    |
| @pdf-lib/fontkit              | https://www.npmjs.com/package/@pdf-lib/fontkit                                                  |
| harfbuzzjs                    | https://github.com/harfbuzz/harfbuzzjs                                                          |
| fontkit                       | https://github.com/foliojs/fontkit                                                              |
| opentype.js                   | https://github.com/opentypejs/opentype.js                                                       |
| hypher / hyphenation patterns | https://github.com/bramstein/hypher                                                             |
| linebreak (UAX #14)           | https://github.com/foliojs/linebreak                                                            |
| css-line-break                | https://github.com/niklasvh/css-line-break                                                      |
| Chart.js                      | https://github.com/chartjs/Chart.js                                                             |
| Apache ECharts                | https://github.com/apache/echarts                                                               |
| Vega-Lite / Vega              | https://github.com/vega/vega-lite · https://github.com/vega/vega                                |
| Recharts                      | https://github.com/recharts/recharts                                                            |
| Mermaid                       | https://github.com/mermaid-js/mermaid                                                           |
| KaTeX                         | https://github.com/KaTeX/KaTeX                                                                  |
| MathJax                       | https://github.com/mathjax/MathJax                                                              |
| mammoth (docx→HTML)           | https://github.com/mwilliamson/mammoth.js                                                       |
| JSZip                         | https://github.com/Stuk/jszip                                                                   |
| jsPDF                         | https://github.com/parallax/jsPDF                                                               |
| libreoffice-wasm / ZetaOffice | https://github.com/zetaoffice (org) — verify what actually exists today                         |
| `Intl.Segmenter` support      | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter |
| WOFF2                         | https://www.w3.org/TR/WOFF2/ · https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face      |

---

## 2. What the repository already does (evidence, not opinion)

These are the facts the recommendations are built on. All are **Evidence** unless labelled.

1. **The paragraph/run model is authoritative and HTML is never persisted.** The DOM overlay is
   seeded from (`paragraphsToHtml`) and read back through (`readParagraphsFromDom`) the model;
   paste is parsed in an inert `<template>` and normalized. [S12], confirmed by [S17].
2. **Layout is a pure module with an injected `measure`.** In the browser it is
   `ctx.measureText(text)` with the CSS font shorthand built by `cssFontFor(spec)`. [S10], [S15].
3. **Wrapping is greedy on whitespace only.** `tokenizeParagraph` splits on `/(\n|\s+)/`; an
   over-long token is hard-split with a binary search and a surrogate-pair guard. There is **no
   UAX #14 line-break handling, no hyphenation, no bidi, and no CJK/Thai/Khmer break rules** in the
   module. [S10] — I read the whole file; this is a direct-evidence statement.
4. **Justification is implemented** by distributing the remaining space across space characters of
   all lines except the last paragraph line. [S10].
5. **DOM↔canvas↔Konva parity is _measured and enforced_, not assumed.** The P04 proof compares
   per-character Range rects in the DOM overlay against the shared layout for a title and a dense
   nested-bullet element, with tolerances ≤2 u vertical centre, ≤2.5 u left, ≤3 u right, and
   asserts Konva `getTextWidth()` vs canvas `measureText` within 0.5 u. [S15].
6. **Fonts are eight static TTFs served from `public/`** (Be Vietnam Pro + Spectral, regular/bold/
   italic/bold-italic, SIL OFL 1.1, full Vietnamese extended range verified with `fc-query`,
   ≈1.6 MB total, fetched on demand), and `ensurePresentationFonts()` is a mandatory gate before
   measuring/rendering/exporting. Documents store a stable font ID, never a CSS family name. [S11],
   [S16].
7. **PPTX output is native, and that path is proven for text/shape/image.** The proof adapter emits
   per-run `fontFace/fontSize/color/bold/italic`, `hyperlink`, paragraph `align`, `indentLevel`,
   bullets (`characterCode '2022'` or `{type:'number', numberType:'arabicPeriod', numberStartAt}`),
   `lineSpacingMultiple`, `wrap: true`; `addShape` for rect/roundRect/ellipse/line/arrow;
   `addImage` with `flipH/flipV/transparency/altText`. Verified by converting with LibreOffice
   26.8.0.3 and reading the PDF text: 960.009 × 540 pt pages, every expected Vietnamese string
   present, title wrapping to four lines with diacritics intact. [S16], [S18].
8. **One real PPTX defect was found and fixed during the proof**: consecutive numbered paragraphs
   each rendered `1.` until explicit `numberStartAt` values were emitted. The adapter layer — not
   pptxgenjs — carried the risk. [S16], [S18].
9. **PDF is deliberately image-based**: 1920×1080 PNG per slide embedded with `pdf.embedPng`,
   page size exactly 960×540 points, producer/creator set, and "text selection and PDF hyperlinks
   are not provided" documented in the module. [S14].
10. **PPTX fonts are referenced by family name only; embedding is explicitly not promised.**
    [S16] ("PPTX references fonts by family name; a viewer without the fonts installed substitutes
    metrics… state the font requirement (or bundle fonts)"), [S19] ("PPTX font embedding is not
    promised until independently proven").
11. **The thin parsing stack for Office files is already in the repo**: `fflate` 0.8.3 (MIT) for ZIP
    [S5], `fast-xml-parser` 5.11.1 (MIT) for XML [S6], plus `jszip` 3.10.2 present transitively via
    pptxgenjs [S3], [S7]. So a PPTX/DOCX _parse_ would need **zero new parsing dependencies**.
12. **Content primitives beyond text/shape/image are formally deferred**: the plan's Deferred list
    includes "native charts/tables/equations" and "PPTX/PDF import", with the instruction that
    chart/table-looking template layouts use shapes/text or image placeholders and "must not imply
    native chart/data editing". [S20].
13. **The builder of the pdf custom-font path is not installed**: `@pdf-lib/fontkit` is absent from
    `node_modules`; pdf-lib lists it only as a devDependency. [S4], [S23].
14. **Presentation text must not use the sticker fonts** (Latin-only, no true italics) — this is both
    a font-choice decision [S16] and a handoff guardrail [S22].
15. **Server-side native image work is confined to a Node processing probe** (`sharp`, `@resvg/resvg-js`
    are declared dependencies) and the architecture requires native processing deps to stay out of
    the browser bundle. [S2], [S19].

---

## 3. Fact table — **all external cells are `TODO-VERIFY`** (parent's fact pass)

Rules applied: no guessed numbers. `TODO-VERIFY` = fetch the first-party source and the npm registry.
Effort scale: **S** ≤ 1 day, **M** ≈ 2–5 days, **L** > 1 week (**Inference**, not a quote).
"Adds/replaces in THIS repo" is grounded in §2 evidence.

### 3.1 Already installed and load-bearing

| Library                                                                                   | Licence                           | Latest version + release date                          | Maintenance signal | React 18 support    | Bundle cost                                                                                                  | What it adds/replaces here                                                                                     | Effort | Risk / caveats                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ | ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pptxgenjs** (installed, verified **4.0.1 / MIT** [S3])                                  | MIT (local)                       | `TODO-VERIFY` (is 4.0.1 latest?)                       | `TODO-VERIFY`      | N/A (no React peer) | `TODO-VERIFY` (pulls jszip + image-size; `browser` map stubs out `fs`/`https`/`image-size`/`os`/`path` [S3]) | Stays. Nothing better found under the constraints; the editable-text contract depends on it [S2], [S16], [S19] | —      | Fonts by name only, no embedding [S16]; SVG image compatibility limitation (cited first-party in [S19]); adapter-level quirks like `numberStartAt` are _our_ risk [S16] |
| **pdf-lib** (installed, verified **1.17.1 / MIT** [S4])                                   | MIT (local)                       | `TODO-VERIFY` (last release date + maintenance status) | `TODO-VERIFY`      | N/A                 | `TODO-VERIFY` (deps: standard-fonts, upng, pako, tslib [S4])                                                 | Stays for the raster-page PDF contract [S14]                                                                   | —      | No selectable text in the current contract; custom-font embedding needs `@pdf-lib/fontkit`, which is **not installed** [S4], [S23]                                      |
| **fflate** (installed, verified **0.8.3 / MIT** [S5])                                     | MIT (local)                       | `TODO-VERIFY`                                          | `TODO-VERIFY`      | N/A                 | `TODO-VERIFY` (self-described ~8 kB class)                                                                   | Stays: backup ZIP + would serve PPTX/DOCX unzip without a new dep [S2], [S5]                                   | —      | Archive limits must be enforced by the importer, not the library [S19]                                                                                                  |
| **fast-xml-parser** (installed, verified **5.11.1 / MIT** [S6])                           | MIT (local)                       | `TODO-VERIFY`                                          | `TODO-VERIFY`      | N/A                 | `TODO-VERIFY`                                                                                                | Stays: PPTX/DOCX XML if import is ever attempted [S2], [S6]                                                    | —      | XML alone is not the hard part of OOXML (§5.6)                                                                                                                          |
| **jszip** (present transitively, verified **3.10.2**, `"(MIT OR GPL-3.0-or-later)"` [S7]) | MIT **or** GPL-3.0+ (dual; local) | `TODO-VERIFY`                                          | `TODO-VERIFY`      | N/A                 | `TODO-VERIFY`                                                                                                | **Do not add as a direct dependency**: `fflate` is already direct and does ZIP [S2], [S5]                      | —      | Dual licence is fine via the MIT option, but record it; two ZIP libraries in one bundle is waste                                                                        |

### 3.2 Text shaping / measurement / line breaking (candidates)

| Library                                 | Licence        | Latest version + release date | Maintenance signal | React 18 support | Bundle cost                                     | What it adds/replaces here                                                                                                                  | Effort | Risk / caveats                                                                                                                                                                      |
| --------------------------------------- | -------------- | ----------------------------- | ------------------ | ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **harfbuzzjs** (WASM port)              | `TODO-VERIFY`  | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY` (WASM payload — must be measured) | Would place a **second** shaping engine beside the browser's, which the canvas _and_ the DOM overlay both already share [S10], [S12], [S15] | L      | Directly threatens the measured P04 DOM↔canvas parity [S15]; only earns its keep for shaping _without_ a browser (e.g. Node-side layout), which this architecture avoids [S19]      |
| **fontkit**                             | `TODO-VERIFY`  | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY`                                   | Font subsetting (to shrink the ≈1.6 MB font payload [S16]) and/or metrics extraction; **not** needed for layout today                       | M      | Subsetting output must be re-verified against the P04 parity spec; a subset must keep Vietnamese coverage [S15], [S16]                                                              |
| **opentype.js**                         | `TODO-VERIFY`  | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY`                                   | Glyph outlines / text-to-path                                                                                                               | M–L    | Text-to-path contradicts the required editable PPTX text [S16], [S19], [S20]; shaping/bidi coverage must be verified before any use                                                 |
| **hypher** (+ language pattern sets)    | `TODO-VERIFY`  | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY` (+ dictionary bytes)              | Hyphenation quality in narrow boxes                                                                                                         | S–M    | Requires the **DOM overlay to break identically**, or P04 parity regresses [S15]; Vietnamese is space-separated, so the benefit is unproven — and PPTX readers re-wrap anyway [S16] |
| **linebreak** (UAX #14)                 | `TODO-VERIFY`  | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY`                                   | Replaces the whitespace-only tokenizer assumption [S10] for Thai/Khmer/CJK and punctuation rules                                            | S–M    | Parity re-run required [S15]; value is zero for the current English/Vietnamese-only scope [S16], [S20]                                                                              |
| **css-line-break**                      | `TODO-VERIFY`  | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY`                                   | Overlaps `linebreak`; alternative implementation                                                                                            | S–M    | Verify it is maintained and browser-buildable; same parity risk                                                                                                                     |
| **`Intl.Segmenter`** (platform, no dep) | N/A (platform) | N/A                           | N/A (browser)      | N/A              | 0 kB                                            | Would replace the whitespace tokenizer _and_ the surrogate-pair guard in `largestFittingPrefix` [S10]                                       | S      | Browser-support check + parity re-run [S15]; a behaviour change to proven layout code                                                                                               |

### 3.3 Slide-ready content primitives (charts / diagrams / math / tables / icons)

| Library                                               | Licence                                                         | Latest version + release date                    | Maintenance signal                              | React 18 support            | Bundle cost                  | What it adds/replaces here                                                                           | Effort | Risk / caveats                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- | --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chart.js** (canvas-first)                           | `TODO-VERIFY`                                                   | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | N/A (framework-agnostic)    | `TODO-VERIFY`                | Gets a chart onto the Konva slide as a **PNG snapshot** through the existing image path [S19], [S20] | S–M    | Editing is not preserved; fonts/DPR must be set explicitly for export-grade pixels (Inference)                                                                        |
| **Apache ECharts**                                    | `TODO-VERIFY`                                                   | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | N/A                         | `TODO-VERIFY`                | Same as Chart.js with more chart types                                                               | M–L    | Bundle cost vs the AGENTS "small dependency footprint" rule [S1]; only justified by real feature pressure                                                             |
| **Vega-Lite + Vega**                                  | `TODO-VERIFY`                                                   | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | React wrapper `TODO-VERIFY` | `TODO-VERIFY` (two packages) | Declarative specs, canvas/SVG renderers                                                              | L      | Two-package runtime; SVG output would need rasterizing for PPTX pictures [S19]                                                                                        |
| **Recharts**                                          | `TODO-VERIFY`                                                   | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | `TODO-VERIFY`               | `TODO-VERIFY`                | React SVG charts                                                                                     | M      | SVG/DOM-first: needs an SVG→raster step before it can be a PPTX picture (Inference); DOM measurement/async vs the canvas renderer                                     |
| **pptxgenjs native charts** (already installed [S3])  | MIT (local)                                                     | `TODO-VERIFY` (chart API surface + known limits) | `TODO-VERIFY`                                   | N/A                         | 0 kB additional              | Editable data charts inside PPTX                                                                     | M      | Renders **nothing** in the browser → preview must come from a second renderer → permanent preview/export divergence (Inference); not verified in this repo            |
| **pptxgenjs native tables** (already installed [S3])  | MIT (local)                                                     | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | N/A                         | 0 kB additional              | Editable PPTX table                                                                                  | M      | The document model has no table element, and paste currently flattens `td/th/li/h1-6` into text lines [S12], [S19]; a modelling project first                         |
| **Mermaid**                                           | `TODO-VERIFY`                                                   | `TODO-VERIFY`                                    | `TODO-VERIFY` (incl. security advisory history) | `TODO-VERIFY`               | `TODO-VERIFY` (large)        | Diagrams rendered to SVG in the DOM, then rasterized                                                 | M      | User-supplied diagram source is an injection surface (Inference — verify advisories); result is a picture, not editable PPTX content                                  |
| **KaTeX**                                             | `TODO-VERIFY`                                                   | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | React wrapper `TODO-VERIFY` | `TODO-VERIFY` + font files   | Fast math typesetting into DOM/HTML                                                                  | M      | HTML/CSS output is not canvas or OOXML; would need a snapshot path. Equations in PPTX would ideally be OMML — no mapping library identified (§5.4)                    |
| **MathJax** (`tex-svg`)                               | `TODO-VERIFY` (repo states Apache-2.0 for v3 — **TODO-VERIFY**) | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | N/A                         | `TODO-VERIFY` (large)        | Math → **SVG**, which is the more export-friendly output of the two                                  | M      | Larger than KaTeX; SVG→PNG rasterization still required for PPTX/PDF [S14], [S19]                                                                                     |
| **lucide-react** (already installed, `^0.468.0` [S2]) | `TODO-VERIFY`                                                   | `TODO-VERIFY`                                    | `TODO-VERIFY`                                   | React 18 (in use today)     | `TODO-VERIFY`                | Icons in _DOM_ UI                                                                                    | S      | SVG icons cannot be dropped into Konva; the sticker catalog already ships licensed raster assets [S21] — keep icons as catalog images rather than adding a rasterizer |

### 3.4 Deck import / conversion

| Library / approach                                                                   | Licence                                                         | Latest version + release date | Maintenance signal | React 18 support | Bundle cost                                   | What it adds/replaces here                         | Effort         | Risk / caveats                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------- | ------------------ | ---------------- | --------------------------------------------- | -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hand-rolled PPTX parse** (`fflate` + `fast-xml-parser`, both installed [S5], [S6]) | MIT (local)                                                     | N/A                           | N/A                | N/A              | 0 kB new                                      | A reading path for `.pptx`                         | **L** (Tier 1) | Not a library problem: theme/master/layout inheritance, autofit text scaling, groups, charts, SmartArt, embedded fonts must each be handled or dropped; model has no representation for most of it [S19] |
| **mammoth** (docx→HTML) + existing `htmlToParagraphs` [S12]                          | `TODO-VERIFY`                                                   | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY`                                 | "Paste a written assignment → outline text" import | M              | No layout fidelity; still needs a chunk-to-slides heuristic; HTML is explicitly **not** the model authority [S19]. Plan defers arbitrary import [S20]                                                    |
| **libreoffice-wasm / ZetaOffice-class browser conversion**                           | `TODO-VERIFY` (LibreOffice itself is MPL-2.0 — **TODO-VERIFY**) | `TODO-VERIFY`                 | `TODO-VERIFY`      | N/A              | `TODO-VERIFY` (payload is the whole question) | Would give real fidelity conversion in the browser | L              | Almost certainly violates "small dependency footprint" and offline cold-start [S1] (Inference); verify whether a maintained build even exists (§6)                                                       |
| **Server-side LibreOffice container**                                                | `TODO-VERIFY`                                                   | N/A                           | N/A                | N/A              | N/A (server)                                  | Server fidelity conversion                         | L              | **Non-option for this product**: browser-only/offline-first core editing [S1], [S19]; new paid service; hostile-input sandboxing. LibreOffice's legitimate role here is a _test reader_ [S16]            |

---

## 4. Analysis (repo-grounded)

### 4.1 (a) Text shaping and measurement consistency canvas ⇄ DOM ⇄ PPTX ⇄ PDF

**Finding A1 (Evidence).** The consistency strategy is already the right one and is _measured_: one
authoritative paragraph/run model, one injected-measure layout service, DOM overlay for caret work,
Konva text nodes for painting, and an executed Playwright proof asserting agreement (≤2 u centres,
≤2.5 u left, ≤3 u right, Konva↔canvas ≤0.5 u). [S10], [S12], [S15]

**Finding A2 (Evidence).** Nothing in the pipeline needs a shaping library _while a browser renders_:
both `measureText` and the DOM overlay go through the same platform shaping stack, which is exactly
why the parity proof passes on Vietnamese. [S10], [S12], [S15]

**Finding A3 (Inference, high confidence).** Adding harfbuzzjs/fontkit/opentype.js as a _layout_
engine would create a second text engine and immediately put the P04 parity property at risk; it
would only pay off for shaping without a browser (Node-side layout), which the architecture avoids
server-renders student content. This is the strongest "don't do it" in this brief.

**Finding A4 (Evidence + Inference).** The real cross-engine gap is PPTX: pptxgenjs writes text as
runs with a font family name and the _reader_ re-wraps. The proof verified content presence and
page geometry through LibreOffice→PDF, not identical line breaks. [S16] Therefore no library can
deliver identical wrapping in PowerPoint, and the honest product stance is "content and structure
preserved, line breaks may differ", plus a documented font requirement.

**Finding A5 (Evidence).** Width/line-breaking quality limits are explicit in code: whitespace-only
tokenization, binary-search hard splits, no hyphenation, no UAX #14, no bidi. [S10] For the stated
English/Vietnamese scope [S16], [S20] that is adequate; it becomes wrong the moment a template
catalog carries Thai/Khmer/CJK text.

**Finding A6 (Evidence).** PDF is raster by contract, so "measurement consistency with PDF" reduces
to "raster the same renderer used on canvas" — which `renderSlide` + `buildRasterPdf` already do
(1920×1080 PNG per 960×540 pt page). [S14], [S19]

**Finding A7 (Inference, medium).** If hyphenation/justification quality ever matters enough to add
`hypher`, the DOM overlay must apply the _same_ break points (manual break insertion or CSS
`hyphens` with identical dictionaries), or the proven parity property regresses — a library change
here is cheap to add and expensive to keep consistent. Prefer `Intl.Segmenter` (no dependency) for
any UAX #14 need before adding a package.

**Finding A8 (Inference, medium).** Rich-text editors (ProseMirror/Tiptap/Lexical/Slate/Quill) are
DOM-first by design: they own the editing tree and expose selection, not per-run line boxes in _your_
coordinate space. The repo's overlay + model + layout service is the standard way to get both caret
behaviour and canvas parity; swapping in one of these frameworks is a large migration that does not
solve measurement. Licences/versions for all of them: `TODO-VERIFY` (all are permissive in practice
per prior knowledge, but this document asserts nothing).

### 4.2 (b) What actually survives export

Direct evidence: text runs / bullets / numbered bullets / hyperlinks / shapes / images were verified
in a generated PPTX read by LibreOffice 26.8.0.3 [S16], [S18]. Everything else in this table is
**Inference** from the model contract [S19] and the plan's deferred list [S20] — nothing else was
exported or read by any app in this repo.

| Slide content                                       | Konva canvas                                                          | PDF (current contract)  | PPTX (current contract)                                                                | Note                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Paragraphs, runs, bold/italic, size, colour         | Yes [S10], [S13]                                                      | Pixels only [S14]       | Native, proven [S16], [S18]                                                            | Fonts by name; reader substitutes if missing [S16]                                                     |
| Bullets + numbering, indent levels                  | Yes [S10]                                                             | Pixels                  | Native, proven (incl. the `numberStartAt` fix) [S16], [S18]                            |                                                                                                        |
| Hyperlinks                                          | Underlined only (no click) [S12]                                      | **Not preserved** [S14] | Native `hyperlink` in the proof adapter [S18]                                          |                                                                                                        |
| Alignment / justify / line spacing / vertical align | Yes [S10]                                                             | Pixels                  | Mapped in the proof adapter [S18]                                                      | Complex-script justification is not implemented                                                        |
| Shapes: rect, roundRect, ellipse, line, arrow       | Yes [S19]                                                             | Pixels                  | Native [S18]                                                                           |                                                                                                        |
| Images / sticker snapshots                          | Yes                                                                   | Pixels                  | Separate movable pictures [S18], [S19]                                                 | Crop/flip/opacity: flip+transparency mapped; unrepresentable crop is baked into pixels by design [S19] |
| SVG artwork                                         | Inserted as an image [S20]                                            | Pixels                  | As PNG picture (SVG compatibility limitation noted first-party) [S19]                  |                                                                                                        |
| Tables                                              | **No table element**; paste flattens cells to text lines [S12], [S19] | Pixels                  | `addTable` exists in pptxgenjs but is untested here (`TODO-VERIFY`)                    | Modelling work, not a library gap                                                                      |
| Charts                                              | Not implemented [S20]                                                 | Pixels                  | Native charts exist in pptxgenjs (untested here) and would be **invisible in the app** | Preview/export divergence unless rasterized                                                            |
| Equations (KaTeX/MathJax)                           | Would be a snapshot only                                              | Pixels                  | A picture, not editable math                                                           | OMML mapping not identified (§5.4)                                                                     |
| Diagrams (Mermaid)                                  | Would be a snapshot only                                              | Pixels                  | A picture                                                                              | Injection surface to review                                                                            |
| Animations / transitions / video / audio            | Out of scope [S20]                                                    | No                      | No                                                                                     |                                                                                                        |
| Speaker notes                                       | Out of scope [S20]                                                    | No                      | pptxgenjs supports notes (`TODO-VERIFY` API)                                           | Not a v1 concern                                                                                       |

### 4.3 (c) PPTX/PDF generation, and import feasibility

**PPTX generation.** Nothing better than pptxgenjs was found for this constraint set: browser-capable,
MIT (locally verified [S3]), already integrated, and the only path in this repo that satisfies the
"editable text" requirement [S16], [S18], [S19]. The alternatives are server-side or non-browser
runtimes, commercial/paid SDKs, or different formats — all of which conflict with at least one of
[S1]'s constraints. The two _real_ weaknesses are (i) referenced-not-embedded fonts [S16], [S19] and
(ii) adapter-level correctness, which is ours to test (the `numberStartAt` bug [S16]).

**PDF generation.** pdf-lib (MIT, locally verified [S4]) satisfies the deliberate raster contract
[S14]. A selectable-text PDF is a _product_ change: it would need `@pdf-lib/fontkit` (verified
absent [S4], [S23]) or a different generator (e.g. jsPDF — `TODO-VERIFY`), plus text-layout parity
work, and it is not requested by the plan [S20].

**PPTX import — is it realistic in-browser?** Parsing is not the obstacle: the ZIP and XML libraries
are already present for free [S5], [S6], [S7]. The obstacles are semantic and permanent:

1. Geometry is EMU-based and slide size varies; the model is fixed 1280×720 [S19].
2. Visible text properties come from inheritance: theme → slide master → layout → placeholder → run.
   The model has flat per-run formatting [S19].
3. Text autofit ("shrink text on overflow") has no model representation and cannot be reproduced
   without running the reader's layout engine.
4. Unsupported parts (charts, SmartArt, groups, embedded objects, embedded fonts, notes, animations)
   must be dropped or flattened — each one a fidelity decision the user must be told about.
5. Crops, rotation, and effects are a long tail; the model supports a subset [S19].

**Tiering proposal (Inference):** Tier 0 = accept a deck as fixed images/picture placeholders (honest
"your slides become images"); Tier 1 (_M–L_) = resolve placeholders into editable text frames + runs +
pictures, drop the rest with a per-slide report; Tier 2 (_L/XL_) = tables/charts/group mapping, and
permanent fidelity debt. Recommendation: **do not promise deck import in this release** [S20 already
defers it]; if real students ask, ship Tier 0/1 and label it explicitly.

**DOCX import (Inference, M).** The interesting small path is mammoth (docx→HTML, `TODO-VERIFY`)
feeding the _existing_ `htmlToParagraphs` normalizer, which already flattens `li`/`p`/`td`/`th`/`h1-6`
into paragraphs and strips unsafe markup [S12]. That yields "import an assignment outline into
slides", not layout fidelity, and still needs a chunking heuristic. Cheap to prototype; cheap to
abandon.

### 4.4 (d) Thumbnails, previews, and server-side conversion

- **Thumbnails need no library (Inference, high confidence).** The fixed-page renderer already
  produces deterministic slides and Konva stages are already rasterized to PNG in proofs [S15],
  [S17]. Render at a small scale, sequentially, and yield between slides — the architecture already
  requires sequential slide rasterization to bound memory [S19].
- **The two libraries that would help thumbnailing in _Node_ are native modules already present for
  the server probe**: `sharp` and `@resvg/resvg-js` [S2], and the architecture forbids native
  processing dependencies in the browser bundle [S19]. So they are not a browser thumbnail option,
  and no browser substitute is needed.
- **Font-gated previews are a real hazard.** If a preview is captured before `ensurePresentationFonts()`
  resolves, it silently renders fallback metrics; the P04 proof documents that DOM and canvas metrics
  diverge while faces load [S16]. Template previews must additionally be bound to the snapshot
  revision/hash so a stale preview cannot advertise an edited deck [S19].
- **Server-side conversion (LibreOffice) is a non-option for the product** (Inference + [S1], [S19]):
  it means a second always-on service, hostile-file sandboxing, and a network dependency in an
  offline-first app, and it would be the only place "local-first" breaks. A WASM LibreOffice is the
  same trade in the browser with a large payload; whether a maintained build exists at all is
  `TODO-VERIFY` (§6). The repo's existing use of LibreOffice — as a _test reader_ to validate exported
  PPTX — is the right role [S16], [S19].

### 4.5 (e) Template and preview rendering with a curated font catalog

- **Current state (Evidence).** Two families, eight static TTFs, ≈1.6 MB, full Vietnamese coverage,
  OFL 1.1, provenance and upstream blob hashes recorded; stable font IDs in documents; a single
  mandatory `ensurePresentationFonts()` gate; unknown font IDs fall back and are surfaced as
  `missingFontIds` in layout results. [S10], [S11], [S16]
- **Template catalog consequence (Inference).** Every published template must pin its font IDs and
  ship/licence those files; the catalog already requires provenance for artwork [S1], [S19], and the
  same discipline applies to fonts. A template that uses a font the app does not serve will render
  with fallback metrics in the editor and substitute in PowerPoint.
- **Cheapest measurable improvement (Inference, medium confidence):** serve WOFF2 derivatives of the
  same eight faces (same `@font-face` families, same `FontFace` API, canvas measurement unchanged
  once loaded) and preload only the faces the visible previews need instead of all eight in one
  promise ([S11] loads every face). Both are small edits to `fonts.ts`/CSS plus a provenance note;
  the correct check is re-running the P04 parity spec [S15] and the P05 stress export [S16].
  `TODO-VERIFY`: WOFF2 size reduction claims (do not quote numbers until measured locally).
- **Do not** solve font fidelity by embedding fonts in PPTX in this release: the capability is
  explicitly not promised [S19], and no maintained permissive browser library for OOXML font
  embedding was identified (§5.2). Document the requirement instead.

---

## 5. Where NO good library exists (with the evidence that I looked)

### 5.1 Cross-engine text re-layout parity

**No library.** Nothing reconciles browser wrapping, the DOM caret, PowerPoint's own wrapping, and
the raster PDF's baking. Evidence: the repo solves it with its own layout service plus an executed
parity proof limited to DOM↔canvas [S10], [S15]; the PPTX proof checked text _presence_ and page
geometry, not identical line boxes [S16].

### 5.2 In-browser PPTX font embedding / subsetting

**No library identified.** Evidence of looking: `@pdf-lib/fontkit` absent from `node_modules`
[S23]; the pptxgenjs surface used by the proof adapter has no font-embedding call [S18]; the
architecture declines to promise embedding pending independent proof [S19]. `TODO-VERIFY` externally
whether any permissive package writes OOXML embedded-font parts.

### 5.3 Faithful PPTX/DOCX import into a foreign document model

**No library.** Every product does a lossy best-effort. Evidence: parsing deps already exist at zero
cost [S5], [S6], [S7], so the blocker is inheritance/autofit/unsupported-part semantics versus a flat
model [S19]; the plan defers import outright [S20].

### 5.4 Editable equations in PPTX (OMML) from KaTeX/MathJax output

**No mapping library identified.** KaTeX emits HTML/CSS; MathJax can emit SVG; neither is OOXML math.
`TODO-VERIFY` externally. Consequence: math becomes a picture, which is exactly the honest limitation
the plan already uses for charts (§4.2).

### 5.5 Chart fidelity between an in-app preview and a PPTX-native chart

**No library** — it is an architectural choice, not a package. Two renderers means two geometries;
the only parity-preserving option is one renderer + a rasterized picture. Evidence: the plan defers
native charts and forbids implying data editing [S20]; pptxgenjs chart capability is unverified here.

### 5.6 Vietnamese hyphenation patterns

**Nothing verified.** Evidence of looking: in-repo code cannot justify any pattern set [S10]; I could
not search externally in this run. `TODO-VERIFY` whether a maintained Vietnamese pattern set exists
at all — if not, hyphenation is off the table for this product.

### 5.7 Faithful HTML/CSS → canvas snapshots (e.g. html2canvas-class)

**Rejected rather than missing.** No library renders arbitrary HTML/CSS to canvas with faithful
metrics; the repo's model-first approach exists precisely to avoid that class of bug [S19], and any
snapshot pipeline would also need the same font gate [S11].

---

## 6. Mechanical verification checklist for the fact pass

Run these against the first-party source + npm registry for each candidate; paste numbers into §3.
Nothing in §3 is real until this is done.

1. **Versions, dates, licences.** For each package: latest published version, publish date of latest,
   `license` field _and_ the licence file in the repository, plus deprecated/archived flags.
2. **Maintenance signal.** Last commit date on the default branch; commits in the last 6 months;
   open-issue count; whether the maintainer responds; whether the latest release is a security
   release. Record the exact query date — this is the "freshness" evidence.
3. **React 18 compatibility** (only where a React binding is proposed): declared peer range must
   include 18, or the wrapper must be framework-agnostic. Flag React-19-only as disqualifying.
4. **Bundle cost.** Measure, do not quote: build a tiny Vite entry importing the package and compare
   `vite build` output, or use a bundler-size service; record minified+gzip kB and whether tree
   shaking works. For WASM packages, record the separate `.wasm` payload.
5. **Offline/browser-only behaviour.** Confirm no network calls at runtime, no server-side rendering
   requirement, no Node-only imports in the browser entry (pptxgenjs already maps `fs`/`https`/
   `image-size` to false [S3] — check the same for anything new).
6. **Licence compatibility.** Confirm permissive (MIT/Apache-2.0/BSD/ISC) or dual with a permissive
   option; flag paid, AGPL, or "source-available with a key" loudly, per [S1] and the existing
   AGPL/paid analysis style in [S21].
7. **Candidate-specific questions.**
   - harfbuzzjs: is there a browser build, and what is the WASM payload?
   - fontkit: does it build for the browser, and does its subsetter preserve the Vietnamese extended
     range used by the eight faces [S16]?
   - opentype.js: which shaping/bidi features does it actually implement?
   - hypher: which dictionaries ship, and is Vietnamese among them?
   - linebreak / css-line-break: which UAX #14 revision, and is either maintained?
   - chart.js / echarts / vega-lite+vega / recharts: licence, version, date, size, and — for
     recharts — the React peer range.
   - mermaid / katex / mathjax: licence, version, date, size, and any published security advisories.
   - mathjax: current version and licence (do not repeat the v3 Apache-2.0 claim unverified).
   - mammoth: licence, version, date, whether a browser bundle exists.
   - pptxgenjs: is 4.0.1 the latest; any open issue/support for font embedding; documented chart and
     table API limits.
   - pdf-lib: maintenance status and last release date; `@pdf-lib/fontkit` licence/version and what
     it is actually required for.
   - jszip: confirm the dual-licence wording and that the MIT option is available.
   - libreoffice-wasm / ZetaOffice: does a maintained browser build exist, under what licence, at what
     payload and cold-start cost?
8. **Platform facts.** Current browser support for `Intl.Segmenter` (word/line/grapheme) in the
   target desktop Chromium, and whether WOFF2 needs any fallback for the eight faces [S11].

---

## 7. Ranked top recommendations (max 5, highest confidence first)

**R1 — Add no new text/content dependency for this release.** _Impact: high. Effort: S. Confidence: high._
The text pipeline is proven end-to-end at the level the product needs (DOM↔canvas parity, Vietnamese,
PPTX native runs/bullets/hyperlinks, raster PDF). Every shaping/line-breaking/hyphenation candidate
in §3.2 either duplicates the platform or threatens the parity property [S10], [S12], [S15], [S16].
The strongest reason to add one would be a new script requirement in the template catalog — that is a
product signal, not a backlog item. Evidence: §2 findings 3, 5, 7; §4.1 A3.

**R2 — Make export truthful before adding features: preflight + lazy loading + "what may differ" copy.**
_Impact: high. Effort: S–M. Confidence: high._
The verified weak spots are (i) PPTX fonts referenced by name and substituted by the reader [S16],
[S19], and (ii) anything the model cannot represent (charts, equations, diagrams, tables) [S19], [S20].
A preflight that lists unresolved fonts, overflow, and "this will export as a picture" plus documented
reader/font requirements keeps the editable-PPTX promise honest. This is already partially planned
(P35/P40) [S20] — the recommendation is to treat the fidelity report as part of the contract, not a
nicety.

**R3 — If charts become a real requirement: one canvas-first renderer, rasterized; do not add
pptxgenjs native charts at the same time.** _Impact: medium. Effort: M. Confidence: medium-high._
A canvas chart library can be captured as a PNG and travels the existing image path to both PDF and
PPTX as one picture, preserving preview↔export parity. pptxgenjs native charts would give editability
but nothing in the browser can draw them, so preview and export would diverge — and the plan already
forbids implying data editing [S20]. Pick one; document the other as unavailable. Licence/version
cells: `TODO-VERIFY`.

**R4 — Font delivery: WOFF2 derivatives + load only the faces the visible previews need, behind the
existing `ensurePresentationFonts()` gate.** _Impact: medium. Effort: S. Confidence: medium._
≈1.6 MB of TTFs is fetched on demand today and all eight faces are awaited in one promise [S11],
[S16]; template galleries multiply that cost. Verify by re-running the P04 parity spec and the P05
stress export [S15], [S16], and record provenance for the derived files [S1]. WOFF2 size claims:
measure locally, `TODO-VERIFY`.

**R5 — Text-break upgrades only on a real language requirement, and prefer the platform over a
package.** _Impact: low–medium (future). Effort: S–M. Confidence: medium._
If Turkish/Thai/CJK/Khmer template text appears, `Intl.Segmenter` (zero dependency) is the first
thing to try in place of the whitespace tokenizer and the surrogate-pair guard [S10]; only then
consider `linebreak`/`hypher`, and only with the DOM overlay breaking identically, because PPTX
readers re-wrap regardless [S16].

---

## 8. Anti-recommendations (examined and rejected)

1. **harfbuzzjs for layout.** Duplicates the browser's shaping engine and endangers the measured
   DOM↔canvas parity [S10], [S12], [S15]; only useful for shaping without a browser, which [S19]
   avoids. Licence/payload `TODO-VERIFY`.
2. **opentype.js / text-to-path.** Converting text to outlines contradicts the editable-PPTX
   requirement [S19], [S20] and removes nothing from the current pipeline; shaping/bidi coverage is
   `TODO-VERIFY`.
3. **fontkit as a release deliverable.** Subsetting is a nice-to-have with a parity re-verification
   cost; the compliance question (OFL redistribution) is already handled by shipping the OFL text
   [S16]. Defer until the payload actually hurts.
4. **A React rich-text framework (ProseMirror/Tiptap/Lexical/Slate/Quill) as the document model.**
   Violates the paragraph/run authority rule [S19], is a large migration, and provides no per-line
   measurement in our coordinate space (§4.1 A8).
5. **Mermaid for diagrams.** Large runtime, user-authored content as an injection surface, output is
   a picture in PPTX anyway; the same need is met by an image snapshot the model already supports
   [S19], [S20].
6. **KaTeX/MathJax as canvas-native content.** KaTeX emits HTML/CSS, MathJax emits SVG; neither is
   canvas or OOXML math, so equations become pictures (§5.4). Accept that limitation explicitly
   instead of adding a heavy runtime to pretend otherwise.
7. **Recharts / Vega-Lite / ECharts for this export contract.** SVG/DOM-first or heavy; all require a
   rasterization step or two-package runtimes, versus a canvas-first renderer that captures directly.
   ECharts only becomes justified by genuine feature pressure beyond the deferred scope [S20].
8. **jsPDF / pdfkit / pdfmake as pdf-lib replacements.** The current PDF contract is deliberately
   raster [S14]; a selectable-text PDF is a product change requiring font embedding (`@pdf-lib/fontkit`
   is not even installed [S23]) plus new parity work. No library upgrade is warranted.
9. **JSZip as a direct dependency.** `jszip` is already present transitively [S3], [S7] and `fflate`
   is already a direct dependency doing the same job [S2], [S5]. Adding it directly duplicates a
   dependency for zero capability.
10. **Any server-side or WASM LibreOffice conversion path.** Breaks offline-first/browser-only
    [S1], [S19]; adds a paid, attack-surface-heavy service or an oversized payload. Its correct role
    here is as a test reader [S16].
11. **html2canvas-style snapshots of DOM content for export.** No faithful metrics; the model-first
    pipeline exists to avoid exactly this [S19].

---

## 9. Missing evidence

- Every licence, version, release date, maintenance signal, React 18 peer range, and bundle size for
  every candidate in §3 — **not fetched** (no web tool in this session).
- Whether pptxgenjs 4.0.1 is current, and whether it has usable chart/table/notes APIs and any
  font-embedding support (`TODO-VERIFY` against its first-party docs).
- Whether pdf-lib is actively maintained (last release date unknown).
- Whether a maintained in-browser LibreOffice build exists at all, and at what payload.
- Whether any maintained Vietnamese hyphenation pattern set exists.
- Measured WOFF2 size reduction for the eight presentation faces (do not quote until measured).
- pptxgenjs chart/table round-trip through LibreOffice — never tested in this repo [S16] tested only
  text/shape/image paths.
- Whether Microsoft PowerPoint (desktop) renders the stress deck as LibreOffice does — the environment
  has no desktop PowerPoint; the P05 record flags this as an evidence gap [S16]. Browser PowerPoint,
  Google Slides and Keynote are also untested [S16].
- Bundle-size deltas for any added dependency — none measured.

---

## 10. Summary (15 lines)

1. This session had no web capability, so every external fact cell is `TODO-VERIFY`; nothing is guessed.
2. The repo's text pipeline is already the correct architecture: authoritative paragraph/run model,
   injected-measure layout, DOM overlay for caret, Konva for paint [S10], [S12], [S13], [S19].
3. That parity is proven, not assumed: DOM↔canvas line boxes within ~2–3 units, Konva↔canvas ≤0.5 u [S15].
4. Vietnamese rendering, IME, paste-normalization and one-undo-per-session are all verified [S15], [S17].
5. PPTX already emits native editable text runs, bullets with explicit numbering, hyperlinks and shapes,
   confirmed through LibreOffice 26.8.0.3 → PDF at 960×540 pt [S16], [S18].
6. PDF is deliberately image-based via pdf-lib `embedPng`; no text selection or links by design [S14].
7. No shaping/hyphenation library is needed while a browser renders text; adding one risks the parity
   proof [S10], [S15] — that is the highest-confidence "do not add" in this brief.
8. The real PPTX weakness is fonts referenced by name and substituted by the reader [S16], [S19];
   embedding is not promised and no browser library for it was identified (§5.2).
9. Parsing deps for PPTX/DOCX import already exist at zero new cost (`fflate`, `fast-xml-parser`) [S5], [S6].
10. PPTX/DOCX import is therefore blocked by OOXML semantics (theme inheritance, autofit, groups,
    charts), not by libraries [S19]; the plan already defers it [S20] — keep it deferred.
11. Charts, tables, equations and diagrams should stay image snapshots or native exports, never both;
    pptxgenjs native charts would be invisible in-app and cause preview/export divergence [S20].
12. Thumbnails need no library: rasterize the existing fixed-page renderer, sequentially, behind the
    font gate [S11], [S15], [S19].
13. LibreOffice conversion (server or WASM) is a non-option for browser-only/offline-first [S1], [S19];
    its right role here is as a test reader [S16].
14. Cheapest real wins are non-library: truthful export preflight, and WOFF2 + selective font preload
    behind `ensurePresentationFonts()` [S11], [S16].
15. Highest-confidence recommendation: **add nothing new now (R1)**; if ONE thing is changed, make it
    the export fidelity preflight and font-delivery work (R2, R4).
