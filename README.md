# StickerLab

Mint-green local sticker editor. Create a sticker, upload a photo, edit, save, reopen, and export a transparent PNG — no cloud credentials required.

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
- [ ] Masks, silhouette outlines, filters, full layer manager, template cloning, packs/favorites, ZIP export
- [ ] Cloud auth/sharing and native WhatsApp/Telegram installation

Deferred actions open an explanation or stay disabled. They do not report success. Automatic background removal is unavailable.

## Design mapping

The four supplied images map to the four routes above. Estimated tokens live in `src/styles.css`: navy `#08152f`, emerald `#08b879`, near-white `#fcfdfd`, mint `#ddf7ed`. UI type is locally bundled Plus Jakarta Sans (OFL) as an approximation of the mockup; headings are explicit weight 800 because Tailwind preflight inherits heading weight. Licensed decorative samples, the user-supplied hero collage, and font sources are recorded in `docs/assets-provenance.md`.

## Verification

`src/features/editor/commands.test.ts` covers undo/gesture history. `src/features/exports/renderDocument.test.ts` covers PNG size/transparency and missing-asset failure. `src/features/editor/editor.test.tsx` covers upload → text → save → reopen, save-failure preservation, in-flight save queuing, and typing-safe shortcuts. `src/lib/persistence/repository.test.ts` covers MemoryRepository and IndexedDB roundtrips. `npm run test:browser` runs create/save/reload/reopen/export, checks real IndexedDB, and inspects downloaded 512 and 1024 PNG dimensions, alpha, and red content.

Browser screenshots from the foundation layout checks are stored outside the repository at `/tmp/stickerlab-browser-verification/`.
