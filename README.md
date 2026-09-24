# Peeloodle / StickerLab — SvelteKit port

Local-first sticker editor, ported from the React application preserved in this repository at git tag
`react-final` (`git show react-final:src/...`; the port is `git diff react-final..main`). This is the
SvelteKit application: `/` dashboard → `/templates` → `/my-stickers` →
`/create` → `/editor/<projectId>`, plus the local `/presentations` library and its
`/presentations/<id>` editor (canvas editing plus PDF, editable-PPTX and backup exports), with
versioned documents, packs and asset blobs stored in IndexedDB.

Binding scope is `docs/superpowers/specs/2026-09-14-react-to-svelte-design.md`; current status,
checks and known limitations are recorded in `docs/migration-progress.md`.

## What works today

- Browse the **template catalog** (`/templates`): source categories and search (`?q=` lives in the
  URL), generated previews, localStorage favorites, a preview dialog, and "Use Template" copies
  that clone the composition into an independent editable sticker (its own document, layer and
  asset ids, real bundled artwork and caption fonts) saved locally before the editor opens.
- Organize saved stickers into **packs** (`/my-stickers`): the source hero and view pills
  (`?view=` lives in the URL), `?pack=<id>` deep links, search + Recent/Name sort, pack covers built
  from sticker thumbnails, add/reorder/remove membership, edit/duplicate/delete (deleting a pack
  keeps its stickers), and an ordered transparent PNG ZIP export (`manifest.json` plus
  `NN_title.png`, generation order = membership order). The same view shows the local sticker
  drawer (`#local-stickers`) and, when favorites exist, the Favorite Templates rail.
- Upload a PNG/JPEG/static-WebP photo through the validated upload path.
- Move, scale and rotate on the Konva artboard; undo/redo per completed gesture.
- Add and edit text layers, filters (brightness/contrast/saturation/grayscale), silhouette
  outline, flip/rotate, and layer order/visibility/lock/rename/duplicate/delete.
- **Erase / Restore brushing** on an image-local mask: brush size, Reset Mask, one undo entry per
  stroke, live preview, and the same mask in PNG exports and pack ZIPs. The original photo is never
  modified; automatic background removal is not available (there is no model/provider).
- Autosave plus explicit save into IndexedDB, reload, and reopen a saved sticker.
- Export a transparent PNG (512 or 1024 px) cropped to the artwork bounds.
- Manage local **presentations** (`/presentations`): create a blank 16:9 deck, search, rename,
  duplicate and delete; cards lazily render the stored first slide through the shared Konva
  renderer. Restore validates a bounded `.stickerlab.zip` backup and saves it as an independent
  deck with fresh IDs, without overwriting existing work.
- Edit a presentation (`/presentations/<id>`): select, drag, resize and rotate elements on the
  Konva canvas with zoom/pan and alignment guides; add shapes, photos and sticker snapshots; edit
  rich text (bold/italic/underline/strike, size, colour, alignment, lists, spacing) in place; pick
  a theme; reorder/hide/lock/duplicate/delete elements; add, duplicate, reorder and delete slides;
  undo/redo per gesture; autosave locally with a leave guard, and recover a revision conflict by
  keeping the local copy. A missing or unreadable deck gets an honest state instead of a crash.
  Insert theme-styled **headings, subheadings and body text**, or one of five offline **built-in
  layouts** (title, title + body, two columns, section header, image + caption) as a new slide
  after the current one — the layout dialog previews the real slides, insertion never replaces
  existing content, and a layout's image area takes a real photo in place through the same
  persist-first path as Add image. Text boxes can grow automatically with their content (the
  default for new presets and layouts), stay fixed with an explicit **Shrink text to fit** action,
  and keep legacy decks at their authored geometry until you choose otherwise.
  Export the deck as a 960×540 pt image-based PDF, an editable PPTX (native text runs, hyperlinks,
  bullets, preset shapes, cropped/flipped/rotated pictures) or a restorable `.stickerlab.zip`
  backup; the editor shows live progress, can cancel between slides, and reports preflight warnings.
  Once the presentation flow has been prepared, editing, saving and first-use exports keep working
  after the connection drops (no service worker: a page that never opened the flow, or a reload
  while offline, stays unsupported).
- **Optional private cloud** (off by default): when the site is configured with public Supabase
  values, the header's account button offers email-link sign-in (PKCE), a per-account private
  workspace, cloud-saved stickers and packs, explicit guest-import consent, retry after a
  disconnect, and conflict copies instead of overwriting another device's newer save. Local editing,
  saving and export keep working with no account and while offline; presentations stay local.
- **Trusted catalog backend and an administrator console** (`/admin/collections`, `/admin/assets`,
  `/admin/uploads`): collections, bulk uploads and asset review are backed by Postgres tables,
  published-only row policies, private Storage buckets and guarded admin RPCs under
  `supabase/migrations/`. Files upload straight into the private bucket under a path the batch
  reserved, and the server validates and derives each one (PNG/static WebP are re-encoded into a PNG
  derivative plus a WebP thumbnail; SVG must pass a strict static subset and is rasterized without
  fonts or network). A file that fails is reported per file with a retry, a failed validation never
  becomes a version, and abandoned uploads are listed for removal only when nothing references them.
  It needs the cloud configuration above plus a row in `catalog_admins` (bootstrap SQL in
  `supabase/README.md`); everyone else sees an honest "/admin" state. `npm run test:catalog-sql` runs
  the migrations against a throwaway local PostgreSQL and checks immutability, pointer integrity,
  RLS/Storage visibility, the leased upload lifecycle and every publish/archive guard.
- **The student side of the catalog**: the presentation editor has a catalog panel listing published
  assets only (search, collection and type filters, thumbnails fetched lazily as they scroll into
  view). It downloads the derivative into the deck _before_ the insertion is committed, so a failed
  or offline download leaves the document untouched, and the saved deck records the catalog item and
  version it came from rather than a URL.
- **Deck templates** (`/presentation-templates`): the published class, research-defense and
  club-pitch decks are seeded from one source of truth (`npm run seed:templates`, drafts only;
  previews, validation and publication stay explicit admin actions). The browser filters by use
  case, previews every slide, and “Use template” clones all slides and artwork into an independent
  local deck in one atomic step — a failed download leaves no half-created presentation. A
  template's slide layouts can also be inserted into an existing deck at a chosen position; the
  template and every clone stay independent. Catalog administrators author templates from the
  shared editor (`/admin/templates`): save a presentation as a draft, edit metadata and slides in
  the one editor implementation, generate cover/slide previews from immutable snapshots, and
  validate/publish/archive through guarded RPCs; publication is refused while a dependency is
  missing or archived.

## Not implemented yet (do not expect these to work)

- Automatic background removal (no model/provider is configured; the UI says so).
- JPEG/WebP export for stickers. Cloud-only pack views (shared packs, cloud export history) stay
  honest placeholders: packs are private or local, never shared.
- Live cloud verification against the **deployed production** backend: the cloud journeys run
  against a synthetic in-process backend, and the catalog's live isolation/abuse checks run against
  a dedicated test project (`proofs/p53-live-catalog-isolation.md`), not against production
  StickerLab. Deployed production RLS/Storage rules therefore remain unverified here.
- **Serverless hosts**: asset validation runs in `POST /api/catalog/process`. On a purely static
  deployment that endpoint does not exist, so uploads can be stored but never validated (and the
  screens say so); a server or serverless deploy is required to publish catalog media. Packaging
  that endpoint on a hosted serverless runtime is P08, pending an authorized preview run.
- **Presentation readers**: the PPTX/PDF exports have been round-tripped through LibreOffice
  Impress (25/25 checks) and opened in OnlyOffice Desktop Editors; PowerPoint, Google Slides and
  Keynote are untested, and OnlyOffice interactive editing is not automated (reader-window
  screenshots only). See `proofs/p44-p45-readers-and-limits.md`.
- **Decoded-bitmap memory** at the top of the P45 budget (190–200 MiB) is not measured: the budget
  probes use pixel-light PNGs padded to size.

## Development

```sh
npm install          # installs dependencies (prepare runs `svelte-kit sync`)
npm run dev          # Vite dev server
npm run dev -- --open
npm run build        # production build
npm run preview      # serve the production build
```

## Checks and tests

| Command                     | What it runs                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`             | `svelte-kit sync` + `svelte-check` (types, Svelte a11y/compile diagnostics)                                                                                                                                        |
| `npm run lint`              | Prettier check + ESLint                                                                                                                                                                                            |
| `npm run format`            | Prettier write                                                                                                                                                                                                     |
| `npx playwright test`       | End-to-end journeys against `npm run build && npm run preview` (`e2e/*.spec.ts`)                                                                                                                                   |
| `npm run test:e2e`          | `playwright install` + `npx playwright test`                                                                                                                                                                       |
| `npm run test:e2e:cloud`    | Optional-cloud journeys against a synthetic in-process Supabase backend                                                                                                                                            |
| `npm run test:catalog-sql`  | Catalog migrations + RLS/RPC/upload-lifecycle checks against a throwaway local PostgreSQL                                                                                                                          |
| `npm run test:catalog-live` | Live isolation + upload abuse/recovery checks against a dedicated Supabase test project (`node --env-file=.env.catalog-test scripts/verify-catalog.mjs`; 16/16 recorded in `proofs/p53-live-catalog-isolation.md`) |
| `npm run seed:templates`    | Seeds the three shipped deck templates as drafts into a configured catalog (add `-- --dry-run` to print hashes and sizes without network)                                                                          |

`npx playwright test` uses an already-installed Chromium when one is cached; `npm run test:e2e`
downloads browsers first. The Playwright web server builds and previews the production output.

## Optional cloud configuration

Without public configuration the app is fully local: no auth, no cloud requests and no cloud chrome.
Cloud turns on only when all three public values are valid for the served origin (see
`.env.example`):

```sh
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_AUTH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:4173,https://your-deployment.example
```

Only a publishable (or legacy anon) key is accepted; a service-role key must never reach the browser.
`npm run test:e2e:cloud` builds with synthetic public values and answers every auth/REST/Storage
request in-process, so no project or credentials are needed for that suite.

## Compatibility

| Area                 | Verified                                                                                                                                      | Not verified                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Browser              | Headless Chromium 153 (Playwright e2e); the editor is laptop/desktop-first                                                                    | Firefox, Safari/WebKit, mobile browsers, real-device touch input             |
| Viewports            | 1440×900, 1024×768, 390×844, including the honest phone note (`proofs/p76-p77-route-audits.md`)                                               | Other sizes                                                                  |
| Presentation readers | LibreOffice Impress 25/25 round-trip checks; OnlyOffice Desktop Editors 9.4 opens the exports                                                 | PowerPoint, Google Slides, Keynote; OnlyOffice interactive editing           |
| Hosting              | Local production build + preview; static hosting keeps uploads stored but unvalidated                                                         | Hosted serverless packaging of `/api/catalog/process` (P08 preview pending)  |
| Measured limits      | 20 MiB sources, 100 files per batch, 4096px derivatives, 64 KiB processing request body, 190 MiB export budget (accept 265 ms / refuse 64 ms) | Decoded-bitmap memory at the top of the budget (probes are pixel-light PNGs) |

## Catalog setup (migrations, admin, server env)

The catalog's tables, policies, private buckets and guarded RPCs live in `supabase/migrations/`;
`supabase/README.md` is the operator runbook (migration order, admin bootstrap and recovery SQL,
publication rules, the validation endpoint, seeding and live verification).

- **Migrations**: `supabase link --project-ref <ref>` then `supabase db push --linked` applies them in
  order; the catalog SQL harness rehearses the same migrations against a throwaway local PostgreSQL.
- **Admin bootstrap**: an operator inserts the signed-in user's id into `public.catalog_admins`
  (statement in `supabase/README.md`). Nothing in the app can grant membership, and every admin RPC
  re-checks it server-side.
- **Server env**: `POST /api/catalog/process` reads the same public values at build time
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_AUTH_ALLOWED_ORIGINS` — the deployment
  origin must be listed exactly). It never reads a service-role key: every Supabase call uses the
  signed-in administrator's own token, so row policies apply unchanged.
- **Seeding**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_ADMIN_ACCESS_TOKEN` with
  `npm run seed:templates` creates the three shipped template drafts; previews, validation and
  publication stay explicit `/admin/templates` actions.
- **Live verification**: `npm run test:catalog-live` (with `--env-file` values) is the isolation and
  upload-abuse check for a dedicated test project; never point it at production.

## Local-first data

Without an account, projects, asset blobs and masks live in the origin-scoped IndexedDB database
`stickerlab-local`, so local work does not transfer between origins (dev server, preview port,
deployed origin). With an account, each account gets its own `stickerlab-account-<id>` cache: work is
written there first and synced to the private account when the connection allows, and signing out
only hides that cache on this device. Guest work is never uploaded unless the user chooses import.

Bundled artwork, fonts and samples are served from `static/` under the same URL paths as the source
app (`/art/...`, `/fonts/...`, `/samples/...`). Asset rights and provenance are documented in
`docs/assets-provenance.md`.
