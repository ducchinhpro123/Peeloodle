# Libraries that could raise StickerLab's ceiling

**Question:** which libraries (or platform features) would materially level up StickerLab — the
local-first sticker editor plus the in-progress student presentation editor — without replacing the
document model, the framework, or local-first operation?

**Researched** 2026-09-12. Facts about third-party packages come from the npm registry and
first-party pages fetched that day (see Sources); claims about this repository come from reading the
working tree. Every recommendation carries its licence and latest known release. This is a decision
document, not a migration plan.

---

## Executive summary

Four independent scans (canvas/image, slides/text, persistence/sync, product-UX) reached the same
shape of answer from different directions: **the libraries that would "boot this app to another
level" are not in the core.** The engine (Konva), the persistence layer (typed repositories + outbox

- content-addressed blobs), the text pipeline, and the export compositor are already doing work that
  no drop-in library does better, and several popular candidates would actively subtract value.

What the scans _did_ find is a smaller, sharper set of real wins, and one of them is unusually
cheap:

1. **Accessibility is the single most under-served area, and the fix is two devDependencies with no
   runtime cost** — `eslint-plugin-jsx-a11y` and `@axe-core/playwright`. The repo has typed,
   hand-rolled validation everywhere but has _never_ run an a11y linter or an automated a11y audit,
   while `AGENTS.md` lists accessible names, dialog focus handling, and keyboard alternatives as
   requirements.
2. **The product has already advertised an unbuilt affordance.** The header renders a search control
   with a `<kbd>` hint and result-list styling, and `docs/ui-audit.md` records that search "honestly
   explains that it is not implemented". `AGENTS.md` forbids active-looking dead controls, so this is
   implement-or-remove. `cmdk` (MIT, headless, React 18 peer) is the smallest way to implement it and
   simultaneously fix the audit's other finding — that canvas selection is pointer-only.
3. **Exactly one drag library, at exactly two sites.** Slide reorder (P23) and the element list (P30)
   are unstarted; the sticker layer stack already has working keyboard reorder buttons. `@dnd-kit`
   (MIT) is the fit, and its `2024-12-05` last release is a maintenance fact worth weighing.
4. **Two licence traps and one non-commercial model would be easy to walk into.** `intro.js` and
   `@triplit/client` are AGPL-3.0; `@imgly/background-removal` (the package most browser
   "remove background" demos use) ships under **AGPL-3.0**; and the two BRIA RMBG models behind most
   demos are **non-commercial** (CC BY-NC 4.0 / source-available for non-commercial use). The
   permissive path out exists — `Xenova/modnet` is **Apache-2.0** at ~105 MB — but it is a real
   product commitment, not a drop-in.
5. **The biggest wins are not libraries at all.** The three highest-value items found across all four
   scans are in-repo work: a `schemaVersion` **migration** module (old documents are currently
   unreadable _and_ un-restorable while P41/P42 ship restorable backups), an **export fidelity
   preflight** (PPTX references fonts by family name and the reader substitutes metrics), and a
   **measurement** of the full-resolution mask encode before anyone builds a worker.

The rest of this document is the evidence for those five statements, a ranked shortlist with
verified licences and versions, and the anti-recommendations — including the popular options that
were examined and rejected with a reason.

---

## How to read the recommendations

Three different kinds of "level up" came out of the scans, and they should not be ranked against
each other:

| Kind           | What it buys                                               | Candidates                                                                       |
| -------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Capability** | Product surface that does not exist yet                    | `cmdk`, `@dnd-kit`, chart renderer, permissive cutout model                      |
| **Quality**    | Fewer regressions, honest failures, real a11y              | `eslint-plugin-jsx-a11y`, `@axe-core/playwright`, Playwright snapshots, `sonner` |
| **Velocity**   | Faster, safer change in a 19k-LOC codebase mid-restructure | `rollup-plugin-visualizer`, `knip`, `@t3-oss/env-core`                           |

Every cell below was fetched on 2026-09-12 unless marked. "Last release" is the publication date of
the newest version on the registry. Bundle sizes were **not** measured; none is quoted.

---

## Ranked shortlist

Ranked by expected value against effort. Everything here is licence-checked and React-18-compatible;
versions and dates were read from the registry on 2026-09-12. Bundle sizes were **not** measured, so
none is quoted.

| #   | Recommendation                                        | Licence                                                                                  | Version (last release)                              | React 18                                | Buys                                                                                                                                                         | Effort |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | An offline app shell: `vite-plugin-pwa`               | MIT                                                                                      | 1.3.0 (2026-05-05)                                  | n/a (build plugin, peer `vite ^3.1–^7`) | The app currently cannot load at all without a network — for a product whose promise is offline-first, this is the gap between the promise and the behaviour | S–M    |
| 2   | `eslint-plugin-jsx-a11y` + `@axe-core/playwright`     | MIT / **MPL-2.0**                                                                        | axe-core/playwright 4.13.0 (2026-08-11)             | n/a                                     | Automated a11y checks inside commands that already run; closes a verified tooling gap                                                                        | S      |
| 3   | `cmdk` (+ optional `fuse.js` for cross-entity search) | MIT / Apache-2.0                                                                         | cmdk 1.1.1 (2025-03-14); fuse.js 7.5.0 (2026-07-13) | cmdk `^18 \|\| ^19` ✅                  | Implements the advertised-but-missing search and the missing keyboard path                                                                                   | S–M    |
| 4   | Playwright snapshot assertions + traces               | **Apache-2.0** (already a dep, verified in `node_modules/@playwright/test/package.json`) | `@playwright/test` ^1.63.0                          | n/a                                     | Turns `/tmp` screenshots and 12 known-failing overflow checks into committed regressions                                                                     | S      |
| 5   | `@dnd-kit/core` + `@dnd-kit/sortable`                 | MIT                                                                                      | 6.3.1 (2024-12-05) / 10.0.0 (2024-12-04)            | `>=16.8` ✅                             | Drag reorder with announcements at P23 + P30 only                                                                                                            | M      |

**Adopt when the trigger arrives, not now** — each has a concrete trigger, and adopting early buys
nothing:

| Candidate                                    | Licence   | Version                                      | Trigger                                                                                   |
| -------------------------------------------- | --------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `sonner`                                     | MIT       | 2.0.8 (2026-08-09), `react: ^18 \|\| ^19` ✅ | The first genuinely off-screen async flow (P40/P43/P58/P60)                               |
| `rollup-plugin-visualizer` + `knip`          | MIT / ISC | 7.1.1 (2026-08-14) / 6.35.1 (2026-09-09)     | Now-ish, as devDependencies: Konva is already lazy-loaded and someone must see the chunks |
| `@tanstack/react-virtual`                    | MIT       | 3.14.12 (2026-09-11)                         | A catalog page that renders hundreds of assets _and_ paging has been ruled out            |
| One canvas-first chart renderer (`chart.js`) | MIT       | 4.5.1 (2025-10-13)                           | Charts become a real requirement — then pick one renderer, never two                      |
| `msw`                                        | MIT       | 2.15.0 (2026-07-08)                          | P46+, when hostile cloud behaviour must be induced on demand                              |

**Deliberately not ranked:** automatic background removal. The permissive option exists
(`Xenova/modnet`, Apache-2.0) but it is a 105 MB first-run download plus licence review, honest
progress/cancel/failure UI, and quality expectations — a product decision, not a dependency.

---

## 1. An offline app shell — the promise the app does not yet keep

This is the finding that most changes the answer to "what would boot this app to another level",
and it is not about a canvas or a data library. The repo has **no service worker, no web app
manifest, no `theme-color`, and no PWA tooling of any kind**: `index.html` carries only a viewport
meta, `public/` holds icons but no manifest, and a repo-wide search for `serviceworker`,
`registerSW`, `workbox`, `vite-plugin-pwa` and `webmanifest` returns nothing. Offline-first here
extends to the _data_ (IndexedDB documents, immutable blobs, local save/reopen) but **not to the
application itself**: with no network, a reload cannot load the app at all.

For a product whose stated core is "core editing, saving, reopening and PNG export must work without
cloud credentials", and whose likely deployment is a school with unreliable wifi and tablets, an
installable offline shell is the difference between the promise and the behaviour.

- **`vite-plugin-pwa`** 1.3.0 — MIT, 2026-05-05, peer `vite ^3.1.0 || ^4 || ^5 || ^6 || ^7` (the repo
  is on Vite 6 ✅), ~3.4M weekly downloads. Build-time only: it generates the manifest, the precache
  list for the app shell, and the service worker. `workbox-window` 7.4.1 (MIT) comes with it for the
  update lifecycle.

Caveats worth writing into the plan before adopting, because a service worker changes caching
semantics for the whole app:

1. **Never let the worker touch editable data.** Precache the app shell only; do not intercept
   Supabase, Storage, or any API request. Documents live in IndexedDB and their truth must not move.
2. **Stale-version handling is a support cost, not a free win.** With `autoUpdate` the old bundle can
   survive a deploy; a prompt-on-update flow ("New version ready — reload") is the honest option and
   must not interrupt unsaved work.
3. **The current deploy already behaves well here** — `cache-control: public, max-age=0,
must-revalidate` — so index and assets are revalidated; the worker must not fight that.
4. Service workers need HTTPS or localhost; the Vercel deployment is HTTPS, so this is satisfied.
5. It does not replace the storage layer, the autosave debounce, or the save-state pill, and it must
   not be presented to users as "your work is backed up".

## 2. Accessibility — the cheapest real upgrade

The scans found no a11y tooling in the repo: `package.json` lists `@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`, and **no** a11y plugin. Automated
accessibility checks are therefore absent, while `AGENTS.md` requires "semantic controls, visible
focus, accessible names, dialog focus handling, and keyboard alternatives for core canvas
operations", and `docs/ui-audit.md` already records the gap that canvas selection is pointer-only.

- **`eslint-plugin-jsx-a11y`** — MIT, static checks for missing labels, ARIA misuse, and click
  handlers on non-interactive elements. It hooks into the `npm run lint` that verification already
  runs. Expect a small burst of legitimate fixes on first run.
- **`@axe-core/playwright`** — **MPL-2.0** 4.13.0 (2026-08-11), peer `playwright-core >= 1.0.0`
  (the repo has `@playwright/test` ^1.63.0). It runs axe inside the existing Playwright suite across
  the four routes at the three documented viewports (1440×900, 1024×768, 390×844). MPL-2.0 is
  file-level copyleft, not a permissive licence — it is fine for a devDependency that is not
  redistributed in the app bundle, but it should be recorded rather than assumed.

**Why this ranks first:** every other item on the list is a new capability or a deferred decision,
while this one addresses a requirement that is already written down, on a surface a school-facing
product will be judged on, for two devDependencies and no runtime cost.

## 3. A command palette for an affordance that already exists

The shell renders a search control with a `<kbd>` hint and `.global-search-result` styling, and the
audit says search is not implemented. Under `AGENTS.md`, "unavailable features need an honest
explanation, not active-looking dead controls" — so this is decide-and-do, and the two outcomes are
"remove the control" or "implement it".

`cmdk` 1.1.1 (MIT, `react: ^18 || ^19`) is headless: it supplies the filtering/selection primitives
and the repo builds the chrome from its own `DialogContent` and tokens, which keeps the
one-dialog-system rule intact. It also gives keyboard users a route to actions and documents, which
is the other half of the pointer-only finding. If the palette must search _content_ across
documents, templates and catalog assets rather than one flat action list, `fuse.js` 7.5.0
(Apache-2.0, 2026-07-13) is the small, framework-free index for it — optional, and only if cmdk's
own filtering stops being enough.

Constraints to honour when wiring it: canvas shortcuts must stay inert while a dialog or text field
is focused (a rule the current hand-rolled `keydown` handling already encodes), and the palette must
not become a second navigation system alongside the router.

Rejected alternatives: `kbar` 1.0.0 (MIT, React 18 peer OK) ships its own palette UI, styling and
animation that would collide with the token system; `hotkeys-js` 4.0.8 is vanilla-global with no
React lifecycle; `ninja-keys` is a web component, the least composable option in a React-strict
shell. `react-hotkeys-hook` 5.3.3 (MIT, React 18 OK) is a _conditional_ swap for the existing
hand-rolled shortcut dispatch — only worth it once the shortcut table outgrows one readable
dispatcher.

## 4. One drag library, at two sites, not everywhere

Landing sites, in order of real value: presentation slide reorder/delete (P23, unchecked), the
accessible element list (P30, unchecked), the sticker layer stack (already has `ArrowUp`/`ArrowDown`
buttons), pack member ordering, and admin catalog collection ordering (P52).

`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 (MIT, peer `react: >=16.8`) supplies pointer and
keyboard sensors, sortable lists, and screen-reader announcements for position changes. The
selection criterion is not popularity but focus: **a drag library that hides focus management behind
a pointer-only implementation would be a regression in this repo**, which has an explicit
focus-restoration discipline for dialogs and keyboard-reachable list rows.

Two caveats worth stating plainly:

- **Maintenance signal:** the core's newest release is 2024-12-05 and sortable's is 2024-12-04 —
  roughly 21 months old at the time of writing, versus `@atlaskit/pragmatic-drag-and-drop` 3.1.0
  (Apache-2.0, 2026-08-29). Recent releases are not proof of health, and a stable library is not a
  problem, but the age is a fact the decision should acknowledge rather than ignore.
- **The drag result must be an array move fed into the existing store command**, so one completed
  drag stays one undo entry and selection still never dirties the document.

Rejected: `sortablejs` 1.15.7 mutates the DOM list directly, fighting React's ownership of the same
list; `@react-aria/dnd` 3.12.1 would introduce a second collection/component system beside Radix and
the hand-rolled primitives, against the reuse-first rule; native HTML5 DnD has no touch support,
which matters for the supported 390×844 viewport.

## 5. Feedback for long-running work — one system, not two

Status is currently inline and truthful (`saveStatusLabel` with `data-state="saving" |
"saved-locally" | "save-failed"`, `.asset-error`, `.presentation-local-status`, `NoticeDialog`), and
the audit spent a pass _removing_ non-functional controls.

So a toast library is only justified where the result is genuinely off-screen or asynchronous:
pack ZIP export, PPTX/PDF export progress and cancellation (P40), backup/restore (P43), per-file
catalog upload status (P58), publish/archive (P60). `sonner` 2.0.8 (MIT, `react: ^18 || ^19`) has
the best fit for promise-style loading→success/error flows. `react-hot-toast` 2.6.0 (MIT) is a
fine smaller alternative.

**The rule to write down before adopting either:** toasts for background/long-running results only,
never for save state — otherwise the app ends up with two feedback systems for one event, which is
exactly the redundancy a previous audit pass removed.

Bounded progress needs no library: `<progress>` against the repo's own counters is more honest than
an indeterminate spinner.

## 6. Velocity: see the chunks, find the dead code

`KonvaCanvas` is already `React.lazy`-loaded and lazy export loading is planned, which means someone
must actually see the chunk graph. `rollup-plugin-visualizer` 7.1.1 (MIT) is a Vite plugin
devDependency with no runtime cost. `knip` 6.35.1 (ISC) is worth a trial in a 19k-LOC codebase
mid-restructure (sticker vs presentation families, template/pack surfaces) — with the honest caveat
that dynamic imports (which this repo has) are its classic false-positive source.

`@t3-oss/env-core` 0.13.11 (MIT) validates `VITE_*` variables, but the lazy version is ~20 lines:
the repo's actual need is to express "Supabase is optional for local-first mode" and to fail loudly
on a malformed URL. Hand-rolled wins on dependency count here.

Rejected for now: `msw` 2.15.0 (its value starts when hostile cloud behaviour must be induced, i.e.
P46+), `@vitest/browser` 5.0.0 (**peer `vitest: 5.0.0` — incompatible with the repo's
`vitest ^2.1.8`, and it would add a second browser runner beside Playwright**),
`@total-typescript/ts-reset` 0.6.1 (a team preference, not a product win).

## 7. Persistence and sync: do not adopt a sync engine

This is the strongest "no" in the research, and it is evidence-based rather than conservative. The
repo already implements the hard part of local-first sync:

- a **bounded, replay-safe outbox** where the head snapshot's `operationId` is the idempotency key
  the RPC dedupes on, with the queue bounded to two snapshots per resource
  (`src/lib/persistence/repository.ts`);
- **optimistic concurrency on an explicit revision** — the server RPC takes `expected_revision` and
  returns `{ resource, original, conflict }`, and conflicts produce a _copy_ via `acknowledge`'s
  notice, never an overwrite (`src/lib/persistence/cloudRemote.ts`, `cloud.ts`);
- **content-addressed binaries** — SHA-256 via Web Crypto, path `${ownerId}/${hash}`,
  `upsert:false` with 409 treated as success, then re-download and re-hash before acknowledging;
- **idempotent guest→account migration** by construction, with target IDs derived from
  `sha256(ownerId, kind, id)` and guest originals retained until cloud writes confirm;
- **document + binaries committed in one IndexedDB transaction** with write-time referential
  integrity and immutable media identity;
- undo with **gesture boundaries, a 50-entry bound, and history entries that pin the asset/mask
  records they reference**.

Against that baseline, every offline-first engine examined requires a **server component** and owns
its own local model and sync protocol. First-party documentation confirms the service requirement
directly: PowerSync "is made up of the **PowerSync Service** and a set of client SDKs"; Electric sync
is a "read-path sync engine for Postgres" deployed via Electric Cloud or self-hosted; Zero's
quickstart starters run a server process in the loop. Adopting any of them means discarding the
outbox/conflict reasoning above and re-deriving it on someone else's semantics, while keeping the
invariants they do not provide (atomic doc+binary commits, immutable media, additive single-DB
schema).

| Engine                     | Service required                               | Verdict                                                                                                                                           |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electric                   | Yes (Cloud or self-host, in front of Postgres) | Reject — drops `expected_revision` conflict semantics                                                                                             |
| PowerSync                  | Yes (service + connector you write)            | Reject — closest analogue to the outbox, still displaces it                                                                                       |
| Zero (Rocicorp)            | Yes (`zero-cache`)                             | Reject — replaces the sync half only, so you run both                                                                                             |
| RxDB replication           | Yes for replication                            | Reject — second revision system beside the RPC one                                                                                                |
| Jazz / InstantDB / Triplit | Yes (hosted or self-host)                      | Reject — owns the data model, i.e. replaces the Supabase stack                                                                                    |
| Liveblocks                 | Yes (hosted, server auth endpoint)             | Reject — session-oriented, replaces nothing here                                                                                                  |
| Yjs / Loro / Automerge     | Provider needed in practice                    | Reject — merged CRDT state is not a validated document; no blob atomicity; co-editing is deferred by product decision                             |
| Supabase Realtime          | Already in the stack                           | **The one positive:** a subscription that wakes the existing `sync()` instead of a manual "Refresh cloud" — a notification channel, never storage |

Storage adapters: `idb` 8.0.3 (ISC, 2025-05-07) would collapse ~40 lines of plumbing and touch
nothing else; `dexie` 4.4.6 (Apache-2.0, 2026-09-10) adds declarative upgrades and live queries but
relocates the version chain that `HANDOFF.md` pins to `STICKERLAB_DB_VERSION` in
`src/lib/persistence/idb.ts`. Dexie gives nothing for referential integrity, media immutability, or
conflict copies — those are app logic. OPFS would break doc+binary atomicity.
`@sqlite.org/sqlite-wasm` 3.53.4-build1 (Apache-2.0, 2026-09-08) is the maintained SQLite option if
one is ever wanted — `wa-sqlite` 1.0.0 is not: it has **no licence field and no repository** in its
registry metadata and its newest release is 2024-01-05.

History: `zundo` 2.3.0 (MIT, 2024-11-17, peer `zustand ^4.3 || ^5`) can replace the two
past/future arrays but not the rules attached to them — it cannot express the coupled
`assetsFor`/`masksFor` media retention that makes "delete a layer, undo it" work. `immer` 11.1.18
(MIT, 2026-08-19) inverse patches are a _performance_ question (the current push does a JSON
round-trip clone through the validator, 50 deep, and validates on every push) and need a profile
before adoption — not a simplification.

## 8. Canvas and image: nothing to add, two things to fix

The repo already uses the right native primitives — `createImageBitmap` with
`imageOrientation: 'from-image'`, `premultiplyAlpha: 'none'`, `resizeQuality: 'high'` and two
fallbacks, in both the compositor and upload validation. No decoder library replaces that, and the
compositor's `CanvasLike` duck type already accepts `convertToBlob`, so a worker offload (if ever
needed) is an injection change rather than a rewrite.

Two concrete, library-free improvements did fall out:

- **The outline is a separable box-max dilation, and the code itself names the upgrade** — "separable
  box max (O(WH)); Euclidean DT if round corners matter". An exact Euclidean distance transform
  removes square-footprint artefacts at large outline widths, matches the round-capped brush, and is
  one function. Preview/export pixel parity must be re-proved (`e2e/render-parity.spec.ts`,
  `e2e/outline.spec.ts`).
- **Nothing measures the full-resolution mask encode.** Every paint stroke rasterises at full asset
  resolution, encodes via `canvas.toBlob` on the main thread, then writes to IndexedDB. The recorded
  measurements cover the _preview raster_ path only and do not transfer. Measure it (25 MP stroke,
  stroke-end latency + peak heap) **before** building anything.

Alpha matting / background removal — the honest picture:

| Option                              | Licence (verified)                                                            | Reality                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@imgly/background-removal` 1.7.0   | **AGPL-3.0** (its `LICENSE.md` is the AGPL; other licensing via img.ly sales) | Copyleft obligations for a networked app; not a casual dependency                                                                            |
| BRIA RMBG-1.4                       | source-available, **non-commercial** (commercial requires agreement)          | The model behind many demos                                                                                                                  |
| BRIA RMBG-2.0                       | **CC BY-NC 4.0**                                                              | Same wall, newer model                                                                                                                       |
| `Xenova/modnet`                     | **Apache-2.0**, ~105 MB ONNX, 103,619 downloads, last modified 2025-10-26     | The permissive path; portrait matting quality                                                                                                |
| `onnx-community/BiRefNet_lite-ONNX` | **MIT**, ~322 MB ONNX                                                         | Permissive, but a large first-run download                                                                                                   |
| `@mediapipe/tasks-vision` 1.0.1     | Apache-2.0                                                                    | Person/selfie-oriented; the repo's own audit called it "legal but product-unfit" for pets and objects, which is what StickerLab's artwork is |

Runtimes: `onnxruntime-web` 1.29.0 (MIT) or `@huggingface/transformers` 4.2.0 (Apache-2.0). Two
verified constraints stack on top of the licence question:

- **The size is not a rounding error for an offline-first app.** 105 MB (MODNet) to 322 MB
  (BiRefNet-lite) of weights against a bundle whose largest chunk is currently 314 kB.
- **The deploy cannot run threaded WASM today.** `curl -I https://stickerlab-eta.vercel.app` returns
  HTTP/2 200 with `strict-transport-security` and nothing else in the cross-origin family — **no
  `Cross-Origin-Opener-Policy` and no `Cross-Origin-Embedder-Policy`** — so `crossOriginIsolated` is
  false and multi-threaded inference is unavailable. A cutout model would run single-threaded, or the
  deploy would need COOP/COEP added (which affects embedding, iframes, and any `cross-origin`
  resources). Verified 2026-09-12.

The integration seam, if this is ever approved, is small: `applyMask(layerId, uuid, blob)` already
takes an image-local mask blob, and preview, export and ZIP already handle `maskKey`.

Rejected: `wasm-vips` 0.0.18 (MIT) would add a second browser imaging stack while the server already
runs native libvips via sharp behind an unmounted probe; `glfx` 0.0.4 (MIT, 2016-12-08) and similar
WebGL filter libraries would fork the single preview/export compositor; `jimp` duplicates codecs the
platform already provides; `exifr` 7.1.3 (MIT, 2021-08-05) is unnecessary because orientation is
already applied at decode — though note the latent asymmetry the scan found: the byte-level JPEG
header parser has no EXIF handling, so an orientation-6/8 JPEG can size differently between header
and decode. That is latent today (the server rejects JPEG entirely) and becomes live at catalog
ingestion.

## 9. Slides and text: the architecture is already right; fix the promises

The presentation text pipeline is provably correct at the level it needs to be: one authoritative
paragraph/run model, one injected-measure layout service, a DOM overlay for caret work, Konva for
painting, and an **executed** proof asserting DOM↔canvas agreement (≤2 u vertical centres, ≤2.5 u
left, ≤3 u right, Konva↔canvas ≤0.5 u) on Vietnamese text. PPTX emits native runs, bullets with
explicit numbering, hyperlinks and shapes, verified through LibreOffice → PDF at 960×540 pt.

Therefore the highest-confidence line in this whole document is a **"do not add"**: adding
`harfbuzzjs` 1.6.1 (MIT), `fontkit` 2.0.4 (MIT) or `opentype.js` 2.0.0 (MIT) as a _layout_ engine
would create a second text engine and put the measured parity property at risk. Shaping libraries
only pay off when shaping without a browser, which this architecture deliberately avoids. Likewise
`hypher` 0.2.5 (BSD-3-Clause, 2016-12-19) and `linebreak` 1.1.0 (MIT, 2022-05-20) address scripts
(Thai/Khmer/CJK) outside the current English/Vietnamese scope — and `Intl.Segmenter` is the
zero-dependency option if that day comes.

The real gap is not a library, it is a **promise**: pptxgenjs 4.0.1 (MIT, installed) writes text with
a font _family name_, and a reader without those fonts substitutes metrics. The architecture already
declines to promise font embedding. An export preflight that lists unresolved fonts, overflow, and
"this will export as a picture" turns that from a latent support problem into an honest feature.

If charts become a real requirement, choose **one** renderer and accept its consequence: a
canvas-first library (`chart.js` 4.5.1 MIT, or `echarts` 6.1.0 Apache-2.0) captured as a PNG travels
the existing image path to both PDF and PPTX as a single picture, preserving preview↔export parity.
pptxgenjs native charts would be editable in PowerPoint but invisible in the app, which is a
permanent preview/export divergence.

Rejected: `jsPDF`, `pdfmake` 0.3.11 (MIT), `@react-pdf/renderer` 4.9.0 (MIT) — the current PDF
contract is deliberately raster via pdf-lib 1.17.1 (MIT); a selectable-text PDF also needs
`@pdf-lib/fontkit`, which is not even installed. `mermaid` 12.0.0 (MIT) and `katex` 0.18.7 (MIT) are
large runtimes whose output is a picture in PPTX anyway (and Mermaid source is an injection surface).
`JSZip` is already present transitively and `fflate` 0.8.3 (MIT) is already direct — the repo
currently has _two_ ZIP implementations (a hand-rolled STORE-only writer in `zipExport.ts` and
fflate in the presentation backup), which is a consolidation opportunity, not a library gap.
Server-side or WASM LibreOffice conversion would break browser-only operation; its correct role here
is as a test reader, which is how it is already used.

## 10. The three biggest wins are not libraries

Ranked by expected value, and all in-repo:

1. **A `schemaVersion` migration module.** `parseProjectDocument` hard-fails on any unknown
   `schemaVersion` with `unsupported_schema`; list and detail loaders skip unreadable rows. So an old
   document is not corruptible — it is _invisible_. Meanwhile P41/P42 make portable, restorable
   backups a deliverable, which guarantees old-version documents will appear. `AGENTS.md` requires
   invalid or unsupported versions to be a _recoverable_ error. No library covers this shape
   (two document kinds in one additive DB); it is a small module keyed by `schemaVersion`, run before
   validation and during restore.
2. **The export fidelity preflight** described in §9.
3. **The mask-encode measurement** described in §8 — the decision gate for any worker work.

Also worth noting because it is a genuine capability with no dependency: a sticker **sheet/print
sheet** composer over the existing `renderDocument` plus `pdf-lib` (already a client dependency), and
multiple selection of pack members for batch actions.

---

## Anti-recommendations (examined, rejected, with the reason)

| Rejected                                                                                           | Licence                                      | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intro.js` 8.5.0                                                                                   | **AGPL-3.0**                                 | Licence is the risk, not the code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@triplit/client` 1.0.50                                                                           | **AGPL-3.0-only**                            | Same; also requires its own backend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@imgly/background-removal`                                                                        | **AGPL-3.0**                                 | Copyleft obligations; commercial licensing is a purchase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| BRIA RMBG-1.4 / 2.0                                                                                | Non-commercial (CC BY-NC / source-available) | Product cannot ship on these weights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@sentry/react` 10.74.0, Highlight.io, OTel web                                                    | MIT / —                                      | Network egress, an account, a purchase and session data in an app whose promise is offline-with-no-credentials; `AGENTS.md` forbids unapproved services                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `web-vitals` 6.2.1                                                                                 | Apache-2.0                                   | Measures but has nowhere to report; INP on brush strokes is better obtained from the repo's own harness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `motion` 13.2.0, `react-spring` 10.0.4                                                             | MIT                                          | Reduced motion is already a global CSS rule; JS-driven animation escapes it and needs its own guard. Value today ≈ 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@formkit/auto-animate` 0.10.0                                                                     | MIT                                          | Cosmetic until drag reorder exists; revisit then, with its own reduced-motion guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `react-easy-crop` 6.2.3, `react-zoom-pan-pinch` 4.2.0, `react-advanced-cropper`                    | MIT                                          | Each introduces a second crop/zoom coordinate system or DOM transform wrapper, contradicting the non-destructive, mask-aligned, single-clamp invariants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `uppy` 6.0.1                                                                                       | MIT                                          | A second upload state machine overlapping the planned durable job model (P54/P55 reserved paths, leases, idempotent retries). Its one genuinely unclaimed capability — resumable upload — is confirmed absent from the installed stack: `@supabase/storage-js` 2.115.0 exposes `upload`, `update`, `upsert`, `move`, `copy`, `remove`, `list`, `createSignedUrl(s)`, `createSignedUploadUrl`, `uploadToSignedUrl`, `getPublicUrl`, `download`, `info`, `exists`, `purgeCache`, `transform`, and **no** `resumableUpload` or tus support. The capability gap is real; the right owner for it is the existing job model, not a second uploader UI |
| `react-dropzone` 20.1.1                                                                            | MIT                                          | Its filters are a UX pre-filter, not a trust boundary — `validateUpload.ts` stays the gate either way. Reconsider only for P58 folder drops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `react-hook-form` 7.88.0, `@conform-to/react` 1.21.1                                               | MIT                                          | Two-field dialogs; conform additionally assumes a server-action architecture this app does not have                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `zod` 4.6.2, `valibot` 1.5.0                                                                       | MIT                                          | Re-authors working, tested boundary parsers and adds a dependency — and adds no migration, which is the actual gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `i18next` 26.4.2 / `react-i18next` 17.0.13, Lingui 6.7.0, `typesafe-i18n` 5.27.1, Paraglide 2.25.2 | MIT                                          | UI translation is an unmade product decision; the Vietnamese requirement is already solved at the font/metrics layer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `react-joyride` 3.2.0, `driver.js` 1.8.0                                                           | MIT                                          | Tours hard-code selectors and copy against an editor still under construction, and can end up describing behaviour that does not exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `kbar`, `hotkeys-js`, `ninja-keys`, `sortablejs`, `@react-aria/dnd`                                | MIT / Apache-2.0                             | See §3 and §4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `satori` 0.33.4                                                                                    | **MPL-2.0**                                  | Not permissive; the text pipeline does not need an HTML→SVG renderer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `wa-sqlite` 1.0.0                                                                                  | **none declared**                            | No licence field, no repository, last release 2024-01-05                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## Open questions

1. **(Answered, §8)** The deploy sends no COOP/COEP, so threaded WASM is unavailable today. The open
   part is whether adding those headers is acceptable — it is a deploy-wide decision with consequences
   beyond cutout.
2. **Is UI translation a product decision?** Every i18n recommendation is blocked on that, not on a
   library comparison.
3. **(Answered, §7)** `@supabase/storage-js` 2.115.0 has no resumable upload. The open part is whether
   batch catalog ingestion (P54/P58) needs it badly enough to own it in the existing job model.
4. **What does the mask encode actually cost at 25 MP?** Unmeasured; it gates the worker question.
5. **The EXIF orientation asymmetry** (header dimensions vs decode dimensions for orientation-6/8
   JPEG) is inferred from two code paths, not reproduced in a test.
6. **`@dnd-kit`'s 21-month release gap** — acceptable stability or a signal to prefer Atlassian's
   actively released library? Both are permissive and React 18 compatible.
7. **InstantDB's service model** could not be verified: its docs page yielded no retrievable content,
   so its row in §7 rests on the general pattern of hosted local-first backends, not on a fetched
   first-party statement. It is marked as such rather than asserted.

## Sources

**Fetched 2026-09-12 (first-party):**

1. `@imgly/background-removal` — package page and `LICENSE.md` (AGPL-3.0, "free for use under the
   AGPL License… contact support@img.ly for other licensing options").
   https://www.npmjs.com/package/@imgly/background-removal · https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/LICENSE.md
2. BRIA RMBG-1.4 model card — "available as a source-available model for non-commercial use. To
   purchase a commercial license…". https://huggingface.co/briaai/RMBG-1.4
3. BRIA RMBG-2.0 model card — "released under a CC BY-NC 4.0 license for non-commercial use".
   https://huggingface.co/briaai/RMBG-2.0
4. `Xenova/modnet` and `onnx-community/BiRefNet_lite-ONNX` model metadata (licence, downloads, last
   modified, ONNX byte totals) via the Hugging Face model API.
   https://huggingface.co/api/models/Xenova/modnet · https://huggingface.co/api/models/onnx-community/BiRefNet_lite-ONNX
5. PowerSync documentation — "PowerSync is made up of the PowerSync Service and a set of client
   SDKs". https://docs.powersync.com/intro/powersync-overview
6. Electric documentation — "Electric Sync is a read-path sync engine for Postgres", Electric Cloud
   or self-host. https://electric-sql.com/docs/intro
7. Zero quickstart — server-side starters. https://zero.rocicorp.dev/docs/quickstart
8. npm registry metadata (`registry.npmjs.org/<pkg>`: `dist-tags`, `time`, `license`,
   `peerDependencies`) and weekly download counts (`api.npmjs.org/downloads/point/last-week/<pkg>`)
   for every package named in this document, retrieved 2026-09-12. Versions and dates in the tables
   are from this source. Examples: `@dnd-kit/core` 6.3.1 (2024-12-05, MIT); `cmdk` 1.1.1
   (2025-03-14, MIT, `react: ^18 || ^19`); `sonner` 2.0.8 (2026-08-09, MIT, `react: ^18 || ^19`);
   `@axe-core/playwright` 4.13.0 (2026-08-11, MPL-2.0); `@atlaskit/pragmatic-drag-and-drop` 3.1.0
   (2026-08-29, Apache-2.0); `intro.js` 8.5.0 (AGPL-3.0); `@triplit/client` 1.0.50 (AGPL-3.0-only);
   `wa-sqlite` 1.0.0 (no licence field, no repository); `@vitest/browser` 5.0.0 (peer `vitest: 5.0.0`).

9. Deployed response headers — `HEAD https://stickerlab-eta.vercel.app`, HTTP/2 200, `server: Vercel`,
   headers observed: `strict-transport-security`, `access-control-allow-origin: *`,
   `cache-control`, `content-type`. **No `cross-origin-opener-policy` and no
   `cross-origin-embedder-policy`.** Fetched 2026-09-12.
10. `@supabase/storage-js` 2.115.0 — read from the installed package in this working tree
    (`dist/index.d.mts`, `package.json`): the `StorageFileApi` surface and the absence of any
    tus/resumable method (word-boundary search returns nothing).

**Repository evidence (read from the working tree):** `AGENTS.md`, `CONTEXT.md`, `HANDOFF.md`,
`package.json`, `README.md`, `docs/editor-library-research.md`, `docs/core-tools-plan.md`,
`docs/slides-implementation-plan.md`, `docs/slides-architecture.md`, `docs/ui-audit.md`,
`proofs/baseline.md`, `proofs/p05-fonts.md`, `proofs/p07-processing.md`, `proofs/p17-text-editing.md`,
`e2e/proofs/text-bridge.spec.ts`, `src/lib/persistence/{repository,idb,cloud,cloudRemote,document,syncTypes}.ts`,
`src/lib/persistence/presentations/{repository,idb}.ts`, `src/features/editor/{store,EditorPage,KonvaCanvas,maskPainter,maskUtils,useMaskBrush}.ts*`,
`src/features/exports/{renderDocument,zipExport}.ts`, `src/features/assets/validateUpload.ts`,
`src/lib/imageFormat.ts`, `src/features/presentations/rendering/{textLayout,fonts,konvaText}.ts`,
`src/features/presentations/exports/{pdf,backup}.ts`, `src/features/presentations/editor/textBridge.ts`,
`src/styles.css`, `vite.config.ts`.

**Method note:** the four dimension scans were produced by subagents that had only file access, so
their external-package cells were left as `TODO-VERIFY`; the registry, model-card and documentation
facts above were fetched by the lead and merged in. Bundle sizes and benchmarks were not measured
anywhere in this document and none is quoted.
