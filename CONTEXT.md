# Peeloodle (SvelteKit) — context and handoff

The SvelteKit port of the Peeloodle React sticker editor. This file is the entry point for the next
AI session: what is implemented, what was verified and how, what is deliberately absent, and where the
binding documents live. It is written to be read first, then followed by pointer to the two
long-lived documents (spec + progress) rather than duplicating them.

## Boundaries (non-negotiable for this port)

**Target** = `/home/vdc/Projects/Peeloodle` (this repository, branch `main`). **Source** = the React
application this repo was ported from: now **git tag `react-final`** in this same repository
(`54eae61c6e93519f235dd91641da92ca000ae189`), still on disk for reference at
`/home/vdc/Projects/Peeloodle-React-archive`. Never edit the React tree; read it for parity.
Provenance comments in `src/**` that mention `../Peeloodle/...` refer to that tag.

- The repository **is versioned now** (commit "Rewrite the app on SvelteKit" on `main`, remote
  `origin` = `git@github.com:ducchinhpro123/Peeloodle.git`, ahead of `origin/main`, **not pushed**).
  `git show react-final:<path>` reads the React app and `git diff react-final..main` is the port.
  Commit locally when asked; **do not push, deploy, or touch production configuration or data
  without explicit approval** — the repository is production-deployed and a push would attempt a
  SvelteKit deploy.
- **Cloud is implemented and optional** (slice 4). `@supabase/supabase-js` is installed and drives
  the browser integration only when valid **public** configuration exists for the page's origin
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_AUTH_ALLOWED_ORIGINS`); without it the
  app stays fully local. Never copy secrets or accept a service-role key; no server/cookie session
  architecture. **Live RLS/Storage verification is unavailable** (no deployed test project or
  accounts) and the cloud journeys run against a synthetic in-process backend — report that
  honestly rather than claiming deployed-backend verification. Presentations stay local (the source
  has no presentation cloud tables).
- **Not ported, on purpose:** catalog administration (deferred by the design), cloud pack views
  (shared packs, cloud export history, public sharing), billing, background removal. The
  presentation model, local repositories, rendering layer, local library,
  `/presentations/<id>` editor and its PDF/PPTX/backup exports are ported; masks/restore brushing is
  fully implemented.
- Preserve: document schema versions, the `stickerlab-local` IndexedDB store names/keys, separate
  image blobs, immutable originals, image-local masks, editor draft recovery/navigation, template
  clone independence, the `stickerlab_fav_templates` localStorage key, modal/dialog regressions.
- File search must use the FFF tools (no `grep`/`find` CLI for discovery); work must be serial in this
  checkout; no nested subagents from a child session.
- Before any Svelte analysis or edit: load both Svelte skills, call the Svelte MCP `list-sections`,
  fetch only the targeted `get-documentation` sections, and run `svelte-autofixer` on every changed
  component/module. Direct MCP calls only — no CLI transport for MCP.

## Language

**Sticker (project / document)**: the editable artwork a user creates — a versioned `ProjectDocument`
(title, artboard, layers, assetIds, revision) persisted in IndexedDB; never persisted with scene
graph nodes, object URLs or viewport state.
_Avoid_: file, image, drawing

**Pack**: a named, ordered collection of saved stickers (`PackRecord` = title, description,
visibility, `projectIds` in membership order) that exports as one ZIP.
_Avoid_: album, folder, bundle, collection

**Template**: one of the twelve seeded catalog compositions in `src/lib/editor/templates.ts`;
"Use Template" clones it into an independent sticker (new document/layer/asset ids).
_Avoid_: preset, sample (the `/art/templates/sample-N.png` files are previews, not templates)

**Asset**: stored image bytes plus metadata (mimeType, size, provenance) in its own IndexedDB store;
separate from the document that references it.
_Avoid_: blob (the `Blob` is the runtime value; the asset is the stored record)

**Mask**: image-local PNG applied to one image layer's alpha via `maskKey`, painted by the
Erase/Restore brush (one history entry per stroke) and rendered by preview, PNG export and ZIP.
_Avoid_: eraser, cutout, alpha channel

**Revision**: the monotonic save counter on a document; a save may only clear the revision it actually
persisted.
_Avoid_: version (schema versions use that word), save number

**Library**: the `/my-stickers` page — packs plus the sticker drawer. Distinct from the **catalog**
(`/templates`), which is the seeded template showcase.
_Avoid_: gallery, showcase, my stickers (that is the route, the concept is the library)

**Shell**: the app chrome (`AppShell` → `Header` + `Sidebar` + routed page). Shell links are built only
by `shellHref()` in `src/lib/app/navigation.js`.
_Avoid_: layout (used for the CSS grid class), frame

## Current implementation

Status as of 2026-09-16: slices 1–4 are implemented and locally verified, and **milestones 4 and the
first eight items of milestone 5 of `docs/slides-implementation-plan.md` were implemented on
explicit request** — catalog schema/RLS/policies, guarded admin RPCs, typed repositories, the
`/admin` guard with the collections console, then durable upload batches with leased validation jobs,
server-side PNG/WebP/SVG processing, and the `/admin/uploads` + `/admin/assets` review screens, with
a local PostgreSQL harness (52 checks) standing in for the live isolation check that needs a
dedicated test project. **Milestone 5's last three items (P62 student catalog panel, P63 snapshot
download before insertion, P64 the end-to-end journey) are not implemented yet.** Slice 3 is complete as
written — presentation model, local storage, rendering, the `/presentations` library, the
`/presentations/[presentationId]` editor, its PDF/PPTX/backup exports, and every source presentation
journey either ported or recorded as superseded (the P44 reader-fixture proof is source proof
infrastructure and deliberately not ported). Slice 4 ports the optional browser Supabase
integration: public config validation, PKCE sign-in and callback, per-account private workspace,
immutable artwork upload/download, the conflict-checked commit RPC, guest import, retry and conflict
copies — exercised by 6 synthetic-cloud journeys. The slice-5 leftovers have coverage too: reduced
motion and keyboard-only journeys. Focused tests and all configured checks are green. Slice 2
remains **implemented, green and independently reviewed** (the masks review returned BLOCK, its
defects were fixed, and re-review returned PASS).

**Working routes:** `/` dashboard · `/templates` catalog · `/my-stickers` library · `/create` ·
`/editor/[projectId]` · `/presentations` library · `/presentations/[presentationId]` editor ·
`/auth/callback` (real PKCE callback, honest missing/invalid-link state) ·
`/admin/{collections,assets,uploads}` (administrator-only; redirects from `/admin`) ·
`POST /api/catalog/process` (the app's only server-side route: trusted asset validation for a claimed
job, using the caller's own JWT). Presentation exports
(PDF/PPTX/backup) and the optional cloud account work from the app shell.

**Cloud, when configured:** header account button → email-link sign-in (PKCE) → private workspace
with cloud-saved stickers/packs, explicit guest import, retry after disconnect and conflict copies;
sign-out hides the account cache on this device. Without public configuration nothing cloud-related
is fetched or shown, and all local journeys stay green.

**End-to-end without credentials:** dashboard → templates (search, categories, previews, favorites,
independent "Use Template" clone) → my-stickers (pack views via `?view=`, `?pack=<id>` deep link,
search/Recent-Name sort, pack covers, add/reorder/remove membership, edit/duplicate/delete, ordered
transparent-PNG ZIP export, sticker drawer `#local-stickers`, Favorite Templates rail) → create →
editor (validated PNG/JPEG/static-WebP upload, Konva drag/scale/rotate, text, filters, outline,
flip/rotate, layers, **Erase/Restore mask brush with brush size + Reset Mask**, undo/redo per
gesture, autosave + explicit save, reload/reopen with masks, 512/1024 artwork-bounds PNG export, and
the mask travelling into pack ZIPs) → presentations library → presentation editor (canvas
selection/move/resize/rotate with guides, zoom/pan, in-place rich text with a format toolbar,
shapes/photos/sticker snapshots, slide add/duplicate/reorder/delete, element layer list and
geometry/style/image/theme panels, undo/redo, debounced autosave, leave guard and conflict
recovery, plus a 960×540 pt image-based PDF, an editable PPTX and a restorable `.stickerlab.zip`
backup, with cancellation and preflight warnings, that keep working after a disconnect once the
presentation flow has been prepared).

**Key files for the newest work (milestone 5: uploads, processing, review):**

| Path                                                             | Role                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260916160000_catalog_uploads.sql`         | Batch/job lifecycle (reserved paths, `position`, claim gates against Storage, leases with bounded attempts, completion validation, fail/retry/cancel/close) plus the bounded orphan listing and the delete policies |
| `supabase/migrations/20260916170000_catalog_claim_job.sql`       | Adds the optional job id to the claim so one request acts on exactly one job                                                                                                                                        |
| `src/lib/catalog/processing/{limits,errors,raster,svg,index}.ts` | The trusted validator: header sniffing, decode limits, PNG/WebP derivatives, the strict SVG static subset and bounded resvg rasterization                                                                           |
| `src/lib/catalog/processing/runJob.ts`                           | One claimed job end to end, with every dependency injected (and the validator required, so no native decoder reaches the browser bundle)                                                                            |
| `src/routes/api/catalog/process/+server.js`                      | The server function: `{jobId}` + bearer token in, validated version out; no service-role key exists anywhere                                                                                                        |
| `src/lib/components/catalog/AdminUploadsPage.svelte`             | Bulk queue: preflight, direct uploads, per-file stages from the database, retry/cancel, honest resume, cleanup dry run                                                                                              |
| `src/lib/components/catalog/AdminAssetsPage.svelte`              | Asset grid + inspector: filters, signed draft preview, version facts, publication refusals, conflict that adopts the server revision, pinned-archive explanation                                                    |
| `src/lib/catalog/{types,repository,parse,memory,remote}.ts`      | Upload contracts, storage seam (`uploadSource`/`uploadDerivative`/`downloadSource`/`removeObjects`), strict parsers, and a fake that now hands out snapshots                                                        |

**Key files for milestone 4 (trusted catalog backend, repositories, admin console):**

| Path                                                                                                | Role                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260916120000_catalog_schema.sql`                                             | Catalog tables: collections, assets, templates, immutable version rows, dependency pins, upload bookkeeping, event journal                                                  |
| `supabase/migrations/20260916120100_catalog_policies.sql`                                           | `catalog_is_admin()`, published-only read policies, no write grants, and the two private Storage buckets with path-scoped read rules                                        |
| `supabase/migrations/20260916120200_catalog_admin_rpcs.sql`                                         | Guarded admin RPCs (`{ok,item}` / `{ok,reason,detail}` envelopes): create/update with CAS revision, publish, archive, events                                                |
| `scripts/verify-catalog-sql.mjs` (`npm run test:catalog-sql`)                                       | Throwaway PostgreSQL + Supabase shim running the real migrations: **35 checks** of immutability, pointer integrity, RLS/Storage visibility and every guard                  |
| `scripts/verify-catalog.mjs` (`npm run test:catalog-live`)                                          | Live three-session isolation check (admin/ordinary/anonymous) for a dedicated test project — **written but never run**: no project or credentials exist                     |
| `src/lib/catalog/{types,repository,parse,memory,remote}.ts` + `client.ts`                           | Domain types and interfaces, strict snake_case parsers, the in-memory fake, the PostgREST/RPC adapter, and `getCatalogRepository()`                                         |
| `src/lib/components/catalog/{AdminGuard,AdminShell,AdminCollectionsPage}.svelte`                    | Route-wide admin gate (five honest states), section nav, and the collections console (search/create/edit/publish/archive, revision conflicts and refusal reasons preserved) |
| `src/routes/admin/{+layout,+page}.svelte`, `src/routes/admin/collections/+page.svelte`              | The `/admin` shell, its redirect to `/admin/collections`, and the collections route                                                                                         |
| `supabase/README.md`                                                                                | Migration order, the admin bootstrap insert and the membership-removal recovery SQL                                                                                         |
| `src/lib/catalog/catalog.test.ts` + `remote.test.ts`, `src/lib/components/catalog/*.svelte.test.ts` | 21 unit and 11 browser tests: domain semantics, the adapter's query composition, gate states and console flows                                                              |

**Key files for slice 4 (optional cloud) and the slice-5 sweeps:**

| Path                                                                               | Role                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/lib/cloud/config.ts` + `database.ts`                                          | Public config validation, lazy PKCE client, `safeReturnPath`; generated Supabase schema types                      |
| `src/lib/persistence/cloudRemote.ts` + `cloud.ts`                                  | Owner-scoped list/download/commit wire contract, and the local-first queue/conflict/import repository              |
| `src/lib/cloud/workspace.svelte.ts`                                                | Session, per-account repository/status, flush-before-switch, epoch and gate; context triplet with a guest fallback |
| `src/lib/components/AccountDialog.svelte`, `CloudBanner.svelte`, `AppScope.svelte` | Sign-in/import/status UI, shell banner, per-epoch app-context publication                                          |
| `src/routes/auth/callback/+page.svelte`                                            | Real PKCE callback with honest invalid-link recovery                                                               |
| `e2e/cloud.spec.ts` + `playwright.cloud.config.js`                                 | Synthetic Supabase (auth/REST/Storage) and six cloud journeys; run via `npm run test:e2e:cloud`                    |
| `e2e/a11y-sweep.spec.ts`                                                           | Reduced-motion pair (dialog reveal suppressed/allowed) and Tab/Enter-only navigation + pack flow                   |
| `src/lib/persistence/cloud.test.ts`, `src/lib/cloud/config.test.ts`                | 18 unit cases for the queue/conflict/import/expiry contracts and the public-config rules                           |

**Key files for the newest work (presentation editor, exports and journeys, slice-3 increment 5–6):**

| Path                                                                                                                                                    | Role                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/presentations/[presentationId]/+page.svelte`                                                                                                | Base-aware route seam that mounts the editor with the URL id                                                                                                                                        |
| `src/lib/components/presentation/PresentationEditorPage.svelte`                                                                                         | Load states, editor bar, slide rail, inspector wiring, export dialog and leave guard                                                                                                                |
| `src/lib/components/presentation/ExportDialog.svelte`                                                                                                   | PDF/PPTX/backup dialog: progress, cancel, preflight warnings, offline readiness line                                                                                                                |
| `src/lib/presentations/exports/snapshot.ts`                                                                                                             | Shared preflight: capture, decode referenced media once, warnings, dispose-once                                                                                                                     |
| `src/lib/presentations/exports/pdf.ts` + `pptx.ts`                                                                                                      | Raster PDF (960×540 pt pages) and editable OOXML PPTX builders, both abort-aware                                                                                                                    |
| `src/lib/presentations/editor/exportController.ts`                                                                                                      | One-export-at-a-time controller: flush, cancel, download only on success, reload guidance                                                                                                           |
| `src/lib/presentations/presentationOffline.svelte.ts`                                                                                                   | Runes bridge over the offline readiness state machine, module and route preloading                                                                                                                  |
| `src/lib/components/presentation/PresentationCanvas.svelte`                                                                                             | Konva stage: viewport, hit-testing, transform handles, guides, selection frame                                                                                                                      |
| `src/lib/presentations/editor/store.svelte.ts`                                                                                                          | Non-proxied document state, slide/element/text/theme mutations, history groups, undo/redo                                                                                                           |
| `src/lib/presentations/editor/presentationSaving.ts`                                                                                                    | Debounced autosave, revision ownership, conflict detection and leave flush                                                                                                                          |
| `src/lib/presentations/editor/textEditSession.svelte.ts`                                                                                                | Live text session that defers autosave while composing and commits one history entry                                                                                                                |
| `src/lib/components/presentation/TextEditOverlay.svelte`                                                                                                | In-place text editing surface (paragraph/run model, overflow reporting)                                                                                                                             |
| `src/lib/components/presentation/TextFormatToolbar.svelte`                                                                                              | Bold/italic/underline/strike, size, colour, alignment, lists, spacing                                                                                                                               |
| `src/lib/presentations/editor/*.test.ts`                                                                                                                | Store, geometry, guides, shape, insert, save and text-format contracts                                                                                                                              |
| `src/lib/components/presentation-editor-page.svelte.test.ts`                                                                                            | 13-test browser contract for the mounted editor page                                                                                                                                                |
| `e2e/presentations.spec.ts` + `e2e/presentations.ts`                                                                                                    | Seven production-build journeys plus the shared DOM/IndexedDB helpers                                                                                                                               |
| `e2e/presentation-exports.spec.ts` + `e2e/presentation-offline.spec.ts`                                                                                 | Export bytes read back, and the three production offline journeys (prepared session, pre-warm-up disconnect, failed builder fetch)                                                                  |
| `e2e/presentation-{guards,library-actions,image,milestone-journey,library-thumbnails,transform,text,slides,responsive,view-state,scale-limits}.spec.ts` | The increment-6 journeys: guards, library actions, stored image bytes, the desktop/tablet milestone, thumbnails, transforms at two zooms, text, slides, responsive, view-state and the P45 ceilings |

**Previously (presentation library, slice-3 increment 3):**

| Path                                                   | Role                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/lib/components/PresentationsPage.svelte`          | Shell-integrated local library: create/search/rename/duplicate/delete/restore              |
| `src/lib/components/PresentationThumb.svelte`          | IntersectionObserver attachment and thumbnail acquisition/release lifecycle                |
| `src/lib/presentations/library/*`                      | Revision-safe actions, bounded memory thumbnail queue/cache and independent backup restore |
| `src/lib/presentations/exports/backup.ts`              | Versioned, bounded, checksummed ZIP writer/parser used by restore                          |
| `src/routes/presentations/+page.svelte`                | App-context repository plus base-aware presentation URL seam                               |
| `src/lib/components/presentations-page.svelte.test.ts` | Browser coverage for create, filter, duplicate, rename, delete and thumbnail mounting      |

**Previously (presentation rendering, slice-3 increment 2):**

| Path                                                | Role                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/lib/presentations/rendering/textLayout.ts`     | Shared rich-text measurement, wrapping, bullets, alignment and overflow                   |
| `src/lib/presentations/rendering/renderSlide.ts`    | Direct-Konva page renderer for shapes, cropped/flipped images and rich text               |
| `src/lib/presentations/rendering/decodedArtwork.ts` | Owned bitmap/object-URL sessions with exact replacement/failure disposal                  |
| `src/lib/presentations/rendering/rasterizeSlide.ts` | Detached fixed-page PNG rasterizer for thumbnails and exports                             |
| `src/lib/presentations/rendering/fonts.ts`          | Stable font IDs and strict loading for eight Vietnamese-capable font faces                |
| `src/lib/presentations/rendering/*.test.ts`         | Layout/font/decode contracts plus real Chromium page-background and shape-pixel rendering |

**Previously (presentation model + local storage, slice-3 increment 1):**

| Path                                              | Role                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/lib/presentations/model/*`                   | Separate 16:9 presentation schema, parser, limits, safe links, factories and unit conversion |
| `src/lib/presentations/persistence/repository.ts` | Memory repository contract, independent duplication and atomic document/media writes         |
| `src/lib/presentations/persistence/idb.ts`        | IndexedDB adapter using the existing additive v5 `presentations`/`presentationMedia` stores  |
| `src/lib/presentations/persistence/*.test.ts`     | Media immutability, revision conflicts, atomic rollback, v4 upgrade and duplication proofs   |

**Previously (mask/restore brushing, the last implemented slice-2 piece):**

| Path                                        | Role                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/editor/maskPainter.ts`             | Tile-alpha painter: crop clipping, inverse-scaled ellipse strokes, one `hasChanges()` compare per stroke                                     |
| `src/lib/editor/maskBrush.ts`               | Pointer pipeline: capture, rAF preview frames, one encode per stroke, `beginMaskStroke` registration, failure retention                      |
| `src/lib/components/KonvaArtboard.svelte`   | Brush listeners + `previewMask()` live repoint + `brush-cursor`; the committed surface returns on the post-`applyMask` reconcile             |
| `src/lib/components/EditorInspector.svelte` | Source Background panel: Erase/Restore toggles, Reset Mask, brush-size slider                                                                |
| `src/lib/editor/maskStroke.test.ts`         | The source session contracts (commit ordering, rejected-retry, no-op, undo refusal)                                                          |
| `src/lib/editor/maskPainter.svelte.test.ts` | Browser tests for the ellipse, crop clip, restore no-op and blob seeding                                                                     |
| `e2e/masks.spec.ts`                         | Six journeys: preview/IDB/undo/reset, PNG export agreement, pack-ZIP round trip, Space-pan precedence, failed-encode retry, touch at 390×844 |

**Previously (packs half of slice 2, independently reviewed):** `src/lib/packs/packActions.ts`,
`src/lib/exports/zipExport.ts`, `src/lib/components/PacksPage.svelte`,
`src/routes/my-stickers/+page.svelte`, `shellHref()` (typed `resolve()` everywhere) and the
`TemplateCard.svelte` preview copy.

**Known editor parity limitation (recorded, not fixed):** `Replace photo` lives in the image-layer
card **above** the inspector's `Adjust / Effects / Position / Layers` tabs (upstream layout, same as
`../Peeloodle/src/features/editor/EditorPage.tsx`), so it is visible on every tab once an image layer
is selected and only behind the "Sticker properties" dialog on narrow screens. Moving it into the
Adjust panel is later editor work.

## Verification (exact commands and results)

**Newest (2026-09-16, milestone 4):** `npm run check` 0 errors/0 warnings, `npm run lint` clean,
`npm run test:unit -- --run` **64 files / 563 tests**, `npm run test:catalog-sql` **35 checks**,
`npx playwright test` **68 journeys**, `npm run test:e2e:cloud` **6 journeys**. The live catalog
check (`npm run test:catalog-live`) was **not run** — no test project, credentials or Supabase CLI
on this machine. The dashboard's phone-width overflow was found by the cloud suite's 390px
assertion and fixed (`minmax(0, 1fr)` on `.split`). Browser suites need `TMPDIR` off the small
`/tmp` tmpfs when it is full. Details in the newest checkpoint.

The rendering checkpoint ports four upstream test files (**24 tests**) and adds one real-Chromium
pixel test. The full suite passes **35 files / 270 tests**. The current browser runner prints a known
non-failing
SvelteKit/Vite/Vitest SSR transport diagnostic during startup/teardown; exact isolated-project
results and the residual are recorded in `docs/migration-progress.md`.

Run from the target root. Playwright uses the already-installed Chromium (never run
`playwright install`); its web server builds and previews the production output. Logs:
`/tmp/peeloodle-mask-logs/` (writer) and `/tmp/peeloodle-masks-review/` (independent review and
re-review). Logs from earlier checkpoints: `/tmp/peeloodle-packs-logs/`,
`/tmp/peeloodle-packs-review/`, `/tmp/peeloodle-ckpt/`, `/tmp/peeloodle-slice-logs/`,
`/tmp/peeloodle-templates-logs/`, `/tmp/peeloodle-konva-fix/`.

| Command                      | Result (2026-09-15, after the review fixes)    | Log                  |
| ---------------------------- | ---------------------------------------------- | -------------------- |
| `npm run check`              | `svelte-check found 0 errors and 0 warnings`   | `rereview-check.log` |
| `npm run lint`               | exit 0 — Prettier clean, no ESLint findings    | `rereview-lint.log`  |
| `npm run build`              | exit 0                                         | `rereview-build.log` |
| `npm run test:unit -- --run` | **23 files / 189 tests passed** (was 20 / 167) | `rereview-unit.log`  |
| `npx playwright test`        | **20 journeys passed** (was 14; masks adds 6)  | `rereview-e2e.log`   |

The re-review ran every command above fresh (writer logs from the same fix round:
`unit-reviewfix.log` / `e2e-reviewfix.log` in `/tmp/peeloodle-mask-logs/`) and additionally probed
the fixed paths live: Space-pan paints nothing and pans fully, painting works after Space release
and after a pan-tool drag, a mid-stroke Arrow nudge finishes the stroke, mask eviction survives
undo/redo, and mid-stroke navigation still commits to the old project. Historical counts:
23/188 unit and 19 journeys before the review fixes; 22/178 and 19 before the asset hardening.

Pre-fix red runs (test-first evidence): the packs slice's `pre-unit-*` logs under
`/tmp/peeloodle-packs-logs/` (module-not-found) remain valid; the masks slice's tests were written
before `maskPainter`/`maskBrush` existed and the red runs are quoted in the progress checkpoint.

Test files added or extended in the masks slice: `src/lib/editor/maskPainter.svelte.test.ts` (4,
browser), `src/lib/editor/maskStroke.test.ts` (4, the source test ported),
`e2e/masks.spec.ts` (5 journeys incl. the pack-ZIP mask round trip and the 390×844 touch journey),
`src/lib/components/packs-page.svelte.test.ts` (+3 P3 focus/notice regressions),
`src/routes/app-shell.svelte.test.ts` (eraser card copy).

The masks Playwright journeys are the parity evidence that matters: a real stroke must change the
live preview alpha, persist a separate `masks` row whose decoded blob has the hole at the expected
image-local point (344 px photo centered on the 1024 artboard → (172, 172)), survive Undo/Redo and a
save/reload, add thousands of transparent pixels to the 512 px PNG export (returning to the unmasked
count after Reset Mask), produce a pack ZIP whose PNG entry has the same hole (±50 px), retain a
failed-encode stroke for a Save retry as one history entry, and work by touch through the properties
dialog at 390×844.

Svelte MCP: `list-sections`, a targeted `get-documentation` batch (`$state`, `$derived`, `$effect`,
`$props`, `bind:`, `{#each ...}`, snippets, testing), and `svelte-autofixer` on every changed
component/module of the masks slice and its fixes — `KonvaArtboard.svelte`, `EditorInspector.svelte`,
`EditorWorkspace.svelte`, `Sidebar.svelte`, `DashboardPage.svelte`, `Header.svelte`,
`StickerCollage.svelte`, `AssetTray.svelte`, `TemplateCard.svelte`, `maskBrush.svelte.ts`,
`maskPainter.svelte.ts` — **0 issues** each. Remaining suggestions are the project's documented
non-actionable class (`$effect` used to sync external state, `bind:this` handles, internal Map
caches). Transport: the writer's harness had no direct MCP tools and used the server's stdio
JSON-RPC transport; the reviewer did the same and logged it honestly (`rereview-mcp-*.json`). A
harness with direct tools should re-run the autofixer if that evidence form is required.

## Gaps and residuals

- **Catalog (milestone 5) residuals:** the student catalog panel and the snapshot-before-insert step
  (P62, P63) are **not implemented**, so nothing in the editor reads the public catalog yet; the
  end-to-end journey (P64) therefore has no journey test. Uploads report progress per file **stage**,
  not bytes (storage-js has no progress event; a synthetic counter would be a lie). Validation needs a
  **server deployment** — on a static host `/api/catalog/process` does not exist and the screens say
  so rather than pretending a file was processed. The SVG policy rejects text elements by design.
- **Catalog (milestone 4) residuals:** the live isolation check (P53) is **unavailable** (no
  dedicated Supabase test project or credentials; `npm run test:catalog-live` is ready to run
  there) — do not claim live RLS/Storage verification. The admin console covers collections only;
  asset upload/review and template authoring are milestones 5–6 of
  `docs/slides-implementation-plan.md`. Search is sanitized `ILIKE` with a keyset cursor, not
  full-text. Archive is the terminal state (no delete); no background processing worker exists, so
  `catalog_upload_jobs` is bookkeeping the UI does not yet drive.
- **Cloud is optional and synthetically verified.** The Private/Local labels follow the workspace
  context; without public configuration the app stays local-only. The cloud journeys answer every
  auth/REST/Storage request in-process, so the **deployed** RLS policies and Storage rules are
  unverified; live verification needs dedicated ordinary-user accounts and is reported as
  unavailable.
- **Cloud follow-ups:** the source auto-opened a conflict copy and re-pointed the route to it (the
  target keeps the copy, its notice and the library row); a deep link to a remote-only sticker
  before the listing refresh shows the source's "not cached" guidance. Presentations have no cloud
  tables, by design.
- **Automatic background removal is not implemented** (no provider/model), as in the source. The
  Erase/Restore brush edits an image-local mask; the original photo is never modified.
- **Masks review done: BLOCK → fixed → re-review PASS.** The independent review found two blockers
  (stale "not available yet" empty-state copy in `toolIntent.ts`; Space-pan starting a brush stroke)
  plus four P3s (document-identity stroke baseline, full-resolution live preview, un-evicted mask
  rasters, outline rail state). All six are fixed and were re-verified with live probes and the full
  suite. Artifact:
  `outputs/c47e7d11-4974-48cd-9b39-0ca3aa5ae3b2/masks/independent-masks-review.md` (original review
  - "Re-review after fixes" verdict). The packs slice is also reviewed (PASS):
    `outputs/44ceb52a-3d7e-4980-b1cb-bc2ca803296f/packs/independent-packs-review.md`.
- Masks residuals accepted by the re-review: the **committed** `ensureSurface` raster is still
  full-resolution (the source caps its preview too — pre-existing, not introduced by the brush);
  a late-resolving decode of an evicted mask key can be re-cached until the next loader pass; stage
  teardown `clear()`s without `close()`. All bounded; none affect correctness.
- `Download ZIP` shows only the source's `Exporting…` label; a large pack holds the busy flag until
  the last render and a failure surfaces the thrown message in the page alert.
- Favorites rails read `stickerlab_fav_templates` at load time (source parity): toggling a heart in a
  rail updates that rail, the parent's Favorite Templates list follows the next library load.
- IndexedDB is origin-scoped (`stickerlab-local`); local work does not transfer between origins.
- No **non-empty-base** browser run exists (`vite.config.js` sets no `paths.base`), so base-path
  behaviour is only covered by mocked-`$app/paths` unit tests.
- Pack-cover thumbnails are real rendered previews in the browser but placeholder copy in unit tests,
  so "cover matches sticker" is asserted structurally (ids/order), not pixel-wise.
- The `ensureSurface()` cache covers `maskKey` but not the decoded mask image identity (recorded
  last checkpoint). Harmless today: `applyMask` always writes a fresh key and live brush frames
  bypass that cache through `previewMask()`.
- Svelte MCP evidence in the earlier checkpoints came from the server over stdio JSON-RPC (that
  harness had no direct MCP tools). The increment-6 session had the direct tools and ran
  `svelte-autofixer` on every touched component; later checkpoints should keep using them when
  available.

## Next steps (in order)

1. **Slices 1–4 are complete as written** (2026-09-15). Stickers, presentations and the optional
   cloud integration are implemented and locally verified; see the newest checkpoint in
   `docs/migration-progress.md` for what the cloud journeys do and do not prove. The only source item
   not ported is the P44 reader-fixture proof (an external LibreOffice round trip), recorded as
   source proof infrastructure. **Live cross-user RLS/Storage verification is unavailable** — do not
   claim it without dedicated ordinary-user accounts and a deployed test project. The presentation
   editor's client-only Konva seam has a server-graph guard
   (`src/lib/components/presentation-editor-page.server.test.ts`): never import Konva
   (`PresentationCanvas.svelte` / `KonvaArtboard.svelte` / `konvaText.ts`) statically into an
   SSR-reachable module.
2. **Cloud/Supabase (slice 4) follow-ups**, only with an explicit decision: the source editor
   auto-opened a conflict copy (the target keeps the copy, notice and library row but not the
   auto-open); a remote-only deep link before the listing refresh shows the source's "not cached"
   guidance. Neither is a schema or backend change.
3. **Parity hardening leftovers (slice 5)** — reduced motion and the keyboard-only sweep now have
   journeys; an exhaustive per-control keyboard audit was not done. The named base-awareness item for
   shell artwork is **done** (all static `<img>`s and bundled fetches go through `asset()`).
4. Editor parity note recorded above (`Replace photo` outside the Adjust panel) is upstream layout;
   only revisit if a real UX issue is confirmed.
5. **Catalog milestones 4 and 5 are implemented** on explicit request: schema/RLS/policies, guarded
   admin RPCs, repositories, the `/admin/{collections,assets,uploads}` screens, leased upload jobs and
   server-side validation, and (P62–P64) the student catalog panel in the presentation editor with
   download-before-insert and the full admin-upload → student-insert → export browser journey. What
   remains: **milestone 6** (template authoring), plus the **live** isolation check (P53), which needs
   a dedicated Supabase test project before it can be run or claimed. Reuse the download-then-insert
   shape for any future remote media: never commit an insertion before the bytes are local.
6. Keep README + `docs/migration-progress.md` honest at each checkpoint; never claim a slice the code
   does not implement.

## Pointers

- **Binding spec (scope authority):** `docs/superpowers/specs/2026-09-14-react-to-svelte-design.md`
- **Task plan (first slice):** `docs/superpowers/plans/2026-09-14-sticker-vertical-slice.md`
- **Task plan (slice 3, increments 1–6 complete):**
  `docs/superpowers/plans/2026-09-15-presentations-slice.md`
  (source inventory, increment order, seams and exclusions for presentations)
- **Product plan (source, milestones 1–6; M4 and M5's first eight items implemented):**
  `docs/slides-implementation-plan.md`; **backend operations** `supabase/README.md` (migration
  order, admin bootstrap, membership recovery, the processing endpoint's requirements)
- **Long-lived progress, checkpoints, residuals, review paths:** `docs/migration-progress.md`
  (read "Honest status" first; the newest checkpoint is at the top, `P2 fix` sections record
  reviewer findings and their fixes)
- **Behaviour reference:** git tag `react-final`
  (`git show react-final:src/features/editor/useMaskBrush.ts`,
  `src/features/packs/{PacksPage.tsx,packActions.ts}`, `src/features/exports/zipExport.ts`,
  `src/features/presentations/`, `src/app/routes.tsx`), also on disk at `../Peeloodle-React-archive`
- **Review artifacts** (under
  `/home/vdc/.pi/agent/sessions/--home-vdc-Projects--/subagent-artifacts/`):
  **packs review (PASS)** `outputs/44ceb52a-3d7e-4980-b1cb-bc2ca803296f/packs/independent-packs-review.md`;
  **masks review (BLOCK → fixes → re-review PASS)**
  `outputs/c47e7d11-4974-48cd-9b39-0ca3aa5ae3b2/masks/independent-masks-review.md`;
  **packs handoff** `outputs/9ab07e3d-8a0e-4a67-8687-fd76891955bf/packs/implementation.md`.
- **Asset provenance:** `docs/assets-provenance.md`; **scripts/tests:** `package.json`
  (`check`, `lint`, `build`, `test:unit`, `test:e2e`), `playwright.config.js`, `vite.config.js`.

## Handoff notes for the next session

- Commits are local: `main` is ahead of `origin/main` and nothing is pushed (do not push, deploy or
  touch production configuration without explicit approval). Archives taken while the port was
  unversioned:
  `pre-packs-polish-<timestamp>.tar.gz` (before the masks work),
  `pre-presentations-*` (before each presentation increment),
  `post-presentations-exports-final-20260915T025010Z.tar.gz` (increment 5),
  `post-presentations-text-journeys-20260915T043654Z.tar.gz` (increment 6 part 2),
  `post-presentations-slide-rail-journeys-20260915T044704Z.tar.gz` (increment 6 part 3),
  `post-presentation-scale-and-offline-failures-20260915T091632Z.tar.gz` (increment 6 complete;
  sha256 `8b960b97c78da6a5d11458fd44665bef197410e592e041b44ef8579d544518a8`) and the newest,
  `post-cloud-and-a11y-sweeps-20260915T101537Z.tar.gz` (slices 4 + slice-5 leftovers; sha256
  `eaca8a4d75d764ac5e21d19f669faec40a0336a9bdfa4dbacb3e005325ad8aab`), `pre-git-graft-20260915T102807Z.tar.gz`
  and `peeloodle-history-20260915T102807Z.bundle` (the full React history, taken before the graft).
  `main` carries the Svelte tree now, so Git is the restore point; take a fresh archive only before
  genuinely risky, hard-to-reverse work.
- Last verification: 2026-09-16, **milestone 5 complete (P54–P64)** — `npm run check` 0/0, `npm run lint`
  clean, `npm run build` clean, `npm run test:unit -- --run` **71 files / 629 tests**,
  `npm run test:catalog-sql` **52 checks**, `npx playwright test` **68 journeys**,
  `npm run test:e2e:cloud` **6 journeys**. The processing route is covered by request-shape tests and
  by the Node processing tests over real generated bytes; the _deployed_ decode path can only be
  exercised where a server runs. The live catalog verifier (`npm run test:catalog-live`) is written and documented
  but **was never run**: there is no Supabase test project, no credentials and no Supabase CLI here,
  so live RLS/Storage remains unverified. Browser suites need `TMPDIR` pointed off `/tmp` while that
  tmpfs is full, otherwise Chromium aborts and every `.svelte.test.ts` "fails to fetch dynamically
  imported module" (misleading symptom, not a code failure). Re-run the relevant set after any
  change, and run `svelte-autofixer` on every touched component/module (direct MCP tools when the
  harness exposes them; otherwise the server's stdio JSON-RPC transport, noted honestly).
- Where the work stopped: slices 1–4 are complete as written, the slice-5 leftovers (reduced
  motion, keyboard-only flows) have journeys, and **catalog milestones 4 and 5 are implemented**
  (schema/RLS/RPCs, repositories, `/admin/{collections,assets,uploads}`, leased upload jobs,
  server-side validation, the student catalog panel with download-before-insert, and the end-to-end
  upload → publish → insert → export journey). The next catalog step is **milestone 6** (template
  authoring), followed by the live P53 check once a real Supabase test project exists.
  Read the milestone-4 and milestone-5 checkpoints in `docs/migration-progress.md` before touching the
  catalog: the migrations are ordered and the policies/RPCs enforce the invariants (published-only
  reads, no write grants, CAS revisions, immutability triggers), so the client must stay read-only and
  every mutation must go through an RPC; the storage seam is `uploadSource`/`uploadDerivative`/
  `downloadSource`/`removeObjects` on the admin repository. `npm run test:catalog-sql` boots a real
  PostgreSQL locally and is the fast way to prove a backend change; the processing validator is
  proven by the Node tests over generated bytes. The cloud entry points are `src/lib/cloud/*` and
  `src/lib/persistence/cloud*.ts`; read the slice-4 checkpoint before touching them. Two behaviours
  the last batch pinned and a follow-up session should not re-derive: the synthetic Supabase must
  unwrap the multipart file part on Storage uploads (storage-js sends Blobs as FormData), and the
  builder chunk URLs the offline journeys intercept come from
  `.svelte-kit/output/client/.vite/manifest.json` (SvelteKit hashes chunk names, so there is no
  static name to match).
- Known accepted residuals and the exact review findings/fixes are in `docs/migration-progress.md`
  (newest checkpoint at the top); do not re-claim anything the progress doc marks as residual.
