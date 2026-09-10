# Asset provenance

## Planned admin dashboard concept

`docs/design/admin-dashboard-concept.png` was generated with the built-in imagegen tool on 2026-09-10 for the presentation planning documents. The exact prompt is stored in `docs/design/admin-dashboard-prompt.txt`. It is a UI reference with sample artwork and metadata, not a production asset catalog or permission record for real uploads. The image was inspected; generated format badges and readiness/provenance inconsistencies are called out in `docs/slides-architecture.md`. It is not served by the application.

Decorative sample images are stored locally under `public/samples/`. They are not user uploads and are not used as fake background-removal results.

| File | Source | License (as stated on the file page) | Notes |
| --- | --- | --- | --- |
| `public/samples/cat-in-console.png` | [File:Cat in console.png](https://commons.wikimedia.org/wiki/File:Cat_in_console.png), original [PNG](https://upload.wikimedia.org/wikipedia/commons/5/52/Cat_in_console.png) | CC0 1.0 Universal Public Domain Dedication | 344×344 decorative sample. Attribution is not required by CC0; Commons URL retained. |
| `public/samples/solenodon.png` | [File:Dixi-Solenodon cubanus-transparent.png](https://commons.wikimedia.org/wiki/File:Dixi-Solenodon_cubanus-transparent.png), original [PNG](https://upload.wikimedia.org/wikipedia/commons/f/f6/Dixi-Solenodon_cubanus-transparent.png) | Released worldwide to the public domain by author Dixi/Monika Betley | 240×135 decorative sample. Local-law limits may still apply. |
| `design/ChatGPT Image Sep 7, 2026, 08_44_53 AM.png` | User-supplied generated collage (ChatGPT image, 7 Sep 2026) | User-supplied generated asset; original kept in `design/` | 1824×862 PNG with alpha. Dashboard hero decoration only; not user project data. |
| `design/ChatGPT Image Sep 7, 2026, 10_47_20 AM.png` | User-supplied generated cat sticker collage (ChatGPT image, 7 Sep 2026) | User-supplied generated asset; original kept in `design/` | 1672×941 PNG with alpha. Templates hero decoration; not user project data. |
| `public/art/hero-collage.webp` | Derivative of the user-supplied collage above | Same provenance as the original | Legacy banner asset, no longer used by the UI. Trimmed, resized to 1400×632, WebP q82, alpha preserved. |
| `public/art/templates-collage.webp` | Derivative of the user-supplied cat collage above | Same provenance as the original | Legacy banner asset, no longer used by the UI. Resized to 1400×788, WebP q82, alpha preserved. |
| `public/art/stickers/*.webp` (25 files) | User-supplied `design/separated-stickers-transparent/`: items 01–25 | User-supplied artwork; third-party rights and license have not been independently verified | Trimmed with ImageMagick, alpha preserved. Original nine derivatives (01, 02, 03, 04, 05, 14, 16, 18, 19) retain their q84/560px limit; the other sixteen use q90 at original trimmed size, without upscaling. About 484 KB total on disk. Decorative collage use plus explicit insertion from the editor catalog; inserted copies become independent image layers with blobs saved in IndexedDB and `bundled-asset:` provenance. Never used as simulated background-removal results. |
| `public/fonts/plus-jakarta-sans-latin-wght-normal.woff2` | [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) via Fontsource variable 5.3.0 | SIL Open Font License 1.1 (`public/fonts/PLUS-JAKARTA-SANS-LICENSE.txt`) | Latin variable wght 200–800. UI approximation of the mockup sans; not a claim of exact font identity. Editor canvas text still uses `TEXT_FONTS`. |

The raster samples are modest-resolution source art (roughly 100–600px). Insertion preserves native dimensions and never enlarges them automatically; large manual upscales can look softer. Lettering baked into a cutout is image content, not editable text. Use the Text styles tray for editable labels.

## Scrapbook hero

`public/art/scrapbook-paper.svg` is original code-drawn decorative artwork inspired by the user-supplied scrapbook panel: paper polygons, procedural grain, print-like lines, and gingham. It contains no embedded screenshot, external images, or fonts. The Templates hero reuses the existing supplied cat/star cutouts under their existing rights limitations; its headline and description remain HTML.

`public/art/dashboard-paper.svg`, `public/art/polaroid-field.svg`, and `public/art/polaroid-daisy.svg` are original code-drawn decorations for the Dashboard hero and feature cards (torn cream/mint paper, a hillside, and a daisy). They are not photographs, user uploads, or background-removal stand-ins. The Dashboard collage still uses the supplied cat/star/heart cutouts plus HTML “Meow!” / “STAY COOL” lettering.

`public/art/packs-paper.svg` is original procedural grain and displaced torn-paper artwork inspired by the supplied packs-page reference. The packs collage reuses the local illustrated daisy/field polaroids and supplied cat cutouts; no screenshot is embedded. Notes and controls remain HTML. The illustrated scenery and bundled Chewy font are approximations, not the reference’s photographs/handwriting.

`public/art/header-paper.svg` and `public/art/header-scrap.svg` are original procedural SVG decorations based on the supplied header reference: mint paper, a cream/grid logo backing, and a torn cream navigation strip. Tape and accent marks are CSS/SVG. No reference screenshot or external assets are embedded, and all navigation/control labels remain accessible HTML.

`design/logo.png` and `design/logo-wordmark.png` are user-supplied brand artwork (8 Sep 2026). Served derivatives: `public/art/logo.webp` (icon), `public/art/logo-wordmark.webp` (header mark), `public/favicon.png`, and `public/apple-touch-icon.png`. Trimmed with ImageMagick, alpha preserved. Third-party rights have not been independently verified.

## Illustration assets

Eight user-supplied generated PNGs (1254×1254, real alpha) are preserved unchanged in `design/`. Served derivatives under `public/art/illustrations/` are 1024×1024 WebP q90, produced with ImageMagick without trimming or background removal. Original margins, white outlines, and small edge artifacts remain. Third-party rights have not been independently verified; owner review is still needed before public distribution.

| Served file (`.webp`) | Source in `design/` |
| --- | --- |
| `happy-astronaut` | `ChatGPT Image Sep 7, 2026, 03_34_38 PM (1).png` |
| `sunshine` | `ChatGPT Image Sep 7, 2026, 03_34_38 PM (2).png` |
| `little-rocket` | `ChatGPT Image Sep 7, 2026, 03_34_43 PM (6).png` |
| `cool-corgi` | `ChatGPT Image Sep 7, 2026, 03_34_44 PM (7).png` |
| `happy-kitten` | `ChatGPT Image Sep 7, 2026, 03_34_45 PM (8).png` |
| `playful-corgi` | `ChatGPT Image Sep 7, 2026, 03_34_46 PM (9).png` |
| `cloud-rainbow` | `ChatGPT Image Sep 7, 2026, 03_35_57 PM.png` |
| `happy-planet` | `ChatGPT Image Sep 7, 2026, 03_36_06 PM.png` |

These eight graphics are available in the sticker tray. Some photo templates also place them as independent decoration layers. Raster illustration details are not independently editable objects.

## Template stand-in photos

Six user-supplied generated PNGs (1254×1254, real alpha) from 8 Sep 2026 are preserved unchanged in `design/`. Served derivatives under `public/art/template-photos/` are 1024×1024 WebP q90, produced with ImageMagick without trimming or background removal. Original margins, white die-cut outlines, and baked doodles remain. Third-party rights have not been independently verified; owner review is still needed before public distribution. They are template photo stand-ins and sticker-tray assets, not simulated background-removal results.

| Served file (`.webp`) | Source in `design/` |
| --- | --- |
| `boba-tea` | `ChatGPT Image Sep 8, 2026, 09_56_52 AM.png` (duplicate `09_57_15 AM (6).png` not served separately) |
| `peace-selfie` | `ChatGPT Image Sep 8, 2026, 09_57_13 AM (1).png` |
| `thumbs-up` | `ChatGPT Image Sep 8, 2026, 09_57_14 AM (2).png` |
| `coffee-days` | `ChatGPT Image Sep 8, 2026, 09_57_14 AM (3).png` |
| `sunny-corgi` | `ChatGPT Image Sep 8, 2026, 09_57_14 AM (4).png` |
| `waving-cat` | `ChatGPT Image Sep 8, 2026, 09_57_15 AM (5).png` |

## Layered photo templates

The 12 compositions in `src/features/templates/templates.ts` combine the Sep 8 stand-in photos above, separately positioned supplied decorations and illustrations, editable locally bundled font captions, and optional caption backing (`public/art/templates/caption-paper.png`, generated with ImageMagick) or shape plates (polaroid frame, speech bubble, work stamp). Stand-in photos already include a die-cut outline, so templates do not add a second silhouette outline or the old 344×220 cat crop. Each card uses a distinct subject on the dashboard rail; the six photos repeat across the full catalog. Users replace the stand-in with their own photo. Automatic background removal is not implied.

`public/art/templates/sample-*.png` are 512px previews generated by `scripts/generate-template-previews.mjs` using the actual export renderer. Each template clones with independent asset IDs and an atomic document/blob save. Replacement photos retain composition center, rotation, flips, and effects; old crop/mask data is reset, with undo support. Automatic background removal is not implied.

## Editor fonts

Unmodified TTFs from the official Google Fonts repository are bundled locally with their license texts. File bytes were verified against upstream Git blob hashes. Full upstream glyph coverage is retained rather than subsetting; coverage varies by family. The six files total about 1.38 MB and load on demand, without runtime requests to Google or a third-party CDN.

| Local file | Upstream source | License |
| --- | --- | --- |
| `public/fonts/fredoka.ttf` | [Fredoka](https://github.com/google/fonts/tree/main/ofl/fredoka) | SIL OFL 1.1, `fredoka-LICENSE.txt` |
| `public/fonts/baloo2.ttf` | [Baloo 2](https://github.com/google/fonts/tree/main/ofl/baloo2) | SIL OFL 1.1, `baloo2-LICENSE.txt` |
| `public/fonts/luckiestguy.ttf` | [Luckiest Guy](https://github.com/google/fonts/tree/main/apache/luckiestguy) | Apache 2.0, `luckiestguy-LICENSE.txt` |
| `public/fonts/chewy.ttf` | [Chewy](https://github.com/google/fonts/tree/main/apache/chewy) | Apache 2.0, `chewy-LICENSE.txt` |
| `public/fonts/pacifico.ttf` | [Pacifico](https://github.com/google/fonts/tree/main/ofl/pacifico) | SIL OFL 1.1, `pacifico-LICENSE.txt` |
| `public/fonts/bangers.ttf` | [Bangers](https://github.com/google/fonts/tree/main/ofl/bangers) | SIL OFL 1.1, `bangers-LICENSE.txt` |

All license files above live beside their fonts under `public/fonts/`. Family names are serialized as document data; CSS font faces and `src/lib/fonts.ts` provide shared canvas/export loading. Fonts are not stored in each document or copied into image assets.

`e2e/fixtures/red.png` and `e2e/fixtures/center-blue.png` are generated test fixtures (solid/test pixels), not third-party artwork.

## Presentation typefaces (P05)

Unmodified static TTFs from the official Google Fonts repository, bundled locally with their license texts under `public/fonts/presentations/`. All eight files were verified against upstream Git blob hashes (local `git hash-object` equals the GitHub API `sha`) on 2026-09-10. Coverage and export verification are recorded in `proofs/p05-fonts.md`.

| Local file | Upstream source | License |
| --- | --- | --- |
| `public/fonts/presentations/BeVietnamPro-Regular.ttf` | [Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro) (Regular) | SIL OFL 1.1, `be-vietnam-pro-OFL.txt` |
| `public/fonts/presentations/BeVietnamPro-Bold.ttf` | Be Vietnam Pro (Bold) | SIL OFL 1.1, `be-vietnam-pro-OFL.txt` |
| `public/fonts/presentations/BeVietnamPro-Italic.ttf` | Be Vietnam Pro (Italic) | SIL OFL 1.1, `be-vietnam-pro-OFL.txt` |
| `public/fonts/presentations/BeVietnamPro-BoldItalic.ttf` | Be Vietnam Pro (Bold Italic) | SIL OFL 1.1, `be-vietnam-pro-OFL.txt` |
| `public/fonts/presentations/Spectral-Regular.ttf` | [Spectral](https://github.com/google/fonts/tree/main/ofl/spectral) (Regular) | SIL OFL 1.1, `spectral-OFL.txt` |
| `public/fonts/presentations/Spectral-Bold.ttf` | Spectral (Bold) | SIL OFL 1.1, `spectral-OFL.txt` |
| `public/fonts/presentations/Spectral-Italic.ttf` | Spectral (Italic) | SIL OFL 1.1, `spectral-OFL.txt` |
| `public/fonts/presentations/Spectral-BoldItalic.ttf` | Spectral (Bold Italic) | SIL OFL 1.1, `spectral-OFL.txt` |

These faces cover the full Vietnamese extended range (U+1EA0–U+1EF9) and are used only by presentation documents, which store the stable font IDs `be-vietnam-pro` and `spectral`. Serve them on demand; do not substitute the Latin-only sticker fonts for Vietnamese presentation text.
