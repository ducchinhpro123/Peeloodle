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

## Not implemented yet (do not expect these to work)

- Automatic background removal (no model/provider is configured; the UI says so).
- JPEG/WebP export for stickers. Cloud-only pack views (shared packs, cloud export history) stay
  honest placeholders: packs are private or local, never shared.
- Live cloud verification against a deployed backend: the cloud journeys run against a synthetic
  in-process backend, so the deployed RLS policies and Storage rules are unverified here. The same
  applies to the catalog: `npm run test:catalog-live` is the three-session isolation check for a
  dedicated test project and has never been run (no project or credentials).
- **Template authoring** is not built yet (the only catalog surface the design still defers).
- **Serverless hosts**: asset validation runs in `POST /api/catalog/process`. On a purely static
  deployment that endpoint does not exist, so uploads can be stored but never validated (and the
  screens say so); a server or serverless deploy is required to publish catalog media.

## Development

```sh
npm install          # installs dependencies (prepare runs `svelte-kit sync`)
npm run dev          # Vite dev server
npm run dev -- --open
npm run build        # production build
npm run preview      # serve the production build
```

## Checks and tests

| Command                      | What it runs                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run check`              | `svelte-kit sync` + `svelte-check` (types, Svelte a11y/compile diagnostics)                |
| `npm run lint`               | Prettier check + ESLint                                                                    |
| `npm run format`             | Prettier write                                                                             |
| `npm run test:unit -- --run` | Vitest (node project for modules, headless Chromium for `*.svelte.test.ts`)                |
| `npx playwright test`        | End-to-end journeys against `npm run build && npm run preview` (`e2e/*.spec.ts`)           |
| `npm run test:e2e`           | `playwright install` + `npx playwright test`                                               |
| `npm run test:e2e:cloud`     | Optional-cloud journeys against a synthetic in-process Supabase backend                    |
| `npm run test:catalog-sql`   | Catalog migrations + RLS/RPC/upload-lifecycle checks against a throwaway local PostgreSQL  |
| `npm run test:catalog-live`  | Live catalog isolation check — requires a dedicated Supabase test project (never run here) |

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

## Local-first data

Without an account, projects, asset blobs and masks live in the origin-scoped IndexedDB database
`stickerlab-local`, so local work does not transfer between origins (dev server, preview port,
deployed origin). With an account, each account gets its own `stickerlab-account-<id>` cache: work is
written there first and synced to the private account when the connection allows, and signing out
only hides that cache on this device. Guest work is never uploaded unless the user chooses import.

Bundled artwork, fonts and samples are served from `static/` under the same URL paths as the source
app (`/art/...`, `/fonts/...`, `/samples/...`). Asset rights and provenance are documented in
`docs/assets-provenance.md`.
