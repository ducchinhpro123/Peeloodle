# Peeloodle / StickerLab

A SvelteKit app for creating stickers and presentations. Guest work is saved in
this browser using IndexedDB. Presentations support editable slides, PDF/PPTX
exports, and portable `.stickerlab.zip` backups.

## Run locally

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Use `/create` for stickers, `/presentations` for
presentations, and `/my-stickers` for saved sticker packs.

```sh
npm run build
npm run preview
```

## Checks and tests

| Command                                                     | Purpose                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run check`                                             | Svelte and TypeScript diagnostics                                                     |
| `npm run lint`                                              | Prettier and Oxlint                                                                   |
| `npm run test:e2e`                                          | Install browsers and run the production browser tests                                 |
| `npx playwright test --config playwright.startup.config.js` | Verify development startup in Chromium and Firefox                                    |
| `npm run test:e2e:cloud`                                    | Browser tests with a simulated cloud backend                                          |
| `npm run test:catalog-sql`                                  | Verify migrations and catalog permissions using a temporary local PostgreSQL database |
| `npm run test:catalog-live`                                 | Verify a separately configured Supabase test project                                  |

The browser tests and verification helpers are tracked under `e2e/`. The default
Playwright configuration builds and previews the production app. Install both
browsers with `npx playwright install chromium firefox` before running the
startup configuration. Run development and production configurations separately.

Screenshots, downloads, reports, and old development plans stay local and are
ignored by Git. Tests generate their artifacts when run; existing proof files
are not required to build or start the app.

## Optional cloud and catalog

Without cloud configuration, the editor works locally. To enable the optional
Supabase integration, configure the public values documented in `.env.example`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_AUTH_ALLOWED_ORIGINS`

Never put a service-role key in frontend configuration. Catalog uploads require
a server deployment supporting `/api/catalog/process`; a static deployment
cannot validate uploaded assets.

Database migrations and the catalog setup runbook are in `supabase/`. Run
`npm run seed:templates -- --dry-run` to inspect the seed documents without
contacting a backend. See [supabase/README.md](supabase/README.md) for migration,
administrator, deployment, and seeding instructions.

## Saved work and assets

Local browser saves do not automatically sync between origins or devices.
Download a presentation backup before clearing browser data, and restore it
from the presentation library to reopen it elsewhere.

Application assets and their license notices live in `static/`. Attribution and
source information are in [docs/assets-provenance.md](docs/assets-provenance.md).
