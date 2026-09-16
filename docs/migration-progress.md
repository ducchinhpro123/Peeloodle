# Peeloodle React → Svelte migration progress

Last verified: 2026-09-16, **Milestone 4 of the slides plan (P46–P53)** — the catalog schema, RLS
policies and guarded admin RPCs with a 35-check SQL harness, the typed catalog repositories, and the
admin guard plus collections console (P53's live isolation check is runnable but unrun; no test
project exists — see the newest checkpoint), on top of
the presentation editor's client-only Konva seam — the dev-server 500 fix,
its server-graph regression guard and the Svelte-best-practice cleanup (see the newest checkpoint
below), on top of Slice 4 (cloud/Supabase) plus the slice-5 leftovers — the cloud port with its
synthetic backend, the reduced-motion and keyboard-only sweeps,
on top of increment 6 complete (the P45 ceiling journeys and the two
production-offline failure paths), on top of
the slide-rail and undo/redo journeys, the text journeys, the responsive editor bar and the
caret/focus-steal fixes, Slice 3 increment 6 part 1 (the first twenty journeys and the
Konva paint-effect fix) and Slice 3 increment 5 —
presentation exports, on top of the Slice 3
editor/library/rendering/model checkpoints, the Slice 2 mask/restore checkpoint, independently
reviewed (BLOCK → fixed → re-review PASS), plus the
packs review and the base-aware artwork hardening (see the checkpoints below), on top of the real
`/my-stickers` pack library checkpoint, the real `/templates` catalog checkpoint, the Sidebar
base-compatibility checkpoint, the Sidebar-tool-intent / dialog-shortcut / 512-1024-export
checkpoint, the truthful-UI / accessibility / base-links checkpoint, the save/navigation lifecycle
recovery checkpoint and the independently reviewed P1 Konva preview fix recorded under "P1 fix —
reused Konva image nodes" below.
Authority: `docs/superpowers/specs/2026-09-14-react-to-svelte-design.md` (binding scope) and
`docs/superpowers/plans/2026-09-14-sticker-vertical-slice.md` (task list). Behaviour reference: the
React application at git tag `react-final` (`54eae61c6e93519f235dd91641da92ca000ae189`; the port
landed on `main` as "Rewrite the app on SvelteKit").

This port began in an unversioned working copy (`/home/vdc/Projects/Peeloodle-Svelte`). On 2026-09-15
that tree was grafted onto the source repository's history, so the app now lives in the Peeloodle
repository (`/home/vdc/Projects/Peeloodle`; `main` = the rewrite, tag `react-final` = the React app).
Nothing has been pushed, published or deployed — see the newest checkpoint.

## Honest status

**Slice 1 (sticker vertical slice) is implemented, locally verified, and green on every configured
check.** **Slice 2's implemented work is complete**: `/templates` is a real route with the source
catalog's search, category filters, previews, favorites and independent "Use Template" cloning,
`/my-stickers` is a real route with the source pack library — views, search/sort, pack covers,
membership add/reorder/remove, edit/duplicate/delete and ordered ZIP export, plus the local sticker
drawer and the Favorite Templates rail — and the editor now has the source's **Erase/Restore mask
brush** (brush size, Reset Mask, live preview, one history entry per stroke, masks in PNG exports
and pack ZIPs). Both implemented halves of slice 2 have been **independently reviewed and accepted
after fixes** (packs PASS; masks BLOCK → fixed → re-review PASS). Catalog administration was
**deferred by the design** ("Presentation templates/admin catalog … remain deferred"), and
**Milestone 4 of the slides plan was then requested explicitly and is now implemented** — schema,
RLS policies and guarded admin RPCs (35 local SQL checks), typed repositories, and the `/admin`
guard plus the collections console; the two sides of the catalog that stay deferred are the
pictographic asset pipeline (milestone 5) and template authoring (milestone 6), and the live
isolation check (P53) still needs a dedicated Supabase test project. **Slice 3 now has its model, local storage, rendering foundations, the
working `/presentations` library, the `/presentations/<id>` editor** (open, edit, transform,
text, slides, layers, undo/redo, autosave, leave guard, conflict recovery), **the editor's
PDF/PPTX/backup exports, and every source presentation journey either ported or recorded as
superseded** — guards, library actions, images, thumbnails, the milestone journey, transforms, the
responsive and view-state journeys, the text journeys, the slide-rail / undo-redo journeys, the P45
ceiling journeys and the three production-offline journeys (prepared session, disconnect before the
warm-up, failed builder fetch). Increment 6 is complete; the one source item not ported is the P44
reader-fixture proof, which is source proof infrastructure (an external LibreOffice round trip) and
is recorded in the newest checkpoint as a deliberate exclusion.
**Slice 4 (optional cloud) is implemented and verified against a synthetic backend**: public
configuration validation, PKCE sign-in and callback, per-account private workspace, upload/download
of immutable artwork, the conflict-checked commit RPC, guest import, retry and conflict copies —
without a real project, credentials or emails. **Live cross-user RLS/Storage verification remains
unavailable** (no deployed test project or credentials), so it is reported as unavailable rather
than claimed. **The slice-5 leftovers now have coverage**: reduced motion and keyboard-only flows
are exercised by journeys, and the source's dialog reveal animation was restored (`Modal` carries
the `data-state` Radix used to supply). Slices 1–3 remain complete as written. Nothing in this
document claims live backend verification or deployment.

What works today, end to end and without credentials: `/` dashboard → `/templates` (search,
categories, previews, favorites, clone to an independent editable sticker) → `/my-stickers` (packs:
views, search/sort, membership order, duplicate/delete, ordered ZIP export, sticker drawer) →
`/create` → `/editor/<id>`,
upload a PNG/JPEG/static-WebP photo through the validated upload path, drag/scale/rotate on the
Konva artboard, add and edit text, **erase and restore an image-local mask with the brush**, undo/redo
per gesture, filters, outline, flip/rotate, layer list operations, local autosave + explicit save
into IndexedDB, reload and reopen the saved sticker (mask included), and export a transparent PNG
(512 / 1024) with artwork-bounds cropping. `/presentations` manages local decks with create,
search, rename, duplicate, delete, lazy first-slide thumbnails and independent backup restore, and
`/presentations/<id>` opens a deck in the real editor: canvas selection, drag/resize/rotate with
alignment guides, zoom/pan, text editing with a format toolbar, shapes, photos and sticker
snapshots, slide add/duplicate/reorder/delete, layer list, geometry/style/image panels, themes,
undo/redo, local autosave, a leave guard, revision-conflict recovery, and PDF / editable-PPTX /
restorable-backup exports that keep working after a disconnect once the presentation flow has been
prepared.

Automatic background removal is **not available** and the UI says so: Erase/Restore edit a mask and
the original photo stays unchanged (source parity).

## Repository graft — the SvelteKit app becomes the Peeloodle repository (2026-09-15)

Goal: keep the source repository's history, remote and tag while the working tree becomes the
SvelteKit port, losing neither the React application nor the server-side material the port depends on.

- Before anything moved: `git bundle create …/peeloodle-history-<ts>.bundle --all` captured the full
  React history in one file, and a pre-graft archive of the verified port was taken
  (`pre-git-graft-<ts>.tar.gz`).
- The source repository's `.git` was moved **into** the verified SvelteKit tree — nothing was copied,
  so `node_modules` and every verified file stayed byte-identical. The React paths then read as
  deletions, and the rewrite was committed as "Rewrite the app on SvelteKit" on `main`; tag
  `react-final` marks the React application, the `svelte-port` branch was fast-forwarded into `main`
  and deleted.
- Carried over because they are not app code and remain authoritative: `supabase/migrations/` (RLS
  policies plus `commit_sticker_resource`), `docs/adr/`, `docs/research/`, `docs/design/` and the
  other source-era `docs/*.md`, `proofs/` (byte-identical, excluded from formatting and linting so the
  recorded proofs keep their exact bytes), `scripts/verify-cloud.mjs` (the framework-independent live
  RLS/RPC verifier for the remaining cloud-verification item) and `.github/workflows/ci.yml`
  (rewritten for this toolchain: check, lint, unit, build, both e2e suites).
- Not carried over, all available at `react-final`: the React `src/`, its `e2e` specs, root configs
  (`vite.config.ts`, `tsconfig*.json`, `components.json`, `playwright*.config.ts`), `public/`
  (superseded by `static/`; verified file-for-file apart from one added `favicon.svg`),
  `server/processing/` (catalog admin backend, not ported by design), `vercel.json` +
  `.vercelignore` (deploy config for the React build — deployment needs its own review), `tasks.html`,
  `readme-included.png`, and the React-only scripts. `.agents/` (vendored React-agent skills),
  `skills-lock.json`, `design/`, `HANDOFF.md` and `StickerLab-Agent-Brief.md` were also left behind.
- `.gitignore` merges both repositories (build output, env, Playwright artifacts, Paraglide);
  `.prettierignore` is unchanged and ESLint excludes only `proofs/**`.
- The former React checkout is at `/home/vdc/Projects/Peeloodle-React-archive` and can be deleted —
  everything in it is recoverable from tag `react-final` or the history bundle.
- Verification in the grafted tree: `svelte-check` 0 errors/0 warnings, `prettier --check .` and
  ESLint clean, **59 files / 530 unit tests**, **68 main e2e journeys**, **6 synthetic-cloud
  journeys**, and `npm run build` green.
- Archives: `pre-git-graft-20260915T102807Z.tar.gz` (sha256
  `4e742c986693a09008e85c0914bfe342a725e4b8a5f7117c410bb6f4db9adabf`), the history bundle
  `peeloodle-history-20260915T102807Z.bundle` (sha256
  `65e4791a638a7138b3a45cf627a44212a1911fe7bef4774eff7fab8feb52a01b`) and the post-graft archive —
  working tree **and** `.git` (86 MB, so full history) at
  `post-git-graft-20260915T105133Z.tar.gz`, sha256
  `4c377f511613a79d743f2a96b5261356e962168841aaf26f46456fa1a04275df`.

## Milestone 4 checkpoint — catalog permissions, versioning and the admin console (2026-09-16)

Scope: **Milestone 4 (P46–P53) of `docs/slides-implementation-plan.md`**, requested explicitly on
2026-09-16. The binding design defers catalog administration ("stays deferred; do not pull it in
without an explicit scope change"), so this checkpoint records the scope change and its reach: the
trusted catalog backend, the typed repositories and the collections console. The rest of the catalog
surface (asset upload and review, template authoring) stays with milestones 5 and 6.

### Backend (P46–P48, P50) — `supabase/migrations/2026091612*`

- `_catalog_schema.sql`: `catalog_admins`, `catalog_collections`, `catalog_assets`,
  `catalog_asset_versions`, `catalog_templates`, `catalog_template_versions`,
  `catalog_template_dependencies`, `catalog_upload_batches`/`_jobs` and `catalog_events`. Version
  rows are immutable (trigger), `catalog_template_dependencies` is a composite FK that pins the
  exact version pair, and triggers keep the `published_version_id`/`published_*` pointers honest
  (same asset, same version row, published state).
- `_catalog_policies.sql`: `catalog_is_admin()` (security definer) plus published-only read
  policies for `anon`/`authenticated`, admin read policies, and **no write grants at all** — every
  mutation goes through an RPC. Private buckets `catalog-sources` (admin insert only, tied to that
  admin's open batch) and `catalog-derivatives` (readable only while the naming version is the
  published one, matched by exact paths including slide previews).
- `_catalog_admin_rpcs.sql`: `catalog_require_admin`, the result envelope `{ok:true,item}` /
  `{ok:false,reason,detail}`, create/update (compare-and-set `revision`) and publish/archive for
  collections, assets and templates, every outcome journaled to `catalog_events`. Guards: publish
  needs a validated version, a collection must itself be published, template dependencies must be
  live, archiving refuses while a published template pins the version (`pinned_by_template`) and
  refuses a non-empty collection unless `archive_items` is passed.
- `npm run test:catalog-sql` (`scripts/verify-catalog-sql.mjs`) boots a **throwaway PostgreSQL
  cluster** with a Supabase shim (`auth.uid`, the storage tables, `folder()`, roles, a
  `pg_jsonschema` stub), applies the real migrations and runs **35 checks**: immutability, pointer
  integrity, RLS visibility for all three roles, Storage access, and every publish/archive guard.
  Wired into CI next to the other checks; `supabase/README.md` documents migration order, the admin
  bootstrap and the membership-removal recovery SQL.

### Repositories (P49) — `src/lib/catalog/`

- `types.ts` (public/admin projections), `repository.ts` (the `CatalogRepository` and
  `CatalogAdminRepository` interfaces, `CatalogError`/`CatalogRefusal`, `CatalogActionResult`),
  `parse.ts` (strict snake_case parsers that reject unknown shapes and turn refusal `detail.item`
  back into a domain type), `memory.ts` (a fake that mirrors the RPC semantics, including pins) and
  `remote.ts` (PostgREST/RPC adapter: explicit column lists, keyset cursor over `(sort_order, id)`,
  `limit + 1` pagination, sanitized search terms; `42501` → permission, `PGRST116` → not_found).
- `src/lib/cloud/database.ts` gained the catalog tables (`Insert`/`Update: never` — the client
  cannot write them) and the RPC signatures. `safeReturnPath` now accepts the admin sections.
- **21 catalog unit tests**: domain semantics against the fake (13) and the adapter's wire contract
  against a recording fake client (8), which pins every query's composition.

### Admin console (P51, P52) — `src/routes/admin/*` + `src/lib/components/catalog/`

- `AdminGuard.svelte` is a route-wide gate with five honest states — not configured, signed out,
  denied, transport error (with retry) and ready. It is messaging, not the boundary: every RPC
  re-checks membership on the server. `AdminShell.svelte` carries the section nav.
- `/admin` redirects to `/admin/collections`; `/admin/collections` is a paged, searchable list with
  create, edit, publish and archive. A revision conflict keeps the administrator's typed values,
  names the server revision and requires an explicit second save. Archiving surfaces the refusal
  reason (`contains_items` count, or the template names from `pinned_by_template`) and only then
  offers the consent path. Permission and transport failures render as messages with a retry,
  never as an empty list.
- **11 browser tests** cover the gate states and the collections screen (search, create, conflict,
  publish, archive consent, error retry); `svelte-autofixer` reported 0 issues on all three
  components.

### P53 — live verification is **unavailable**, and that is reported honestly

`scripts/verify-catalog.mjs` (`npm run test:catalog-live`) is the runnable live isolation check:
three sessions (administrator, ordinary, anonymous) against a dedicated test project, asserting
published-only reads, denied admin RPCs, draft invisibility before publish, a publish race that
resolves to exactly one `revision_conflict`, signed-URL reads of a published derivative, and
archive revocation — with an explicit instruction never to use a service-role key to play an
ordinary user. **It has not been run**: this machine has no Supabase test project, credentials or
CLI, so there is no environment in which the checks could pass or fail for a real reason. What was
verified instead is the local harness: `npm run test:catalog-sql` runs the real migrations against
real PostgreSQL and exercises the same guards, and the adapter's queries are pinned by unit tests.

### Verification at this checkpoint

- `svelte-check` 0 errors/0 warnings; `prettier --check .` and ESLint clean.
- **64 files / 563 unit tests** (60/531 before; the four new files are the two catalog modules and
  the two component suites).
- **35 SQL checks** (`npm run test:catalog-sql`) green.
- **68 main e2e journeys** and **6 synthetic-cloud journeys** green (`npm run build` included).
- Fixed along the way, and committed separately: the dashboard overflowed horizontally at phone
  widths (`scrollWidth` 676 at a 390 viewport). The style migration introduced it
  (`.split { grid-template-columns: 1fr }` at ≤720px, whose min-content floor is the template
  rail's card width) and the optional-cloud suite had not been re-run since, so its 390px
  assertion is what caught it — now `minmax(0, 1fr)`. Cloud suite back to 6/6.

### Environment note

`/tmp` on this machine is a 6.7 GB tmpfs and was **full** during verification, which makes Chromium
abort on launch; the browser suites then fail with `Failed to fetch dynamically imported module` for
every `.svelte.test.ts` — a confusing symptom that is not a code failure. `TMPDIR` pointed at a
directory on `/` (e.g. `TMPDIR=$HOME/.cache/peeloodle-tmp npm run test:unit -- --run`) is the
workaround. The `wrapDynamicImport` stderr noise documented elsewhere is unrelated to this.

## Fix checkpoint — the presentation editor's client-only Konva seam (2026-09-16)

Scope: the one open presentation item — `/presentations/<id>` returned **500 in `vite dev`** because
Konva was in the route's server import graph. `konva`'s package `main` is `lib/index-node.js`, which
top-level-requires the native `canvas` package (not installed), so dev SSR threw
`Cannot find module 'canvas'`. Production preview resolves Konva's browser entry and the Playwright
suite runs against that build, so the failure was invisible to every e2e journey.

### Changes

- `src/lib/components/presentation/PresentationEditorPage.svelte`: the slide canvas is now loaded in a
  browser-only `$effect` (`import('./PresentationCanvas.svelte')`) — the same client-only seam
  `EditorCanvas.svelte` already uses for the sticker artboard — with a placeholder holding the canvas
  grid track until it resolves. The effect carries no `browser` check and reads no state: effects
  never run during SSR, and with no dependency it runs exactly once (the Svelte best-practices
  guidance; the removed check was redundant).
- `src/lib/components/presentation-editor-page.server.test.ts` (new, vitest `server`/node project):
  imports the page the way SSR does. Verified to fail against the pre-fix static import with the real
  `Cannot find module 'canvas'` (`konva/lib/index-node.js`) and to pass now, so a static re-import
  cannot regress silently.
- The dynamic component state is JSDoc-typed from the real component
  (`typeof import('./PresentationCanvas.svelte').default`) instead of `any`.

### Why this is the seam

`{#await import('./PresentationCanvas.svelte')}` was tried as the alternative: it also serves this
route 200 in dev (the page is still in its client-only `loading` state during SSR, so the block is
never reached) and would drop the state/effect pair. It was not taken because an inline `import()`
re-evaluates with the block, while the effect seam keeps the import browser-only no matter which
branch SSR renders. Both were exercised; the e2e suite cannot tell them apart.

### Regressions and verification

- `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint`: prettier + ESLint
  clean.
- `npm run test:unit -- --run`: **60 files / 531 tests passed** (was 59 / 530; +1 server-graph test).
  The known non-failing `wrapDynamicImport` startup diagnostics remain visible, as recorded before.
- `npx playwright test`: **68 journeys passed** (2.4 min, production build, `workers: 1`).
- `vite dev` re-check: `/`, `/presentations`, `/presentations/<id>` and `/editor/<id>` all return
  **200** with no Konva/canvas error in the dev log.
- Svelte MCP protocol used: `list-sections`, targeted `get-documentation` (`$effect`, `await`,
  `<svelte:component>`, best practices), then `svelte-autofixer` on `PresentationEditorPage.svelte` —
  **0 issues**. Its suggestions are the documented non-actionable class (state assigned in the
  effects that coordinate the save/export controllers and the client-only import; `bind:this` where
  an attachment is not a better fit) plus one unused-`eslint-disable` note the project's own ESLint
  does not report.

## Slice 4 (cloud/Supabase) + slice 5 leftovers — cloud port, synthetic backend, reduced-motion and keyboard sweeps (2026-09-15)

Scope: design slice 4 — "port the existing optional browser Supabase integration and source
callback/session/sync behavior" — plus the two slice-5 items still missing (reduced motion and a
keyboard-only sweep). **68 browser journeys are green** in the main suite (was 65; +3 accessibility)
and **6 synthetic-cloud journeys** are green in `playwright.cloud.config.js`. Nothing is deployed and
no real Supabase project was touched: live RLS/Storage verification remains unavailable and is
reported as such, and presentations stay local (the source has no presentation cloud tables).

### Changes — cloud core (framework-independent)

- `src/lib/cloud/database.ts` — the generated Supabase schema types (public schema only), ported
  from `src/types/database.ts`; no schema or policy is added by the target.
- `src/lib/cloud/config.ts` — `parseCloudConfig` (pure and unit-tested), `readCloudConfig` (the
  page's exact origin must be allowed), lazy `getAuthClient` (PKCE, `detectSessionInUrl: false`) and
  `safeReturnPath`. Public names kept: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_AUTH_ALLOWED_ORIGINS`. Only a publishable/anon key is accepted; no service credential and no
  cookie/session-server architecture.
- `src/lib/persistence/cloudRemote.ts` — `SupabaseRemote`: owner-scoped `projects`/`packs` listing
  with paging, immutable binary upload → verify → download against the private `stickerlab-private`
  bucket, and the existing `commit_sticker_resource` RPC. The server side is reused as-is.
- `src/lib/persistence/cloud.ts` — `CloudRepository` over the already-ported sync-capable
  `IdbRepository`: one foreground drain, per-record base revisions, conflict detection and copies,
  notices, guest import and session-expiry wording.
- `src/lib/persistence/cloud.test.ts` (11 cases, ported from the source) and
  `src/lib/cloud/config.test.ts` (7 cases) cover the queue, retry, conflict-copy, guest-import and
  expiry contracts without a backend.
- `@supabase/supabase-js` added (2.116, the source's major).

### Changes — workspace and UI (Svelte 5)

- `src/lib/cloud/workspace.svelte.ts` — rune workspace: session, per-account repository and cloud
  status, flush-before-switch, epoch, restore gate, online retry hook, `createContext` triplet with a
  guest fallback for components mounted outside the layout.
- `src/lib/components/AppScope.svelte` + `src/routes/+layout.svelte` — `{#key workspace.epoch}`
  remounts the routed tree and publishes that epoch's app context, the source's
  `<div key={epoch}>{children}</div>` remount.
- `AccountDialog.svelte`, `CloudBanner.svelte`, `src/routes/auth/callback/+page.svelte` — sign-in by
  email link, status, explicit guest-import consent, sign-out, and an honest missing/invalid-link
  state; `/auth/callback` is a real route now instead of the milestone page.
- `Header.svelte` / `AppShell.svelte` — the account trigger and cloud status live in the shell.
- `LocalProjectList.svelte`, `PacksPage.svelte`, `EditorWorkspace.svelte` — private/local labels and
  the cloud save status (`Saved to cloud`, `Saved locally · syncing`, `Saved locally · cloud
pending`); editor load errors keep the actionable message, so a remote-only deep link says how to
  cache it instead of a generic failure.

### Changes — verification

- `e2e/cloud.spec.ts` + `playwright.cloud.config.js` — an in-process synthetic Supabase (GoTrue
  OTP/PKCE, PostgREST tables and the commit RPC with idempotency and conflicts, Storage multipart
  upload/download) answers every `/auth/v1`, `/rest/v1` and `/storage/v1` request. Six journeys:
  sign-in, two sticker saves and a pack, a second browser reopening them with a pixel-identical PNG
  export and an ordered ZIP, an offline edit with retry, and sign-out isolation; a stale
  second-device save becoming a conflict copy; guest-import consent with originals kept and an
  idempotent retry; and the account dialog plus an invalid callback at 1440/1024/390.
- `e2e/a11y-sweep.spec.ts` (+3 journeys) — reduced motion suppresses the dialog reveal and the dialog
  stays usable (and the same dialog reveals through the keyframes when motion is allowed;
  `Modal.svelte` now carries the source's `data-state`, which Radix used to supply), and the primary
  navigation plus pack creation run on Tab/Enter alone.
- `playwright.config.js` runs with `workers: 1`: parallel workers let the CPU-heavy presentation
  export journeys starve unrelated long journeys into their default 30 s timeout. Two consecutive
  serial full runs are green.

### Deliberately not ported / residuals

- **Live cross-user RLS/Storage journeys are not run here** — they need dedicated ordinary-user
  accounts and a deployed project. The synthetic backend is the evidence; nothing is claimed about
  the deployed policies, and no backend mutation or credential was used.
- The source editor auto-opened a conflict copy and re-pointed the route to it. The target keeps the
  copy, its notice and the library row, but the editor stays on the document being edited.
- A deep link to a remote-only sticker before the listing refresh shows the source's "not cached"
  guidance instead of silently creating an empty document; opening the library first caches it.
- The keyboard sweep covers the primary navigation, the pack flow and the earlier dialog/focus
  coverage; it is not an exhaustive audit of every control. Reduced motion is verified for the
  dialog reveal and the global transition rule.

### Regressions and verification

- `npx playwright test`: **68 passed** (main, serial). `npm run test:e2e:cloud`: **6 passed**.
- `npm run test:unit -- --run`: **59 files / 530 tests** (was 57/512; +1 cloud-repository file with
  11 cases, +1 config file with 7). `npm run check`: 0 errors / 0 warnings; `npm run lint` passed;
  `npm run build` passed.
- Svelte MCP protocol used throughout: `list-sections`, targeted `get-documentation` (runes,
  context, `.svelte.ts` files) and `svelte-autofixer` on every new/changed component and the rune
  module → **0 issues** each; the remaining suggestions are the documented non-actionable class
  (subscriptions and repository reads in effects, `bind:this` handles).
- Checkpoint archive:
  `/home/vdc/Projects/.peeloodle-svelte-backups/post-cloud-and-a11y-sweeps-20260915T101537Z.tar.gz`,
  sha256 `eaca8a4d75d764ac5e21d19f669faec40a0336a9bdfa4dbacb3e005325ad8aab`.

## Slice 3 checkpoint — increment 6 complete: the P45 ceilings and the two production-offline failure paths (2026-09-15)

Scope: the last of increment 6 from `docs/superpowers/plans/2026-09-15-presentations-slice.md` — the
source `presentations-reader-limits.spec.ts` P45 ceilings and the two failure paths in
`presentations-production-offline.spec.ts` that the already-ported `presentation-offline.spec.ts`
did not cover. **65 browser journeys are green** (was 61; +4). With the view-state, responsive and
text journeys already ported in the previous batches, every source `presentations*.spec.ts` journey
is now ported or recorded as superseded; the one deliberate exclusion is named below.

### Changes

- `e2e/presentation-offline.spec.ts` (+2 journeys):
  - **a disconnect before the warm-up finishes is reported honestly and poisons nothing.** A
    test-side `requestIdleCallback` stub delays the warm-up by 8 s; the network is disabled first,
    so the readiness run finds `navigator.onLine === false` and publishes the before-load message
    (`Offline use needs one online load. Reconnect and reload the page. Your saved work is not
affected.`). No builder chunk was requested while offline. Reconnecting in the same page then
    supports local editing, autosave and a first-use PDF export; a reload while online warms the
    session (all eight presentation font faces report `loaded`), and an offline reopen paints the
    stored photo from IndexedDB.
  - **a builder that cannot be fetched says how to recover and needs a reload.** The three builder
    chunks are held through Playwright routing and aborted as the browser goes offline, so the
    failure is a real failed module fetch. The library reports `Offline use could not be prepared in
this page. …`, local editing and autosave keep working, the export alert says "Reconnect and
    reload the page" (not the browser's module wording), a same-page retry fails again (the failed
    import is cached for the page), and a reload while online recreates a ready session that exports
    a real PDF.
- `e2e/presentation-scale-limits.spec.ts` (new, +2 journeys): the P45 ceilings.
  - **50 slides / 2 000 elements / 200 distinct assets** open in the editor and export: the PDF has
    50 pages at 960×540 pt and the PPTX carries 50 slide parts and 200 media parts (each asset
    embedded once).
  - **8 × 1024² random PNG artwork** (the media axis, not the element axis) exports as 8 PDF pages
    and 8 PPTX slides with 8 media parts; the package is larger than the stored artwork, so a dropped
    or re-encoded picture fails the claim.
  - The production build cannot import `/src/...` the way the source's dev-server specs did, so the
    decks are built from the real model factories in Node and the PNGs are generated and hashed in
    the page before being written to the app's own IndexedDB stores. The failure journey reads the
    Vite manifest of the build under test to map `presentations/exports/{snapshot,pdf,pptx}.ts` to
    their opaque hashed chunk URLs; no application debug hook was added for either journey.

### What remains (and what does not)

- The source `presentations-reader-limits.spec.ts` **P44** reader-fixture journey is proof
  infrastructure, not app behaviour: it wrote `p44-reader-fixture.{pptx,pdf}` plus a facts JSON for
  the external LibreOffice round-trip script (`proofs/readers/libreoffice_roundtrip.py`). The target
  has no `proofs/` tree and this port does not ship a reader; the app behaviour P44 leaned on (PPTX
  crop/flip/rotation frame mapping, rotated text) is covered by `exports/pptx.test.ts`,
  `exports/pdf.test.ts` and the export journeys here. Recorded as a deliberate exclusion, not a gap
  in the app.
- The source file's dev-server network-disabled journey is superseded by the production-build
  `presentation-offline.spec.ts`, which was already ported and is stronger.
- Increment 6 is complete, and with it slice 3 as written. Slices 4 (cloud/Supabase) and 5 (parity
  hardening: reduced motion, keyboard-only sweep, broader responsive audits) have not started and
  need their own explicit decisions.

### Regressions and verification

- `npx playwright test`: **65 journeys passed** (was 61; +4 new), 43 s against the production build.
- `npm run test:unit -- --run`: **57 files / 512 tests passed** (unchanged; this batch is
  browser-level only). `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint`
  passed (`prettier --check .` and `eslint .`); `npm run build` passed.
- No Svelte component or module changed in this batch, so the Svelte MCP protocol was not invoked;
  the previous checkpoints record the autofixer runs for the components they touched.
- Test-side corrections made while porting (not product defects): the geometry inspector renders its
  fields twice (the desktop pane plus the closed mobile properties dialog), so the photo helper
  scopes every read to `.presentation-inspector`; and the source's fixture-based seeding was replaced
  with factory-built documents and in-page artwork generation, because the target serves only the
  production build.
- Checkpoint archive:
  `/home/vdc/Projects/.peeloodle-svelte-backups/post-presentation-scale-and-offline-failures-20260915T091632Z.tar.gz`,
  sha256 `8b960b97c78da6a5d11458fd44665bef197410e592e041b44ef8579d544518a8`.

## Slice 3 checkpoint — remaining presentation journeys, part 3 (2026-09-15)

Scope: increment 6 from `docs/superpowers/plans/2026-09-15-presentations-slice.md`, third batch —
the source `presentations.spec.ts` **slide-rail** and **undo/redo** journeys, ported as two new
journeys in `e2e/presentation-slides.spec.ts`. 61 browser journeys are green. The rest of increment 6
(the reader limits, the two production-offline failure paths and three un-ported
`presentations.spec.ts` journeys) is still open.

### Changes

- `e2e/presentation-slides.spec.ts` (2 journeys) — `adds, duplicates, reorders, and deletes
slides through the accessible rail` and `undoes and redoes through the toolbar and keyboard
without stealing text-field undo`. The source seeded a fixture deck through the React store; this
  target has no fixture seeder, so both journeys build their deck through the real UI (blank editor + a real PNG
  through `presentation-image-input`) and then make every claim against surfaces a user can reach: the
  stored IndexedDB row, the rail's own `aria-current`/focus/disabled state, and the pixels the Konva
  canvas really paints. Together the two journeys pin that a duplicate gets a **new slide id and
  fresh element ids while reusing the stored asset** (one asset row, not two), that the reused bytes
  really paint, that `Add slide` inserts **after** the active slide and starts empty, that the new
  order survives a reload and a reopen from the library, that deleting the active slide moves focus to
  the slide that took its place, that the only-slide guard leaves one reachable slide with move
  up/move down/delete all disabled, and that the toolbar, `Ctrl+Shift+Z` and `Ctrl+Z` drive the same
  history (disabled at both ends of it).

### What the port learned (no product defect in this batch)

- **Slide names use the lowest unused `Slide N`, not the slide count.** After `Slide 1` and its
  copy `Slide 1 copy`, `Add slide` produces **`Slide 3`**, so the third rail entry is
  `Show slide 3: Slide 3`. The source's fixture was named `Title slide` with a four-slide deck, and
  its `/Show slide 3:/` regex hid the naming rule; the port asserts the real label. Both initial
  failures in this batch were test-side assumptions of this kind, not product bugs — the journey now
  reads the labels the app actually renders.
- **A text session deliberately holds the write back, and the port had to state that honestly.**
  Every keystroke commits into one open `historyGroup`, and the save coordinator skips the debounce
  while a group is open (`presentationSaving.ts`: `if (current.lastHistoryGroup !== null) return`) —
  the same rule the source has, so an in-progress typing session is not a persisted revision until
  the session ends. The port therefore asserts the ordered truth instead of the convenient one:
  `Ctrl+Z` inside the field is the browser's (the box stays, only the typed characters go), what
  lands on storage is exactly what the field showed when `Escape` closed the session, the first app
  `Ctrl+Z` then empties that box (one gesture, one history entry) and only the second removes it.
  The source's journey asserted nothing beyond the field still being visible.

### Regressions and verification

- `npx playwright test`: **61 journeys passed** against the production build (was 59; +2 for the
  slide-rail and undo/redo journeys). `e2e/presentation-slides.spec.ts` was additionally run with
  `--repeat-each=4` (8/8 green) before the full suite.
- `npm run test:unit -- --run`: **57 files / 512 tests passed** (unchanged; this batch is
  browser-level only). `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint`
  passed (`prettier --check .`, `eslint .`); `npm run build` passed.
- No Svelte component or module changed in this batch, so the Svelte MCP protocol was not invoked;
  the previous checkpoint records the autofixer run for `TextEditOverlay.svelte`.
- Honest boundaries: the PDF is still image-based (no text selection or clickable links); cloud /
  Supabase presentations remain unimplemented (slice 4); the target stays unversioned and nothing is
  deployed.
- Checkpoint archive: `/home/vdc/Projects/.peeloodle-svelte-backups/post-presentations-slide-rail-journeys-20260915T044704Z.tar.gz`,
  sha256 `70ed984dcad7a235f49ce0d92c7360e463c093c2f481c42553f715c35720740f`.

## Slice 3 checkpoint — remaining presentation journeys, part 2 (2026-09-15)

Scope: increment 6 from `docs/superpowers/plans/2026-09-15-presentations-slice.md`, second batch —
the source `presentations.spec.ts` text journeys, plus the responsive work and the three defects
found while porting them. 59 browser journeys are green. The rest of increment 6 (the source
slide-rail and undo/redo journeys, the reader limits and the two production-offline failure paths)
is still open.

### Changes

- `e2e/presentation-text.spec.ts` (5 journeys) — the source's `inserts, edits, saves, and reopens a
text box without moving it`, `formats a text selection and keeps it through save and reopen`,
  `applies paragraph formatting and links, and reports text overflow` and `autosaves a typed edit and
keeps it after a reload and reopen`, plus a new regression journey for the caret fix below. The
  source asserted against the React store; this port asserts against the stored IndexedDB row, the
  overlay's DOM seam and the canvas host's `data-*` state. The overflow journey drives 600 typed
  characters, reads the element's real height before and after the one-click fix and confirms the
  panel notice clears.
- `e2e/presentation-responsive.spec.ts` and `layout.css`: the editor bar keeps a **stable height at
  every width**. The bar wraps (the source's tablet defect fix), but wrapping made its height a
  function of app state as well as width — at 1280 px it was 70 px idle and 121 px once a text
  element was selected, so a canvas rectangle measured before a state change was stale and clicks
  landed on the wrong target. Below 1420 px the actions and the save status are each given their own
  line (`flex-basis: 100%`), which makes the height a function of width alone; the dead
  `grid-template-columns`/`grid-column` rules from the old grid bar were removed. Measured identical
  bar height and canvas top across idle / text-selected / saved at 1920, 1440, 1421, 1420, 1280,
  1024, 900, 721, 720 and 390 px, with the long title visible and no horizontal overflow.
- `e2e/presentation-text.spec.ts` helpers needed for these journeys: the toolbar is scoped by
  `getByRole('toolbar', { name: 'Text formatting' })` because the geometry inspector also offers
  "Align Left/Center/Right" — the unscoped `Align center` matched two buttons; session re-entry goes
  through the layer list plus the editor bar's "Edit text" (the canvas double-click path is already
  covered by the first journey); and ending a session clicks the field before blurring it, because
  `blur()` on an unfocused field is a no-op and the link input really does take focus.

### Defects found and fixed

- **Caret dragged to the end while typing** (`TextEditOverlay.svelte`). The seeding effect read
  `element.paragraphs`/`element.lineHeight`, so it re-ran on every commit — every commit replaces
  the element object — and its `requestAnimationFrame` re-focused the field and ran
  `placeCaretAtEnd`. Typing after `Home` therefore still appended: `abc` + Home + `X` stored
  `abcX`, not `Xabc`. The source's dependency array was `[elementId]`; the effect now tracks
  `$derived(element.id)` and reads the element through `untrack`, so it seeds once per element.
  Pinned by the new `keeps the caret where the user left it while typing` journey and by the
  existing `Bold`/`Font size` journey, which needed the live collapsed caret to read the selection
  it was formatting.
- **A passive toolbar refresh could take focus from a toolbar input and edit the document**
  (`TextEditOverlay.svelte`, `textFormat.ts`) — **upstream defect, fixed in the port**. The toolbar
  refreshes its state on every `selectionchange`, and `read()`/`readParagraph()` restored the field's
  saved selection before reading it. Putting that range back into the document makes Chromium focus
  the editable host, so focus left the link input; the address then arrived as an `Input.insertText`
  aimed at the focused element and was inserted **over the selected text** — a deck's paragraphs
  were replaced by `https://example.com` (reproduced in 1 of 3 runs). The source has the same shape
  (`TextFormatToolbar.tsx` refreshes on `selectionchange` → `restoreRange`), so this is an upstream
  defect rather than a port divergence. Reads now take an explicit range: `undefined` means the live
  selection, `null` reads nothing, and the overlay passes the range it saved _without_ restoring it.
  Only a command (`Bold`, `Add link`, paragraph formatting) puts the selection back, which is where
  it is required. Pinned by the unit case `describes a held range without moving the live selection`,
  by the link journey's assertion that the field still contains both paragraphs after the address is
  typed, and by five consecutive flake-free runs of that journey.

### Regressions and verification

- `npx playwright test`: **59 journeys passed** against the production build (was 50; +5 text
  journeys, +4 from the responsive batch). Run twice end to end; the only failure seen in between
  was the truncated `null`-range regression this doc records, which the full suite caught and the
  explicit-range fix closed.
- `npm run test:unit -- --run`: **57 files / 512 tests passed** (was 511; +1 range/no-focus case).
- `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint` passed
  (`prettier --check .` and `eslint .`), `npm run build` passed.
- Svelte MCP protocol used on the changed component (`TextEditOverlay.svelte`): targeted
  documentation plus `svelte-autofixer`, which reports no issues; its `$effect` suggestions describe
  the deliberate imperative editor lifecycle (field seeding, Konva-style focus, commit-on-input).
- Honest boundaries: the PDF is still image-based (no text selection or clickable links); cloud /
  Supabase presentations remain unimplemented (slice 4); the target stays unversioned and nothing is
  deployed.
- Checkpoint archive: `/home/vdc/Projects/.peeloodle-svelte-backups/post-presentations-text-journeys-20260915T043654Z.tar.gz`,
  sha256 `c6c055e046d67b0eb999c8da55927de412838405dcc6236da45b040ac12cee48`.

## Slice 3 checkpoint — remaining presentation journeys, part 1 (2026-09-15)

Scope: increment 6 from `docs/superpowers/plans/2026-09-15-presentations-slice.md`, first batch —
the source journeys around the library, the editor's guards and the transform surface. Six new
browser files port twenty journeys; the rest of increment 6 (the source `presentations.spec.ts`
view/slide/text journeys, the reader limits and the two production-offline failure paths) is still
open.

### Changes

- `e2e/presentation-guards.spec.ts` (4): a shell nav link flushes a pending edit before leaving; a
  clean editor follows the link immediately; the browser Back button flushes a pending edit; a
  clean Back navigates without being blocked.
- `e2e/presentation-library-actions.spec.ts` (3): renaming stores the new title at the next
  revision without touching the slides; duplicating writes an independent stored row; deleting a
  duplicate cancels safely, removes only that row and returns focus.
- `e2e/presentation-image.spec.ts` (2): uploading a personal image paints it, stores its bytes
  (re-hashed from IndexedDB against the uploaded SHA-256) and survives a reload and reopen; an
  unsupported SVG is refused and leaves no element or asset behind.
- `e2e/presentation-milestone-journey.spec.ts` (2, desktop 1440×900 and tablet 1024×768): create →
  type → insert a photo → autosave → rename from the library → reload → reopen, with painted-pixel
  claims and an empty-region negative control.
- `e2e/presentation-library-thumbnails.spec.ts` (3): every card paints a real 480×270 render of its
  own first slide (each deck's dominant background), deleting a deck removes only its thumbnail,
  and the thumbnail stays inside the card at 1024 and 390 px widths.
- `e2e/presentation-transform.spec.ts` (6): a move in document units produces the same geometry at
  two zoom levels and exactly one history entry; the south-east handle resizes keeping the origin;
  the numeric rotation field and the rotate handle agree on the visual centre; every handle keeps a
  44 px pointer target; a coarse pointer at a desktop width keeps that expansion; and a locked
  element still selects but no gesture moves it, resizes it or pans the view.
- Helpers (`e2e/presentations.ts`): `readStoredPresentation` now returns each element's `assetId`
  plus `slideIds` and an `assets` summary (id, byteLength, sha256, width, height, mimeType);
  `readStoredMedia` hashes the stored bytes; `seedStoredPresentation` clones a real stored row with
  a new id/title/background/text for journeys the library has no UI for (slide backgrounds).

### Defect found and fixed — the paint effect rebuilt on every view change

- `PresentationCanvas.svelte` had merged the source's two React effects into one that read
  `editorState.view.*` directly. The store replaces its object on every `set`, so _any_ view change
  — including a plain selection — re-ran the effect, destroyed the painted children and rebuilt
  them, and that clears Konva's hit canvas for the rest of the task. The compatibility `click`
  (synthesized from `mouseup`) then hit-tested into the gap: clicking a locked element selected it
  on `pointerdown`, and the trailing click immediately cleared the selection. The source never had
  this: its paint effect depends on `[activeSlide, document, editingElementId, images]`, and React
  compares those values, so a selection change is not a repaint.
- The fix restores the source's structure: a **viewport** effect sets the stage size, scale and
  position from `size`, `viewZoom` and `viewPan`; a **paint** effect rebuilds the children only when
  the document, the active slide, the decoded images or the edited element change (plus the
  attachment's `ready` flag, which is what repaints as soon as the stage exists). `editingElementId`,
  `viewZoom` and `viewPan` are read through their own `$derived`s, so a replaced store object with
  unchanged values does not invalidate the paint effect.
- Verified the claim both ways: re-widening the paint effect to read `editorState` reproduces the
  cleared selection, and the locked-element journey passes with the split effect. The existing
  trailing-click latch stays for real transform gestures, where committing the document legitimately
  repaints before the compatibility click arrives.
- Journey corrections made while porting, recorded because they change what is asserted:
  - the locked-element drag now starts from an ellipse-only point; the text box covers the ellipse's
    centre, so the original drag grabbed the text;
  - the 44 px handle journey clears the selection on the background first, because two clicks on one
    element inside Konva's 400 ms double-click window open the text editor (that shortcut is
    intended) and hide the selection frame;
  - the locked-element journey re-selects before reading the inspector and then compares the stored
    row's geometry and revision. A drag that releases over the empty canvas clears the selection in
    the source too — its Konva click does the same — and the source asserted the stored element's
    geometry/history, not the selection.

### Regressions and verification

- `npx playwright test`: **50 journeys passed** against the production build (was 30; +20 new).
- `npm run test:unit -- --run`: **57 files / 511 tests passed** (unchanged).
- `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint` passed.
- Svelte MCP protocol used on the changed component (`PresentationCanvas.svelte`): targeted
  documentation plus `svelte-autofixer`, which reports no issues; its `$effect` suggestions describe
  the deliberate imperative Konva lifecycle.
- Honest boundaries: the PDF is still image-based (no text selection or clickable links); cloud /
  Supabase presentations remain unimplemented (slice 4); the target stays unversioned and nothing is
  deployed.

## Slice 3 checkpoint — presentation exports (2026-09-15)

Scope: increment 5 from `docs/superpowers/plans/2026-09-15-presentations-slice.md`. The
`/presentations/<id>` editor now writes real files: an image-based PDF, an editable PPTX and a
restorable `.stickerlab.zip` backup, each loaded on demand and each verified by reading the bytes
back rather than by watching a download click. The remaining presentation work is the un-ported
source journeys (increment 6).

### Changes

- `src/lib/presentations/exports/snapshot.ts` is the shared preflight: it captures the live
  document, decodes every referenced image once, reports the warnings both exports carry and throws
  `PresentationPreflightError` (`missing-media`, `decode-failed`) before any file exists. A snapshot
  is disposed exactly once, whatever the outcome.
- `exports/pdf.ts` renders each slide at 1920×1080 with the production renderer and embeds the PNG
  into a pdf-lib page of exactly 960×540 pt, so the PDF is a fixed, pixel-accurate copy of the slide
  (no selectable text and no link annotations — the dialog says what the format keeps). Progress
  callbacks and an `AbortSignal` stop the run between slides, and a cancel never downloads a partial
  file.
- `exports/pptx.ts` builds a real OOXML deck through PptxGenJS 4.0.1: text as native runs with
  character formatting and hyperlinks, bullets as `buChar`/`buAutoNum`, shapes as preset geometry,
  and pictures with `<a:srcRect>` crop plus flip and rotation. Its layout is `LAYOUT_WIDE`
  (13⅓×7.5 in), which is exactly the document's 1280×720 at 1/96 inch per unit. PptxGenJS writes
  `<a:pPr>` once per run, so paragraph options are repeated identically on every run of a paragraph
  (commented in the module and pinned by its tests).
- `exports/loaders.ts` is the single lazy-entry list (`snapshot`, `pdf`, `pptx` and the existing
  `backup`); `exports/backup.ts`, already used by library restore, now also runs from the editor.
- `src/lib/presentations/editor/exportController.ts` is the Svelte equivalent of the source hook
  `usePresentationExport`: one export at a time, text flushed before the snapshot is captured, the
  snapshot always disposed, downloads only after the bytes are complete, cancellation between
  slides, and a failed browser-module import reworded into reload guidance composed from the
  editor's live save state (`ReloadSafety`), so it never tells a student to reload over unwritten
  work.
- `ExportDialog.svelte` offers the three formats with live progress, cancellation while busy,
  preflight warnings and the readiness line; `PresentationEditorPage.svelte` wires the controller and
  adds the standalone "Download backup" recovery button while a local write is failing.
- Offline readiness is now real for both presentation routes: `offlineReadiness.ts` holds the
  framework-independent state machine and wording, `offlineModules.ts` lists the components, the
  export builders and the two route paths, and `presentationOffline.svelte.ts` composes them for
  SvelteKit — fonts, components, builders **and** `preloadCode` for `/presentations` and the editor
  route. The library page and the editor both start and show it.
- Fix found by the new journeys: importing a component does not fetch a SvelteKit route's generated
  node chunk, which the client router imports on navigation. A fresh page that had only opened the
  library could therefore not open the editor after a disconnect even though readiness said "Ready".
  `preloadCode` for both routes is part of the warm-up now; the production offline journey clears
  the HTTP cache before disconnecting, so the claim is proven from loaded modules rather than from
  Chromium's disk cache. Component tests render outside a SvelteKit app, so the route preload is
  gated on the document's own `data-sveltekit-preload-data` contract.

### Regressions and verification

- New suites: snapshot (7 tests), PDF (6), PPTX (8), export controller (9), offline readiness (5),
  offline modules (3, including the route list). The editor page browser contract grew to 13 tests
  (dialog contents and the backup affordance) and the library contract to 4 (the readiness line).
- `npm run test:unit -- --run`: **57 files / 511 tests passed** (the increment-4 checkpoint was 51
  files / 471 tests). The known non-failing `wrapDynamicImport` startup diagnostics remain visible
  during the full browser run.
- `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint` and `npm run build`
  passed; the adapter-auto environment notice is unchanged.
- `npx playwright test`: **30 journeys passed** (was 28), all against the production build. The two
  new journeys:
  - `e2e/presentation-exports.spec.ts` exports a two-slide deck and opens the files: the PDF parses
    with pdf-lib (2 pages, each exactly 960×540 pt, with the slide raster embedded as
    `/Subtype /Image`), the PPTX unzips to OOXML (slide 1 carries the typed text, `slide2.xml`
    exists, `p:sldSz` is 12192000×6858000 EMU), and the backup's manifest and document are read and
    then restored through the library's own restore path as an independent deck holding the same
    text.
  - `e2e/presentation-offline.spec.ts` builds a deck, opens the library in a fresh page, waits for
    "Ready for offline use.", clears the HTTP cache, disconnects, reopens the deck through an in-app
    navigation, edits and autosaves, and runs a first-use PDF, PPTX and backup export — all offline.
- Dependencies: `pdf-lib@^1.17.1` and `pptxgenjs@^4.0.1` were added (`fflate` was already present
  for backup restore). `fast-xml-parser` from the plan's prose is not used by the source's exports
  and was not installed. npm reports the inherited audit warnings; no install scripts were approved.
- Svelte MCP protocol used: targeted documentation plus `svelte-autofixer` on every new or changed
  component (`ExportDialog`, `PresentationEditorPage`, `PresentationsPage`, `+error.svelte`).
  Autofixer reports no issues; its `$effect` suggestions describe the deliberate
  subscribe/destroy lifecycle.
- Honest boundaries: the PDF is image-based (no text selection, no clickable links); cloud/Supabase
  presentations are still not implemented (slice 4); the target is unversioned and nothing is
  deployed. The source's remaining presentation journeys — text formatting through save/reopen,
  slide add/duplicate/reorder/delete through the rail, the shell-guard and browser-Back save-guard
  variants, and the reader/limit specs — are increment 6.

## Slice 3 checkpoint — presentation editor (2026-09-15)

Scope: increment 4 from `docs/superpowers/plans/2026-09-15-presentations-slice.md`. The
`/presentations/[presentationId]` route is now the real source editor. Presentation exports
(increment 5) are deliberately absent and the inspector says so in words.

### Changes

- `PresentationEditorPage.svelte` owns the route contract: repository load with honest
  loading/missing/missing-media/unsupported/error states (retry only where a retry can help), the
  editor bar (back, undo/redo, add shape, photo input, edit text), the slide rail, the element
  inspector and the mounted dialogs. Its "Back to presentations" and library links are built from
  `resolve()`, so the base path stays correct.
- `store.svelte.ts` holds one non-proxied document with slide/element/text/theme mutations, history
  groups and undo/redo, while `presentationSaving.ts` coordinates debounced autosave with the
  document revision: a save only clears the revision it persisted, a newer stored revision becomes
  a conflict, and the leave guard flushes pending text through the same coordinator.
- `PresentationCanvas.svelte` owns the Konva stage through an effect: direct renderer reuse,
  viewport zoom/pan, hit-test selection (including empty-canvas clear and additive shift-click),
  transform handles, alignment guides and the selection frame, with viewport state kept out of the
  document. `transformGeometry`/`viewGeometry`/`alignmentGuides` remain framework-independent.
- The text seam is `textEditSession.svelte.ts`, `TextEditOverlay.svelte`, `TextFormatToolbar.svelte`
  and the `textBridge`/`textFormat`/`textMeasure` modules: the overlay edits the authoritative
  paragraph/run model (bold/italic/underline/strike, size, colour, alignment, lists, line spacing),
  reports overflow, and every committed change is one history entry that autosave then persists.
- Element tools: `shapeTools.ts` (rectangle, ellipse, line, arrow), `insertImageAsset.ts`,
  `insertStickerSnapshot.ts`, plus `ElementGeometryInspector`, `ShapeStyleInspector`,
  `ImageAdjustInspector`, `ElementLayerList`, `ThemeControls`, `StickerPickerDialog` and
  `PresentationCanvasControls`.
- Genuine parity fix found by the new journeys: Konva's compatibility `click` (synthesized from
  `mouseup`/`touchend`) fires after the commit repaint, which cleared the selection at the end of
  every drag. `PresentationCanvas.svelte` now ignores that trailing click inside the transform
  window, so the selection, inspector and frame survive a move/resize.

### Regressions and verification

- Increment 4 ships the editor store/geometry/save/text suites plus a 12-test browser contract for
  the mounted page; the focused editor page suite passes **12/12**, and the new
  `e2e/presentations.spec.ts` adds **7 production-build journeys** (library create/reopen; move +
  undo/redo and click-to-select/clear; resize at two zoom levels; typed text across a reload; photo
  insert with stored bytes and painted pixels; leave-guard flush on Back; newer-revision conflict
  that keeps the local copy). The journeys read the app's own DOM/IndexedDB surfaces because the
  production build cannot import the source modules the React specs reached for.
- `npm run test:unit -- --run`: **51 files / 471 tests passed** (the baseline before this increment
  was 50 files / 459 tests). The known non-failing `wrapDynamicImport` startup diagnostics remain
  visible during the full browser run.
- `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint` and `npm run build`
  passed.
- `npx playwright test`: **28 journeys passed** (15 editor incl. the new unknown-presentation-id
  honesty test, 6 masks, 7 presentations) against the production build. The editor journey that
  previously asserted the old milestone page now points at `/auth/callback`, and the milestone copy
  in `src/routes/+error.svelte` was updated to list the editor as working.
- Svelte MCP protocol used: `list-sections`, targeted `get-documentation`, and `svelte-autofixer` on
  every new/changed component (`PresentationEditorPage`, `PresentationCanvas`, `TextEditOverlay`,
  `TextFormatToolbar`, `+error.svelte`). Autofixer reports no issues; its `$effect` suggestions
  describe the deliberate Konva stage/render lifecycle, and the one `$bindable` assignment it flags
  is load-bearing (`leaveguard = $bindable(null)` is required by the core
  `no-useless-assignment` lint rule, verified by removal).

## Slice 3 checkpoint — presentation library (2026-09-15)

Scope: increment 3 from `docs/superpowers/plans/2026-09-15-presentations-slice.md`. This exposes the
source-compatible local library while keeping the unfinished `/presentations/<id>` editor on the
honest milestone page.

### Changes

- `/presentations` now uses the shared `AppShell` and app-scoped IndexedDB presentation repository.
  The header and sidebar expose one base-aware Presentations destination and keep it active for
  future editor URLs.
- `PresentationsPage.svelte` ports the source hero, honest empty/loading/error states, title search,
  local counts, create, revision-safe rename, independent duplicate, delete confirmation and focus
  fallback. Its URL inputs remain route-owned props, matching the catalog and pack seams.
- `PresentationThumb.svelte` uses a Svelte attachment to own `IntersectionObserver` setup and
  teardown. The framework-independent thumbnail module lazily loads a stored first slide, limits
  rendering to two concurrent jobs, caches 24 revisions in memory and releases decoded artwork.
- Restore accepts a `.stickerlab.zip`, bounds archive and expansion sizes, rejects unsafe paths,
  verifies checksums and image structure/dimensions, clones every document/slide/element/asset ID,
  and commits the copy plus media atomically. `fflate` is now the only dependency introduced for
  this increment.

### Regressions and verification

- Upstream-derived archive, restore and thumbnail suites plus library action tests and Svelte
  browser tests: **5 new files / 40 tests**. They cover archive tampering and limits, independent
  restore, cache/revision/LRU/throttling behavior, decode disposal, create/search/rename/duplicate/
  delete, and mounted thumbnail loading.
- `npm run test:unit -- --run`: **40 files / 310 tests passed**. The known non-failing
  `wrapDynamicImport` startup diagnostics remain visible during the full browser run.
- `npm run check`: `svelte-check found 0 errors and 0 warnings`; `npm run lint` and `npm run build`
  passed. The adapter-auto environment notice remains unchanged.
- `npx playwright test`: **21 journeys passed** against the production build. The new presentation
  journey proves the route, active navigation, local create, editor URL handoff and persistence
  when returning to the library; the existing 20 sticker, pack and mask journeys remain green.
- Svelte MCP documentation covered attachments, effects, state, derived values, props, routing,
  accessibility and testing. `svelte-autofixer` reports no findings for the thumbnail and root
  layout. On the page/route it flags the deliberate route-owned `openhref` prop and its `goto`
  consumer as if they were unresolved raw links; the route constructs that value from
  `resolve('/presentations')`, so these are parser-local false positives. Its effect suggestion is
  also inapplicable: the effect initiates the external repository read on mount rather than
  deriving state from state.

## Slice 3 checkpoint — presentation rendering (2026-09-15)

Scope: increment 2 from `docs/superpowers/plans/2026-09-15-presentations-slice.md`. This ports the
source renderer behind framework-independent TypeScript APIs. It does not expose an unfinished
presentation route.

### Changes

- `textLayout.ts` measures, wraps and positions the authoritative paragraph/run model, including
  Vietnamese text, explicit breaks, mixed formatting, nested bullets, numbering, justification,
  vertical alignment, overflow and missing-font reporting.
- `renderSlide.ts` builds a direct-Konva page group for shapes, cropped/flipped images and rich text.
  Editor selection/listening stays an explicit option, while detached raster exports cannot include
  viewport transforms, selection frames, guides or handles.
- `decodedArtwork.ts` provides incremental editor and all-or-nothing batch decode sessions. Replaced
  sources close immediately, failed additions retain prior artwork, batch failures close successful
  peers, and disposal is idempotent. Browser `Blob` creation copies potentially shared bytes into an
  `ArrayBuffer`, satisfying the target's TypeScript 6 contract.
- `rasterizeSlide.ts` renders the same page group on a detached stage and destroys the stage after
  producing PNG bytes. `fonts.ts` strictly loads all eight Be Vietnam Pro/Spectral faces before
  measurement; the global stylesheet now registers their existing licensed files.
- The implementation remains plain TypeScript. A later Svelte canvas component can own the Konva
  stage through an attachment/effect teardown without putting large presentation documents into
  deep reactive proxies or shared server-global state.

### Regressions and verification

- Four upstream test files: **24 tests passed** for font-face completeness/failure, text layout,
  decode ownership/failure and raster input validation.
- One browser test renders a real detached Konva stage in Chromium and verifies the PNG signature,
  exact 640×360 size, white page background and mint shape pixels.
- `npm run check`: `svelte-check found 0 errors and 0 warnings`.
- `npm run lint`: passed; Prettier and ESLint are clean.
- `npm run build`: passed with the existing adapter-auto environment notice.
- `npm run test:unit -- --run`: exit 0, **35 files / 270 tests passed**. The previously recorded
  non-failing browser-runner `wrapDynamicImport` startup diagnostics remain; the new focused
  Chromium raster test runs cleanly by itself.
- Svelte MCP protocol used: `list-sections`, then targeted documentation for best practices,
  `$effect`, `{@attach}`, testing, TypeScript and `.svelte.ts` modules. No `.svelte` or `.svelte.ts`
  source file changed in this framework-independent increment, so component autofixing does not
  apply.

## Slice 3 checkpoint — presentation model + local storage (2026-09-15)

Scope: the first presentation increment from
`docs/superpowers/plans/2026-09-15-presentations-slice.md`. This ports the source's separate
presentation schema and repository boundary without exposing unfinished routes or claiming editor,
rendering or export support.

### Changes

- `src/lib/presentations/model/` now owns the serializable 1280×720 presentation document model,
  rich text/shape/image element contracts, validation limits, safe hyperlink policy, factories,
  independent clone remapping and document-unit conversions. It stays separate from sticker
  `ProjectDocument` and contains no Svelte, DOM or Konva state.
- `src/lib/presentations/persistence/` adds memory and IndexedDB repository adapters. Documents and
  immutable media records save atomically, stale revisions fail with stable conflict errors,
  unreadable rows cannot hide valid library summaries, and duplication remaps document, slide,
  element and asset ids while copying media bytes. The IndexedDB write boundary makes an explicit
  `Uint8Array` copy so TypeScript 6 proves the stored value is an `ArrayBuffer`, not a possible
  `SharedArrayBuffer`.
- The IndexedDB adapter uses the target's existing additive database-v5
  `presentations`/`presentationMedia` stores. The ported upgrade regression proves a populated v4
  sticker database retains its projects and assets when presentation stores are added.
- No route or user-facing presentation claim was added. `/presentations*` continues to use the
  honest milestone error page until the library and editor increments land.

### Regressions ported

Seven upstream test files cover **56 tests**: parser and round-trip validation, schema/size/ID/link
rejection, factories and independent clones, geometry conversion, media immutability, memory/IDB
repository parity, atomic rollback, v4 upgrade preservation, duplication and shared revision rules.

### Verification

- Focused model/storage run: **7 files / 56 tests passed**.
- `npm run check`: `svelte-check found 0 errors and 0 warnings`.
- `npm run lint`: passed; Prettier and ESLint are clean.
- `npm run build`: passed with the existing adapter-auto environment notice.
- `npm run test:unit -- --run`: exit 0, **30 files / 245 tests passed**. The server project also ran
  clean in isolation (**22 files / 197 tests**). The browser project passed **8 files / 48 tests**
  but the current SvelteKit/Vite/Vitest combination prints non-failing `wrapDynamicImport` or
  disconnected-transport diagnostics while its SSR test server starts or tears down. This is a
  known upstream runner issue and did not fail an assertion; it remains visible rather than being
  described as clean output.
- No presentation E2E journey exists yet because no presentation route is exposed in this
  checkpoint.
- The required Svelte MCP tools were not exposed by this session's tool harness. No `.svelte` or
  `.svelte.ts` file changed; all new modules are framework-independent TypeScript. The missing MCP
  evidence is recorded rather than simulated.

## Slice 2 checkpoint — mask/restore brushing + independent packs review (2026-09-14)

Scope: the last implemented piece of slice 2 — the mask brush pointer pipeline, the source
Background panel and the retirement of every "Coming later" deferral — plus the independent packs
review requested by the previous checkpoint and its three P3 findings. Ports
`../Peeloodle/src/features/editor/{maskPainter,useMaskBrush,maskUtils,maskStroke}.ts` (React main
`54eae61c`). Catalog administration stays deferred by the design; presentations and cloud/Supabase
are untouched.

### Changes

- **`src/lib/editor/maskPainter.ts` (new, port of `maskPainter.ts`)** — 128 px tile alpha
  snapshots so `hasChanges()` compares once per stroke, painting clipped to the layer crop, and the
  normalized-space ellipse that makes a round document brush exact under nonuniform scale.
- **`src/lib/editor/maskBrush.ts` (new, port of `useMaskBrush.ts`)** — pointer capture, rAF preview
  frames, one PNG encode on pointer-up applied as one history entry, the source's failure retention
  (`Save to retry; the stroke is retained`), and lazily decoded mask canvases seeded from the stored
  blob. The source's synchronous store subscription is replaced by a baseline compare: the values
  at stroke start (tool, selection, viewport, brush size, document) are captured after the stroke's
  own `selectLayer`, so the selection write made inside pointer-down cannot end the stroke; any
  later change finishes it, and teardown finishes an in-flight stroke.
- **`src/lib/components/KonvaArtboard.svelte`** — brush listeners on the artboard host (attached
  imperatively, like pan/wheel), `previewMask()` repointing the live Konva image at the painter's
  canvas during the stroke, the source's dashed `brush-cursor` with the erase/restore colours, and
  an `$effect`-owned teardown. The committed surface returns on the reconcile after `applyMask`
  replaces the document, so preview, save, PNG and ZIP all read the same mask.
- **`src/lib/components/EditorInspector.svelte`** — the source Background section: `Erase` /
  `Restore` toggles (active tool highlighted), `Reset Mask` only while a mask exists, the brush-size
  slider while the brush is active, the source outline help ("use Erase to make a cutout"), and the
  deferred adjust-tab notice removed.
- **Deferral retirement** — `toolIntent.ts` dropped `DEFERRED_TOOL_MARKER`, `DEFERRED_TOOL_NOTE`
  and `isDeferredToolIntent`; `Sidebar.svelte`, `EditorWorkspace.svelte` and `DashboardPage.svelte`
  stopped rendering "Coming later" (the dashboard card reads the source copy "Brush away the
  background. Keep the good bits.", and the rail Pro Tip reads the source brush tip); `+error.svelte`
  and `README.md` no longer list mask/restore as a later slice.
- **Packs P3 fixes (from the independent review)** — `Modal.svelte` gained an optional `onclosed`
  signal (the one "the dialog is gone" callback for both user and programmatic closes) so
  `PacksPage.svelte` can run the source's focus fallback (`deleteOpener` if connected, else
  `newPackButton`) after deleting the last pack or creating from the empty state. The messenger
  notice regained the source's `Got it` action, `.muted` body and always-enabled trigger.
- **Base-aware artwork (slice-5 hardening item named by the design)** — every static `<img>` now
  renders through SvelteKit's `asset()` (`Header`, `Sidebar`, `StickerCollage`, `DashboardPage`,
  `AssetTray` incl. the sticker-catalog tiles, `EditorWorkspace`, `TemplateCard` previews), and
  `ingestBundledImage()` fetches through `asset()` while still recording the canonical
  `bundled-asset:/art/...` provenance, so template cloning, samples and the sticker catalog work
  under a configured `paths.base`. `internalLinks.test.ts` grew source-based checks that no
  root-relative `src=` literal survives and that the loader fetches through `asset()`; a new
  mocked-base node test (`bundledAsset.test.ts`) pins the fetch URL and the canonical provenance.
  The scripted bulk edit was reviewed file by file (an `{#each ... as asset}` shadowing hazard in
  `AssetTray.svelte` was renamed to `entry`).

### Regressions added

| Test                                                                                                       | What it locks down                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/editor/maskPainter.svelte.test.ts` (new, browser; 4 cases)                                        | The nonuniform radii ellipse (holes at ±8/±38, intact at ±30/±60), crop clipping (outside-crop alpha untouched), `restore` on a clean mask reporting no changes, and `loadMaskCanvas` drawing a stored blob into the working canvas.                                |
| `src/lib/editor/maskStroke.test.ts` (new, node; the source `maskStroke.test.ts` ported, 4 cases)           | Commit ordering (`commit` → reader → `committed`), a rejected commit staying registered for retry (called again), the no-stroke no-op, and undo refusing to run while a stroke is open.                                                                             |
| `e2e/masks.spec.ts` → "erase paints a mask that the preview shows, IndexedDB keeps, and undo/redo handles" | A real mouse stroke: live preview alpha 255 → 0, the stored image layer gains a `maskKey`, the separate `masks` row decodes with the hole at image-local (172, 172) and white elsewhere, Undo/Redo flip the preview, and `Reset Mask` + save clears the stored key. |
| `e2e/masks.spec.ts` → "the mask reaches the exported PNG and Reset Mask removes it there again"            | 512 px exports before/after a 120 px stroke: identical dimensions, >500 more fully transparent pixels (thousands measured) and fewer opaque pixels with the mask, and the count returning to the unmasked value after `Reset Mask`.                                 |
| `e2e/masks.spec.ts` → "a masked sticker travels through the pack ZIP with the same hole as the PNG export" | The masked sticker organized into a pack, its ZIP parsed in Node (STORE writer), the PNG entry decoded in the page, and its transparent-pixel count equal (±50) to the single PNG export — the mask round-trip the previous checkpoint recorded as unverified.      |
| `e2e/masks.spec.ts` → "a failed mask encode retains the stroke and Save retries it exactly once"           | A stalled `toBlob` released with failure: `Mask edit pending` while encoding, the retained-stroke copy appears, the next Save re-encodes the same canvas, persists the mask, and one Undo removes it (one history entry).                                           |
| `e2e/masks.spec.ts` → "Space-pan takes precedence over the brush and never paints" (added by the P2 fix)   | Space + erase-tool drag pans the image fully (`data-space-pan`/`data-panning` set), paints nothing (old centre now off-photo, new centre alpha 255), stores no `maskKey`, and the document stays saved.                                                             |
| `e2e/masks.spec.ts` → mobile, "touch erase and restore stay reachable at 390x844"                          | Touch tap erases through the properties dialog's `Erase`, the dialog's `Restore` + tap fills it back, and Save/Export stay in the viewport.                                                                                                                         |
| `src/lib/components/packs-page.svelte.test.ts` extended (+3)                                               | Focus falls back to `New Pack` after deleting the last pack (dead opener) and after creating from the empty state, and the messenger notice has the source `Got it` footer, a `.muted` body and opener focus restoration.                                           |
| `src/routes/app-shell.svelte.test.ts` (updated)                                                            | The dashboard eraser card asserts the real source copy and href instead of "Not available yet".                                                                                                                                                                     |
| `src/lib/app/internalLinks.test.ts` extended (+9)                                                          | No component/route may hard-code a root-relative `src=` literal, the seven artwork components must go through `asset()`, and `ingestBundledImage` must fetch through `asset()` with the canonical provenance kept.                                                  |
| `src/lib/assets/bundledAsset.test.ts` (new, node; mocked `$app/paths` base `/stickerlab`)                  | The bundled fetch URL is base-prefixed (`/stickerlab/art/...`) while the stored provenance stays `bundled-asset:/art/...`.                                                                                                                                          |

### Checks run in this checkpoint

All commands ran from `/home/vdc/Projects/Peeloodle-Svelte` with the installed browser (logs under
`/tmp/peeloodle-mask-logs/`).

| Command                      | Result                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run check`              | `svelte-check found 0 errors and 0 warnings`                     |
| `npm run lint`               | exit 0 — Prettier clean, no ESLint findings                      |
| `npm run build`              | exit 0                                                           |
| `npm run test:unit -- --run` | **23 files, 189 tests passed** (was 20 / 170 after the P3 fixes) |
| `npx playwright test`        | **20 journeys passed** (was 14; `e2e/masks.spec.ts` adds 6)      |

Direct Svelte MCP calls: `list-sections`, a targeted `get-documentation` batch (`$state`, `$derived`,
`$effect`, `$props`, `bind:`, `{#each ...}`, snippets, testing) and `svelte-autofixer` on every
changed component/module — `KonvaArtboard.svelte`, `EditorInspector.svelte`, `EditorWorkspace.svelte`,
`Sidebar.svelte`, `DashboardPage.svelte`, `Header.svelte`, `StickerCollage.svelte`, `AssetTray.svelte`,
`TemplateCard.svelte`, `maskBrush.svelte.ts`, `maskPainter.svelte.ts` → **0 issues** each. Remaining suggestions are the project's documented non-actionable class (`$effect`
used to sync external state, `bind:this`/Map caches). Transport note: this checkpoint ran in a
harness without the project's direct MCP tools, so the MCP server was called over its supported
stdio JSON-RPC transport rather than through direct tools; the tool outputs above are the server's
own, not a CLI re-implementation.

### Residuals

- **Masks review outcome: BLOCK → fixed → re-review PASS** (see the review section below). The
  re-review accepted these bounded residuals, none of which affect correctness:
  the **committed** `ensureSurface` raster is still full-resolution (the source also caps its
  committed preview, `KonvaCanvas.tsx:390,402` — pre-existing, not introduced by the brush); a
  late-resolving decode of an evicted mask key can be re-cached until the next loader pass; stage
  teardown `clear()`s mask rasters without `close()`; a theoretically stuck `panning` state after a
  failed pointer capture would keep the brush blocked (pre-existing stuck-pan timing).
- **Automatic background removal is not implemented** (no provider/model), unchanged from the
  source.
- The `ensureSurface()` signature hazard recorded last checkpoint (mask key covered, decoded mask
  image identity not) is unchanged; it stays harmless because `applyMask` always writes a fresh
  key and live frames bypass that cache through `previewMask()`.
- A reduced-motion/keyboard-only sweep of the brush remains slice-5 work; the mask browser test
  drives real pointer/touch input but not keyboard-only operation (the source brush has none).
- The MCP transport note above: future harnesses with direct tools should re-run the autofixer
  directly if they require that evidence form.

### Independent masks review and its fixes (this checkpoint)

`/home/vdc/.pi/agent/sessions/--home-vdc-Projects--/subagent-artifacts/outputs/c47e7d11-4974-48cd-9b39-0ca3aa5ae3b2/masks/independent-masks-review.md`
(original review plus a "Re-review after fixes" section).

The independent review ran fresh commands (23 files / 188 tests, 19 journeys), compared
`maskBrush.ts` / `maskPainter.ts` / the `KonvaArtboard` wiring / the inspector panel against the
source line by line, and returned **BLOCK** with two blockers plus four P3s:

| Finding                                                                                                                                                           | Fix (all verified by the re-review)                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** `toolIntent.ts` empty-state copy still said "Background Eraser is not available yet / later milestone" (reachable from the dashboard erase card, untested) | Restored the source copy ("Upload a photo to erase the background…") and pinned it in `toolIntent.test.ts`.                                                                       |
| **P2** Space-pan also ran the brush's same-element `pointerdown`: a Space drag painted a mask and truncated the pan                                               | `maskBrush.pointerdown` now stands down on `blocked()`; `KonvaArtboard` passes `spaceHeld \|\| panning \|\| activeTool === 'pan'`; new e2e journey "Space-pan takes precedence…". |
| **P3** stroke baseline compared document **id** only, so a mid-stroke document replacement could split a stroke                                                   | Baseline stores the document object and `sync()` compares identity, exactly like the source subscription.                                                                         |
| **P3** live preview composited full-resolution (2048 px photos every frame)                                                                                       | `previewMask()` now applies the source's 1024 px `previewRatio`; exports stay full-resolution.                                                                                    |
| **P3** decoded mask rasters were never evicted or closed                                                                                                          | The loader effect evicts keys no layer references and `close()`es bitmap-backed rasters; undo/redo re-decodes.                                                                    |
| **P3** outline rail `aria-pressed` omitted the source's `activeTool === 'select'`                                                                                 | `railPressed` matches the source condition.                                                                                                                                       |

The re-review then re-attacked the fix surface (full Space pan with no paint, painting after Space
release and after a pan-tool drag, mid-stroke Arrow nudge finishing the stroke, eviction-safe
undo/redo, mid-stroke navigation committing to the old project) and re-ran every check green:
**check 0/0, lint clean, build exit 0, 23 files / 189 unit tests, 20 Playwright journeys**. Verdict
**PASS**; only the documentation update this section performs (P3-D1) remained.

### Independent packs review (this checkpoint)

`/home/vdc/.pi/agent/sessions/--home-vdc-Projects--/subagent-artifacts/outputs/44ceb52a-3d7e-4980-b1cb-bc2ca803296f/packs/independent-packs-review.md`
— **verdict PASS**, no P1/P2 findings. Fresh checks were re-run for the review (20 files / 167
tests, 14 journeys, all green), source integrity was verified at `54eae61c` with a clean tree, and
`packActions.ts` / `zipExport.ts` / `PacksPage.svelte` / the route + navigation + `removeProject.ts`
were compared file by file. Three P3 findings were recorded and two were fixed here (see the P3
fixes above); the third (favorites rail re-reading at load instead of per render) is an accepted,
documented approximation. The review confirmed the URL contract (`?view` replaces the whole query,
`?pack=` deep link, `#local-stickers`), ZIP ordering/manifest, and the delete-keeps-stickers /
remove-keeps-assets semantics independently of the writer's tests.

## Slice 2 checkpoint — real `/my-stickers` pack library (2026-09-14)

Scope: the **packs half of slice 2** — the source `/my-stickers` library (`PacksPage`), its
framework-free rules, the ordered ZIP export and the route wiring, plus the P2 preview-hint
correction. Ports `../Peeloodle/src/features/packs/{PacksPage.tsx,packActions.ts,packActions.test.ts}`
and `../Peeloodle/src/features/exports/{zipExport.ts,zipExport.test.ts}` (React main `54eae61c`).
No masks/brush, no presentations, no cloud/Supabase work; the editor, save coordination, templates
and `/templates` are untouched apart from the hint copy and the now-obsolete `base` fallback.

### Changes

- **`src/lib/packs/packActions.ts` (new, port of `packActions.ts`)** — `PACK_VIEWS`,
  `packViewFromParams` / `packViewParams` (URL contract: `view=mine|favorites|shared|export-history`,
  unknown → All Packs, All Packs clears the parameter), `visiblePacks` (title+description search,
  Recent/Name sort, caller's array untouched), `buildPackRecord` (blank title refused; editing keeps
  id/visibility/projectIds/createdAt), `duplicatePackRecord` (`"… Copy"`, fresh id, fresh times),
  `setProjectInPack` (toggle) and `reorderProjectInPack` (one step; out of range → `null`, no write).
- **`src/lib/exports/zipExport.ts` (new, port of `zipExport.ts`)** — the source's own STORE-only
  pure-JS ZIP writer (`createZipArchive`, `crc32` from `src/lib/imageFormat.ts`) and `exportPackZip`,
  which renders one 512 px artwork-bounds PNG per pack membership **in membership order**
  (`NN_title.png`), prepends `manifest.json` (`{title, description, version: 1, count, stickers[]}`)
  and fails the whole export when a sticker cannot be read or rendered. No new archive dependency was
  added — the source ships this writer, so the port reuses its algorithm and its dependency set
  (`loadProjectBundle` + the shared `renderDocument`).
- **`src/lib/components/PacksPage.svelte` (new, port of `PacksPage.tsx`)** — hero
  (`StickerCollage variant="packs"`, the source kicker/title/points copy, New Pack + Import Photos),
  the five view pills (`aria-pressed`), search (`Search packs`) and sort, the pack grid with
  `.pack-cover` collages built from up to five saved `ProjectThumb`s, the detail aside
  (artwork, `Download ZIP`, `Add Stickers`, `Edit pack`, `Duplicate`, `Delete`, the
  messenger "unavailable" notice, contents heading, sticker tiles with ↑/↓/remove, add tile), the
  three source dialogs (create/edit form with required name, add-stickers checkbox list, delete
  confirmation that says the stickers are kept) and the sticker drawer section (`#local-stickers`,
  `LocalProjectList`). Behaviour kept from the source: the `operationActive` write serialization with
  `busy`/`error` state and a single `reload()`, the `live` liveness guard around async work,
  `selectedPackId` falling back to the first visible pack, `detailClosed`, the ZIP button disabled for
  an empty pack, buttons/checkboxes disabled while a write is in flight, and focus restoration to the
  element that opened each dialog.
- **`src/lib/components/PacksPage.svelte` — URL seam.** `view`, the `?pack=<id>` deep link and
  `#local-stickers` arrive as props, and view picks are reported through `onselectview`, so the
  component renders in a browser test without `$app` mocks (the `TemplatesPage`/`DashboardPage`
  seam). The hash scroll effect re-runs on `hash` **and** on the loaded library, mirroring the
  source's `useEffect(..., [location.hash, packs])`.
- **`src/routes/my-stickers/+page.svelte` (new)** — the real route. The URL owns the view
  (`/my-stickers?view=favorites` is shareable, reloadable and falls back to All Packs) and the
  optional `?pack=<id>` deep link. A view pick pushes a history entry that **replaces the whole
  query** (the source called `setSearchParams(packViewParams(view))`), so picking a view clears a
  `pack` parameter; `keepFocus`/`noScroll` keep the caret and scroll position while only the query
  changes.
- **`src/lib/app/navigation.js`** — the temporary `base`-prefix branch is **gone**:
  `shellHref('/my-stickers')` and `shellHref('/my-stickers#local-stickers')` now go through typed
  `resolve()` like every other shell link, and the `base` import was removed. This retires the last
  deferred destination the 2026-09-14 "links to routes that do not exist yet" ruling had to keep.
- **`src/lib/blob.ts`** — `blobBytes` now declares `Promise<Uint8Array<ArrayBuffer>>`, which is what
  it always returned; the ZIP writer's part list needs ArrayBuffer-backed views. Type-only change.
- **P2 — `src/lib/components/TemplateCard.svelte` preview hint corrected.** The hint claimed
  "use Adjust → Replace photo". Verification of the actual control: `EditorInspector.svelte` renders
  the image-layer card (`.layer-card`, containing the `Replace photo` button and the hidden
  `#replacement-photo-input`) **above** the `Adjust / Effects / Position / Layers` tablist, so it is
  reachable on every tab whenever an image layer is selected, and at narrow widths only after opening
  the "Sticker properties" dialog. The asset tray has no replace affordance at all. The hint now says
  "select your photo layer and use **Replace photo** at the top of the Sticker Properties panel — it
  sits above the Adjust / Effects / Position / Layers tabs (open "Sticker properties" first on a
  narrow screen)". The source's own wording (`TemplateRail.tsx`: "open Layers → Your photo → Adjust →
  Replace photo") is misleading for the same reason and was **not** copied.
- **`src/routes/+error.svelte`**, **`README.md`**, this document — milestone copy updated: `/my-stickers`
  is a working page now, presentations and cloud/Supabase remain later slices.
- **Editor parity limitation recorded for later (not fixed here):** `Replace photo` living outside the
  Adjust panel is upstream behaviour (`EditorPage.tsx` renders `<ImageLayerCard>` before
  `<Tabs.Root>`), so the target matches the source layout and the preview copy had to describe the
  real path instead. Moving that control into the Adjust panel — or adding a `Layers → Your photo`
  shortcut — is editor work for a later slice, not a packs change.

### Regressions added

| Test                                                                                                                                                                                             | What it locks down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/packs/packActions.test.ts` (new, node; the source test ported, +1 contract)                                                                                                             | The source's view-parameter mapping/fallbacks, the search/sort contract ("the caller's array is not reordered"), create/edit/duplicate/toggle/reorder rules including the refused blank title and the out-of-range `null`, plus round-tripping a view through `packViewParams` → `packViewFromParams`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/lib/exports/zipExport.test.ts` (new, node; the source test ported)                                                                                                                          | A missing sticker or a failing render rejects the whole export (no silently dropped entry), membership order is preserved in both ZIP entry names and `manifest.json`, the writer emits a real PK-header ZIP, and `exportPackZip` produces a ZIP with manifest + rendered PNGs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/lib/components/packs-page.svelte.test.ts` (new, browser; 11 cases)                                                                                                                          | Hero/controls/pills/search/sort/empty state and the drawer section; view picks reported through `onselectview`; create → persisted local pack with the form's title/description and empty membership; add two saved stickers, reorder (with the end tiles disabled) and remove one, then assert the sticker and every asset row survive; edit keeps id/createdAt/projectIds; duplicate gets a fresh id and the same stickers; delete removes only the pack and keeps both stickers, their assets and the unrelated pack; a refused write surfaces the repository message and adds nothing; the `requestedPackId` deep link and the close button; search/sort/no-results/Clear search; the honest Shared-with-Me and Export-History views; the Favorite Templates rail driven by `stickerlab_fav_templates`.                                                         |
| `e2e/editor.spec.ts` → "organizes saved stickers into packs, exports an ordered ZIP and keeps the stickers on delete" (**fails pre-implementation: `/my-stickers` rendered the milestone page**) | Two real stickers saved from the editor → dashboard "View all" href `/my-stickers#local-stickers` → hero + drawer listing both → create "Reactions Pack" → `Download ZIP` disabled while empty → add both stickers through the dialog → reorder → **reload** and re-assert the persisted order → download and **parse the ZIP** (entry order `manifest.json`, `01_beta_dog.png`, `02_alpha_cat.png`; manifest equality; PNG signature/IHDR bit depth 6/RGBA/512-px longest edge per entry) → duplicate (fresh id, same membership) → `?pack=` deep link → view pill writes `?view=favorites` and survives a reload → a favorite picked in `/templates` surfaces in the Favorite Templates rail → back to All Packs clears the query → delete the pack via the dialog and assert both stickers, all asset rows and the other pack survive, including after a reload. |
| `e2e/editor.spec.ts` → "keeps the pack library usable at desktop, tablet and phone widths"                                                                                                       | 1024×768 and 390×844: controls/search/pills visible, the add-stickers dialog reachable and toggling membership, membership written at the first width still present at the second, and `Download ZIP` enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/lib/app/shell-href.test.ts` (rewritten)                                                                                                                                                     | `/my-stickers` and `/my-stickers#local-stickers` resolve through `resolve()` (mock base `/stickerlab` no longer appears in shell hrefs), no shell link falls back to a bare base-prefixed pathname, and My Stickers/Templates are current on their own routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/lib/app/internalLinks.test.ts` (updated)                                                                                                                                                    | `PacksPage.svelte`, `src/routes/my-stickers/+page.svelte` added to the per-file base-aware check; `navigation.js` must not import `base` or interpolate `${base}` any more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/routes/templates/templates-catalog.svelte.test.ts` (extended)                                                                                                                               | The preview dialog's editor hint must name the real control (`Replace photo` at the top of the Sticker Properties panel) and must not contain `Adjust →`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `e2e/editor.spec.ts` → "the routes that are still later slices explain themselves honestly" (repurposed)                                                                                         | The honest milestone page is now asserted through `/presentations`, since `/my-stickers` is a real route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Checks run in this checkpoint

All commands ran from `/home/vdc/Projects/Peeloodle-Svelte` with the installed browser (logs under
`/tmp/peeloodle-packs-logs/`).

| Command                      | Result                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`              | `svelte-check found 0 errors and 0 warnings`                                                                                                                                                          |
| `npm run lint`               | exit 0 — Prettier clean, no ESLint findings (the ZIP rethrow carries `cause`; the view pick mutates `searchParams` instead of `url.search` to stay inside the `svelte/prefer-svelte-reactivity` rule) |
| `npm run build`              | exit 0                                                                                                                                                                                                |
| `npm run test:unit -- --run` | 20 files, **167 tests passed** (was 17 files / 141)                                                                                                                                                   |
| `npx playwright test`        | **14 journeys passed** (was 12); no `playwright install`                                                                                                                                              |

Direct Svelte MCP calls (no CLI transport): both skills loaded, `list-sections`, targeted
`get-documentation` (`$app/state`, `$app/navigation`, `$app/paths`, `$state`, `$derived`, `$effect`,
`{#each ...}`, `bind:`, testing), and `svelte-autofixer` (Svelte 5) on the full current
`PacksPage.svelte` (0 issues), `src/routes/my-stickers/+page.svelte` (0 issues),
`TemplateCard.svelte` (0 issues) and `+error.svelte` (0 issues); the DashboardPage change is a
comment only and was analysed as an equivalent snippet (0 issues). The remaining suggestions are the
non-actionable class already recorded for this project: "calling a function / assigning a stateful
variable inside an `$effect`" on `PacksPage.svelte` (repository load, URL-derived selection, DOM
scroll) plus the `bind:this` note on the New Pack handle.

### Residuals

- **The library is local-only by design.** The source's optional cloud workspace supplied the
  `Private` badge, the "Private account · local-first cloud saving" note and the `All Private
Stickers` heading; this slice has no cloud, so those surfaces read the honest local value (`Local`,
  `All Local Stickers`) instead of faking a private/cloud state. Shared-with-Me and Export-History
  views keep the source's honest empty states.
- **ZIP export renders on demand.** Each entry is a freshly rendered 512 px artwork-bounds PNG from
  the same renderer as the single-sticker export; mask blobs are fetched per pack membership through
  `loadProjectBundle`, but no brush exists yet, so a mask round-trip through a ZIP is unverified.
- **`Download ZIP` has no progress UI beyond the `Exporting…` label** (source parity); a large pack
  blocks the busy flag until the last sticker renders, and a failure surfaces the thrown message in
  the page alert.
- **Editor parity limitation recorded above**: the `Replace photo` control sits outside the Adjust
  panel (upstream layout), so the template preview hint describes the real path. Moving the control
  is later editor work.
- Favorites rails read `stickerlab_fav_templates` at load time (source parity), so a heart toggled in
  the rail updates the rail itself but the parent's `Favorite Templates` list only follows the next
  library load.
- No non-empty-base browser run exists (`vite.config.js` configures no `paths.base`), so the retired
  `base` branch is covered by the mocked-`$app/paths` unit tests rather than a real subdirectory
  deploy.
- Masks/restore brushing, catalog administration, presentations and cloud/Supabase remain
  unimplemented.

## Slice 2 checkpoint — real `/templates` catalog (2026-09-14)

Scope: the template half of slice 2 — the source catalog route with search, category filters,
previews and localStorage favorites, plus "Use Template" cloning verified as independent and
editable with correct blobs/fonts and a local save/reopen. No packs, masks, presentations or cloud
work; the editor, save coordination, tool intents and the Supabase decision are untouched, and
`/my-stickers` (the other half of slice 2) still has no route.

### Changes

- **`src/routes/templates/+page.svelte` (new)** — the real route. The query lives in the URL
  (`/templates?q=cat` is shareable and reloadable) and each keystroke performs a history-replacing
  client navigation (`goto(url, { replaceState: true, keepFocus: true, noScroll: true })`), the
  closest SvelteKit equivalent of the source's `useSearchParams(..., { replace: true })`.
  `replaceState()` from `$app/navigation` was deliberately **not** used: it rewrites the address bar
  but leaves `page.url` unchanged, so the filtered rails never saw the new query (reproduced in the
  browser journey before switching to the navigation form).
- **`src/lib/components/TemplatesPage.svelte` (new)** — port of
  `../Peeloodle/src/features/templates/TemplatesPage.tsx`: hero (`StickerCollage variant="templates"`),
  the ten source category pills (`aria-pressed`), the result-count copy, `.filter-search`, the three
  rails (Trending / reversed "Explore by Category" / `result.slice(2)`) and the empty state with
  `Reset filters`. The picked category is dropped on **every** query change, like the source's
  `useEffect(() => setCategory('All Templates'), [query])`; a purely derived variant was rejected
  because it revived the old category when the query returned to a value it once had (that revert
  case is now a browser assertion). URL wiring stays in the route, so the component renders without
  `$app` mocks — the same prop seam as `DashboardPage.svelte`.
- **`src/lib/app/navigation.js`** — `/templates` now goes through typed `resolve('/templates')`;
  only `/my-stickers` keeps the documented `base`-prefix fallback, with the comment and typedef
  narrowed to that one target. `DashboardPage.svelte`'s stale "`/templates` is the one deferred
  destination" note was corrected.
- **`src/lib/components/Modal.svelte`** — a dialog that was closed **programmatically** and
  re-opened in the same tick used to be dismissed again by the late `close` event of its own
  `dialog.close()` (a queued task): the reopened preview closed itself a moment after appearing — an
  intermittent timeout in the catalog browser case, and a real risk for two quick preview cycles or
  a second card's "Use Template". The component now consumes the queued event of its own close, so a
  user close (Escape, backdrop, close button) is still reported to the owner and the programmatic
  close behind it is not reported twice. Ten other dialogs share this primitive; their journeys were
  re-run below.
- **`src/routes/+error.svelte`** — the milestone copy now lists `/templates` among the pages that
  work and names My Stickers (not Templates) as a later slice.
- **`README.md`** — the same correction, plus a catalog bullet under "What works today".

No change was needed in `TemplateCard.svelte`, `TemplateRail.svelte`, `AppShell.svelte`,
`src/lib/editor/templates.ts`, `src/lib/editor/toolIntent.ts` or
`src/lib/persistence/repository.ts`: the rail/card, the catalog/clone/favorite module
(`templateData`, `instantiateTemplate`, `cloneTemplateDocument`, `getFavoriteTemplateIds`,
`toggleFavoriteTemplateId`) and `saveProjectWithAssets` already implemented the source contracts, and
this slice's tests now exercise them end to end. `toolIntent.ts`'s `APP_LOCAL_ROUTES` already
recognised `templates`, and the native `<dialog>` still provides what Radix's `onCloseAutoFocus` +
opener ref did for preview focus restoration (the modal change above is the close-event race).

### Regressions added

| Test                                                                                                                                                                                                              | What it locks down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/app/shell-href.test.ts` (new, node; **fails pre-fix**)                                                                                                                                                   | With `$app/paths` mocked, `/templates` must resolve through `resolve()` (`/RESOLVED/templates`) while `/my-stickers` keeps the base prefix. Pre-fix: `expected '/stickerlab/templates' to be '/RESOLVED/templates'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/lib/editor/templates.test.ts` (new, node; the source `templates.test.ts` ported, +1 contract)                                                                                                                | Nested layer isolation on clone; twelve distinct layouts with independent photo/decoration layers and asset sources; clone independence with atomic `saveProjectWithAssets` (an injected write failure leaves no rows, the retry succeeds) and `templateData` unchanged; plus every category being one of the ten source categories, a real non-trivial `/art/templates/sample-N.png` preview per template, and every caption font being in `BUNDLED_FONTS`.                                                                                                                                                                                                                                                                          |
| `src/routes/templates/templates-catalog.svelte.test.ts` (new, browser; **fails pre-fix: the component did not exist**)                                                                                            | Pills/search/count copy/preview `src`s and the three rails; `q` filtering from the `query` prop with `onquery` reporting typing; category reset on every query change including the revert case; the honest empty state + `Reset filters`; the favorite heart synced across rails and persisted in `stickerlab_fav_templates`; the preview dialog's own accessible name/description; and "Use Template" twice — new document/layer/asset ids, real blob bytes, catalog entry untouched.                                                                                                                                                                                                                                               |
| `src/lib/components/modal-cycle.svelte.test.ts` (new, browser; **both cases fail pre-fix — `expected [ 'close' ] to deeply equal []` and `expected [ 'close', 'close' ] to deeply equal [ 'close' ]`, 3/3 runs**) | The shared dialog primitive: a programmatic close that is re-opened in the same tick must not be reported to the owner (the late `close` event is consumed), while a user close is still reported exactly once and the programmatic close behind it is not reported twice. This is the deterministic regression for the intermittent catalog failure seen before the fix (1 in 8 browser runs, plus one full-suite run).                                                                                                                                                                                                                                                                                                              |
| `e2e/editor.spec.ts` → "browses the template catalog, clones an editable copy and reopens it locally" (**fails pre-fix: `/templates` rendered the milestone page**)                                               | Dashboard Templates card → `/templates`; `12 editable templates` and 12 preview cards; `q` in the URL, filtered rails and the filtered view surviving a reload; pill reset on query change; empty state + Reset; favorite persisted across a reload; preview dialog accessible name/description plus Escape focus restoration to the opener; "Use Template" → editor with `Orbit Pop Copy`, 6 layers / 5 assets whose stored bytes carry real PNG/WEBP signatures and `bundled-asset:/art/…` provenance, `document.fonts.check('16px "Bangers"')` true, an edited title plus a nudged layer saved and reopened after reload, and a second clone sharing no layer or asset id with the first while the catalog still renders 12 cards. |
| `e2e/editor.spec.ts` → "keeps the catalog searchable, previewable and honest at tablet and phone widths"                                                                                                          | 1024×768 and 390×844: filters readable, search filtering, pill staying on All Templates, preview dialog reachable with both actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `e2e/editor.spec.ts` → "the routes that are still later slices explain themselves honestly" (repurposed)                                                                                                          | The honest milestone page is now asserted through `/my-stickers`, which still has no route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Checks run in this checkpoint

All commands ran from `/home/vdc/Projects/Peeloodle-Svelte` with the installed browser (logs bounded
under `/tmp/peeloodle-templates-logs/`).

| Command                      | Result                                                    |
| ---------------------------- | --------------------------------------------------------- |
| `npm run check`              | `svelte-check found 0 errors and 0 warnings`              |
| `npm run lint`               | exit 0 — Prettier clean, no ESLint findings               |
| `npm run build`              | exit 0                                                    |
| `npm run test:unit -- --run` | 17 files, **141 tests passed** (was 13 files / 125 tests) |
| `npx playwright test`        | **12 journeys passed** (was 10); no `playwright install`  |

Direct Svelte MCP calls (no CLI transport): both skills loaded, `list-sections`, targeted
`get-documentation` (`$app/state`, `$app/navigation`, shallow routing, `$derived`, `$effect`,
testing, `{#each}`), and `svelte-autofixer` (Svelte 5) on the full current `TemplatesPage.svelte`,
`src/routes/templates/+page.svelte`, the changed `Modal.svelte`, `+error.svelte` and
`DashboardPage.svelte` → **0 issues** each. The remaining suggestions are the non-actionable class
already recorded for this project: "stateful variable assigned inside an `$effect`" on
`TemplatesPage.svelte` (the documented URL/state synchronisation case; the derived alternative is
rejected by a test), plus the DOM-call/`bind:this` notes on `Modal.svelte`'s dialog effect.

### Residuals

- `/my-stickers` still has no route, so the dashboard/header/sidebar links to it land on the honest
  milestone page and `shellHref` keeps its `base`-prefix branch for that one target.
- Favorites are stored only in `stickerlab_fav_templates`. The source's other consumers
  (`features/search/GlobalSearch.tsx`, `features/packs/PacksPage.tsx`) belong to later slices —
  packs are explicitly out of scope here — and were not ported.
- Each rail reads the favorite ids when it mounts, so an SSR render cannot know the localStorage
  value and converges on hydration (the same behaviour the dashboard rail already had). No hydration
  mismatch was observed in the browser journeys.
- Preview PNGs are the source's own generated `/art/templates/sample-N.png` assets; the cloned
  composition's pixels were not compared against a live React rendering of the source, and the
  clone's caption font is asserted through `document.fonts.check` plus the persisted
  `fontFamily`/`BUNDLED_FONTS` contract, not through glyph comparison.
- Packs, masks/restore, presentations and cloud/Supabase remain unimplemented.
- The dialog close-event race is fixed in the shared primitive and pinned by a deterministic test;
  the other `<dialog>` call sites were exercised by the re-run unit and browser journeys, but no
  test enumerates every dialog's close-cycle behaviour individually.

## P2 fix — Sidebar base-prefixed route recognition (2026-09-14)

Scope: the single P2 of the independent verification
(`/home/vdc/.pi/agent/sessions/--home-vdc-Projects--/subagent-artifacts/outputs/5ff54f96-5060-4a0e-a183-f5340c3a3ef1/fixes/final-slice-verification.md`).
No other finding, no later-slice feature, no asset-hosting or build/deployment change.

**Defect.** The production routes forward the raw `page.url.pathname` (configured base included) into
`Sidebar`, while `toolIntentPath()` / `shouldReuseCurrentToolRoute()` and the sidebar `active` checks
expect an app-local pathname. Under a configured `kit.paths.base`, an open editor supplied
`/stickerlab/editor/<id>`, so every tool link became `/stickerlab/create?tool=…`, no tool looked
current, and a repeated same-tool click navigated instead of re-opening the current document.

**Fix — one boundary.** `appLocalPathname(pathname, configuredBase = base)` in
`src/lib/editor/toolIntent.ts` strips the configured base only on an exact match (`/base` → `/`) or a
base followed by `/` (`/base/editor/1` → `/editor/1`) — never a substring or partial-segment match —
and returns already app-local inputs unchanged. A base that itself looks like a route (`/editor`,
`/create`) therefore cannot double-strip: the remainder must still be a route this shell knows,
otherwise the input is read as app-local, which also makes the boundary safe to apply twice.
`Sidebar.svelte` derives `appPathname` once and uses it for the tool hrefs, the tool `active` state,
the reuse decision and the navigation `active` checks (so the Dashboard / Create Sticker entries are
correct under a base too); the module documents app-local pathnames as the contract for every other
helper, and `toolIntentHref()` puts the base back through `resolve()`.

**Regressions added (`$app/paths` mocked with base `/stickerlab`); the two rendering cases were
reproduced failing before the fix:**

- `src/lib/app/base-links.svelte.test.ts` → "keeps the current document id and re-opens the same tool
  for a base-prefixed editor URL": renders `Sidebar` with the raw production input
  `pathname: '/stickerlab/editor/sticker-1'`, `search: '?tool=text'` and asserts all four hrefs keep
  the saved id **and** the intent query, the Text link is `aria-current`, a same-tool click cancels
  the navigation, closes the drawer and re-dispatches through `requestToolIntent()`, Ctrl/Cmd-clicks
  stay uncancelled with no intent, and another tool still follows its real URL. Pre-fix result:
  expected `/stickerlab/editor/sticker-1?tool=…`, received `/stickerlab/create?tool=…`.
- same file → "reads the base root as the dashboard and the base-prefixed create/editor routes as
  active": `/stickerlab` (Dashboard current, no tool current), `/stickerlab/create` (Create Sticker
  current) and an already app-local `/editor/sticker-1`. Pre-fix the Create Sticker entry was not
  active.
- same file → "appLocalPathname boundary" unit cases: the root/default base `''` and already
  app-local inputs are returned untouched; only an exact base or base + `/` is stripped;
  `/stickerlabs/editor/1` and `/stickerlab-extra/editor/1` are **not** stripped (segment-prefix
  collision); bases `/editor` and `/create` strip exactly once and a repeated application is a no-op.
  Documented ambiguity: a pathname exactly equal to the base is always read as the raw base-root URL
  (`/base` → `/`).

**Checks after the fix:** `npm run check` 0 errors / 0 warnings; `npm run lint` clean; `npm run build`
exit 0; `npm run test:unit -- --run` **13 files / 125 tests passed** (was 119); the focused
`toolIntent` + `app-shell` + `base-links` + `editor-flow` run **4 files / 27 tests passed** (was 21);
`npx playwright test e2e/editor.spec.ts --grep "carries every sidebar tool intent"` 1 passed against
the production build. Direct Svelte MCP calls (no CLI transport): both skills loaded, `list-sections`,
targeted `get-documentation` (`$app/paths`, `$app/state`, `$derived`, `testing`) and
`svelte-autofixer` on the full changed `Sidebar.svelte` → 0 issues, 0 suggestions.

**Residual (same class, different surface, outside this P2):** `Header.svelte` still receives the raw
pathname from `AppShell`, so its `primaryNavigation` active checks remain base-blind; and the shell's
`<img src="/art/…">` paths stay root-relative as recorded further below.

## Fix checkpoint — Sidebar tool intents, dialog shortcut guard, 512/1024 export proof (2026-09-14)

Scope: the five findings of the first-slice re-review
(`/home/vdc/.pi/agent/sessions/--home-vdc-Projects--/subagent-artifacts/outputs/979f4c2e-6e5d-486c-a736-18949fe94e4d/fixes/first-slice-rereview.md`).
No later-slice feature, no new route, no coordinator redesign.

### Changes

1. **Sidebar tool links keep the base prefix _and_ the intent query.** `toolIntentHref()`
   (`src/lib/editor/toolIntent.ts`) now resolves the tool pathname through `$app/paths` `resolve()`
   and appends `?tool=<intent>`; `Sidebar.svelte` renders that href for all four tools. An unmodified
   primary click that already sits on the same tool route calls `preventDefault()` and re-opens the
   chrome through the intent listener (and dismisses the mobile drawer); modifier and non-primary
   clicks are left to the browser so a Ctrl/Cmd-click still opens a real new tab. Previously the href
   was `resolve(toolIntentPath(pathname))` with no query, so every tool link became a plain editor
   navigation and clicking the already-active tool stripped `?tool=` again.
2. **Editor shortcuts stand down behind dialogs and controls.** `EditorWorkspace.svelte` skips
   Delete/Backspace, Ctrl/Cmd+D/Z/Y and arrow nudges when the event target is inside an open
   `<dialog>` subtree or is an interactive control (input/textarea/select/button/link/summary/
   contenteditable plus slider, textbox, checkbox, radio, switch, tab, menuitem, option and dialog
   roles). A native modal has an _implicit_ dialog role, so the earlier `[role="dialog"]` selector
   never matched `Modal.svelte`'s `<dialog>` element or its buttons.
3. **512 and 1024 exports are both byte-inspected.** The primary E2E journey exports the same
   document at both advertised caps and checks the PNG signature, IHDR bit depth/dimensions/colour
   type 6, longest edge equal to the requested cap, transparent outer corner, opaque centre,
   non-trivial coverage, the size-suffixed filename and cross-size aspect preservation.
4. **A→B in-place route-parameter transition has component coverage.**
   `src/routes/editor/editor-flow.svelte.test.ts` changes `projectId` in place while A is dirty and
   asserts, with a repository that logs operation order, that the latest A revision is written
   _before_ B is read. A persistent-write-failure variant asserts the blocked flush stays on A, keeps
   the dirty draft visible and unresolved, survives a further failed retry, and saves that same
   draft once storage recovers. No lifecycle defect was reproduced by these tests; the coordinator
   was not changed.
5. **Recovery banner copy** now reads "closing or reloading loses them", matching the working
   _Reopen the unsaved draft_ action beside it.

### Regressions added (the marked ones fail against the pre-fix code)

- `src/routes/app-shell.svelte.test.ts` — sidebar tool hrefs on the dashboard and inside an editor;
  click from the dashboard and from an intent-less editor follows the intent URL without cancelling
  the click; same-intent click cancels the navigation, re-opens the chrome and calls `onnavigate`
  (drawer close); Ctrl-click is left untouched.
- `src/lib/app/base-links.svelte.test.ts` — sidebar-scoped base-path assertion. The dashboard
  feature cards carry the same `?tool=` URLs, which is exactly what masked the missing sidebar query
  in the earlier global check.
- `src/routes/editor/editor-flow.svelte.test.ts` — dialog-focus shortcut guard (**fails pre-fix:**
  `expected 3 to be 1` revisions after five keys); A→B flush ordering; A→B persistent-failure
  retention; normal editor keys still edit after the dialog closes.
- `e2e/editor.spec.ts` — sidebar journey dashboard → editor → repeat click → Ctrl-click new tab
  (**fails pre-fix:** the dashboard click lands on `/editor/<id>` with no `?tool=`); destructive
  keyboard while a dialog has focus then handed back after close; 512/1024 export inspection in the
  primary journey.

### Checks run in this checkpoint

All commands were run from `/home/vdc/Projects/Peeloodle-Svelte` with the installed browser; console
output was bounded to logs under `/tmp/peeloodle-slice-logs/`.

- `npm run check` — **0 errors, 0 warnings**.
- `npm run lint` (`prettier --check . && eslint .`) — clean.
- `npm run build` — production build succeeded (also exercised by the Playwright web server).
- `npm run test:unit -- --run` — **13 files, 119 tests passed** (client + server projects).
- `npx playwright test` — **10/10 journeys passed** against the production build, including the
  primary journey (now inspecting 512 **and** 1024 downloads), the sidebar-intent journey and the
  dialog-shortcut journey.
- Pre-fix runs of the two new regressions fail as quoted above
  (`/tmp/peeloodle-slice-logs/unit-dialog-prefix2.log`,
  `/tmp/peeloodle-slice-logs/e2e-prefix-sidebar.log`); both fixtures were restored to the fixed state
  before the final runs.

### Changed files in this checkpoint

`src/lib/editor/toolIntent.ts`, `src/lib/components/Sidebar.svelte`,
`src/lib/components/EditorWorkspace.svelte`, `src/routes/+layout.svelte`,
`src/routes/app-shell.svelte.test.ts`, `src/lib/app/base-links.svelte.test.ts`,
`src/routes/editor/editor-flow.svelte.test.ts`, `e2e/editor.spec.ts`, this document. No other file was
modified, and nothing was staged, committed, pushed, published or deployed (the target is unversioned).

## Fix checkpoint — availability copy, dialog ids, canvas Space and base-aware links (2026-09-14)

Scope: the remaining review findings of `implementation/independent-sticker-review.md` that the two
earlier fix sessions left open — truthful Erase/Restore status (P1), per-instance dialog names and
canvas Space handling (P2 accessibility), base-path-safe internal links (P2) — plus the two focused
documentation follow-ups (README, asset provenance). No brush implementation, no later route, no
cloud work.

### Changes

- **Truthful availability.** `src/lib/editor/toolIntent.ts` owns the shared deferred copy
  (`DEFERRED_TOOL_MARKER`, `DEFERRED_TOOL_NOTE`, `isDeferredToolIntent`), used by the dashboard
  feature card, the sidebar tool list and the editor tool rail (Erase and Restore). The inspector,
  the erase empty state and the replace-photo title no longer imply that a brush exists; the tool
  still activates its chrome, as `toolIntent.test.ts` requires.
- **Per-instance dialog ids.** `Modal.svelte` derives its title/description ids from `$props.id()`,
  so navigation, walkthrough, export, delete and properties dialogs can no longer label themselves
  with another dialog's heading.
- **Canvas Space.** `KonvaArtboard.svelte` stands down while a `dialog[open]` exists and for
  interactive targets (`input, textarea, select, button, a[href], summary, [contenteditable=true],
[role=slider|dialog|button|link]`), so Space activates a focused dialog button instead of entering
  canvas pan mode.
- **Base-aware internal links.** `src/lib/app/navigation.js` now owns `shellHref()`: implemented
  routes go through `resolve()` from `$app/paths` (including `?search`/`#hash` targets such as
  `/create?tool=erase`), and Header, Sidebar, DashboardPage, LocalProjectList, TemplateRail and
  `+error` render through it. The `onnavigate` → `goto` seams in `/`, `/create` and `/editor/[id]`
  resolve the app-relative href they are handed; `toolIntentPath()`/`editorPathWithIntent()` expose
  the literal route shape that typed `resolve()` requires. Route checks (`item.active(...)`,
  `inEditor(...)`, `shouldReuseCurrentToolRoute`) run on app-local pathnames: the raw base-prefixed
  `page.url.pathname` the production routes forward was only normalized later, in the Sidebar
  boundary recorded in the P2 fix checkpoint above.
- **Documentation.** `README.md` now describes this app (scripts, implemented slice, explicitly
  deferred eraser and later routes, local-first data) instead of the `sv` library scaffold with
  `npm pack` / `npm publish`; `docs/assets-provenance.md` re-points served paths to `static/`,
  replaces the React code path with `src/lib/editor/templates.ts`, and marks source-only records
  (`docs/design/…`, `proofs/…`, `scripts/…`, `design/…`) and unported surfaces as such.

### Ruling recorded: links to routes that do not exist yet

Typed routes are enabled here (SvelteKit generates `.svelte-kit/types/index.d.ts`), so `resolve()`
only accepts pathnames/route IDs for routes that exist. `/templates` and `/my-stickers` have no
route file in this slice, so `resolve('/templates')` and `resolve('/my-stickers#local-stickers')` are
type errors. Per the parent ruling, these two existing unported destinations (dashboard Templates
card, both "View all" links, the header/sidebar entries) prefix the still-exported `base` string
inside `shellHref()` — the documented subdirectory-hosting pattern — with no `as any`/`@ts-expect-error`
cast and no invented route files. When those routes land, those two branches move to `resolve()`.
Everything else uses `resolve()`. The decision is commented once, in `navigation.js`.

### Regressions added (each fails against the pre-fix code)

| Test                                                                                                                          | Pre-fix result                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/app-shell.svelte.test.ts` → "gives every mounted dialog its own accessible name and description"                  | 1 failed: 7 mounted dialogs all reported `aria-labelledby="dialog-title"` (set size 1 vs 7)                                                    |
| `src/lib/components/canvas-space.svelte.test.ts` → "pans for the canvas but leaves Space to dialogs and interactive controls" | 1 failed: Space on a plain button was `defaultPrevented` and entered pan mode                                                                  |
| `src/lib/app/base-links.svelte.test.ts` → "prefixes every app-owned anchor…" (`$app/paths` mocked with `base: '/stickerlab'`) | 1 failed: five dashboard feature hrefs stayed `/create?tool=…`, `/templates`                                                                   |
| `src/lib/app/internalLinks.test.ts` → static guard over `src/lib/components` + `src/routes`                                   | 1 failed: `TemplateRail.svelte: href="/templates"`                                                                                             |
| `src/routes/app-shell.svelte.test.ts` → "says the background eraser is not available yet…"                                    | 1 failed: the card still promised "Brush away the background"                                                                                  |
| `e2e/editor.spec.ts` → "names the open dialog, keeps Space with its controls and restores focus"                              | covered by the unit regressions above; kept as the real-browser journey (dialog name, Space activation, focus restoration, canvas pan control) |

### Checks run after the fix

| Command                                  | Result                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run check`                          | `svelte-check found 0 errors and 0 warnings`                                                   |
| `npm run lint`                           | exit 0 — Prettier clean, no ESLint findings                                                    |
| `npm run build`                          | exit 0                                                                                         |
| `npm run test:unit -- --run`             | 13 files, **113 tests passed** (was 10 files / 101)                                            |
| `npx playwright test e2e/editor.spec.ts` | **8 tests passed** (was 7) against `npm run build && npm run preview`, installed Chromium only |

### Paraglide warning

The review's fresh `npm run check` had reported one warning
(`src/lib/paraglide/messages/hello_world.d.ts` missing). The baseline `npm run check` at the start of
this checkpoint — and every run afterwards — reports **0 errors and 0 warnings**: the declaration set
is regenerated by the Paraglide Vite plugin, so the warning was a stale generated state rather than a
code defect. No generated tooling was changed.

### Residuals

- Image `src="/art/…"` paths in the shell are still root-relative and are not base-path safe; this
  checkpoint scoped itself to internal `<a href>` targets (the review's P2 finding).
- `shellHref()`'s `base` branch is the temporary compatibility measure described above.
- The properties dialog is only reachable at narrow widths in the current layout, so the browser
  journey for dialog naming uses the dashboard walkthrough and the editor export dialog; the unit
  regression covers all seven simultaneously mounted dialogs.

## Recovery checkpoint — save/navigation lifecycle (2026-09-14, recovery session)

Scope: finish the interrupted save-navigation fix only (dirty/failed drafts and reload protection
must survive leaving the editor for Home, queued writes must never be silently cancelled or the
draft replaced, and the happy path — safe flush + reopen from the recent card — must keep working).
No other migration work was touched.

State found at the start of this session (reproduced before changing anything):

- `src/routes/editor/editor-flow.svelte.test.ts` → "uploads, edits by gesture, saves, reopens …"
  failed: `Timed out waiting for the saved document`. The repository held **revision 4 / "Untitled
  Sticker"** while the editor showed **revision 6 / "Slice sticker"**; the write log was
  `1,2,3,6,6,4` — a superseded revision was written _after_ the newer save and clobbered it.
- `e2e/editor.spec.ts` → "protects a failed draft after Back to Home and reopens it from memory"
  failed: after Home with a failing write, no recovery banner appeared at all.

Two independent root causes, both in the lifecycle wiring (no UI/href/modal/eraser change):

1. **Stale departure capture.** `EditorWorkspace.svelte`'s load/replace effect read
   `editor.document?.id` and called `saving.flush(...)`, so it re-ran on _every_ edit and its
   teardown captured state from the effect's previous run (verified with a throwaway browser-mode
   experiment: an `$effect` teardown read `$state.raw` as of the run being torn down —
   `run:0, teardown:0, run:1, …`; a `queueMicrotask` read inside the same teardown was fresh). Each
   re-run therefore queued a write of an older revision. Fixed by making the effect depend only on
   the route's `projectId`/`repository` (`untrack` for the "already open?" reads and for the flush),
   and by deferring the departure flush out of the teardown (`queueMicrotask`) so it captures the
   live revision when the route replaces its document.
2. **The recovery banner could not re-render.** `+layout.svelte` derives the banner from
   `saving.recoveryDraft()`, but the coordinator's "editor route attached" flag was a plain local:
   the flag flips _after_ the failed departure write, so the layout's `$derived` kept its stale
   `null`. The flag is now mirrored into the reactive `EditorState.editorAttached` (read only by
   `hasUnprotectedWork()`/`recoveryDraft()`), while the coordinator keeps a non-reactive internal
   gate for autosave scheduling — reading the reactive field from `attach()`/`detach()` inside the
   autosave effect (which both writes and reads it) produced an infinite effect loop (1004 derived
   evaluations) before that split.

Changed files: `src/lib/components/EditorWorkspace.svelte`,
`src/lib/editor/editorState.svelte.ts`, `src/lib/editor/draftSaving.ts`,
`src/routes/editor/editor-flow.svelte.test.ts` (added the departure-flush regression test; removed
leftover temporary diagnostics), `e2e/editor.spec.ts` (comment/format only — the two navigation
journeys themselves are unchanged), `docs/migration-progress.md`.

| Command                                  | Result                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `npx vitest --run` (all unit/component)  | 10 files, **101 tests passed**                                                         |
| `npx playwright test e2e/editor.spec.ts` | **7 tests passed** (all previously green journeys + both new save/navigation journeys) |
| `npm run check`                          | `svelte-check found 0 errors and 0 warnings`                                           |
| `npx prettier --check .`                 | clean                                                                                  |
| `npx eslint .`                           | exit 0                                                                                 |
| `npm run build`                          | exit 0                                                                                 |

Post-fix behaviour held by tests: leaving the editor for Home flushes the latest revision and the
unload guard stands down ("leaves for the dashboard after a safe flush and reopens the sticker from
the recent card"); a write that keeps failing leaves the draft + banner intact, guards reload with
`beforeunload`, reopens from memory without replacing it, and saves it once storage recovers ("protects
a failed draft after Back to Home and reopens it from memory", plus the new unit test "writes the
latest revision when the editor route departs").

Residual risks (not verified here): the `queueMicrotask` departure flush is exercised by the unit
departure test and the two navigation journeys, but a _route-to-route_ replacement
(`/editor/A` → `/editor/B` while A is dirty) is not covered by an automated test; and the
Svelte 5 teardown read behaviour above was established empirically on this Svelte version
(5.56), so a future Svelte upgrade should re-run the replacement/departure tests.

## Checks run in this checkpoint

All commands were run from `/home/vdc/Projects/Peeloodle-Svelte` on 2026-09-14 (logs kept under
`/tmp/peeloodle-ckpt/`).

| Command                      | Result                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run check`              | `svelte-check found 0 errors and 0 warnings`                     |
| `npm run build`              | exit 0, production build completes                               |
| `npm run lint`               | exit 0 — Prettier clean, no ESLint findings                      |
| `npm run test:unit -- --run` | 10 test files passed, 96 tests passed (client + server projects) |
| `npx playwright test`        | 3 tests passed, no browser install (bundled Chromium 1243)       |

Playwright used the **installed** browser only
(`/home/vdc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`); `playwright install` was
deliberately **not** run. The Playwright web server builds and serves the production output
(`npm run build && npm run preview`, port 4173), so all three journeys exercise the real build.

### Unit / component test files (10 files, 96 tests)

- `src/lib/assets/validateUpload.test.ts`
- `src/lib/editor/editorState.test.ts`
- `src/lib/editor/draftSaving.test.ts`
- `src/lib/editor/maskUtils.test.ts`
- `src/lib/editor/projectThumbnails.test.ts`
- `src/lib/editor/toolIntent.test.ts`
- `src/lib/exports/renderDocument.test.ts`
- `src/lib/persistence/repository.test.ts`
- `src/routes/app-shell.svelte.test.ts` (browser project)
- `src/routes/editor/editor-flow.svelte.test.ts` (browser project)

### Playwright journeys (5, `e2e/editor.spec.ts`)

1. `dashboard → create → upload → edit → save → reload → reopen → export PNG` — drives the real
   Konva canvas drag, verifies the persisted IndexedDB document/asset rows, reloads, and inspects
   the downloaded PNG bytes (signature, IHDR dimensions, colour type 6 = RGBA, transparent corner,
   opaque centre) plus the export dialog status copy.
2. `the unavailable later-slice routes explain themselves honestly` — `/templates` renders the
   milestone message and a working dashboard link instead of a dead control.
3. `keeps filters and outlines on the live Konva raster in agreement with export and reload` — the
   P1 regression added below: real-browser Konva pixels are measured from the live layer canvas and
   from the downloaded PNG after a grayscale filter and an outline, before and after reload.
4. `re-points the live raster after replacing a photo and keeps Transformer undo boundaries` — the
   P1 regression for replacement/undo (the layer id is stable, so the node is reused) plus real
   Transformer corner-scale and rotater gestures, each with one undo/redo boundary.
5. `keeps save and export reachable at desktop, tablet and phone widths` — 1440×900, 1024×768 and
   390×844, including the mobile navigation dialog.

## P1 fix — reused Konva image nodes (2026-09-14)

Independent review (`implementation/independent-sticker-review.md`) blocked the slice because
`KonvaArtboard.svelte` reused an existing `Konva.Image` without ever assigning the recomputed raster.
Scope of this step: that one P1 only (no lifecycle, eraser copy, dialog-id, base-path or later-slice
work).

**Change** — `src/lib/components/KonvaArtboard.svelte` `ensureNode()`: a reused image node now
re-points `image`, `width`, `height`, `offsetX` and `offsetY` whenever the cached appearance surface
or the outline padding changes, mirroring what React-Konva did with `processedImage`/size/offsets.
Transforms, opacity, drag/transform handlers and source compositing order are untouched, and the
`surfaces` cache still keys crop → mask → filters → outline.

**Regression first, then fix.** Both new journeys failed against the unfixed component (same test
file, same commands):

| State    | Command                                                                                    | Result                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-fix  | `npx playwright test e2e/editor.spec.ts --grep "keeps filters\|re-points the live raster"` | 2 failed: preview spread 197 after grayscale (stale red raster); preview stayed green after undoing a replacement while the exported PNG was red |
| Post-fix | same command                                                                               | 2 passed                                                                                                                                         |

**Checks run after the fix** (logs in `/tmp/peeloodle-konva-fix/`):

| Command                                                                                                    | Result                                                    |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run check`                                                                                            | `svelte-check found 0 errors and 0 warnings`              |
| `npm run lint`                                                                                             | exit 0 — Prettier clean, no ESLint findings               |
| `npm run test:unit -- --run`                                                                               | 10 files, 96 tests passed                                 |
| `npx playwright test e2e/editor.spec.ts`                                                                   | 5 tests passed against `npm run build && npm run preview` |
| `npx playwright test e2e/editor.spec.ts --grep "keeps filters\|re-points the live raster" --repeat-each=3` | 6 tests passed (no flakes across repeats)                 |

Svelte MCP (direct tool calls, not CLI transport): `list-sections`, targeted `get-documentation`
(`$effect`, `$state`, `testing`), and `svelte-autofixer` on the changed
`src/lib/components/KonvaArtboard.svelte` → **0 issues**; only the pre-existing non-actionable
"function called inside `$effect`" / `bind:this` suggestions remain.

**Evidence detail.** The journeys measure pixels twice: from the live Konva layer canvas (with the
selection cleared, waiting for Konva's `requestAnimationFrame` repaint) and from the downloaded PNG,
using one reducer for both. Filter/outline: grayscale channel spread < 12, outline white pixels
present, preview vs PNG aspect and mean colour agreement, and the same after reload. Replacement:
preview follows the document through replace → undo → redo, and preview/export/reload agree. The
Transformer rotater anchor is located from the topmost drawn pixels, so a real rotate gesture plus
its undo/redo boundary is verified (45° turn restored and reapplied once per gesture).

**Residual risks found while writing the regression (not fixed in this step):**

- Replacing a photo still destroys and recreates the node while the new asset decodes, because
  `ensureSurface()` returns nothing until `htmlImages` has the new asset; the preview drops the
  artwork for a frame. Forward replacement therefore already looked correct before this fix; the
  reuse defect is what `replace → undo` (same asset id again) exposes.
- `ensureSurface()`'s cache signature covers `maskKey` but not the decoded mask image identity, so a
  mask blob replaced under the same key would reuse a stale surface. No current command does that
  (`applyMask` stores a new key per stroke), but it is worth a guard when the mask slice lands.

## Implemented surface (file inventory)

### Routes and shell

- `src/routes/+layout.svelte` — global CSS, plus app-scoped repository, `EditorState` and draft
  saving coordinator created once per app tree and shared through `$lib/app/context` (no
  server-global mutable state).
- `src/routes/+page.svelte`, `src/lib/components/DashboardPage.svelte` — dashboard (hero, feature
  cards, recent local projects, template rail, walkthrough dialog).
- `src/routes/create/+page.svelte`, `src/lib/components/CreateRedirect.svelte` — flush-then-create
  semantics, reusing a reusable open draft instead of stacking new ones.
- `src/routes/editor/[projectId]/+page.svelte`, `src/lib/components/EditorWorkspace.svelte` —
  load/replace guard (blocked flush keeps the current draft), autosave, keyboard shortcuts (Space
  stands down inside dialogs and on interactive controls), fullscreen, properties modal. Unload
  protection (`pagehide` flush, `beforeunload` warning) moved to the root layout so it outlives the
  route.
- `src/routes/+error.svelte` — honest "not part of the current milestone" fallback for the routes
  that do not exist yet.
- Shell components: `AppShell.svelte`, `Header.svelte`, `Sidebar.svelte`, `Modal.svelte`,
  `Hero.svelte`, `StickerCollage.svelte`, `LocalProjectList.svelte`, `TemplateRail.svelte`,
  `TemplateCard.svelte`, `TemplatesPage.svelte`, `ProjectThumb.svelte`, `Slider.svelte`,
  `ColorField.svelte`.

### Editor UI

- `EditorCanvas.svelte` — client-only canvas seam: `KonvaArtboard.svelte` (Konva) on the client,
  `DomCanvas.svelte` (deterministic DOM artboard, same document state) in unit tests.
- `EditorInspector.svelte` — Adjust / Effects / Position / Layers panels: replace photo, filters,
  outline, opacity, flip, rotate, layer order/visibility/lock/rename/duplicate/delete, text styles,
  mask brush size.
- `AssetTray.svelte` — uploads, bundled stickers, illustrations, template photos, editable text
  presets. `ExportDialog.svelte` — 512/1024 transparent PNG with artwork-bounds cropping and honest
  status copy.

### Framework-free modules

- `src/lib/domain/domain.ts`, `src/lib/persistence/{document,idb,repository,order,syncTypes}.ts`,
  `src/lib/{blob,fonts,imageDecode,imageFormat,hash,utils}.ts`,
  `src/lib/assets/{assetLoader,validateUpload,illustrations,templatePhotos}.ts`,
  `src/lib/exports/{download,renderDocument,zipExport}.ts`, `src/lib/packs/packActions.ts` — the
  ordered pack ZIP writer (STORE-only, source algorithm) and the framework-free pack rules.
- `src/lib/editor/editorState.svelte.ts` — rune port of the React store: one history entry per
  completed gesture, revision bumps on committed edits, asset/mask pruning against everything
  history can reach, selection/zoom never dirtying the document, `markSaved(revision)` clearing only
  the revision actually persisted, mask-stroke registration/commit/abandon.
- `src/lib/editor/{draftSaving,editorStateHelpers,catalog,templates,toolIntent,projectThumbnails,maskStroke,maskUtils,removeProject}.ts`.

### Presentations (slice 3, increments 1–5)

- Model/persistence: `src/lib/presentations/model/*`, `src/lib/presentations/persistence/*` —
  versioned presentation documents, bounded media policy, revision-safe repository over the
  separate presentation stores in `stickerlab-local`.
- Rendering: `src/lib/presentations/rendering/*` — fonts, Konva text layout, decoded artwork and
  fixed-page rasterization shared by thumbnails, the PDF and the offline cache.
- Library: `src/lib/components/PresentationsPage.svelte`, `PresentationThumb.svelte`,
  `src/lib/presentations/library/*` — create/search/rename/duplicate/delete, lazy thumbnails and
  independent backup restore.
- Editor: `src/lib/components/presentation/*.svelte`, `src/lib/presentations/editor/*` — canvas,
  transform geometry, rich text, slides, layers, history, autosave/leave guard and conflict
  recovery.
- Exports/offline: `src/lib/presentations/exports/{snapshot,backup,pdf,pptx,loaders}.ts`,
  `src/lib/presentations/editor/exportController.ts`, `src/lib/presentations/offlineReadiness.ts`,
  `offlineModules.ts`, `presentationOffline.svelte.ts` — preflight, image PDF, editable PPTX,
  restorable ZIP backup, cancellation and route/module warm-up for offline use.
- Routes: `src/routes/presentations/+page.svelte` and
  `src/routes/presentations/[presentationId]/+page.svelte` (base-aware URL seams).

### Assets, config, i18n

- `static/` (117 files) carries the source art, fonts and samples under the same URL paths
  (`/art/...`, `/fonts/...`, `/samples/...`); Paraglide locale passthrough remains in
  `src/hooks.server.js`, with the scaffold Better Auth/Drizzle `handle` wiring removed (that wiring
  made production requests fail; the dependencies stay in `package.json` per plan).
- `vite.config.js` keeps the dual Vitest projects (browser `chromium` for `*.svelte.{test,spec}`,
  node for the rest) and forces runes mode for project files; `jsconfig.json` stays strict.

## Deliberately not implemented

This section records what was still absent at the earlier milestones it was written in; the
checkpoints above supersede any bullet that later work completed. Where a line below names a
finished increment (masks/restore, presentations, `/presentations/[presentationId]`), the newest
checkpoint is authoritative.

- **Later routes**: only `/auth/callback` has no route file; it lands on the honest `+error.svelte`
  page. `/presentations` and `/presentations/[presentationId]` became real routes in the slice 3
  checkpoints above. `/templates` and `/my-stickers` are real routes, so the temporary `base`-prefix
  branch in `shellHref()` is gone and every shell link is typed `resolve()` (see the `/my-stickers`
  checkpoint above).
- **Cloud / Supabase**: implemented in slice 4 — the optional browser integration is ported
  (`config`, `cloudRemote`, `cloud`, the rune workspace, the account dialog, the callback route and
  the shell status) and verified against a synthetic backend. Live Supabase/RLS/Storage verification
  is still unavailable (no dedicated accounts or deployed test project), so it was not attempted; no
  real project was contacted and nothing was deployed. Presentations stay local: the source has no
  presentation cloud tables.
- **Slice 2 remainder**: catalog administration only, deferred by the design. Masks/restore was
  listed here when this section was written but landed in the mask/restore checkpoint above: the
  Erase/Restore brush UI, one history entry per stroke, and mask parity in previews, PNG exports and
  pack ZIPs all exist and are green. Both library halves (templates + cloning, packs + ordered ZIP
  exports) landed in the two slice 2 checkpoints above. Packs are local-only: there is no cloud
  workspace, shared packs, cloud export history or pack sync — see the `/my-stickers` checkpoint's
  residuals.
- **Slice 3**: presentations are implemented through increment 6 — model, local storage, rendering,
  library, editor and PDF/PPTX/backup exports, plus every source journey either ported or recorded as
  superseded (see the newest checkpoint at the top). Slice 3 is complete as written; the only source
  item not ported is the P44 reader-fixture proof, which is source proof infrastructure rather than
  app behaviour. Nothing here claims slices 4–5.
- **Docs**: `README.md` and `docs/assets-provenance.md` were corrected in the truthful-UI
  checkpoint (app scripts and honest milestone status instead of the `sv` library scaffold;
  `static/` paths, the Svelte `src/lib/editor/templates.ts` path and source-only records marked as
  such).

## Svelte autofixer coverage

Every Svelte component (33: `AccountDialog.svelte`, `CloudBanner.svelte` and `AppScope.svelte`
added in the slice-4 checkpoint) and the rune modules (`editorState.svelte.ts`,
`workspace.svelte.ts`) has been analysed with the Svelte MCP `svelte-autofixer`. The slice-4
checkpoint ran it through **direct MCP tool calls** on the full new components (`AccountDialog`,
`CloudBanner`, `AppScope`, the callback page, the rewritten `+layout.svelte`, the workspace rune
module) and on the changed regions of `Header`, `AppShell`, `LocalProjectList`, `EditorWorkspace`,
`PacksPage`, `Modal` and `+error.svelte` → **0 issues** each; the remaining suggestions are the
documented non-actionable class (`bind:this` handles, subscriptions/IndexedDB reads in effects). The `/my-stickers` checkpoint re-ran it through **direct MCP tool calls** (not
CLI transport) on the full current `PacksPage.svelte`, `src/routes/my-stickers/+page.svelte`,
`TemplateCard.svelte` and `+error.svelte` → **0 issues** each; the comment-only `DashboardPage.svelte`
change was analysed as an equivalent snippet (a bare script fragment is not parseable standalone, the
one parse error that call returned was that transport artifact, not a finding). The `/templates`
checkpoint re-ran it on the full current `TemplatesPage.svelte`, `src/routes/templates/+page.svelte`,
`+error.svelte` and `DashboardPage.svelte` → **0 issues** each.
The truthful-UI / a11y / base-links checkpoint
re-ran it through **direct MCP tool calls** (not CLI transport) on every Svelte file it touched:

- Full current content: `Modal.svelte`, `Header.svelte`, `Sidebar.svelte`, `TemplateRail.svelte`,
  `LocalProjectList.svelte` (script plus changed template; the trailing unchanged delete-dialog
  block was not re-sent), `DashboardPage.svelte`, `+error.svelte`, `+page.svelte`,
  `create/+page.svelte`, `editor/[projectId]/+page.svelte` → **0 issues** each.
- Changed regions, verbatim (the rest of those files was already at 0 issues): the Space guard in
  `KonvaArtboard.svelte`, the tool-rail button block in `EditorWorkspace.svelte`, and the
  availability copy in `EditorInspector.svelte` → **0 issues** each.
- Earlier checkpoint: all 26 components plus `editorState.svelte.ts`; `EditorWorkspace.svelte`'s two
  `Unexpected href link without resolve()` issues were fixed there.
- **Fixed in this checkpoint**: `DashboardPage.svelte`'s four `Unexpected href link without resolve()`
  findings (lines 82, 105, 125, 138) are gone — every shell href now goes through `shellHref()`.
- Latest checkpoint (Sidebar tool intents / dialog shortcut guard): direct MCP `svelte-autofixer`
  calls (Svelte 5) on the full current `Sidebar.svelte`, the full current `EditorWorkspace.svelte`
  and the full current `+layout.svelte` → **0 issues and 0 suggestions** each. The autofixer cannot
  see either defect fixed here (a missing query parameter, and an implicit dialog role vs. a CSS
  selector); `check` and the focused tests above are the evidence for those.
- **Non-actionable suggestions** (present on most files, deliberately not churned): "You are calling
  a function inside an `$effect`" / "stateful variable assigned inside an `$effect`" for Konva, DOM,
  object-URL, storage-listener, `document.fullscreenElement`, file-input and lifecycle sync — effects
  are the documented escape hatch for exactly these cases, and the referenced functions/flags are
  verified not to be derived state; plus "consider replacing `bind:this` with an action or
  attachment" notes on element handles in `Modal`, `EditorWorkspace`, `AssetTray` and `DomCanvas`.

## Known limitations and unverified items

- **IndexedDB is origin-scoped.** The app uses the `stickerlab-local` database; the same database name
  does not transfer data between origins (dev server, preview on `:4173`, deployed origin). Local
  drafts are per-origin by design.
- **Local-only path verified; cloud path verified synthetically.** All checks above run without any
  credentials. The cloud journeys answer every auth/REST/Storage request in-process, which exercises
  the ported client end to end; they do not prove the deployed RLS policies, Storage rules or a real
  magic-link delivery. Live verification needs dedicated ordinary-user accounts and a deployed
  project.
- **Export artifact inspection** covers both advertised caps now: the primary Playwright journey
  downloads and byte-inspects a 512 px **and** a 1024 px PNG (signature, IHDR bit depth/colour type,
  dimensions equal to the cap, transparency, filename, cross-size aspect). The `renderDocument` unit
  tests still exercise 512 only; the 1024 path is proven by the downloaded artifact, not by a unit
  case.
- **Editor A→B replacement** (same route, new `projectId`) is covered at component level only, for
  both safe and persistently failing storage. The app has no in-app control that swaps project ids
  while the editor route stays mounted: leaving the editor unmounts it, and `/create` re-entry mounts
  it fresh — both covered by the browser journeys. The in-place parameter change was still tested
  because that is the path where the stale-revision clobber originally appeared.
- **Sidebar tool intents** now have component coverage (hrefs + click/preventDefault/modifier
  semantics) and a real-navigation browser journey for dashboard, intent-less editor, repeat click
  and Ctrl-click new tab. The sidebar itself is hidden by `layout.css` on every editor route, so the
  editor-side checks use the real mobile navigation drawer at an 800 px viewport; the desktop entry
  point is the tool rail. Base-prefixed pathnames are covered by the mocked-base component tests in
  `src/lib/app/base-links.svelte.test.ts` (raw `/stickerlab/editor/<id>` with `?tool=`); no
  **non-empty-base** browser run exists, because `vite.config.js` configures no `paths.base` and the
  Playwright server hosts at the root.
- **Viewports** were exercised at 1440×900, 1024×768 and 390×844 for save/export reachability and the
  mobile navigation dialog. Dialog accessible names, Space activation inside a dialog, focus
  restoration and the canvas Space-pan control now have unit and browser-journey coverage; a full
  keyboard-only audit of every control, and reduced-motion behaviour, still have none.
- `/create?tool=…` intents open existing editor chrome without inserting duplicate layers (covered by
  `toolIntent` tests and the editor flow test); a manual source-by-source parity diff of every tool
  intent was not part of this checkpoint. The Sidebar's own tool links and their click semantics now
  have component and browser coverage (see the latest checkpoint above).
- **Pack library is local-only and the ZIP is a browser download.** There is no cloud workspace,
  shared packs, cloud export history or pack sync; the ZIP is written by the app's own STORE-only
  writer (no `fflate`/`jszip` dependency exists in either app) and verified by parsing real downloaded
  bytes in the Playwright journey and by `zipExport.test.ts` in Node. The pack grid's thumbnails are
  real rendered previews in the browser but the placeholder copy in unit tests, so "cover artwork
  matches the sticker" is asserted structurally (project ids/order), not pixel-wise.
- **Editor `Replace photo` placement (recorded, not fixed).** The control lives in the image-layer
  card above the property tabs — the same place as upstream — so it is visible on every tab once an
  image layer is selected, and the template preview hint now says that instead of "Adjust → Replace
  photo". Moving the control into the Adjust panel is later editor work.

## Backup and recovery evidence

- Preserved pre-timeout snapshot: `/tmp/peeloodle-timeout-1A2Exn/target-state.tar.gz`, 29,226,303
  bytes, sha256 `61ef9032dfd1ab623b10f28c0e36c6c2bfe6527bd059f3446096a54de3a20406`, 281 entries,
  captured 18:10. It was **not** extracted over the working tree. A file-set comparison shows every
  `src/`, `e2e/` and `docs/` file in the snapshot is still present in the current tree; the only
  content change made in this checkpoint is the `resolve()` fix described above plus this document.
- Parent's check log: `/tmp/peeloodle-timeout-1A2Exn/check.log` (0 errors, 0 warnings); this
  checkpoint re-ran `npm run check` after its edit and got the same result.

## Suggested next steps (focused)

This section is a historical record from an early slice-2 checkpoint. The current forward plan is
the "Next steps (in order)" list in `CONTEXT.md`; the newest checkpoint at the top of this document
is authoritative for what is done.

1. Slice 2 remainder (masks/restore brushing with its pointer pipeline, catalog administration),
   then slices 3–5 as written in the design; do not claim any of them before they are implemented and
   independently reviewed. The two library halves and the last `base` branch in `shellHref()` are
   done.
2. When assets move behind a CDN or the app is served from a subdirectory, extend base-awareness to
   the shell's `<img src>` paths (`asset()` from `$app/paths`), which this checkpoint left untouched.
3. Port the Erase/Restore brush (`maskStroke` pointer pipeline) and, at that point, drop the
   "Coming later" copy and the deferred-tool constants.
