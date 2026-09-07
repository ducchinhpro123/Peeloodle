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
- [x] User-supplied cat stickers banner collage on Templates page
- [x] Manual alpha mask erase / restore in image-local coordinates with brush interpolation, cursor preview, and undo/redo
- [ ] Cloud auth/sharing and native WhatsApp/Telegram installation

Deferred actions open an explanation or stay disabled. They do not report success. Automatic background removal is unavailable.

## Design mapping

The four supplied images map to the four routes above. Estimated tokens live in `src/styles.css`: navy `#08152f`, emerald `#08b879`, near-white `#fcfdfd`, mint `#ddf7ed`. UI type is locally bundled Plus Jakarta Sans (OFL) as an approximation of the mockup; headings are explicit weight 800 because Tailwind preflight inherits heading weight. Licensed decorative samples, the user-supplied hero collage, and font sources are recorded in `docs/assets-provenance.md`.

## Verification

`src/features/editor/commands.test.ts` covers undo/gesture history, rotated flips, and runtime asset retention. `src/features/exports/renderDocument.test.ts` covers PNG size/transparency, multiline text, and ImageBitmap cleanup. `src/features/editor/editor.test.tsx` covers upload → text → save → reopen, leave-before-debounce flush, snapshot saves, stale upload discard, and slider/typing-safe shortcuts. `src/features/assets/validateUpload.test.ts` rejects APNG and mislabeled BMP. `src/features/exports/zipExport.test.ts` covers ZIP binary generation and pack manifest bundling. `src/features/editor/maskUtils.test.ts` covers inverse transform mapping, brush radius, and stroke interpolation. `npm run test:browser` starts from the Dashboard CTA, edits the canvas, reloads multiline text, inspects downloaded 512 and 1024 PNG dimensions, alpha, and composition, clones templates, creates/exports sticker pack ZIPs, and tests the manual erase/restore brush workflow with transparent hole verification.

`e2e/render-parity.spec.ts` compares real preview/export pixels for circles, partial filters, padded/cropped outlines, outline opacity, and outline color under filters. Image-local compositing is cached independently of transforms. ZIP exports fail explicitly if any member cannot load or render, rather than silently downloading incomplete packs. Pack/template write failures remain visible and recoverable; pack deletion requires confirmation and preserves stickers. Favorite template cards stay synchronized across rails.

Verified: typecheck, production build, 87 Vitest tests and 23 Chromium browser tests pass. Lint has no errors and the existing `react-refresh/only-export-components` warning in `src/app/repository.tsx`. Firefox/WebKit were not rerun in this pass.

Browser screenshots from the foundation layout checks are stored outside the repository at `/tmp/stickerlab-browser-verification/`.
