# Editor libraries vs the current StickerLab editor

**Question:** The Create Editor (`/create`, `/editor/:projectId`) already has a large custom implementation. Do existing libraries already cover it well enough to replace that code?

**Answer:** No drop-in library matches StickerLab’s editor as a product. Konva is the right *engine* and is already in use. Full editor SDKs exist, but they replace the document model, UI, and licensing story rather than plugging into `ProjectDocument`. Open-source “image editors” are mostly single-photo tools with annotations, not a local-first layered sticker composer.

Researched 2026-09-10 against first-party docs and repositories. This is not a migration plan.

## What the current editor actually is

The editor is not a generic canvas demo. It is a sticker document product:

| Piece | Where it lives today |
| --- | --- |
| Serializable document | `src/types/domain.ts` — `ProjectDocument` with image / text / shape layers, crop, mask key, filters, alpha outline |
| Commands + undo | `src/features/editor/store.ts` — Zustand, 50-entry history, one undo per completed gesture |
| Canvas view | `src/features/editor/KonvaCanvas.tsx` — Konva is a renderer, not the persistence model |
| Erase / restore | `maskPainter.ts`, `maskUtils.ts`, `useMaskBrush.ts` — image-local masks that survive scale, rotate, and zoom |
| Shared preview + PNG | `src/features/exports/renderDocument.ts` — artwork-bounded transparent PNG, longest edge 512 or 1024 |
| Chrome | `EditorPage.tsx` — left tools, checkerboard canvas, right inspector, bottom tray; mobile drawers |
| Local save | IndexedDB via repository interfaces; autosave; guest editing without cloud keys |

Rough size: about 5.2k lines under `src/features/editor/` plus ~580 lines of compositing in `renderDocument.ts`. Dependencies already include `konva@^9.3.20` and `react-konva@^18.2.10` on React 18.

Sticker-specific invariants that matter when judging libraries:

1. Document coordinates are independent of viewport zoom/pan.
2. Original image blobs stay immutable; crop and erasure are non-destructive.
3. Masks are stored in image-local coordinates.
4. Outlines follow the alpha silhouette, not the image rectangle.
5. Preview and export share compositing (`paintImage` / `createImageSurface`).
6. Export excludes checkerboard, handles, and viewport transforms, then trims to visible artwork.
7. Persistence is local-first; Konva nodes, DOM objects, and object URLs are never saved.

Those rules come from `AGENTS.md` and `StickerLab-Agent-Brief.md`, and they are implemented, not aspirational.

## How to classify the market

Libraries that look similar on a landing page fall into four jobs:

1. **Canvas engines** — scene graph, hit testing, transformers. You still write the product.
2. **Design-editor SDKs** — Canva-like app in a box. They own the document, UI, and license key.
3. **Photo editors** — one source photo plus crop / filters / overlay annotations.
4. **Whiteboards** — infinite canvas, diagrams, collaboration.

StickerLab is (1) plus a custom product layer. Most “we already have an editor library” options are (2) or (3).

## Comparison against StickerLab needs

| Need | Current app | Konva | Fabric.js | Polotno | CE.SDK | Pintura | Filerobot | TOAST UI | tldraw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| React + TypeScript | Yes | Official `react-konva` | Community / manual | React components; 4.x wants React 19 | React package | React adapter | `react-filerobot-image-editor` | React wrapper | React SDK |
| Layered image + text + shapes | Yes | You build it | Objects on canvas | Pages + elements | Blocks / scenes | Annotations on one image | Annotations on one image | Objects on one image | Custom shapes |
| Move / resize / rotate | Yes | `Transformer` | Built-in controls | Workspace transformer | Transform APIs | Annotation tools | Konva transformers | Fabric controls | Selection + transform |
| Non-destructive crop | Yes | You build it | Possible | `cropX/Y/Width/Height` | Crop | Core crop UX | Crop tab | Crop | Not a photo cropper |
| Image-local erase / restore | Yes | You build it | Brushes exist; not this model | Not documented | Cutout *blocks* (print/mask), not this brush | Censor / blur, not sticker masks | Pen annotation, not alpha mask | “Mask filter” (apply a mask image) | No |
| Alpha-silhouette outline | Yes | You build it | Rectangle/stroke | `borderSize` on the box; `clipSrc` for frames | Effects / cutout for print | Overlay shapes | Annotation stroke | Shape stroke | Shape stroke |
| Filters | Brightness / contrast / saturation / grayscale | CSS filter in our compositor | Built-in image filters | Brightness + `setFilter` presets | Documented capability | Finetune | Finetune + filters | Many filters | Not photo filters |
| Undo with gesture boundaries | Yes | You build it | You build it | Store undo/redo | Navigation undo/redo | Yes | History undo/redo | Undo/redo | Built-in |
| Transparent PNG, no chrome | Artwork-bounded 512/1024 | `toDataURL` / own compositor | `toDataURL` | `toBlob` / `saveAsImage` | PNG with transparency | Output image | `onSave` image | Download | Export, different product |
| Own serializable document | `ProjectDocument` | Encouraged | JSON of Fabric objects | Polotno JSON / MobX store | `.scene` / `.imgly` | Design/output, not our schema | Experimental `designState` | Internal | tldraw store |
| Local-first, no vendor key | Yes | MIT | MIT | API key + paid license | License key + quote | Paid SDK | MIT | MIT | Production needs a key |
| Mint StickerLab chrome | Custom shadcn | N/A | N/A | Own UI.css | Own design UI | Own UI | Own UI | Own themes | Own UI |
| Packs / templates / IndexedDB | App layer | N/A | N/A | Templates, different model | Templates, different model | No | No | No | Persistence, different model |

Empty cells mean “not the library’s job” or “would still be custom code.”

## Canvas engines

### Konva + react-konva (already adopted)

Konva’s author positions it for design editors, annotation tools, and diagrams: object model, events, drag, `Transformer`, serialization, and official React bindings. He also says a product-grade editor on top of those primitives is months of non-canvas work (persistence, history policy, accessibility, export fidelity).

That matches this repo. `KonvaCanvas.tsx` treats nodes as a view. `renderDocument.ts` composites independently so export does not screenshot the stage.

Konva’s own guidance for a *design editor product* is: look at Polotno first if you want a shipped Canva-style app; build on Konva when the editor *is* the product or you must own the document model.

Sources: [Why Konva / library choice](https://konvajs.org/docs/guides/best-canvas-library.html), [Canvas Editor sandbox](https://konvajs.org/docs/sandbox/Canvas_Editor.html).

### Fabric.js

Fabric is an interactive object canvas with scale/move/rotate/skew/group, shapes, brushes, image filters, and JPG/PNG/JSON/SVG I/O. Official React bindings are not part of the core library; the README shows a manual `useEffect` canvas. Konva’s comparison notes Fabric as the better SVG write-back and brush/image-editing orientation.

Switching engines would rewrite `KonvaCanvas.tsx` and still leave masks, silhouette outlines, artwork bounds, Zustand commands, and IndexedDB as custom code. It does not remove the 5k-line product layer.

Sources: [fabric.js README](https://github.com/fabricjs/fabric.js), [Canvas.toDataURL](https://fabricjs.com/api/classes/canvas/).

### PixiJS, Paper.js

PixiJS is a WebGL/WebGPU game renderer. Paper.js is vector math and boolean paths. Neither is an editor SDK. Konva’s own comparison says not to use them for this job.

Source: [Best JavaScript canvas library](https://konvajs.org/docs/guides/best-canvas-library.html).

## Design-editor SDKs

These are the closest “libraries that already supported it” — and the most expensive mismatch.

### Polotno

Polotno is an opinionated React canvas-editor SDK built on Konva and react-konva by the Konva maintainers. It ships Workspace, side panel, toolbar, zoom, undo, JSON store, and export to PNG/JPEG (plus PDF, video, and others). Image elements include crop fractions, flip, brightness, shadows, and `clipSrc` for framing. Combined filters cover contrast, saturation, and similar.

It does **not** document a StickerLab-style erase/restore brush in image-local mask coordinates. SVG `maskSrc` and image `clipSrc` are framing/overlay, not freehand alpha painting. Border is `borderSize` on the element box, not an alpha-dilated silhouette.

Integration cost is structural:

- Store is MobX / mobx-state-tree, not Zustand.
- Documents are Polotno page/element JSON, not `ProjectDocument`.
- Default UI is `polotno/ui.css`, not the mint editor layout.
- `createStore({ key: 'YOUR_API_KEY' })` is required.
- Current `polotno` 4.x targets React 19; this app is React 18.3. A 3.x line exists for React 18.
- Pricing (self-serve page, 2026-09-10): grass-roots **$249/mo** or $2,490/year (reviewed, limited); self-serve **$899/mo** or $9,990/year per domain/brand family; enterprise custom. 60-day trial on a private dev server. License verification goes to Polotno; designs stay on your side unless you use their cloud render API.

Polotno is what you buy *instead of writing* `EditorPage` + `store` + export. It is not a helper you drop into the existing document.

Sources: [Overview](https://polotno.com/docs/overview), [Element API](https://polotno.com/docs/element), [Import/export](https://polotno.com/docs/import-and-export), [Pricing](https://polotno.com/pricing).

### IMG.LY CreativeEditor SDK (CE.SDK)

CE.SDK is a full in-browser design editor: transform, templates, placeholders, asset libraries, text, collage, headless engine API, customizable UI, PNG export with transparency, and a background-removal plugin. Architecture is CreativeEngine scenes/blocks (`graphic`, `text`, `page`, `cutout`, …), not `ProjectDocument`.

`cutout` blocks are for masking/print cut-out operations, not the current brush-in-image-space erase/restore loop. Stickers in CE.SDK terms are asset-library graphics in *their* scene graph.

Licensing is commercial with no public per-seat price; quotes are sales-led. Trial keys last 30 days. License validation plus an aggregate export count go to IMG.LY; image bytes are not sent. AI plugins may call third-party inference providers billed separately. Enterprise can disable server communication.

Adopting CE.SDK would replace the editor, schema, templates, and export path, then still leave packs, IndexedDB, guest migration, and the mint shell as StickerLab code.

Sources: [CE.SDK React overview](https://img.ly/docs/cesdk/react/), [Blocks](https://img.ly/docs/cesdk/js/concepts/blocks-90241e/), [Pricing](https://img.ly/pricing).

## Photo editors (single image + overlays)

These overlap crop, filters, text, and “stickers” as decorations on one photo. They do not own a multi-sticker document, pack ZIP, or template cloning.

### Pintura (pqina)

Commercial vanilla JS editor with React bindings. Strengths: crop guides, aspect lock, orientation, resize, color finetune, annotations (rect/circle/line/text/freedraw), watermarking, optional video extension. Marketing copy calls it a shortcut for “image cropping and stickers.” Background removal is via third-party AI, not a built-in local mask painter.

Pintura’s unit of work is *an uploaded image and its output*, not a versioned layered `ProjectDocument` with independent image layers, pack membership, and artwork-bounded composition export.

Sources: [Pintura product](https://pqina.nl/pintura/), [docs index](https://pqina.nl/pintura/docs/).

### Filerobot Image Editor

MIT-licensed React editor built on **react-konva** (same engine family). Features: crop, flip, rotate, finetune, filters, annotate (text, image gallery, shapes, pen), watermark, undo/redo, touch-friendly UI. `onSave` returns an image plus experimental `designState`. Image annotations can pull from a gallery — the closest OSS “sticker overlay” API.

It still assumes one source photo. There is no documented image-local erase/restore mask, no silhouette outline compositor, and no independent multi-layer sticker document. Saving design state is marked experimental. UI is Filerobot’s, not StickerLab’s.

Source: [scaleflex/filerobot-image-editor README](https://github.com/scaleflex/filerobot-image-editor).

### TOAST UI Image Editor

MIT, Fabric.js **4.2.0**, crop/flip/rotate/draw/shape/icon/text, “mask filter,” many image filters, undo/redo, React wrapper. Mask here means applying a mask *image* as a filter, not painting an alpha mask in image-local space. Minimum practical UI size is called out as 550×450. The stack is older than current Fabric 6/7 and this repo’s Konva 9.

Source: [nhn/tui.image-editor](https://github.com/nhn/tui.image-editor).

## Whiteboards

**tldraw** is a production infinite-canvas SDK (selection, transform, undo, custom shapes). Default tools are whiteboard tools. Production use requires a trial, commercial, or hobby license key; default terms are development-only. Source-available, not OSI open source.

**Excalidraw** is the same category.

Neither models photo stickers, masks, or transparent artwork-bounded PNG packs.

Sources: [tldraw](https://tldraw.dev/), [tldraw license](https://tldraw.dev/community/license), [Konva comparison](https://konvajs.org/docs/guides/best-canvas-library.html).

## Background removal (not an editor)

Automatic cutout is explicitly out of the current editor (`docs/core-tools-plan.md`). A real library exists:

**`@imgly/background-removal`** runs in-browser (ONNX) with a Node counterpart. Free under **AGPL**; other licenses via IMG.LY sales.

AGPL would copyleft a shipped StickerLab frontend unless a commercial grant is obtained. The brief already requires licensing review, progress, cancellation, and failure handling — never a fake cutout. This package could *feed* the existing mask pipeline later; it does not replace the editor.

Source: [imgly/background-removal-js](https://github.com/imgly/background-removal-js).

## What no reviewed library already does

These StickerLab behaviors are product code either way:

- Image-local erase/restore that remains aligned after scale, rotate, flip, crop, and zoom
- Outline dilation of the *alpha silhouette*, shared by canvas preview and PNG
- Artwork-bounded export (trim transparent margins, longest edge 512/1024, keep aspect)
- Versioned `ProjectDocument` + blob store + autosave + guest-to-cloud migration
- Template clone isolation and pack membership that does not delete stickers
- Mint desktop/mobile chrome (tools / canvas / inspector / tray)

Buying Polotno or CE.SDK would delete most of `src/features/editor/` and `src/types/domain.ts`, then re-implement those invariants on someone else’s schema — or drop them.

## Recommendation

**Keep the custom Konva editor.** The expensive, sticker-specific work is already written. Konva is the library that “already supported” the canvas half; Polotno/CE.SDK/Pintura support a *different product*.

Do not:

- Replace Konva with Fabric or PixiJS without a new requirement (SVG round-trip, WebGL games, etc.).
- Mount Polotno or CE.SDK beside the current store. Two document models violate `docs/core-tools-plan.md` (“one editor, one Zustand store, one document schema”).
- Swap `EditorPage` for Filerobot or TOAST UI. They are single-photo UIs and would regress masks, outlines, and export.

Consider later, as *add-ons*, only after an explicit product decision:

1. **`@imgly/background-removal`** (or a commercially licensed equivalent) to *initialize* a mask, then keep manual erase/restore. Blocked on AGPL vs paid license, model size, and UX for progress/cancel.
2. Small focused helpers we already use or could use without changing the document: `react-colorful` (in use), Konva `Transformer` (in use). `react-moveable` is for DOM/CSS, not this canvas.

If the goal is “write less editor code next time,” Polotno is the honest Konva-native SDK — paid, React 19 on current major, different schema. For *this* repository, the code that looks large is the product, not an accident of missing npm packages.

## Sources

- StickerLab: `src/types/domain.ts`, `src/features/editor/*`, `src/features/exports/renderDocument.ts`, `AGENTS.md`, `StickerLab-Agent-Brief.md`, `docs/core-tools-plan.md`
- [Konva: choosing a canvas library](https://konvajs.org/docs/guides/best-canvas-library.html)
- [Konva: canvas editor sandbox](https://konvajs.org/docs/sandbox/Canvas_Editor.html)
- [Polotno overview](https://polotno.com/docs/overview)
- [Polotno element API](https://polotno.com/docs/element)
- [Polotno import/export](https://polotno.com/docs/import-and-export)
- [Polotno pricing](https://polotno.com/pricing)
- [CE.SDK React](https://img.ly/docs/cesdk/react/)
- [CE.SDK blocks](https://img.ly/docs/cesdk/js/concepts/blocks-90241e/)
- [IMG.LY pricing](https://img.ly/pricing)
- [Fabric.js](https://github.com/fabricjs/fabric.js)
- [Pintura](https://pqina.nl/pintura/)
- [Filerobot Image Editor](https://github.com/scaleflex/filerobot-image-editor)
- [TOAST UI Image Editor](https://github.com/nhn/tui.image-editor)
- [tldraw license](https://tldraw.dev/community/license)
- [@imgly/background-removal](https://github.com/imgly/background-removal-js)
