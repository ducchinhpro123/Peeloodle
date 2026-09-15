# P05 — Presentation fonts: choice and verification

Date: 2026-09-10. Task: "Choose and verify two font families; compare a difficult
long-title/bullets export fixture."

## Choice

| Stable font ID   | Family         | Role            | Files                                          | License                                                           |
| ---------------- | -------------- | --------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `be-vietnam-pro` | Be Vietnam Pro | Body/UI text    | Regular, Bold, Italic, BoldItalic (static TTF) | SIL OFL 1.1 (`public/fonts/presentations/be-vietnam-pro-OFL.txt`) |
| `spectral`       | Spectral       | Headings/titles | Regular, Bold, Italic, BoldItalic (static TTF) | SIL OFL 1.1 (`public/fonts/presentations/spectral-OFL.txt`)       |

Both families ship true static regular/bold/italic/bold-italic faces through
`@font-face` in `src/features/presentations/rendering/presentation-fonts.css`
(loaded from `public/fonts/presentations/`), and are registered in
`src/features/presentations/rendering/fonts.ts`. Documents store the stable ID,
not a CSS family name.

### Rejected candidates (evaluated, not used)

- **PT Serif** — static faces available, but `fc-query` showed no
  `1EA0–1EF9` Vietnamese range; would fail the Vietnamese requirement.
- **Lora** — full Vietnamese coverage, but the official repository ships only
  variable `Lora[wght].ttf`; static italic instances would require a
  fontTools build step, so it was not chosen for the first release.
- Existing sticker fonts (Fredoka, Baloo 2, …) have no true italics and were not
  designed for academic body text.

## Coverage verification

```bash
fc-query --format='%{charset}' <file> | tr ' ' '\n' | grep -c '1ea0-1ef9'
```

All eight files return `1` (the full Vietnamese extended range is present).
The browser proof (`e2e/proofs/text-bridge.spec.ts`) separately renders
`Nghiên cứu và trình bày`, `Tóm tắt kết quả:`, `ấn tượng`, `dễ đọc` through the
real faces in DOM and Konva output (`proofs/out/p04-dom-overlay.png`,
`proofs/out/p04-konva-stage.png`).

## Integrity

Local `git hash-object` equals the upstream `sha` reported by the Google Fonts
GitHub API for all eight files (checked 2026-09-10):

| File                          | Upstream blob sha                          |
| ----------------------------- | ------------------------------------------ |
| `BeVietnamPro-Regular.ttf`    | `dfa34c09fe2bae0626e00aa3265af2119345c27b` |
| `BeVietnamPro-Bold.ttf`       | `52aadc6da089ed8ae647b5e0c8cac4f8b3e24750` |
| `BeVietnamPro-Italic.ttf`     | `d9d0134f4120078d3c815bc20cd7e9dfc5ff66c2` |
| `BeVietnamPro-BoldItalic.ttf` | `7e22a2d7e115780ad7f044548b4cbd745b52d969` |
| `Spectral-Regular.ttf`        | `25a6c47f8050e4ea3c9713a02a4843a8d6c503d5` |
| `Spectral-Bold.ttf`           | `5019e0802e726cebe021b007e661ec763c63e54f` |
| `Spectral-Italic.ttf`         | `99d6c2def129dea2daa47652c2168c271c7a59a7` |
| `Spectral-BoldItalic.ttf`     | `90aea8b167fe1f21316480c4e2860eb93a17c0a0` |

Upstream: `github.com/google/fonts` under `ofl/bevietnampro` and `ofl/spectral`.
Total size ≈ 1.6 MB, fetched on demand only when presentation text uses them.

## Long-title/bullets export comparison

Stress fixture: `src/features/presentations/model/fixtures/stress.ts`
(114-character Vietnamese title in a 700-unit-wide box plus a five-item dense
bullets slide). Generated with
`npx vite-node proofs/pptx/generateStress.ts` and opened with LibreOffice
26.8.0.3 (`soffice --headless --convert-to pdf`).

Results:

- Page size 960.009 × 540 pts, 2 pages — 16:9 preserved.
- `pdftotext` finds every expected string, including `Đánh giá tác động`,
  `sông Cửu Long`, `Năng suất giảm 12%`, `Khuyến nghị`, `thích ứng`.
- The title wraps to four full lines with all diacritics intact; the dense
  bullet slide keeps bold leads, italic keywords, nested bullets, and numbering.
- Renders: `proofs/out/p05-stress-1.png`, `proofs/out/p05-stress-2.png`.
- Defect found and fixed during the proof: consecutive numbered paragraphs both
  rendered `1.` because each `buAutoNum` restarted; the adapter now emits
  explicit `numberStartAt` values (re-verified `1.` and `2.` in the PDF text).
  P38 must preserve this behavior in the production adapter.

## Reader coverage and gaps

| Reader                                       | Status                                             |
| -------------------------------------------- | -------------------------------------------------- |
| LibreOffice Impress 26.8.0.3 (Linux)         | Used for all export checks above                   |
| Microsoft PowerPoint (desktop)               | **Unavailable in this environment — not verified** |
| Google Slides / Keynote / browser PowerPoint | Not tested                                         |

PPTX references fonts by family name; a viewer without the fonts installed
substitutes metrics. The release documentation must state the font requirement
(or bundle fonts) rather than promise identical rendering everywhere.

## Browser-facing notes

- Latin-only UI fonts cannot render Vietnamese; the presentation faces were
  added with full Vietnamese coverage instead of reusing the sticker fonts.
- `ensurePresentationFonts()` in `fonts.ts` must be awaited before measuring or
  exporting; the P04 proof showed DOM and canvas metrics diverge while faces load.
