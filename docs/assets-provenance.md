# Asset provenance

Decorative sample images are stored locally under `public/samples/`. They are not user uploads and are not used as fake background-removal results.

| File | Source | License (as stated on the file page) | Notes |
| --- | --- | --- | --- |
| `public/samples/cat-in-console.png` | [File:Cat in console.png](https://commons.wikimedia.org/wiki/File:Cat_in_console.png), original [PNG](https://upload.wikimedia.org/wikipedia/commons/5/52/Cat_in_console.png) | CC0 1.0 Universal Public Domain Dedication | 344×344 decorative sample. Attribution is not required by CC0; Commons URL retained. |
| `public/samples/solenodon.png` | [File:Dixi-Solenodon cubanus-transparent.png](https://commons.wikimedia.org/wiki/File:Dixi-Solenodon_cubanus-transparent.png), original [PNG](https://upload.wikimedia.org/wikipedia/commons/f/f6/Dixi-Solenodon_cubanus-transparent.png) | Released worldwide to the public domain by author Dixi/Monika Betley | 240×135 decorative sample. Local-law limits may still apply. |
| `design/ChatGPT Image Sep 7, 2026, 08_44_53 AM.png` | User-supplied generated collage (ChatGPT image, 7 Sep 2026) | User-supplied generated asset; original kept in `design/` | 1824×862 PNG with alpha. Dashboard hero decoration only; not user project data. |
| `design/ChatGPT Image Sep 7, 2026, 10_47_20 AM.png` | User-supplied generated cat sticker collage (ChatGPT image, 7 Sep 2026) | User-supplied generated asset; original kept in `design/` | 1672×941 PNG with alpha. Templates hero decoration; not user project data. |
| `public/art/hero-collage.webp` | Derivative of the user-supplied collage above | Same provenance as the original | Legacy banner asset, no longer used by the UI. Trimmed, resized to 1400×632, WebP q82, alpha preserved. |
| `public/art/templates-collage.webp` | Derivative of the user-supplied cat collage above | Same provenance as the original | Legacy banner asset, no longer used by the UI. Resized to 1400×788, WebP q82, alpha preserved. |
| `public/art/stickers/*.webp` (9 files) | User-supplied `design/separated-stickers-transparent/`: items 01, 02, 03, 04, 05, 14, 16, 18, 19 | User-supplied artwork; third-party rights and license have not been independently verified | Trimmed with ImageMagick, fitted within 560×560 without upscaling, WebP q84, alpha preserved. About 264 KB total on disk. Used as individual decorative layers in original CSS collages, the sidebar, empty editor, and footer; not template previews, saved user projects, or simulated background-removal results. |
| `public/fonts/plus-jakarta-sans-latin-wght-normal.woff2` | [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) via Fontsource variable 5.3.0 | SIL Open Font License 1.1 (`public/fonts/PLUS-JAKARTA-SANS-LICENSE.txt`) | Latin variable wght 200–800. UI approximation of the mockup sans; not a claim of exact font identity. Editor canvas text still uses `TEXT_FONTS`. |

These files are low resolution and are only for UI decoration / optional sample insertion. Do not treat them as production 512/1024 source art.

`e2e/fixtures/red.png` and `e2e/fixtures/center-blue.png` are generated test fixtures (solid/test pixels), not third-party artwork.
