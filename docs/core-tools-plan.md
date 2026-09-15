# StickerLab core tools plan

**M1 (tool intent) is implemented** in this repo: `?tool=erase|text|effects|export` on `/create` and `/editor/:id`. Automatic background removal remains unavailable (see research).

Audit date: 2026-09-08. Browser session: headless Chromium via Playwright 1.63 against the running Vite app at `http://127.0.0.1:4173/`. Notes: `/tmp/grok-goal-6ad089e281f0/implementer/audit-notes.md`. Auto-remove research: `/tmp/grok-goal-6ad089e281f0/implementer/auto-remove-research.md`.

This plan distinguishes **observed** defects (code + real browser) from **hypotheses** (code only). Automatic background removal is researched and **not implemented**. No service was purchased and no user photo was sent to a provider. A sample cutout is not processing.

## Existing behavior and reusable components

One editor, one Zustand store (`src/features/editor/store.ts`), one document schema (`src/types/domain.ts`), one IndexedDB repository. Konva is a view. Mutations go through commands/history.

| Surface          | What exists                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Routes           | `/`, `/create`, `/editor/:projectId`, `/templates`, `/my-stickers`                                                                               |
| Draft mint       | `CreateEditor` persists dirty work if needed, then `createDraft()` and `replace`s to `/editor/:id`                                               |
| Background erase | `activeTool` `erase` / `restore`; `useMaskBrush` + `maskPainter` + `maskUtils` in image-local coordinates; Reset Mask; brush size; dashed cursor |
| Text             | `addTextLayer`, DOM/Konva editing, bundled fonts, text-style presets                                                                             |
| Emoji / stickers | `STICKER_CATALOG` image layers (licensed local WebP), distinct from text                                                                         |
| Filters          | brightness / contrast / saturation / grayscale on image layers; Reset Filters                                                                    |
| Outlines         | alpha silhouette, not the rectangle; shared `paintImage` for preview and export                                                                  |
| Export           | artwork-bounded PNG (longest edge 512 or 1024); pack ZIP up to 512 with `manifest.json`; fail-fast on member errors                              |
| Share            | honest “not WhatsApp/Telegram” copy + notice dialog                                                                                              |
| Autosave         | debounce + leave flush; workspace reset on account switch                                                                                        |

Desktop editor chrome: left tool rail, full-panel checkerboard, right inspector, bottom tray. Application sidebar is hidden on `.editor-layout` (intentional). Mobile: header sheet, tool rail, properties dialog.

**Do not** add a second editor, store, or persistence model.

## Confirmed bugs and missing journeys

### Observed

1. **Tool links ignore the advertised tool.** Sidebar TOOLS, dashboard Background Eraser / Text & Emoji / Share & Export, and the mobile sheet all navigate to `/create` with no intent. Chromium: each click opened a new `/editor/<uuid>` blank canvas; rail `aria-pressed` was empty; export dialog stayed closed.
2. **Silent new document.** `/create` always mints a draft (except reusing an empty revision-0 draft, or staying put when a dirty save fails). Opening a tool from Home after editing replaces the session with a blank sticker.
3. **No create/reopen choice** when a document is required and several already exist.
4. **Dashboard has no Filters & Effects shortcut** (sidebar does; it still only hits `/create`).
5. **Text rail always inserts a layer.** Reloading a `?tool=text` URL must not call `addTextLayer()` or layers duplicate.
6. **Automatic removal is absent** (honest). Manual erase is the real path.

### Hypotheses (verify while hardening, after tool-entry)

- Sticker tray is not searchable / not a keyboard-filterable palette.
- Canvas `measureTextBox` uses advance width, not ink bounds; script/italic overhangs may clip in the editor vs PNG.
- No text alignment control in the document (left/top only). “Available alignment” is left.
- Konva `wrap="none"` + `lineHeight={1}` may clip descenders on the canvas.
- Device share sheet (`navigator.share`) is not offered; download-only is honest but not a share sheet.

### Not bugs (keep)

- Artwork-bounded export (not square artboard clipping).
- ZIP fails instead of downloading a partial archive.
- WhatsApp/Telegram not installed natively.
- Shadow/blur controls are not shown.
- Guest local editing without cloud keys.

## Reproduction steps and baseline checks

**Tool entry (fails today)**

1. `/` at 1440×900. Click sidebar Background Eraser.
2. Expect (after fix): erase controls active; upload/select image if none; no extra untitled document if work is already open.
3. Repeat for Text & Emoji, Filters & Effects, Export & Share from sidebar, dashboard cards, and mobile sheet (390×844).
4. With a dirty or populated open document, a tool click must keep that document id.
5. With saved stickers and no open work, `/create?tool=erase` must offer create vs reopen — not mint silently.
6. Reload `/editor/:id?tool=text` must not add another text layer.
7. Empty erase/effects states must ask for a photo, never claim success.

**Editor/export baselines (already covered; keep green)**

- `src/features/editor/commands.test.ts`, `editor.test.tsx`, `maskUtils.test.ts`
- `src/features/exports/renderDocument.test.ts`, `zipExport.test.ts`
- Playwright: `e2e/mask-regressions.spec.ts`, `fonts-stickers.spec.ts`, `render-parity.spec.ts`, `artwork-export.spec.ts`, `editor.spec.ts`

## Prioritized milestones

### M1 — Tool intent (this increment; gate for later work)

Shared typed intent `erase | text | effects | export` as `?tool=` on existing `/create` and `/editor/:id` routes.

| Entry             | Opens                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Background Eraser | Image upload/select + erase controls                                         |
| Text & Emoji      | Text inspector + sticker/emoji tray; **does not** insert a layer by itself   |
| Filters & Effects | Effects tab for a selected compatible image layer (or an honest empty state) |
| Export & Share    | Export dialog for the intended document                                      |

Acceptance: existing work is never silently replaced; create/reopen when a project must be chosen; empty states explain requirements; reload/back does not duplicate layers; pending edits persist; workspace/account boundaries unchanged (existing flush + `workspaceEpoch` reset). Create a Sticker (`/create` without `tool`) still mints a new document.

### M2 — Manual Background Eraser

Harden the existing brush: immutable originals, image-local masks, transform alignment, Erase/Restore/brush size/cursor/Reset Mask, restore ∩ original alpha, one undo per stroke, pointer cancel, pending encode, no unfinished stroke on save/export/nav. Auto-remove stays unavailable (see research).

### M3 — Text & Emoji

Harden add/select/edit/move/resize/rotate/duplicate/delete, multiline, fonts, color, left alignment, shortcut isolation, font load/failure, save/reopen parity. Emoji = catalog image layers (not OS emoji fonts). Searchable, accessible tray. Distinguish text vs sticker layers.

### M4 — Filters & Effects

Non-destructive, intended layer only, alpha outlines, documented compose order (crop → mask → filters → outline → layer opacity → transform). One undo per slider gesture. Reset = actual defaults. Preview = saved = PNG = ZIP. Mobile properties sheet. No fake shadow/blur.

### M5 — Export & Share

Keep artwork-bounded PNG/ZIP contracts. Inspect files, not click events. Share: optional `navigator.share` with download fallback; no native messenger install; no public cloud links.

## Research findings, sources, decisions, unresolved approvals

**Decision: do not implement automatic background removal now.** Recommend browser-local, self-hosted, commercially licensed weights later; never a fake cutout.

| Option                            | License (official)                                                                                                                | Quality                                                | Size / runtime        | Privacy              | Cost                    | Verdict                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------- | -------------------- | ----------------------- | --------------------------- |
| Manual erase                      | App code                                                                                                                          | User-controlled                                        | Existing              | Local                | $0                      | **Ship / harden**           |
| MediaPipe Image Segmenter         | Apache 2.0 code samples; [docs](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)                    | Selfie/person, not pets/objects                        | Small `.tflite`       | Local if self-hosted | $0                      | Legal but product-unfit     |
| `@imgly/background-removal` ISNet | [AGPL-3.0](https://github.com/imgly/background-removal-js/blob/main/LICENSE.md); commercial license from IMG.LY                   | General matting; still needs cleanup on hair/fur/glass | ~40–80 MB ONNX + WASM | Local if self-hosted | Paid commercial license | Blocked (AGPL / purchase)   |
| BRIA RMBG-1.4 / 2.0               | [Non-commercial](https://huggingface.co/briaai/RMBG-1.4); [CC BY-NC 4.0](https://huggingface.co/briaai/RMBG-2.0) + paid agreement | Strong general photos                                  | ~0.2B params / 1024   | Local if self-hosted | Paid for commercial     | Blocked                     |
| remove.bg API                     | [TOS](https://www.remove.bg/tos) free = non-commercial; [API](https://www.remove.bg/api) paid credits; 50 free calls/month        | Strong people/products/animals                         | Hosted, rate-limited  | **Uploads photos**   | Paid                    | Blocked (upload + purchase) |

**Unresolved approvals:** commercial model license, redistributing weights, any hosted API seeing user photos, mobile memory budget.

Compose order to document in-product (M4): crop in image space → mask (image-local, destination-in) → CSS-style filters → silhouette outline (from post-filter alpha) → layer opacity → layer transform. Viewport zoom/pan is view-only.

## Implementation notes for M1

- `src/features/editor/toolIntent.ts`: parse, href, apply (UI only; no layer insert).
- Sidebar/dashboard/mobile: `toolIntentHref(intent, pathname)` so an open `/editor/:id` keeps that id.
- `/create?tool=*` : if open work exists, continue it; else if saved projects exist, create/reopen choice; else mint a blank and apply the tool.
- `/create` without `tool`: unchanged new-document path.
- Empty erase/effects: demand an image layer. Empty export: existing recoverable message.
