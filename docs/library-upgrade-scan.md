# Libraries that could raise StickerLab's ceiling

**Question asked:** which library could boot this app to another level?

**Researched** 2026-09-12. Package facts come from npm registry packuments and first-party pages
fetched that day (see Sources); claims about this repository come from reading the working tree.

**Scope bound — read this before the headline.** Four dimensions were searched in depth (canvas and
image processing, slides and text, persistence and sync, product-UX), each by a separate scan, and
this document adds a bounded second pass over five previously untouched dimensions (offline
packaging, server-state fetching, collection/table primitives, paste-and-import sanitisation, test
coverage). That is still not the whole space. No exhaustive npm/GitHub sweep was performed, so
"no library exists for X" always means "*no library among those examined*", and the two harshest
conclusions below (§7, §8) are the ones a falsification pass should attack first.

---

## Executive summary

The honest answer has three parts, and they do not all point the same way.

**1. The single biggest available enhancement is offline packaging** — and it is an enhancement, not a
missed promise. The documented promise is that core editing, saving, reopening and PNG export work
without cloud credentials, and the app keeps it: documents, media and export are all local. What the
repo has never had is a service worker, a manifest, `theme-color` or any PWA tooling, so with no
network a *reload* cannot load the application itself. `vite-plugin-pwa` closes that gap at build
time, which matters for a school deployment on unreliable wifi and tablets — but it goes beyond what
was promised, and it must not be described to users as work being backed up.

**2. The engine and persistence layers should keep their hand-rolled code.** The repo already
implements the hard part of local-first sync — a bounded replay-safe outbox, content-addressed
binaries verified after upload, optimistic concurrency with conflict *copies*, idempotent
guest→account migration, and document-plus-binaries commits in one IndexedDB transaction — and every
offline-first engine examined requires a server component and owns its own data model. Likewise the
text pipeline's DOM↔canvas↔export parity is *measured*, and a second shaping engine would put that
proof at risk. These are evidence-based negatives, not conservatism.

**3. The cheapest real upgrades are quality and velocity tooling, not features.** There is no a11y
linting and no automated a11y audit anywhere in a codebase that explicitly requires accessible names,
dialog focus handling and keyboard alternatives. Two devDependencies fix that with zero runtime cost.

**Three licence traps and two non-commercial models were confirmed by first-party text**, and they are
the kind that would be walked into innocently: `@imgly/background-removal` (the package most
"remove background" tutorials reach for) is **AGPL-3.0**; `intro.js` and `@triplit/client` are
AGPL-3.0/AGPL-3.0-only; `satori` and the `@axe-core/playwright` + `axe-core` pair are MPL-2.0; and
both BRIA RMBG models — the weights behind the other half of the cutout demos — are **non-commercial**.
The permissive path exists (`Xenova/modnet`, Apache-2.0) but it is a 105 MiB model plus licence review,
not a dependency.

**One correction worth stating loudly:** an earlier draft of this document recommended building a
command palette because "search is not implemented". That was wrong. Search ships in
`src/components/GlobalSearch.tsx`, with `Ctrl/Cmd+K`, e2e coverage at three viewports, and an
in-memory filter. The claim came from a **stale line in `docs/ui-audit.md`**. §3 covers what the real
situation is, and why the stale line is itself a defect worth fixing.

---

## How to read the recommendations

Items are ranked on **one axis: expected value per unit of effort**. Each row states the kind of value
it delivers, because the kinds are not interchangeable — an enhancement to what users can do, a quality
guard, and developer tooling cannot be compared directly, and where they compete the user-visible
value wins. Rank 1 is the offline app shell for that reason, not because it is the smallest change.

Every row carries a licence and a version read from the registry on 2026-09-12. Bundle sizes were
**not** measured, so none is quoted — with one exception in §8 that is explicitly attributed to the
repo's own recorded baseline.

---

## Ranked shortlist

| # | Kind | Recommendation | Licence | Version (last release) | React 18 | Buys | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Enhancement | Offline app shell: `vite-plugin-pwa` | MIT | 1.3.0 (2026-05-05) | n/a — build-time plugin, peer `vite ^3.1.0 \|\| ^4 \|\| ^5 \|\| ^6 \|\| ^7` | The app cannot load at all without a network today. The documented offline promise (core editing, saving, reopening, export without credentials) is already kept, so this is a valuable addition for unreliable-wifi schools rather than a fix for a broken promise | S–M |
| 2 | Quality | `eslint-plugin-jsx-a11y` + `@axe-core/playwright` | MIT / MPL-2.0 | 6.10.2 (2024-10-26) / 4.13.0 (2026-08-11) | n/a | Automated a11y checks inside commands that already run; closes a verified tooling gap | S |
| 3 | Quality | Playwright snapshot assertions + traces | **Apache-2.0** (already a dependency) | `@playwright/test` ^1.63.0 | n/a | Records the visual contract; the audit's screenshot evidence lives in uncommitted `/tmp/**` and 12 desktop-width checks are already failing per `proofs/baseline.md` | S |
| 4 | Capability | `@dnd-kit/core` + `@dnd-kit/sortable` | MIT | 6.3.1 (2024-12-05) / 10.0.0 (2024-12-04) | `react: >=16.8.0` ✅ | Drag reorder with screen-reader announcements at P23 (slide rail) and P30 (element list) only | M |
| 5 | Quality | `sonner` | MIT | 2.0.8 (2026-08-09) | `react: ^18.0.0 \|\| ^19.0.0 \|\| ^19.0.0-rc` ✅ | Honest progress/success/failure for off-screen async work (P40/P43/P58/P60) | S |

**Adopt when the trigger arrives, not now.** Each has a concrete trigger; adopting early buys nothing.

| Candidate | Kind | Licence | Version | Trigger |
| --- | --- | --- | --- | --- |
| `rollup-plugin-visualizer` + `knip` | Velocity | MIT / ISC | 7.1.1 (2026-08-14) / 6.35.1 (2026-09-09) | Now-ish, as devDependencies: Konva is lazy-loaded and someone must see the chunk graph |
| `fuse.js` or `minisearch` | Capability | Apache-2.0 / MIT | 7.5.0 (2026-07-13) / 7.2.0 (2025-09-16) | The catalogue reaches P59/P62 scale ("hundreds of files"), where substring matching stops matching intent (§3) |
| `@vitest/coverage-v8` | Velocity | MIT | 5.0.0 (2026-09-03) | **Needs the 2.x line**: 5.0.0 peers `vitest: 5.0.0` and `@vitest/browser: 5.0.0`, and the repo pins `vitest ^2.1.8` |
| `@tanstack/react-virtual` | Capability | MIT | 3.14.12 (2026-09-11) | A catalogue page renders hundreds of assets *and* paging has been ruled out |
| One canvas-first chart renderer (`chart.js`) | Capability | MIT | 4.5.1 (2025-10-13) | Charts become a real requirement — then pick one renderer, never two |
| `@tanstack/react-query` | Velocity | MIT | 5.102.8 (2026-08-27) | The P58/P60/P62 catalogue flows start hand-rolling retry/refetch/dedupe per page |
| `msw` | Velocity | MIT | 2.15.0 (2026-07-08) | P46+, when hostile cloud behaviour must be induced on demand |

**Deliberately not ranked:** automatic background removal. See §8.

---

## 1. An offline app shell (an enhancement, not a broken promise)

Offline-first extends to the data but **not to the application**, and the distinction matters for how
this is described:

- What is documented and delivered: core editing, saving, reopening and PNG export work without cloud
  credentials. Documents, media and export are local, and that promise is kept.
- What was never promised and does not exist: the *application* loading with no network. There is no
  service worker, no manifest, no `theme-color` and no PWA tooling anywhere in the repo, so a reload
  offline cannot start the app. IndexedDB documents survive; the code that opens them does not.

Evidence for the absence, since the claim carries the recommendation: a repo-wide search for
`serviceworker`, `service-worker`, `vite-plugin-pwa`, `workbox`, `registerSW`, `webmanifest` and
`navigator.serviceWorker` across `src/`, `scripts/`, `vite.config.ts`, `package.json` and
`vercel.json` returns nothing; no `sw.*`, `*service-worker*`, `*.webmanifest` or `manifest.json`
exists outside `node_modules`; `public/` holds icons, `art/`, `fonts/` and `samples/` but no manifest;
and `index.html` carries only `<meta name="viewport">` with no `theme-color`, manifest link or
`apple-mobile-web-app-*` tags.

For a school deployment on unreliable wifi and tablets, an installable offline shell is the most
valuable single addition available in this research. It should be presented as an enhancement to an
already-working offline story, not as repairing something broken.

**`vite-plugin-pwa`** 1.3.0 — MIT, 2026-05-05, ~3.4M weekly downloads, peer
`vite ^3.1.0 || ^4 || ^5 || ^6 || ^7` (the repo is on Vite 6 ✅). It is build-time only: it generates
the manifest, the shell precache list and the service worker; `workbox-window` 7.4.1 (MIT,
2026-05-04) ships with it for the update lifecycle.

Caveats to write into the plan *before* adopting, because a service worker changes caching semantics
for the whole app:

1. **Never let the worker touch editable data.** Precache the app shell only; do not intercept
   Supabase, Storage, or any API request. Documents live in IndexedDB and their truth must not move.
2. **Stale-version handling is a support cost, not a free win.** With `autoUpdate` an old bundle can
   outlive a deploy; a prompt-on-update flow is the honest option and must never interrupt unsaved work.
3. **The current deploy already behaves well here** — `cache-control: public, max-age=0,
   must-revalidate` — so index and assets are revalidated; the worker must not fight that.
4. Service workers require HTTPS or localhost; the Vercel deployment is HTTPS, so this is satisfied.
5. It does not replace the storage layer, the autosave debounce, or the save-state pill, and it must
   never be described to users as "your work is backed up".

## 2. Accessibility — the cheapest real upgrade (Quality)

There is no a11y linting: `package.json` lists `@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`, and no a11y plugin. There is no
automated a11y audit either. Meanwhile `AGENTS.md` requires "semantic controls, visible focus,
accessible names, dialog focus handling, and keyboard alternatives for core canvas operations", and
`docs/ui-audit.md` records that canvas selection is pointer-only until P30.

- **`eslint-plugin-jsx-a11y`** 6.10.2 — MIT, 2024-10-26, ~34M weekly downloads. Static checks for
  missing labels, ARIA misuse and click handlers on non-interactive elements; it hooks into the
  `npm run lint` that verification already runs. Expect a small burst of legitimate fixes.
- **`@axe-core/playwright`** 4.13.0 — **MPL-2.0**, 2026-08-11, peer `playwright-core >= 1.0.0` (the
  repo has `@playwright/test` ^1.63.0). Its dependency **`axe-core` 4.13.0 is also MPL-2.0**, so the
  licence sits on both the wrapper and the engine — MPL-2.0 is file-level copyleft, acceptable for a
  devDependency that is not redistributed in the app bundle, but it should be recorded rather than
  assumed.

*Proposal, not current state:* the integration would run axe inside the existing Playwright suite
across the four routes at the three documented viewports (1440×900, 1024×768, 390×844). A first run
on an existing app always yields a triage backlog; that is the point of it.

Rejected: `vitest-axe` 0.1.0 (MIT, last release 2022-10-21) — the interesting a11y surfaces are
composite pages and Radix dialogs, which belong in the browser suite, not jsdom.

## 3. Search already exists — and one audit line about it is stale (corrected finding)

An earlier draft of this brief treated the header search as an unbuilt affordance and recommended
building it. **That was wrong**, and the correction is worth more than the original recommendation:

- `src/components/GlobalSearch.tsx` is a complete Radix-dialog search mounted at
  `src/main.tsx:109`, with a `Ctrl/Cmd+K` shortcut, template filtering, saved-pack filtering,
  loading/error/no-match states, and result links into `/templates?q=…` and `/my-stickers?pack=…`.
- `e2e/ui-polish.spec.ts:6` covers it at 1440/1024/390 px, including the shortcut and the "No
  matches" state. `src/app.test.tsx` covers open and focus restore.
- No `<kbd>` element exists anywhere in `src/`; the `.search kbd` rule in `src/styles.css` is orphaned.

**The real defect:** `docs/ui-audit.md` still says "Search and notifications still honestly explain
that they are not implemented", and `proofs/baseline.md` lists the desktop `global search` case among
12 already-failing desktop-width checks. A stale honesty claim in the audit is a documentation
defect in a repo whose rules are built on honest feature states — fix the line and the dead CSS
rather than building anything.

**The genuine library question is scale, not absence.** Matching is case-insensitive **substring**
matching over templates and packs (`GlobalSearch.tsx:40-41`), which is correct at today's catalogue
size and stops matching user intent when P59/P62 reach the plan's "hundreds of files" with metadata.
At that point `fuse.js` 7.5.0 (Apache-2.0, 2026-07-13, ~9.8M weekly downloads) or `minisearch` 7.2.0
(MIT, 2025-09-16) is the small, framework-free index — **trigger: catalog scale, not now.**

A separate, still-unbuilt feature would be an **action** palette (commands rather than documents):
`cmdk` 1.1.1 (MIT, 2025-03-14, ~30M weekly downloads, peer
`react: ^18 || ^19 || ^19.0.0-rc`) is the headless fit, with the chrome built from the repo's own
`DialogContent` and tokens. That is a product decision about verbs, not a fix for missing search, and
it should not be justified by the stale audit line.

Rejected for the document-search job: `kbar` 1.0.0 and `ninja-keys` ship their own palette UI/styling
(*library internals not verified in this research*), which collides with the token system and the
one-dialog rule; `hotkeys-js` 4.0.8 is vanilla-global with no React lifecycle
(*internals also unverified*). `react-hotkeys-hook` 5.3.3 (MIT, 2026-06-26) is a conditional swap for
the existing hand-rolled shortcut dispatch — only once the shortcut table outgrows one readable
dispatcher.

## 4. One drag library, at two sites, not everywhere (Capability)

Landing sites in order of real value: slide reorder/delete (P23, unchecked), the accessible element
list (P30, unchecked), the sticker layer stack (already has `ArrowUp`/`ArrowDown` reorder buttons),
pack member ordering, and admin catalog ordering (P52).

`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 (MIT, peer `react: >=16.8.0`) supplies pointer and
keyboard sensors, sortable lists, and position-change announcements. The selection criterion is not
popularity but focus: **a drag library that hides focus management behind a pointer-only
implementation would be a regression here**, where dialogs have an explicit focus-restoration
discipline and list rows are keyboard-reachable.

Two caveats stated plainly:

- **Maintenance signal:** the core's newest release is 2024-12-05 (sortable: 2024-12-04), about 21
  months before this research, versus `@atlaskit/pragmatic-drag-and-drop` 3.1.0 (Apache-2.0,
  2026-08-29, ~1.0M weekly downloads). Stability is not a defect, but the age is a fact the decision
  should acknowledge.
- **The drag result must be an array move fed into the existing store command**, so one completed drag
  remains one undo entry and selection still never dirties the document.

Rejected: `sortablejs` 1.15.7 (MIT) mutates the DOM list directly, against the store-as-truth model;
`@react-aria/dnd` 3.12.1 (Apache-2.0) would introduce a second collection/component system beside
Radix and the hand-rolled primitives, against the reuse-first rule; native HTML5 drag-and-drop has no
touch support, which matters for the supported 390×844 viewport.

## 5. Feedback for long-running work — one system, not two (Quality)

Status today is inline and truthful (`saveStatusLabel` with `data-state`, `.asset-error`,
`.presentation-local-status`, `NoticeDialog`), and a previous audit pass *removed* non-functional
controls. A toast library is therefore justified only where the result is genuinely off-screen or
asynchronous: pack ZIP export, PPTX/PDF export progress and cancellation (P40), backup/restore (P43),
per-file catalog upload status (P58), publish/archive (P60). `sonner` 2.0.8 fits promise-style
loading→success/error flows best; `react-hot-toast` 2.6.0 (MIT, 2025-08-15) is a smaller alternative.

**Rule to write down before adopting either:** toasts for background/long-running results only, never
for save state — otherwise the app ends up with two feedback systems for one event.

Bounded progress needs no library: `<progress>` against the repo's own counters is more honest than
an indeterminate spinner.

## 6. Velocity: see the chunks, find the dead code, measure coverage (Velocity)

`KonvaCanvas` is already `React.lazy`-loaded and lazy export loading is planned, so someone must see
the chunk graph: `rollup-plugin-visualizer` 7.1.1 (MIT, 2026-08-14). `knip` 6.35.1 (ISC, 2026-09-09)
is worth a trial in a **~19,400-line TypeScript codebase** (measured: `find src server -name '*.ts'
-o -name '*.tsx' | xargs wc -l` → 19,390 lines) mid-restructure, with the honest caveat that dynamic
imports — which this repo has — are its classic false-positive source.

**Coverage is the missing third leg.** Nothing measures test coverage, and §6's own concern (splitting
sticker vs presentation families) is exactly where coverage data pays. `@vitest/coverage-v8` 5.0.0
(MIT, 2026-09-03) peers `vitest: 5.0.0` and `@vitest/browser: 5.0.0`, so **the 5.x release is
incompatible with the pinned `vitest ^2.1.8`** — take the 2.x line matching the installed vitest.

Server-state: the catalogue and library surfaces hand-roll `useState`/`useEffect` fetch state today
(`GlobalSearch.tsx` keeps `packs`, `error`, and a loading path by hand; a dozen feature files use
`useEffect`). `@tanstack/react-query` 5.102.8 (MIT, 2026-08-27, peer `react: ^18 || ^19`) is the
standard answer, but it is a *trigger* item: adopt it when the P58/P60/P62 flows start re-implementing
retry/refetch/dedupe, not before. Charts, virtualization and `msw` likewise sit in the trigger table.

Rejected: `@t3-oss/env-core` 0.13.11 (MIT) — the real need is ~20 lines expressing "Supabase is
optional for local-first mode" and failing loudly on a malformed URL; hand-rolled wins on dependency
count. `@vitest/browser` 5.0.0 — same peer trap, and it would add a second browser runner beside
Playwright. `@total-typescript/ts-reset` 0.6.1 — a team preference, not a product win.

## 7. Persistence and sync: do not adopt a sync engine

**Confidence note (stated honestly):** the repo-side evidence below was verified line by line against
this working tree by an independent reviewer. The *engine-side* rows are uneven: PowerSync, Electric
and Zero have first-party statements quoted in Sources; RxDB, Liveblocks, Yjs/Loro/Automerge, Jazz,
InstantDB and Triplit rest on the general pattern of hosted local-first backends plus inference, and
InstantDB's own documentation page yielded no retrievable content at all. Treat the engine columns as
inference and the repo columns as fact.

The repo already implements the hard part:

- a **bounded, replay-safe outbox** — the head snapshot's `operationId` is the idempotency key the RPC
  dedupes on, with the queue bounded to two snapshots per resource
  (`src/lib/persistence/repository.ts:359-370`; conflict copy at `:399`);
- **optimistic concurrency on an explicit revision** — the server RPC takes `expected_revision` and
  returns `{ resource, original, conflict }` (`cloudRemote.ts:104`);
- **content-addressed binaries** — SHA-256, path `${ownerId}/${hash}`, `upsert:false` with 409 treated
  as success, then re-download and re-hash before acknowledging (`cloudRemote.ts:95-101`);
- **idempotent guest→account migration** — target IDs derived from `sha256(ownerId, kind, id)`,
  guest originals retained until cloud writes confirm (`cloud.ts:212`);
- **document + binaries in one IndexedDB transaction** with write-time referential integrity and
  immutable media identity;
- undo with **gesture boundaries, a 50-entry bound, and history entries that pin the models they
  reference** (`src/features/editor/store.ts`).

Against that baseline, every offline-first engine examined requires a **server component** and owns
its own local model and protocol. PowerSync's own docs state it "is made up of the PowerSync Service
and a set of client SDKs"; Electric is "a read-path sync engine for Postgres" deployed via Electric
Cloud or self-hosting; every Zero quickstart starter runs a server process in the loop.

| Engine | Service required | Verdict |
| --- | --- | --- |
| Electric | Yes — in front of Postgres (Cloud or self-host) | Reject — drops the `expected_revision` conflict contract |
| PowerSync | Yes — service + connector you write | Reject — closest analogue to the outbox, still displaces it |
| Zero (Rocicorp) | Yes — a server process in front of Postgres | Reject — replaces the sync half only, so you run both |
| RxDB replication | Yes for replication | Reject — a second revision system beside the RPC one |
| Jazz / InstantDB / Triplit | Yes (hosted or self-host) | Reject — owns the data model; replaces the fixed Supabase stack |
| Liveblocks | Yes (hosted, server auth endpoint) | Reject — session-oriented, replaces nothing here |
| Yjs / Loro / Automerge | Provider needed in practice | Reject — merged CRDT state is not a validated document; no blob atomicity; co-editing is deferred by product decision |
| Supabase Realtime | Already in the stack | **The one positive:** a subscription that wakes the existing `sync()` instead of a manual "Refresh cloud". A notification channel, never storage — and never presented as live collaboration |

Storage: `idb` 8.0.3 (ISC, 2025-05-07) would collapse ~40 lines of plumbing and touch nothing else;
`dexie` 4.4.6 (Apache-2.0, 2026-09-10) adds declarative upgrades and live queries but relocates the
version chain that `HANDOFF.md` pins to `STICKERLAB_DB_VERSION` in `src/lib/persistence/idb.ts`.
Dexie gives nothing for referential integrity, media immutability or conflict copies — those are app
logic. OPFS for binaries would break document+binary atomicity. `@sqlite.org/sqlite-wasm`
3.53.4-build1 (Apache-2.0, 2026-09-08) is the maintained SQLite option if one is ever wanted;
**`wa-sqlite` 1.0.0 is not** — its registry metadata declares **no licence and no repository**, and
its newest release is 2024-01-05.

History: `zundo` 2.3.0 (MIT, 2024-11-17, peer `zustand: ^4.3.0 || ^5.0.0`) can replace the two
past/future arrays but not the rules attached to them — it cannot express the coupled `assetsFor`/
`masksFor` media retention that makes "delete a layer, undo it" work. `immer` 11.1.18 (MIT,
2026-08-19) inverse patches are a *performance* question (each history push does a JSON round-trip
clone through the validator, 50 deep) and need a profile first, not a simplification.

## 8. Canvas and image: nothing to add, two things to fix

The repo already uses the right native primitives — `createImageBitmap` with
`imageOrientation: 'from-image'`, `premultiplyAlpha: 'none'`, `resizeQuality: 'high'` and two
fallbacks, in both the compositor and upload validation. No decoder library replaces that, and the
compositor's `CanvasLike` duck type already accepts `convertToBlob`, so a worker offload (if ever
needed) is an injection change rather than a rewrite.

Two library-free improvements fell out:

- **The outline is a separable box-max dilation, and the code names its own upgrade** — "separable box
  max (O(WH)); Euclidean DT if round corners matter". An exact Euclidean distance transform removes
  square-footprint artefacts at large outline widths, matches the round-capped brush, and is one
  function. Preview/export pixel parity is a hard invariant and must be re-proved
  (`e2e/render-parity.spec.ts`, `e2e/outline.spec.ts`).
- **Nothing measures the full-resolution mask encode.** Every stroke rasterises at full asset
  resolution, encodes via `canvas.toBlob` on the main thread, then writes to IndexedDB. The recorded
  measurements cover the *preview raster* path only (the repo's own baseline records a 314 kB
  `KonvaCanvas` chunk in `proofs/baseline.md`, with frame/pointer numbers for the preview path).
  Measure the 25 MP stroke-end encode before building anything.

Cutout / background removal — the honest picture:

| Option | Licence (first-party text) | Reality |
| --- | --- | --- |
| `@imgly/background-removal` 1.7.0 | **AGPL-3.0** (its `LICENSE.md` is the AGPL; the registry field only says `SEE LICENSE IN LICENSE.md`) | Copyleft obligations for a networked app; other licensing is a purchase from img.ly |
| BRIA RMBG-1.4 | source-available, **non-commercial** | The weights behind many demos |
| BRIA RMBG-2.0 | **CC BY-NC 4.0** | Same wall, newer model |
| `Xenova/modnet` | **Apache-2.0** — ≈105 **MiB** ONNX | The permissive path; portrait matting |
| `onnx-community/BiRefNet_lite-ONNX` | **MIT** — ≈322 **MiB** ONNX | Permissive, but a large first-run download |
| `@mediapipe/tasks-vision` 1.0.1 | Apache-2.0 | Person/selfie-oriented; the repo's own audit row reads "Selfie/person, not pets/objects … **Legal but product-unfit**" |
| `mattmdjaga/segformer_b2_clothes` | registry licence resolves to `other` with no readable card | Ambiguous — **not recommended** |

The MiB figures are **derived by summing the ONNX files in each repository, not stated on any model
card**, and only apply to the `.onnx` weights.

Two constraints beyond licence stack on top:

- **The deploy cannot run threaded WASM.** `HEAD https://stickerlab-eta.vercel.app` returns HTTP/2 200
  with `strict-transport-security` and `access-control-allow-origin: *` — and **no
  `Cross-Origin-Opener-Policy` and no `Cross-Origin-Embedder-Policy`**, so `crossOriginIsolated` is
  false and multi-threaded inference is unavailable. A model would run single-threaded, or the deploy
  would need COOP/COEP (a deploy-wide change with consequences beyond cutout).
- **105 MiB against a 314 kB largest chunk** is not a rounding error for an offline-first app.

The integration seam, if approved, is small: `applyMask(layerId, uuid, blob)` already takes an
image-local mask blob, and preview, export and ZIP already handle `maskKey`.

Rejected: `wasm-vips` 0.0.18 (MIT) adds a second browser imaging stack while the server already runs
native libvips via sharp behind an unmounted probe; `glfx` 0.0.4 (MIT, last release 2016-12-08) and
similar WebGL filter libraries would fork the single preview/export compositor; `jimp` duplicates
codecs the platform already provides; `exifr` 7.1.3 (MIT, 2021-08-05) is unnecessary because
orientation is applied at decode — though the byte-level JPEG header parser has no EXIF handling, so
an orientation-6/8 JPEG can size differently between header and decode. That is latent today (the
server rejects JPEG entirely) and becomes live at catalog ingestion.

## 9. Slides and text: the architecture is already right; fix the promises

The text pipeline is provably correct at the level the product needs: one authoritative
paragraph/run model, one injected-measure layout service, a DOM overlay for caret work, Konva for
painting, and an **executed** proof asserting DOM↔canvas agreement (≤2 u vertical centres, ≤2.5 u
left, ≤3 u right, Konva↔canvas ≤0.5 u) on Vietnamese text. PPTX emits native runs, bullets with
explicit numbering, hyperlinks and shapes, verified through LibreOffice → PDF at 960×540 pt.

The highest-confidence *technical* line in this document is therefore a "do not add": `harfbuzzjs`
1.6.1 (MIT), `fontkit` 2.0.4 (MIT) or `opentype.js` 2.0.0 (MIT) as a *layout* engine would create a
second text engine and put that measured parity at risk. They only pay off when shaping without a
browser, which this architecture avoids. `hypher` 0.2.5 (BSD-3-Clause, 2016-12-19) and `linebreak`
1.1.0 (MIT, 2022-05-20) address scripts outside the current English/Vietnamese scope — and
`Intl.Segmenter` is the zero-dependency option if that day comes.

The real gap is a **promise**. pptxgenjs 4.0.1 (MIT, installed) writes text with a font *family name*,
and a reader without those fonts substitutes metrics; the architecture already declines to promise
font embedding. An export preflight listing unresolved fonts, overflow, and "this will export as a
picture" turns a latent support problem into an honest feature.

If charts become a requirement, pick **one** renderer and accept its consequence: a canvas-first
library (`chart.js` 4.5.1 MIT, or `echarts` 6.1.0 Apache-2.0) captured as a PNG travels the existing
image path to both PDF and PPTX as a single picture, preserving preview↔export parity. pptxgenjs
native charts would be editable in PowerPoint but invisible in the app — a permanent divergence.

Rejected: `jsPDF`, `pdfmake` 0.3.11 (MIT), `@react-pdf/renderer` 4.9.0 (MIT) — the PDF contract is
deliberately raster via pdf-lib 1.17.1 (MIT), and a selectable-text PDF would need `@pdf-lib/fontkit`,
which is not installed. `mermaid` 12.0.0 (MIT) and `katex` 0.18.7 (MIT) are large runtimes whose
output is a picture in PPTX anyway, and Mermaid source is an untrusted-input surface. `JSZip` is
already present transitively while `fflate` 0.8.3 (MIT) is direct — and the repo currently has **two**
ZIP implementations (a hand-rolled STORE-only writer in `zipExport.ts`, fflate in the presentation
backup), which is a consolidation opportunity, not a library gap. Server-side or WASM LibreOffice
conversion would break browser-only operation; its correct role is as a test reader, which is how it
is already used.

## 10. Paste and import: no sanitiser needed (a check, not a recommendation)

The second pass checked the trust boundary a sanitiser library would serve, because recommending
`dompurify` 3.4.15 (dual `MPL-2.0 OR Apache-2.0`, 2026-09-06, ~47M weekly downloads — so the
permissive option is available) without checking would have been careless.

The code does not need it: pasted HTML is parsed in an **inert `<template>`**, `script`/`style`/
`template`/`head` elements are skipped, the result is reduced to a paragraph/run **text** model that
is never persisted as HTML, and serialisation back to the editing DOM escapes text through
`escapeHtml` (with run attributes escaped too). There is no `innerHTML` of user content along the
kept path.

One residual question worth a single test rather than a dependency: **link targets are escaped for
attribute quoting but I found no scheme validation**, so a pasted `javascript:` URL is worth probing
in the bridge tests. If that is the only gap, the fix is a scheme allowlist in the bridge, not a
sanitiser package.

## 11. The non-library wins, in order

The reviewer of this brief correctly noted that the highest-value findings are in-repo work. Four,
ranked:

1. **A `schemaVersion` migration module.** `parseProjectDocument` hard-fails on any unknown
   `schemaVersion` with `unsupported_schema`, and list/detail loaders skip unreadable rows — so an old
   document is not corruptible, it is *invisible*. P41/P42 make portable restorable backups a
   deliverable, which guarantees old-version documents will appear. `AGENTS.md` requires unknown
   versions to be a *recoverable* error. No library covers this shape (two document kinds in one
   additive DB); it is a small module keyed by `schemaVersion`, run before validation and during restore.
2. **The export fidelity preflight** (§9).
3. **The mask-encode measurement** (§8) — the decision gate for any worker work.
4. **Two cheap wins the scans ranked and this brief initially dropped:**
   - **WOFF2 derivatives + selective font preload** behind the existing `ensurePresentationFonts()`
     gate. Eight static TTFs (~1.6 MB) are fetched on demand and all eight faces are awaited in one
     promise; template galleries multiply that cost. Re-verify with the P04 parity spec and the P05
     stress export, and record provenance for the derived files. *(Size reduction must be measured
     locally — not quoted.)*
   - **Single-flight the `binaryHash` computation.** `cloudRemote.ts` hashes each binary once to name
     it and again to verify the re-download, plus on every download. Memoising it is a small,
     library-free improvement. *(Magnitude unmeasured; no number is claimed.)*

Also genuine, with no dependency: a sticker **sheet/print sheet** composer over the existing
`renderDocument` plus `pdf-lib` (already a client dependency), and multi-select for pack batch actions.

---

## Anti-recommendations (examined, rejected, with the reason)

| Rejected | Licence | Reason |
| --- | --- | --- |
| `intro.js` 8.5.0 | **AGPL-3.0** | Licence is the risk, not the code |
| `@triplit/client` 1.0.50 | **AGPL-3.0-only** | Same; also requires its own backend |
| `@imgly/background-removal` 1.7.0 | **AGPL-3.0** | Copyleft obligations; commercial licensing is a purchase |
| BRIA RMBG-1.4 / 2.0 | Non-commercial | Product cannot ship on these weights |
| `satori` 0.33.4 | **MPL-2.0** | Not permissive; no HTML→SVG need |
| `wa-sqlite` 1.0.0 | **None declared, no repository** | Unmaintained and unlicensed metadata |
| `react-data-grid` 7.0.0-beta.61 | MIT | Peer `react: ^19.2` — **React 19 only**, disqualifying |
| `@vitest/browser` 5.0.0, `@vitest/coverage-v8` 5.0.0 | MIT | Peer `vitest: 5.0.0` vs the pinned `^2.1.8` (use the 2.x line) |
| `@sentry/react` 10.74.0, Highlight.io, OTel web | MIT / — | Network egress, an account, a purchase and session data in an app whose promise is offline-with-no-credentials |
| `web-vitals` 6.2.1 | Apache-2.0 | Measures but has nowhere to report; INP on brush strokes is better obtained from the repo's own harness |
| `motion` 13.2.0, `react-spring` 10.0.4 | MIT | Reduced motion is already a global CSS rule; JS-driven animation escapes it and needs its own guard. Value today ≈ 0 |
| `@formkit/auto-animate` 0.10.0 | MIT | Cosmetic until drag reorder exists; revisit then, with its own reduced-motion guard |
| `react-easy-crop` 6.2.3, `react-zoom-pan-pinch` 4.2.0 | MIT | Each introduces a second crop/zoom coordinate system, contradicting the non-destructive, mask-aligned, single-clamp invariants |
| `uppy` 6.0.1 | MIT | A second upload state machine overlapping the planned durable job model; its one unclaimed capability — resumable upload — is confirmed absent from the installed Supabase client, and belongs in the job model rather than a second uploader UI |
| `react-dropzone` 20.1.1 | MIT | Its filters are a UX pre-filter, not a trust boundary — `validateUpload.ts` stays the gate. Reconsider only for P58 folder drops |
| `react-hook-form` 7.88.0, `@conform-to/react` 1.21.1 | MIT | Two-field dialogs; conform additionally assumes a server-action architecture this app does not have |
| `zod` 4.6.2, `valibot` 1.5.0 | MIT | Re-authors working, tested boundary parsers — and adds no migration, which is the actual gap |
| `i18next` 26.4.2 / `react-i18next` 17.0.13, Lingui 6.7.0, `typesafe-i18n` 5.27.1, Paraglide 2.25.2 | MIT | UI translation is an unmade product decision; the Vietnamese requirement is already solved at the font/metrics layer |
| `react-joyride` 3.2.0, `driver.js` 1.8.0 | MIT | Tours hard-code selectors and copy against an editor still under construction, and can end up describing behaviour that does not exist |
| `kbar`, `hotkeys-js`, `ninja-keys`, `sortablejs`, `@react-aria/dnd` | MIT / Apache-2.0 | See §3 and §4 — internals are inferred, not fetched |
| `@t3-oss/env-core` 0.13.11, `@total-typescript/ts-reset` 0.6.1 | MIT | Hand-rolled wins on dependency count; ts-reset is a preference, not a product win |

---

## Open questions

1. **Adding COOP/COEP** would enable threaded WASM, at a deploy-wide cost (embedding, iframes,
   `cross-origin` resources). Is that acceptable? Currently no such headers are sent.
2. **Is UI translation a product decision?** Every i18n recommendation is blocked on that, not on a
   library comparison.
3. **Does batch catalog ingestion need resumable upload?** The **installed** `@supabase/storage-js`
   2.115.0 (registry latest: 2.116.0) has none — verified against the full `StorageFileApi` surface
   in this working tree, with no tus support. If yes, the existing job model owns it.
4. **What does the mask encode actually cost at 25 MP?** Unmeasured; it gates any worker work.
5. **Is a pasted `javascript:` link target reachable through the text bridge?** Escaped for quoting
   but not scheme-validated in the code read; one test settles it.
6. **`@dnd-kit`'s ~21-month release gap** — acceptable stability, or a signal to prefer Atlassian's
   actively released library? Both are permissive and React 18 compatible.
7. **InstantDB's service model** produced no retrievable first-party content; its §7 row is inference.
8. **Docs truthfulness:** `docs/ui-audit.md` still claims search is not implemented, and the `.search
   kbd` CSS is orphaned. The audit document is an input to future research — stale lines in it will
   mislead the next scan, as one already misled this one.
9. **The `<kbd>` hint in the header** referenced in the original scan does not exist as an element;
   whether a visible shortcut hint is still wanted is a small design decision, not a library one.

## Sources

**Fetched 2026-09-12 (first-party):**

1. `@imgly/background-removal` — `LICENSE.md` (verbatim: "# GNU Affero General Public License,
   _Version 3, 19 November 2007_") and the package page ("free for use under the AGPL License …
   contact support@img.ly … for other licensing options"). The registry field reads
   `SEE LICENSE IN LICENSE.md`.
   https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/LICENSE.md · https://www.npmjs.com/package/@imgly/background-removal
2. BRIA RMBG-1.4 — "available as a source-available model for non-commercial use … Commercial use is
   subject to a commercial agreement with BRIA." https://huggingface.co/briaai/RMBG-1.4
3. BRIA RMBG-2.0 — "released under a CC BY-NC 4.0 license for non-commercial use."
   https://huggingface.co/briaai/RMBG-2.0
4. Model metadata (licence, downloads, last modified, ONNX file sizes) via the Hugging Face model API:
   `Xenova/modnet` → `apache-2.0`, 103,619 downloads, 2025-10-26, ≈105 MiB ONNX;
   `onnx-community/BiRefNet_lite-ONNX` → `mit`, ≈322 MiB ONNX. MiB totals are derived by summing
   `.onnx` sibling sizes, not stated on the cards.
   https://huggingface.co/api/models/Xenova/modnet · https://huggingface.co/api/models/onnx-community/BiRefNet_lite-ONNX
5. PowerSync docs — "PowerSync is made up of the PowerSync Service and a set of client SDKs."
   https://docs.powersync.com/intro/powersync-overview
6. Electric docs — "Electric Sync is a read-path sync engine for Postgres… the Electric Cloud.
   Alternatively, the Deployment guide covers how to self host." https://electric-sql.com/docs/intro
7. Zero quickstart — starters are Vite/Hono/SolidJS, Vite/Hono/React and a Cloudflare Workers variant
   running `zero-client` in a Durable Object; a server process is present in each.
   https://zero.rocicorp.dev/docs/quickstart
8. npm registry packuments (`registry.npmjs.org/<pkg>`: `dist-tags`, `time`, `license`, `repository`,
   `peerDependencies`) and weekly downloads (`api.npmjs.org/downloads/point/last-week/<pkg>`) for
   **all 90 packages named in this document**, retrieved 2026-09-12 and stored verbatim in
   `docs/research/library-upgrade-scan/registry-facts.tsv`. Every version, release date, licence,
   download count and peer range in this document comes from that file.
9. Deployed response headers — `HEAD https://stickerlab-eta.vercel.app`, HTTP/2 200, `server: Vercel`:
   `strict-transport-security`, `access-control-allow-origin: *`, `cache-control: public, max-age=0,
   must-revalidate`, and **no COOP or COEP header**.
10. Installed-package metadata read from this working tree: `@playwright/test` **Apache-2.0**;
    `vitest` MIT; `fflate` MIT; `pptxgenjs` MIT; `pdf-lib` MIT; `react` MIT; `konva` MIT;
    `zustand` MIT; `@supabase/storage-js` 2.115.0 (full `StorageFileApi` surface; no tus/resumable).

**Repository evidence:** `AGENTS.md`, `CONTEXT.md`, `HANDOFF.md`, `package.json`, `README.md`,
`docs/editor-library-research.md`, `docs/core-tools-plan.md`, `docs/slides-implementation-plan.md`,
`docs/slides-architecture.md`, `docs/ui-audit.md`, `proofs/baseline.md`, `proofs/p05-fonts.md`,
`proofs/p07-processing.md`, `proofs/p17-text-editing.md`, `e2e/proofs/text-bridge.spec.ts`,
`e2e/ui-polish.spec.ts`, `src/components/GlobalSearch.tsx`, `src/main.tsx`,
`src/lib/persistence/{repository,idb,cloud,cloudRemote,document,syncTypes}.ts`,
`src/lib/persistence/presentations/{repository,idb}.ts`,
`src/features/editor/{store,EditorPage,KonvaCanvas,maskPainter,maskUtils,useMaskBrush}.ts*`,
`src/features/exports/{renderDocument,zipExport}.ts`, `src/features/assets/validateUpload.ts`,
`src/lib/imageFormat.ts`, `src/features/presentations/rendering/{textLayout,fonts,konvaText}.ts`,
`src/features/presentations/exports/{pdf,backup}.ts`, `src/features/presentations/editor/textBridge.ts`,
`src/styles.css`, `vite.config.ts`, `index.html`, `public/`, `vercel.json`.

**Verification:** an independent reviewer re-derived the §7 persistence claims against the working
tree and cross-checked repo claims; a separate evidence auditor cross-checked every version, licence,
date and quote against `docs/research/library-upgrade-scan/registry-facts.tsv` and
`docs/research/library-upgrade-scan/fetched-quotes.md`. That audit found one wrong licence (this brief
had `@playwright/test` as MIT; it is Apache-2.0), which is corrected here, and one factual error — the
"search is not implemented" claim behind the original command-palette recommendation — which is
corrected in §3 and the executive summary. See
`docs/research/library-upgrade-scan/library-upgrade-scan-verification.md` and
`docs/research/library-upgrade-scan/library-upgrade-scan-citations.md`. Note that the audit could
cross-check stored data but not independently re-fetch, and that neither verifier had network access.
The pre-review draft is preserved at `docs/research/library-upgrade-scan/draft-pre-review.md`, and the
two verifier findings that were rejected or deferred are recorded in the provenance file.
