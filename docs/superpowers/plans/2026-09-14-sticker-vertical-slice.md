# Sticker Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first working SvelteKit sticker slice: dashboard → create/upload → edit image/text → local save/autosave → reload/reopen → transparent PNG export, without changing Supabase or introducing a backend.

**Architecture:** Convert the target package/showcase scaffold into a browser-first SvelteKit app using filesystem routes and a root layout. Copy/reuse the source's serializable domain, validated upload, IndexedDB repository, draft-save coordinator, and canvas export pipeline unchanged where framework-independent; put browser-only repository/object-URL/canvas/Konva setup behind client lifecycle boundaries. Replace React context/Zustand bindings with Svelte 5 rune state scoped to the app/editor, keeping `ProjectDocument` authoritative and keeping assets/masks separate.

**Tech Stack:** Svelte 5 runes, SvelteKit 2 filesystem routing, Vite, TypeScript/checkJs, IndexedDB, browser Canvas, existing target Vitest/Playwright configuration, optional browser Supabase untouched and not required for this slice.

**Spec:** `docs/superpowers/specs/2026-09-14-react-to-svelte-design.md`

## Global Constraints

- Preserve local-first operation without credentials; documents remain versioned and authoritative, with image blobs/masks stored separately.
- Retain optional browser Supabase naming/protocols; do not add server auth, identity mapping, schema migration, service-role keys, or new backend routes.
- Implement SvelteKit route files for `/`, `/create`, and `/editor/:projectId`; do not embed React or add placeholder routes for later parity.
- Do not persist Konva nodes, DOM objects, functions, object URLs, or viewport state.
- Flush pending work before replacing an editor document/repository; failed flushes retain drafts and block unsafe replacement; never cancel pending writes on teardown as the safety mechanism.
- Accept only PNG, JPEG, and static WebP uploads, enforcing 15 MB and 25 megapixel limits and decode validation.
- Export transparent PNG at 512×512 and 1024×1024 without checkerboard, selection, guides, or viewport transforms.
- Keep all new Svelte components/modules in runes mode, use `onclick`/`onchange` attributes, and run `svelte-autofixer` on every changed `.svelte`/`.svelte.ts` file.
- Do not initialize Git, commit, push, publish, deploy, mutate production data, or copy secrets.

## Source/Target Map and Import Graph

### Target files to modify/create

- Modify `src/routes/+layout.svelte`: root `children` render plus app-level browser repository/editor context; import global CSS.
- Replace `src/routes/+page.svelte`: dashboard page and real recent-project/template sections.
- Modify `src/routes/layout.css`: import/carry the source tokens, responsive shell/editor rules, and component styles needed by this slice; retain Tailwind setup only where useful.
- Modify `package.json`: make app scripts/dependencies explicit; retain `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, and `npm run build`; remove only scaffold startup integrations proven unused by imports (do not remove Supabase dependencies).
- Modify `vite.config.js` only if browser Vitest/Svelte aliases or client tests require it; preserve existing dual client/server projects.
- Keep `jsconfig.json` strict and extending `.svelte-kit/tsconfig.json`.
- Create `src/routes/create/+page.svelte` and `src/routes/editor/[projectId]/+page.svelte`.
- Create `src/lib/domain/domain.ts` (or the target's existing `$lib` equivalent) by copying `src/types/domain.ts` exactly, including schema version 1 and 1024 transparent artboard contracts.
- Create `src/lib/persistence/{document,idb,repository}.ts` and `src/lib/{blob,fonts,imageDecode,imageFormat,hash,utils}.ts` from the exact source modules after import audit.
- Create `src/lib/assets/{assetLoader,validateUpload}.ts`, including catalog asset modules needed by the editor.
- Create `src/lib/exports/{download,renderDocument}.ts` and the focused renderer tests.
- Create `src/lib/editor/{state,draftSaving,toolIntent,projectThumbnails}.svelte.ts` (names may remain `.ts` where no runes are used); expose explicit commands matching the source store behavior rather than a generic store abstraction.
- Create focused UI components under `src/lib/components/` for shell/header/sidebar, dashboard, editor chrome, canvas, inspector, asset tray, export dialog, project thumbnail and accessible dialogs. Keep each component responsible for one surface; no full-page image substitute.
- Copy source `public/art`, `public/fonts`, and `public/samples` to target `static/` with source provenance preserved/documented; do not invent remote assets.

### Source modules read and seams to preserve

- `src/types/domain.ts`: copy contracts and `DOCUMENT_SCHEMA_VERSION`, `ARTBOARD_SIZE` unchanged.
- `src/lib/persistence/document.ts`, `idb.ts`, `repository.ts`: reuse parsing/reference-integrity, IndexedDB version/name/store/key conventions, `StickerLabRepository`, `MemoryRepository`, `IdbRepository`, `loadProjectBundle`, and atomic `saveProjectWithAssets`.
- `src/lib/blob.ts`, `fonts.ts`, `imageDecode.ts`, `imageFormat.ts`, `hash.ts`, `utils.ts`: reuse pure/browser helpers; do not import Svelte.
- `src/features/assets/assetLoader.ts`, `validateUpload.ts`: preserve original blobs, provenance, fit-to-artboard transform, object URL cache, upload limits and format sniffing.
- `src/features/editor/store.ts`: translate the public command surface to rune state: hydrate/create draft, selection/viewport/tool state, image/text edits, transform/undo/redo, dirty/save status, mask seam. Preserve one history entry per completed gesture.
- `src/features/editor/draftSaving.ts`, `useDraftAutosave.ts`: retain coordinator semantics (`save`, `flush`, 800 ms debounce, pagehide/beforeunload warning, origin/workspace matching, revision-specific acknowledgement); replace the React hook with `$effect`/lifecycle wiring in the editor route.
- `src/features/editor/toolIntent.ts`, `catalog.ts`, `projectThumbnails.ts`: retain query tool intent, no duplicate text insertion on reload, catalog/preset data, revision-keyed LRU thumbnail URLs and exact-once revocation.
- `src/features/editor/EditorPage.tsx`, `KonvaCanvas.tsx`: port only the first slice UI and browser canvas seam. Direct Konva integration is allowed; no `react-konva`. DOM fallback is permitted for deterministic component tests but must share the same document state.
- `src/features/exports/renderDocument.ts`, `download.ts`: reuse renderer and download boundary; export only after bundle/assets/fonts are ready.
- `src/app/routes.tsx`, `routeModules.ts`, `repository.tsx`, `Shell.tsx`, `features/dashboard/DashboardPage.tsx`, plus their resolved UI imports (`Hero`, `StickerCollage`, `LocalProjectList`, `TemplateRail`, shared buttons/dialogs): port visible behavior into Svelte components, not React wrappers. Preserve navigation paths and tool query behavior.

## Implementation Tasks

### Task 1: Normalize the app scaffold and global visual foundation

**Files:**

- Modify: `package.json`, `vite.config.js`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/layout.css`
- Create: `src/lib/components/AppShell.svelte`, `src/lib/components/Header.svelte`, `src/lib/components/Sidebar.svelte`, `src/lib/styles/tokens.css` if token ownership is split
- Copy: `static/art/**`, `static/fonts/**`, `static/samples/**`
- Test: `src/routes/app-shell.svelte.test.ts`

**Interfaces:**

- Produces an app shell with accessible links to `/`, `/create`, `/templates`, and `/my-stickers`; this slice must make `/` and `/create` real and must not advertise unimplemented cloud/presentation actions as working.
- Produces a repository context/controller consumed by route components; default is `getLocalRepository()` in the browser.

- [ ] Step 1: Add the source art/font/sample assets and provenance note, preserving local URL paths (`/art/...`, `/fonts/...`, `/samples/...`).
- [ ] Step 2: Replace the welcome page/layout with root `children` rendering and shell navigation using Svelte `$props`, semantic `<a>` links, visible focus, mobile navigation, and no React imports.
- [ ] Step 3: Port only the source dashboard composition needed for the primary flow: hero, “Create a Sticker”, local-first copy, recent projects, and template rail; route unavailable features honestly rather than rendering dead controls.
- [ ] Step 4: Add a browser component regression that renders `/`, finds the Create link, and asserts its href is `/create`; assert the shell contains “No account needed” and “Saved on your device”.
- [ ] Step 5: Run `npm run check -- --output human` and `npm run test:unit -- --run src/routes/app-shell.svelte.test.ts`.

### Task 2: Port contracts, local persistence, upload validation, and renderer as framework-free modules

**Files:**

- Create: `src/lib/domain/domain.ts`
- Create: `src/lib/persistence/document.ts`, `src/lib/persistence/idb.ts`, `src/lib/persistence/repository.ts`
- Create: `src/lib/blob.ts`, `src/lib/fonts.ts`, `src/lib/imageDecode.ts`, `src/lib/imageFormat.ts`, `src/lib/hash.ts`, `src/lib/utils.ts`
- Create: `src/lib/assets/assetLoader.ts`, `src/lib/assets/validateUpload.ts`
- Create: `src/lib/exports/renderDocument.ts`, `src/lib/exports/download.ts`
- Test: `src/lib/assets/validateUpload.test.ts`, `src/lib/exports/renderDocument.test.ts`, plus copied repository tests where imports remain browser-safe

**Interfaces:**

- `StickerLabRepository` remains the exact local-first API, including `saveProjectWithAssets(document, assets, masks?)` and `loadProjectBundle(repository, document)`.
- `validateUpload(file, options?)` preserves error codes and messages for unsupported, animated, oversized, over-pixel, SVG, and undecodable files.
- `renderDocument(document, assets, { size, bounds?, masks?, ... })` remains injectable for fake canvas/decode/font tests and returns a PNG `Blob`.

- [ ] Step 1: Copy modules without Svelte imports and fix only path aliases/extensions; do not simplify validation, parser, transaction, reference-integrity, or export logic.
- [ ] Step 2: Port `validateUpload.test.ts` and the renderer tests, retaining runnable examples for PNG/JPEG/static WebP acceptance, APNG/animated WebP rejection, missing assets/masks, decode failures, transparent PNG dimensions, multiline text, filters, masks, and outline rendering.
- [ ] Step 3: Add a repository regression using `MemoryRepository`: save a version-1 document plus asset/mask, reload with `loadProjectBundle`, then inject a write failure and assert the original draft remains readable.
- [ ] Step 4: Run `npm run test:unit -- --run src/lib/assets/validateUpload.test.ts src/lib/exports/renderDocument.test.ts src/lib/persistence/repository.test.ts` and `npm run check -- --output human`.

### Task 3: Build Svelte editor state and safe draft saving

**Files:**

- Create: `src/lib/editor/editorState.svelte.ts`, `src/lib/editor/draftSaving.ts`, `src/lib/editor/toolIntent.ts`, `src/lib/editor/projectThumbnails.ts`
- Create: `src/lib/editor/editorState.test.ts`, `src/lib/editor/draftSaving.test.ts`, `src/lib/editor/projectThumbnails.test.ts`

**Interfaces:**

- `createEditorState()` returns document/assets/masks/selection/viewport/history/save/load/tool state plus explicit commands corresponding to the source store (`createDraft`, `hydrate`, `addImageLayer`, `addTextLayer`, `applyTransform`, `updateText`, `undo`, `redo`, `commitGesture`, `applyMask`, `clearMask`, `markSaved`).
- `createDraftSaving(state)` returns `save(repo)`, `flush(repo, { projectId }?)`, and `attachAutosave(repo)` with the source `SaveOutcome`/`FlushOutcome` semantics.
- `projectThumbnailKey(project)` is `${project.id}:${project.revision}` and cache eviction revokes each URL once.

- [ ] Step 1: Implement state with `$state` for mutable editor data and `$derived` for selected layer, undo/redo availability, and referenced asset/mask views; keep the state instance scoped to the root/editor tree, not in a server-shared mutable module.
- [ ] Step 2: Port command/history behavior and test that one title/transform gesture creates one undo entry, undo/redo preserves document revisions, and selection/zoom changes do not dirty the document.
- [ ] Step 3: Port draft saving as an explicit coordinator. Capture immutable serialized documents before queueing writes; only clear the exact revision persisted; retain failed drafts; return `blocked` for pending strokes, failed writes, or newer edits; never cancel an in-flight write on detach.
- [ ] Step 4: Port autosave and thumbnail cache tests, including delayed writes, repository/workspace replacement, failed retry, 800 ms debounce, concurrent thumbnail sharing, revision-keyed rerender, and exact-once URL revocation.
- [ ] Step 5: Run `npm run test:unit -- --run src/lib/editor/editorState.test.ts src/lib/editor/draftSaving.test.ts src/lib/editor/projectThumbnails.test.ts`.

### Task 4: Implement create/reopen routes and the minimal editor surface

**Files:**

- Create: `src/routes/create/+page.svelte`, `src/routes/editor/[projectId]/+page.svelte`
- Create: `src/lib/components/EditorWorkspace.svelte`, `EditorCanvas.svelte`, `EditorToolbar.svelte`, `EditorInspector.svelte`, `AssetTray.svelte`, `ExportDialog.svelte`, `ProjectThumb.svelte`
- Modify: `src/routes/layout.css`
- Test: `src/routes/editor/editor-flow.svelte.test.ts`, `e2e/editor.spec.ts` (target port/focused subset)

**Interfaces:**

- `/create` flushes the current draft before minting/reusing a draft ID; `?tool=erase|text|effects|export` selects existing editor chrome without inserting duplicate layers.
- `/editor/:projectId` loads the document and `loadProjectBundle` from the injected repository, reports not-found/malformed/missing-asset errors, and uses route cleanup/pagehide to flush safely.
- Upload calls `ingestImageFile`, creates an image layer with `fitImageToArtboard`; text insertion/editing updates the document through commands; selected image transforms and title edits are undoable gestures.

- [ ] Step 1: Implement `/create` using the source create-route semantics: flush first, redirect to an existing reusable document when appropriate, otherwise create one draft ID and redirect to `/editor/:id`.
- [ ] Step 2: Implement `/editor/[projectId]` loading and replacement guards. Await pending mask/save work before replacing a document; on blocked flush, stay on the current editor and show recovery status.
- [ ] Step 3: Implement the minimum editor UI: upload file input, image layer canvas, select/drag/rotate/scale, add/edit text, title field, undo/redo, local save status, and mobile-accessible inspector/tray. Use `$effect` only for browser-only Konva/DOM synchronization and teardown.
- [ ] Step 4: Implement PNG export dialog with 512/1024 choices; await `loadProjectBundle`, call `renderDocument` with `bounds: 'artwork'` for downloads, and call `downloadBlob` with an honest filename/status.
- [ ] Step 5: Add a deterministic component flow test: create draft → upload synthetic PNG fixture → assert image layer and `data-testid="editor-canvas"` → add text → save → navigate away/reload/reopen → assert title/layers/assets → export and inspect PNG MIME/dimensions/alpha.
- [ ] Step 6: Run `npm run check`, `npm run test:unit -- --run src/routes/editor/editor-flow.svelte.test.ts`, and the focused Playwright journey `npx playwright test e2e/editor.spec.ts --grep "upload|save|reopen|export"` (use the target's actual test naming if the port changes it).

### Task 5: Verify the complete first slice and document honest boundaries

**Files:**

- Modify: `docs/assets-provenance.md` or the target provenance document, `README.md` only if present/owned by the implementation worker
- Test: focused target unit/browser tests and first-slice Playwright journey

- [ ] Step 1: Run `npm run lint` and resolve all Svelte accessibility/compiler findings.
- [ ] Step 2: Run `npm run build` and verify no Better Auth/Drizzle startup path is imported by the app shell or these routes.
- [ ] Step 3: Run the focused journeys at 1440×900, 1024×768, and 390×844: empty dashboard, upload/edit/save/reopen, save failure recovery, transparent export, keyboard focus, mobile inspector/actions.
- [ ] Step 4: Inspect generated PNGs, not only download clicks: MIME `image/png`, requested dimensions, transparent untouched pixels, artwork bounds, and no viewport decorations.
- [ ] Step 5: Record unavailable live Supabase/RLS/storage verification explicitly; local-only operation must pass without credentials. Record the IndexedDB origin limitation (same database name does not transfer data across origins).
- [ ] Step 6: Run `git status --short` only if the target becomes versioned by its owner; otherwise report the target's unversioned status and confirm no staged files were created.

## Self-review checklist

- **Spec coverage:** Tasks 1–2 cover scaffold, local assets, contracts, persistence, upload validation, and export; Task 3 covers versioned drafts, autosave, history and thumbnail lifecycle; Task 4 covers `/`, `/create`, `/editor/:projectId`, upload/edit/save/reopen/export and responsive controls; Task 5 covers required checks and honest cloud/origin boundaries. Templates/packs/presentations/cloud parity remain later slices exactly as the spec requires.
- **No placeholders:** Every task names paths, interfaces, runnable commands, and concrete regression behavior. No task claims full port parity.
- **Type consistency:** `ProjectDocument`, `AssetRecord`, `MaskRecord`, `StickerLabRepository`, `renderDocument`, `SaveOutcome`, and `FlushOutcome` are the shared seams used consistently across tasks.
- **Scope check:** No server auth redesign, presentation route, catalog administration, public sharing, billing, automatic background removal, or production operation is included.
