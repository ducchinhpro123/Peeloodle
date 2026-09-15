# P01 — Repository baseline (2026-09-10)

Recorded before any presentation work, on branch `master` at commit `4edb313`
("Centralize draft saving and safe project transitions").

## Existing user changes preserved

Working tree before this work:

- Modified: `CONTEXT.md`, `README.md`, `docs/assets-provenance.md` (planning edits, kept).
- Untracked: `docs/adr/`, `docs/design/`, `docs/slides-*.md`,
  `docs/editor-library-research.md` (unrelated research file, kept untouched).
- No application source, migration or dependency changes were present.

## Scripts (from `package.json`, actual)

| Script                 | Command                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | `vite`                                                        |
| `npm run build`        | `tsc -b && vite build`                                        |
| `npm run typecheck`    | `tsc -b --pretty false`                                       |
| `npm run lint`         | `eslint .`                                                    |
| `npm test`             | `vitest run --environment jsdom --exclude 'e2e/**'`           |
| `npm run test:browser` | `playwright test`                                             |
| `npm run test:cloud`   | `node --env-file=.env.cloud-test scripts/run-cloud-tests.mjs` |

## Routes (from `src/main.tsx`)

| Route                | Element                                          |
| -------------------- | ------------------------------------------------ |
| `/`                  | Dashboard                                        |
| `/create`            | Sticker editor shell (tool intents via `?tool=`) |
| `/editor/:projectId` | Sticker editor                                   |
| `/templates`         | Template browser                                 |
| `/my-stickers`       | Packs / local stickers                           |
| `/auth/callback`     | Supabase auth callback                           |
| `*`                  | Dashboard fallback                               |

## Recorded checks

```bash
npm run typecheck   # PASS — no output
npm run lint        # PASS — 0 errors, 4 pre-existing react-refresh warnings
                    #   src/app/repository.tsx:17, src/features/auth/Workspace.tsx:18,19,24
npm test            # PASS — 15 files, 167 tests, 4.0 s
npm run build       # PASS — 1873 modules, largest chunk KonvaCanvas 314 kB (97 kB gzip)
npx playwright test e2e/editor.spec.ts e2e/ui-polish.spec.ts --workers=2
                    # 22 passed, 12 failed (all in e2e/ui-polish.spec.ts)
```

Known pre-existing browser failures (not caused by presentation work; no fix attempted here):

- `page banners fill the available content width` overflows at 3200/1920/1440 px (passes at 1024/390).
- `scrapbook header fits and keeps navigation accessible` at 1672/1440 px.
- `global search`, `tool project chooser`, `packs scrapbook`, `scrapbook hero`,
  `pages and shared dialogs stay usable` at desktop widths.

Focused regression specs that pass and must keep passing: `editor.spec.ts`,
`canvas-nav.spec.ts`, `mask-regressions.spec.ts`, `outline.spec.ts`,
`render-parity.spec.ts`, `sticker-fit.spec.ts`, `tool-entry.spec.ts`,
`fonts-stickers.spec.ts`, `favorites.spec.ts`, `illustrated-templates.spec.ts`,
`color-regressions.spec.ts`, `artwork-export.spec.ts`, `foundation.spec.ts`.

## Findings that affect the presentation plan

1. Existing sticker documents stay untouched: `ProjectDocument` validation is
   strict about a 1024×1024 transparent artboard; presentations get a separate
   document kind per ADR 0001.
2. The UI font `/fonts/plus-jakarta-sans-latin-wght-normal.woff2` declares a
   Latin-only `unicode-range` (no Vietnamese), so it cannot be reused for
   presentation text without adding Vietnamese subsets.
3. IndexedDB database `stickerlab-local` is at version 4 with stores
   `projects`, `assets`, `packs`, `masks`, `sync`. Presentation stores must be an
   additive upgrade of this database (P13).
4. `decodeImageSize`/`validateUpload` already enforce 15 MB and 25 MP with
   PNG/JPEG/static-WebP sniffing and animated detection — reused for
   presentation uploads in P18.
