# StickerLab

Mint-green local sticker editor. Create a sticker, upload a photo, edit, save, reopen, and export a transparent PNG — no cloud credentials required.

## Design previews

The supplied design mockups below show StickerLab’s visual direction—not screenshots of the current app. Sample accounts, statistics, subscription offers, and integrations are illustrative; see [Milestone status](#milestone-status) for implemented features.

### Dashboard

Start a sticker and browse recent projects and templates.

![Dashboard design with a mint-green photo sticker banner, recent projects, and trending templates](design/ChatGPT%20Image%20Sep%207%2C%202026%2C%2006_55_49%20AM%20%281%29.png)

### Create editor

Compose photo stickers with a central canvas, editing tools, properties panel, and asset tray.

![Create editor design with a dog sticker on a transparent canvas, left-hand tools, and right-hand properties](design/ChatGPT%20Image%20Sep%207%2C%202026%2C%2006_55_49%20AM%20%282%29.png)

### Templates

Browse sticker designs by category and find a starting point to customize.

![Templates design with category filters and colorful sticker template cards](design/ChatGPT%20Image%20Sep%207%2C%202026%2C%2006_55_50%20AM%20%283%29.png)

### My Sticker Packs

Organize stickers into packs and review their contents before export.

![My Sticker Packs design with pack cards, favorites, and a selected pack’s sticker preview](design/ChatGPT%20Image%20Sep%207%2C%202026%2C%2006_55_50%20AM%20%284%29.png)

## Run

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
```

Playwright uses Chromium at `/usr/bin/chromium` via `playwright.config.ts`. Firefox/WebKit are attempted only when those browsers are already available; this project does not download extra browser builds.

## Milestone status

- [x] React, strict TypeScript, Vite, React Router, Tailwind, and shadcn/ui-adapted Radix components (provenance in `docs/shadcn-provenance.md`)
- [x] Responsive Dashboard (`/`), editor (`/create`, `/editor/:projectId`), Templates (`/templates`), and My Sticker Packs (`/my-stickers`)
- [x] Versioned serializable `ProjectDocument` in `src/types/domain.ts` (1024×1024 transparent artboard)
- [x] IndexedDB repository (`getLocalRepository`) with atomic `saveProjectWithAssets`
- [x] Validated PNG/JPEG/static WebP upload (15 MB, 25 MP); original blob stored separately
- [x] Konva canvas: move, resize, rotate; DOM text editing; zoom/pan are view-only
- [x] Zustand commands, bounded undo, one history entry per completed drag/slider/text gesture
- [x] Manual save and debounced autosave with Saving / Saved locally / Save failed
- [x] Reopen from Dashboard and My Stickers; assets and fonts rehydrate
- [x] Transparent PNG export at 512×512 and 1024×1024 from the document (not the on-screen viewport)
- [x] Template cloning into independent editable projects, preview dialogs, and template favorites
- [x] Layer manager in editor: reorder, hide/show, lock/unlock, rename, duplicate, and delete with undo support
- [x] Local sticker pack management (create, duplicate, delete without deleting stickers, add/remove stickers, reorder)
- [x] Full pack ZIP export with numbered transparent PNGs and manifest.json
- [x] Image filters (brightness, contrast, saturation, grayscale) with reset, shared between canvas preview and PNG exports
- [x] Silhouette outlines & borders with customizable color and thickness on canvas and export
- [x] Scrapbook-style Templates banner with textured paper, yellow headline highlights, and layered user-supplied cat stickers; responsive HTML text rather than a screenshot
- [x] Manual alpha mask erase / restore in image-local coordinates with continuous strokes, crop clipping, matching cursor geometry, and undo/redo
- [ ] Cloud auth/sharing and native WhatsApp/Telegram installation

Deferred actions open an explanation or stay disabled. They do not report success. Automatic background removal is unavailable.

## Design mapping

The four supplied images are inspiration, not a pixel-for-pixel target. The current UI uses original layered cat-sticker collages, playful copy, pastel cards, and a calmer editor workspace. Shared tokens in `src/styles.css` define the spacing rhythm, navy `#08152f`, primary emerald `#00875e`, near-white `#fafbf8`, and mint `#ddf7ed`. Plus Jakarta Sans is bundled locally (OFL).

Dialogs share typography, fields, footers, 44px close controls, and scroll containment; pack deletion uses the same confirmation style. Pack details remain available on tablet/mobile. See [UI audit](docs/ui-audit.md) for findings and [asset provenance](docs/assets-provenance.md) for supplied artwork and licensing limitations.

## Verification

`src/features/editor/commands.test.ts` covers undo/gesture history, rotated flips, and runtime asset retention. `src/features/exports/renderDocument.test.ts` covers PNG size/transparency, multiline text, and ImageBitmap cleanup. `src/features/editor/editor.test.tsx` covers upload → text → save → reopen, leave-before-debounce flush, snapshot saves, stale upload discard, and slider/typing-safe shortcuts. `src/features/assets/validateUpload.test.ts` rejects APNG and mislabeled BMP. `src/features/exports/zipExport.test.ts` covers ZIP binary generation and pack manifest bundling. `src/features/editor/maskUtils.test.ts` covers inverse transform mapping, singular transforms, and inverse-scaled brush radii. Actual brush rasterization is checked in Chromium rather than mocked canvas calls. `npm run test:browser` starts from the Dashboard CTA, edits the canvas, reloads multiline text, inspects downloaded 512 and 1024 PNG dimensions, alpha, and composition, clones templates, creates/exports sticker pack ZIPs, and tests the manual erase/restore brush workflow with transparent hole verification.

`e2e/render-parity.spec.ts` compares real preview/export pixels for circles, partial filters, padded/cropped outlines, outline opacity, and outline color under filters. Image-local compositing is cached independently of transforms. ZIP exports fail explicitly if any member cannot load or render, rather than silently downloading incomplete packs. Pack/template write failures remain visible and recoverable; pack deletion requires confirmation and preserves stickers. Favorite template cards stay synchronized across rails.

`e2e/mask-regressions.spec.ts` covers successive strokes, no-op/redo preservation, non-uniform scale, crop clipping, rotation/flips with zoom/pan, original-alpha restoration, cancellation/secondary pointers, corrupt masks, encoding failures and retries, save/export/navigation races, and touch erase/restore at 390×844. It compares real masked preview/PNG pixels and every decoded pixel of the corresponding pack ZIP image. Save/export await pending strokes; the active editor warns before unloading unsaved work. Masks and assets remain atomically saved with the document in the existing IndexedDB v3 schema; no new migration is required.

Brush movement updates only the active raster and DOM cursor, with no React commits, document revisions, or PNG encoding during pointer movement. Preview rasters are capped at 1024px (high zoom may look softer); mask data and exports remain full-resolution. On this Linux x86_64 machine, headless Chromium 151 at 1440×900, one photo plus 29 shape layers, and 30 synthetic pen moves: the 2048px photo's median frame interval fell from about 32ms to 16.7ms after bounding preview raster work. The final suite measured 16.6ms median / 17.3ms p95 frame intervals and 0.9ms p95 pointer-handler time for that case. These are local observations, not a universal 60 FPS guarantee; maximum-size 25MP photos and physical pen hardware were not profiled. Rerun `npx playwright test e2e/mask-regressions.spec.ts -g '30 layers' --workers=1` for measurements and JSON attachments.

Verified: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:browser`: 87 Vitest tests and 42 Chromium browser tests pass. Lint has no errors and the existing `react-refresh/only-export-components` warning in `src/app/repository.tsx`. Firefox/WebKit were not rerun in this pass.

`e2e/ui-polish.spec.ts` checks all four routes and representative dialogs at 1440×900, 1024×768, and 390×844, plus a short 390×480 viewport. It covers image loading, overflow, keyboard focus trapping/restoration, mobile pack controls, and isolation of editor shortcuts from dialogs. Refresh screenshots are generated outside the repository at `/tmp/stickerlab-ui-audit/`; foundation screenshots remain at `/tmp/stickerlab-browser-verification/`.
