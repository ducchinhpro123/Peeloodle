# Stored evidence for the library-upgrade-scan audit

All items retrieved by the **lead** agent on **2026-09-12** and recorded here verbatim so a
read-only reviewer can cross-check the brief's quotations and numbers. **These are not independent
re-fetches** — a value that matches this file has been checked against the lead's stored source
data, not re-verified from the network. Values that appear in the brief but *not* in this file have
no stored support and should be reported as unsupported.

## 1. npm registry packuments

See `registry-facts.tsv` (same directory). Columns: package, latest version, licence, latest release
date, weekly downloads, peerDependencies. Retrieved via
`curl https://registry.npmjs.org/<pkg>` (packument) and
`curl https://api.npmjs.org/downloads/point/last-week/<pkg>`.

## 2. `@imgly/background-removal` — AGPL-3.0

- URL: https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/LICENSE.md
- Verbatim, top of file:
  > `# GNU Affero General Public License`
  > `_Version 3, 19 November 2007_`
  > `_Copyright © 2007 Free Software Foundation, Inc. <http://fsf.org/>_`
- URL: https://www.npmjs.com/package/@imgly/background-removal
- Verbatim:
  > "The software is free for use under the AGPL License. Please contact
  > [support@img.ly](mailto:support@img.ly?subject=Background-Removal%20License) for questions about
  > other licensing options."
- Registry record for the same package: `license` field reads `SEE LICENSE IN LICENSE.md`
  (i.e. the registry field alone is *not* evidence of the licence — the `LICENSE.md` above is).

## 3. BRIA RMBG-1.4 — non-commercial

- URL: https://huggingface.co/briaai/RMBG-1.4
- Verbatim:
  > "Developed by BRIA AI, RMBG v1.4 is available as a source-available model for non-commercial
  > use. To purchase a commercial license, simply click Here."
  > "* **License:** [bria-rmbg-1.4](https://bria.ai/bria-huggingface-model-license-agreement/)"
  > "* The model is released under a Creative Commons license for non-commercial use."
  > "* Commercial use is subject to a commercial agreement with BRIA."

## 4. BRIA RMBG-2.0 — CC BY-NC 4.0

- URL: https://huggingface.co/briaai/RMBG-2.0
- Verbatim:
  > "Developed by BRIA AI, RMBG v2.0 is available as a source-available model for non-commercial use."
  > "* **License:** [Creative Commons Attribution–Non-Commercial (CC BY-NC
  > 4.0)](https://creativecommons.org/licenses/by-nc/4.0/deed.en)"
  > "* The model is released under a CC BY-NC 4.0 license for non-commercial use."
  > "* Commercial use is subject to a commercial agreement with BRIA."
  > Table on the same page: "Commercial License — Self-Hosted (HF Weights): ❌ Requires agreement;
  > Bria API: ✅ Included"

## 5. Permissive model alternatives

- URL: https://huggingface.co/api/models/Xenova/modnet?blobs=true
- Fields read: `cardData.license` = `apache-2.0`; `downloads` = 103619;
  `lastModified` = `2025-10-26T…`; sum of `.onnx` sibling sizes = 110,159,000 bytes ≈ **105 MiB**
  (this total is **derived by summing file sizes**, not a figure stated on the model card).
- URL: https://huggingface.co/api/models/onnx-community/BiRefNet_lite-ONNX?blobs=true
- Fields read: `cardData.license` = `mit`; `downloads` = 6737; `lastModified` = `2025-10-26T…`;
  sum of `.onnx` sibling sizes ≈ **322 MiB** (likewise derived by summation).
- `mattmdjaga/segformer_b2_clothes`: licence resolves to `other` with no readable model card in the
  fetched response — **ambiguous, therefore not recommended.**
- `onnx-community/U2Netp` returned HTTP 401 — not fetched.

## 6. Service-model quotations

- PowerSync — https://docs.powersync.com/intro/powersync-overview
  > "PowerSync is made up of the PowerSync Service and a set of client SDKs. The PowerSync Service
  > replicates data from your backend database, partitions it based on what data each user should
  > receive, and streams real-time updates to clients through the PowerSync client SDK."
- Electric — https://electric-sql.com/docs/intro
  > "Electric Sync is a read-path sync engine for Postgres. It syncs data out of Postgres into local
  > clients over HTTP using a primitive called a Shape."
  > "The easiest way to use Electric in production is the Electric Cloud. Alternatively, the
  > Deployment guide covers how to self host."
- Zero — https://zero.rocicorp.dev/docs/quickstart
  > Starter stacks listed: "Vite/Hono/SolidJS", "runs Zero in a React/Hono app within the Cloudflare
  > worker environment. It also runs `zero-client` within a Durable Object", "Vite/Hono/React".
  > (A server process is present in every starter; the page does not state that a server is optional.)
- InstantDB — https://www.instantdb.com/docs returned no retrievable readable content, so the brief's
  row for InstantDB rests on inference from the general hosted-local-first pattern, **not** on a
  fetched first-party statement. It is marked as such in the brief.

## 7. Deployed response headers

- Command: `curl -sSI https://stickerlab-eta.vercel.app` — date: Sat, 12 Sep 2026 00:25:36 GMT
- Result: `HTTP/2 200`
- Headers observed in full:
  ```
  accept-ranges: bytes
  access-control-allow-origin: *
  age: 0
  cache-control: public, max-age=0, must-revalidate
  content-disposition: inline
  content-type: text/html; charset=utf-8
  date: Sat, 12 Sep 2026 00:25:36 GMT
  etag: "b1094aa1f214e22eb007ea6295ae6847"
  last-modified: Sat, 12 Sep 2026 00:25:35 GMT
  server: Vercel
  strict-transport-security: max-age=63072000; includeSubDomains; preload
  x-vercel-cache: HIT
  x-vercel-id: hkg1::jt5fx-1789172735975-5029f9fa87d6
  content-length: 902
  ```
- **No `cross-origin-opener-policy` and no `cross-origin-embedder-policy` header is present**, so
  `crossOriginIsolated` would be false for this deployment.

## 8. Installed-dependency licences read from this working tree

Read from `node_modules/<pkg>/package.json` (`license` field):

| Package | licence |
| --- | --- |
| `@playwright/test` | **Apache-2.0** |
| `vitest` | MIT |
| `fflate` | MIT |
| `pptxgenjs` | MIT |
| `pdf-lib` | MIT |
| `react` | MIT |
| `konva` | MIT |
| `zustand` | MIT |

The repository pins `vitest ^2.1.8` in `package.json` (lockfile resolves 2.1.9), which is the premise
of the brief's rejection of `@vitest/browser` 5.0.0 (peer `vitest: 5.0.0`).

## 9. `@supabase/storage-js` — no resumable upload

Read from this working tree: `node_modules/@supabase/storage-js/dist/index.d.mts` and
`package.json` (version **2.115.0**).

- `StorageFileApi` methods found: `upload`, `update`, `upsert`, `move`, `copy`, `remove`, `list`,
  `createSignedUrl`, `createSignedUrls`, `createSignedUploadUrl`, `uploadToSignedUrl`,
  `getPublicUrl`, `download`, `info`, `exists`, `purgeCache`, `transform`.
- A word-boundary search for `\btus\b|resumable` over the declaration file returns **nothing**.
- Therefore: **no resumable (tus-style) upload** in the installed Supabase Storage client.

## 10. Repository-wide absence of PWA/offline-shell tooling

Run in the working tree on 2026-09-12:

- `grep -rniE "serviceworker|service-worker|vite-plugin-pwa|workbox|registerSW|webmanifest|navigator\.serviceWorker" src/ scripts/ vite.config.ts package.json vercel.json` → **no matches**.
- `find . -path ./node_modules -prune -o \( -name "sw.*" -o -name "*service-worker*" -o -name "*.webmanifest" -o -name "manifest.json" \) -print` → **no matches**.
- `public/` contains `apple-touch-icon.png`, `art/`, `favicon.png`, `fonts/`, `samples/` — **no manifest**.
- `index.html` contains only `<meta name="viewport" …>`; no `theme-color`, no manifest link,
  no `apple-mobile-web-app-*` tags.

## 11. Search: already implemented (contradicting `docs/ui-audit.md`)

- `src/components/GlobalSearch.tsx` exists (3,969 bytes) and is mounted in `src/main.tsx:109`
  (`import … from './components/GlobalSearch'` at `:65`).
- It is a Radix dialog with a `Ctrl/Cmd+K` shortcut (`GlobalSearch.tsx:20`) and case-insensitive
  **substring** matching over templates (`:40`) and saved packs (`:41`).
- Covered by `e2e/ui-polish.spec.ts:6` — `global search finds templates and saved packs at ${width}px`
  (asserts `Control+k` at `:22` and a "No matches" state at `:24`).
- `grep -rn "<kbd" src/` → **no matches**: the `.search kbd` rule in `src/styles.css` is orphaned CSS.
- `docs/ui-audit.md` still reads: "Search and notifications still honestly explain that they are not
  implemented." **This line is stale.** (The brief originally relied on it; it was wrong.)
