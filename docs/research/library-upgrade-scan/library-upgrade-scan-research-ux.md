# Research: library-upgrade scan — product velocity and UX quality (StickerLab)

**Dimension:** motion/interaction, drag+reorder, command palette/shortcuts, virtualization, forms+validation,
feedback/status, onboarding tours, error+perf observability, i18n, dev velocity/quality, a11y beyond Radix,
crop/pan/zoom and upload UX.

**Explicitly out of scope (already settled elsewhere):** canvas engines, full editor SDKs, sync/persistence,
slides/text engines. `docs/editor-library-research.md` already resolved Konva vs Fabric/Polotno/CE.SDK/Pintura/
Filerobot/TOAST UI/tldraw. Nothing below proposes replacing Konva, React, Vite, Zustand, or the serializable
document model.

**Method limitation, stated up front:** this session had **no network tooling** — only file-read, file-write,
and a supervisor channel. Therefore **no URL was fetched, and no licence, version, release date, or bundle size
below was verified.** Per the task rule ("verify them or omit them"), every such cell reads literally
`TODO-VERIFY`. Part 2 keeps the columns and empties them rather than guessing. Part 3 is the mechanical pass
that fills them. All repo statements in Part 1 are direct reads of the working tree this session, and every
judgement of effort/risk/fit is marked **Inference**.

---

## Part 0 — What is actually in this repo right now (verified locally this session)

| Fact                                                                                                                                                                                                                                                                                                         | Evidence (file read this session)                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No animation, toast, DnD, forms, virtualisation, i18n, command-palette, analytics/observability, or a11y-testing dependency exists.                                                                                                                                                                          | `package.json` — full dependency and devDependency lists contain none.                                                                                                                                                                                                                                                                                                                  |
| No `eslint-plugin-jsx-a11y` (and no `eslint-plugin-react`) installed: lint is `@eslint/js` + `typescript-eslint` + `react-hooks` + `react-refresh`.                                                                                                                                                          | `package.json` scripts/deps.                                                                                                                                                                                                                                                                                                                                                            |
| Konva canvas is code-split with `React.lazy(() => import('./KonvaCanvas'))`.                                                                                                                                                                                                                                 | `src/features/editor/EditorPage.tsx:37`.                                                                                                                                                                                                                                                                                                                                                |
| The layer stack is hand-rolled: per-row kind tag, **rename `<input>`**, visibility, lock, **`ArrowUp`/`ArrowDown` reorder**, duplicate, delete. No drag reorder.                                                                                                                                             | `EditorPage.tsx` `LayersInspector` (`reorderLayer(layer.id, 'up' \| 'down')`).                                                                                                                                                                                                                                                                                                          |
| A second, simpler layer list exists in the Position tab as `<ul className="layer-list">` buttons.                                                                                                                                                                                                            | `EditorPage.tsx` `Inspector` → `Tabs.Content value="position"`.                                                                                                                                                                                                                                                                                                                         |
| Upload validation is hand-rolled and strict: 15 MB / 25 MP caps, magic-byte sniffing, declared-vs-sniffed MIME agreement, animated-PNG and animated-WebP detection, GIF rejection, SVG rejection by label _and_ by prefix markup sniff, decode via `createImageBitmap` with `HTMLImageElement` fallback.     | `src/features/assets/validateUpload.ts`.                                                                                                                                                                                                                                                                                                                                                |
| Reduced motion is **already handled**, twice: a global `@media (prefers-reduced-motion: reduce)` rule killing all transitions/scroll-behavior, and the only keyframe animation (dialog `reveal`, 180 ms opacity) wrapped in `@media (prefers-reduced-motion: no-preference)`.                                | `src/styles.css`.                                                                                                                                                                                                                                                                                                                                                                       |
| Everything else animates with 120–160 ms CSS `transition`s (buttons, features, inspector switch).                                                                                                                                                                                                            | `src/styles.css`.                                                                                                                                                                                                                                                                                                                                                                       |
| The header advertises a search affordance with a `<kbd>` hint and a global-search result list, but search is documented as not implemented.                                                                                                                                                                  | `src/styles.css` (`.search kbd`, `.global-search-input`, `.global-search-result`); `docs/ui-audit.md` ("Search and notifications still honestly explain that they are not implemented").                                                                                                                                                                                                |
| Sticker tray is a horizontal flex rail with fixed-basis thumbs — small, fixed catalogue, not a growing grid.                                                                                                                                                                                                 | `src/styles.css` (`.asset-items`, `.asset-item`s, `.catalog-asset`); `src/features/editor/catalog.ts` (`STICKER_CATALOG = [...ILLUSTRATIONS, ...TEMPLATE_PHOTOS, ...25 named cutouts]`). Exact entry count **TODO-VERIFY** (counts of `ILLUSTRATIONS`/`TEMPLATE_PHOTOS` not read); `docs/ui-audit.md` describes 25 cutouts + 8 illustrations + 6 photo stand-ins ⇒ ≈39 — **Inference**. |
| Pack detail renders `.pack-sticker-row` items in a scroll-bounded list (240 px).                                                                                                                                                                                                                             | `src/styles.css` (`.pack-stickers-list`, `.pack-sticker-row`, `.pack-detail`). Whether member order is user-editable **TODO-VERIFY** (ordering component not read).                                                                                                                                                                                                                     |
| Presentation editor already has a slide rail rendered as `.presentation-slide-card` with `aria-current`; slide add/duplicate is P22, **reorder/delete is P23 and unchecked**.                                                                                                                                | `src/styles.css`; `docs/slides-implementation-plan.md` (P22/P23 rows).                                                                                                                                                                                                                                                                                                                  |
| Canvas zoom/fit has exactly one clamp (0.25–4) in `viewGeometry.ts`, and the handoff forbids a second zoom implementation.                                                                                                                                                                                   | `HANDOFF.md` guardrails.                                                                                                                                                                                                                                                                                                                                                                |
| Document parsing/validation is hand-rolled and unit-tested at every boundary (`validatePresentationDocument`, `serializePresentationDocument`, duplicate-ID/geometry/reference rejection).                                                                                                                   | `HANDOFF.md` interfaces table; `docs/slides-implementation-plan.md` P10.                                                                                                                                                                                                                                                                                                                |
| Verification today: Vitest + jsdom + `fake-indexeddb`, Playwright specs, plus a real-cloud script (`npm run test:cloud`). Screenshot comparisons are stored in `/tmp/**` and are **not** committed; `proofs/baseline.md` records 12 pre-existing failing desktop overflow checks in `e2e/ui-polish.spec.ts`. | `package.json`; `docs/ui-audit.md`; `HANDOFF.md`; `AGENTS.md` verification section.                                                                                                                                                                                                                                                                                                     |
| Product rules that constrain any UI dependency: one document model, commands through the store, one undo entry per completed gesture, view state never dirties, no second zoom/dialog/toast system, honest feature states, offline-first with no cloud credentials, no unapproved purchases.                 | `AGENTS.md`; `docs/core-tools-plan.md`; `HANDOFF.md`.                                                                                                                                                                                                                                                                                                                                   |

---

## Part 1 — Repo-grounded adoption analysis (the deliverable that matters)

Each item: **what it would replace or add here**, **landing site**, **verdict**, **effort S/M/L**, **risk**.
Effort and risk are **Inference** unless they quote a verified repo fact.

### 1. Motion and interaction

**(a1) `motion` (the Framer Motion successor) — recommend against for now.**
Replaces: nothing. Adds: a React animation runtime and a second, JS-driven style-authoring path for
transform/opacity.
The decisive repo fact is that reduced motion is _already implemented in CSS_ — a global
`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important } }`
(`src/styles.css`). **Inference:** a JS animation library drives `element.style`/WAAPI rather than CSS
`transition`, so that existing global rule would not neutralise it; adopting one means adding
`MotionConfig reducedMotion="user"` (or an equivalent) and keeping it correct in every new component, i.e.
trading one CSS line for an ongoing discipline. The only animation in the app today is a 180 ms dialog fade.
Effort to add: **S**. Effort to keep consistent with the existing reduced-motion rule: **M**. Verdict:
**skip** until a concrete flow needs sequenced motion (candidate flows, all currently unstarted: slide
transition previews, editor first-run reveal, palette open/close). **Inference:** value today ≈ 0.

**(a2) `react-spring` — recommend against (same reason, larger concept surface).** Physics/spring abstractions
buy nothing for 120–160 ms UI transitions. Effort S, risk of two animation idioms. **skip.**

**(a3) `@formkit/auto-animate` — watch, do not adopt yet.** It adds FLIP animation to a list/container with
one hook or attribute. Here the natural targets are exactly the two lists whose order changes by _user
command_: the sticker layer stack and (later) the slide rail. **Inference:** the honest lazy answer is that
CSS transitions on list reorder are hard, so auto-animate is the cheapest way to get "item moved" feedback —
but layer reorder today is a button click with an immediate DOM re-render, and the value is cosmetic.
Effort S. **Defer** until drag reorder (item b) actually lands, then re-evaluate as a single deliberate
addition, and make sure the added animation is suppressed by the existing reduce rule (**Inference:** it is
JS-driven, so it will _not_ be — it needs its own guard).

**(a4) CSS-only — the default here.** `AGENTS.md` asks for "lively, vivid, engaging" but also "decoration must
not obscure content or controls", and the editor is explicitly the calm surface. The repo already has the
token system (`--space-*`, `--radius*`, `--shadow*`) and data-state-driven animation for dialogs. Verdict:
**CSS first**; document any new motion with the same reduced-motion idiom already present.

### 2. Drag, sort, reorder

Landing sites, in order of real value: (1) presentation slide rail reorder/delete (**P23**, unchecked), (2)
accessible element/layer list for presentations (**P30**, unchecked), (3) sticker layer stack reorder
(**currently** `ArrowUp`/`ArrowDown` buttons in `EditorPage.tsx`), (4) pack member ordering (**TODO-VERIFY**
whether it is editable today), (5) admin catalog collection ordering (**P52**).

**Repo constraints any of these must satisfy:** reorder must be a store command; one completed drag = one undo
entry; selection must not dirty the document; keyboard access is required (the layer stack and slide cards are
already keyboard-reachable, and the repo has an explicit rule that canvas shortcuts stay inert inside dialogs
and text inputs). That last point is the real selection criterion: **a drag library that hides focus
management behind a pointer-only implementation is a regression here.**

**(b1) `@dnd-kit` (core + sortable) — the leading candidate.** Adds: pointer + keyboard sensors, sortable
lists with a `SortableContext`, and screen-reader announcements for position changes. Replaces: the
`ArrowUp`/`ArrowDown` button pair in the layer stack and the future rail in P23/P30. Effort **M** (sensors,
collision detection, actuator/handle, then wiring `onDragEnd` into a single `reorderLayer`-style command and
one history entry). Risk: **M** — the announcement live-region and the existing focus-restoration discipline
for dialogs must be reconciled; a drag library also introduces its own DOM ordering during the gesture, which
must never leak into the document. **Inference:** this is the best fit for a React-store-owned list, because
the drag result is expressed as an array move you hand to your own command. React 18 support:
**TODO-VERIFY** (`peerDependencies.react`) — treat as the deciding fact before adopting.

**(b2) Atlassian Pragmatic drag and drop — credible second, with a footprint caveat.** Built for performance on
big surfaces (native drag-and-drop under the hood) and framework-agnostic, which fits the "don't let a library
own my list" instinct. **TODO-VERIFY: the package count** — this library is distributed as several packages
(core, React adapter, hitbox, auto-scroll, drop-indicator) (recall, unverified), so "one small dependency" may
not describe it; the aggregate bundle cost is **TODO-VERIFY** and must be measured before adoption. Effort
**M**. Risk: **M**, mostly learning a different event model plus the drop-indicator UI needing token-based
restyling. **Inference:** choose this over dnd-kit only if a real performance problem appears on a _large_ list
(the admin grid), not for a 10-slide rail or a 20-layer stack.

**(b3) React Aria drag and drop — recommend against here.** Adds collection components (`useDragAndDrop` with
ListBox/GridList) that would introduce a second, parallel component/collection system beside the existing
Radix + hand-rolled primitives. `AGENTS.md` explicitly says to reuse `src/components/ui/` and not to create
page-local lookalikes; adopting React Aria's collections would either duplicate the layer row (kind tag,
rename input, toggles) or force the row's markup to be rebuilt as a React Aria item. Effort **L**. Risk: **M**.
Its genuine strength — first-class a11y semantics — is exactly what a11y item (k) wants, so the honest
trade-off is "dnd-kit's announcements + our own live region" vs "a whole collection system".

**(b4) `sortablejs` — recommend against.** It mutates the DOM list directly; **Inference:** that fights React's
ownership of the same list and invites desync between the store's `layers` array and the rendered order. The
repo's whole model is "store is the source of truth, canvas/DOM is a view". Effort S to install, **M+** to keep
correct. Risk: **M**.

**(b5) Native HTML5 drag and drop — free, and adequate only for the desktop-only case.** Adds zero
dependencies; `draggable` + `dragstart`/`dragover`/`drop` with `dataTransfer`. Risk: **M** — **Inference:**
HTML5 DnD has no touch support and awkward drag images, and this app has a supported phone viewport
(390×844) with drawers/sheets as first-class UI; the editor also already needs pointer events for masking and
panning, so a second drag idiom (pointer vs HTML5) adds cognitive and code cost. Recommend using it only if
reorder is explicitly desktop-only and you want zero dependencies.

**Lazy summary for (b):** keep the existing keyboard `ArrowUp`/`ArrowDown` buttons everywhere they suffice.
Adopt **one** drag library at the two sites that genuinely hurt (slide rail P23, element list P30), and require
that it emits an array move you feed into your existing command + undo path.

### 3. Command palette and keyboard shortcuts

**(c1) `cmdk` — highest-value UX item in this scan.** Replaces/ completes: the header already renders a search
control with a `<kbd>` hint and `.global-search-result` styling while the audit records that search "honestly
explains that it is not implemented". `AGENTS.md` forbids active-looking dead controls, so this is either
implemented or removed; a headless palette is the implementation. It also addresses an audit-recorded
limitation ("selection is pointer-only (no keyboard path until the P30 element list)") by giving keyboard users
a way to reach actions and documents. Landing site: header/app shell (`src/app/`, `.button.search`), plus
editor verbs (add text, export, switch tool, open template). Effort **S–M** (headless primitives; the Command
chrome must be built from the repo's own `DialogContent`/tokens rather than importing a pre-styled command
component, per the one-dialog-system rule). Risk: **S/M** — the palette must respect the existing rule that
canvas shortcuts stay inert while a dialog or text field is focused, and must not become a second navigation
system. **TODO-VERIFY:** React 18 support and whether the shadcn/ui Command wrapper (cmdk-based — recall,
unverified) is what the repo's conventions would pull in.

**(c2) `react-hotkeys-hook` — conditional, not now.** Replaces the hand-rolled `keydown` handling in
`EditorPage.tsx` (which already encodes a real rule: exclude dialog targets so Delete/arrows can't mutate the
canvas behind a modal). **Inference:** swapping working, tested shortcut isolation for a hook that must be
configured to _not_ fire in form fields is net churn; adopt only when the shortcut table grows past what a
single hand-rolled dispatch reads cleanly. Effort S, risk S–M. **TODO-VERIFY:** whether this package is a
wrapper over `hotkeys-js` (recall, unverified) — matters because it determines whether `hotkeys-js` is also
implied.

**(c3) `kbar` — recommend against.** **Inference:** it ships its own palette UI, styling, and animation, which
collides with the mint token system and the single-dialog rule, for capabilities cmdk already covers headless.
Effort S, risk M (restyling + a competing UI layer).

**(c4) `hotkeys-js` — recommend against.** Vanilla global hotkeys, no React lifecycle integration; the scoping
problem (don't fire while typing) is exactly the one the repo already solved by hand. Effort S, risk M.

**(c5) `ninja-keys` — recommend against.** **Inference:** web-component based, so styling and key handling sit
outside React state; in a React-strict, token-driven shell it is the least composable option. Effort S, risk M.

### 4. Virtualization

**Repo reality:** the sticker tray is a ~39-item horizontal rail of 76 px thumbs (`src/styles.css`
`.asset-items`/`.catalog-asset`; count **Inference** from `docs/ui-audit.md` prose), the pack list is bounded
to 240 px, and the slide rail is 8–10 cards per template by design. **Inference:** at those sizes
virtualisation buys nothing measurable and costs a windowing abstraction plus measurement bugs. The one place
it can earn its keep is the **admin asset grid (P59) and student catalog panel (P62)**, where the plan
explicitly targets "hundreds of files" and "paged filters" — and even there the plan's own answer is _paging_
("stable cursors", "no fetching every full image"), which is cheaper than windowing.

- **`@tanstack/react-virtual`** — headless, works with any scroll container, good grid/list support. Effort M
  (measurement + dynamic sizes), risk M (scroll restoration, focus retention during scroll, screen-reader
  behaviour). **Adopt only after measuring** a real grid at hundreds of DOM nodes.
- **`virtua`** — smaller surface, list+grid oriented. Effort M, risk M. **TODO-VERIFY** React 18 support.
- **`react-window`** — the simplest/most conservative option, but least flexible for dynamic item heights and
  has its own API style. **TODO-VERIFY** maintenance signal; **Inference:** fine for a uniform thumbnail grid.

**Verdict: no virtualization dependency now.** Evidence I looked: measured list scopes in `src/styles.css` and
the P58/P59/P62 acceptance criteria in `docs/slides-implementation-plan.md`. Revisit when a real catalogue page
renders hundreds of assets _and_ paging has already been ruled out.

### 5. Forms and validation

**Repo reality:** the only forms are 1–3-field dialogs (pack name, layer rename as an inline input, document
title). The real validation work is (i) upload validation (hand-rolled, strict, tested) and (ii) document
parsing/serialisation at every boundary (hand-rolled, versioned, tested against duplicate IDs, bad geometry,
missing references).

- **`react-hook-form` — reject for now.** It would own form state that must funnel into Zustand commands;
  **Inference:** for a two-field dialog that is a net increase in moving parts, and it risks a second source of
  truth for "is this dialog dirty". Effort S, risk M (state ownership).
- **`@conform-to/react` — reject, wrong architecture.** It is built around progressively-enhanced, action/
  server-validated forms (Remix/React Router actions). This app is a client-only, offline-first editor whose
  forms write through store commands; there is no action/server-form boundary to enhance. Effort S, risk M.
- **`zod` / `valibot` — plausible later, not now, and not as a forms tool.** The honest use case is the
  _boundary parsers_ (`validatePresentationDocument`, backup-ZIP manifest parsing in P42, catalog payloads in
  P49) where hand-rolled validation keeps growing. Trade-off to weigh in the fact pass: runtime cost and
  bundle cost versus a tested hand-rolled parser you already own; and **Inference:** a schema library expresses
  cross-field invariants (unique element IDs, asset-reference closure, ordered slides) less directly than the
  current code does. `valibot` is the tree-shakeable/smaller-runtime option; `zod` is the ecosystem default.
  **TODO-VERIFY** sizes and React independence (both are React-independent — recall, unverified). Effort M to
  migrate a boundary, risk M (silent behaviour change on already-tested error messages).
- **`standard-schema` — a spec, not a runtime.** Its only role here is as a selection criterion: if you ever
  adopt a validator, prefer one that implements the shared Standard Schema interface so a future swap (or a
  `cmdk`/formtool integration) doesn't lock the repo in. No dependency, no effort.

### 6. Feedback and status

**Repo reality:** status is inline and truthful by convention — `saveStatusLabel` with
`data-state="saving" | "saved-locally" | "save-failed"` styling, `.asset-error`, `.presentation-canvas-error`,
`.presentation-local-status`, plus a shared `NoticeDialog`. The audit explicitly _removed_ nonfunctional
controls rather than faking them; the presentation editor's pill honestly says `Unsaved changes` until P19.

- **`sonner` — adopt later, for the deferred long-running flows only.** It adds stacked toasts with a promise
  (loading → success/error) API. Landing sites where the result is genuinely off-screen or asynchronous:
  pack ZIP export, PPTX/PDF export progress + cancellation (**P40**), backup/restore (**P43**), bulk catalog
  upload per-file status/retry (**P58**), publish/archive (**P60**). Effort S, risk M — **Inference:** the risk
  is not the library, it's ending up with two feedback systems (inline status pill _and_ toast) for the same
  event, which is the exact redundancy `docs/ui-audit.md` spent a pass removing. Rule to write down before
  adopting: toasts only for background/long-running results, never for save state.
- **`react-hot-toast` — acceptable alternative, no strong reason over sonner.** Smaller and older;
  **Inference:** sonner's stacking/promise ergonomics fit export progress better. **TODO-VERIFY** both.
- **Progress indicators — no dependency needed.** All progress here is bounded work you own (bytes read,
  files processed, export steps). A determinate `<progress>`/div bar against your own counters is more honest
  than an indeterminate spinner, and the repo already reports "no fake background completion".

**Verdict: no toast dependency while the sticker editor is the only surface.** Add exactly one at P40/P43/P58.

### 7. Onboarding and product tours

**Repo reality:** onboarding is in-context and hand-built — `.tool-tip-card`, `.tool-mascot`,
`.editor-welcome`, a `.walkthrough` numbered list, and per-tool empty states with honest copy
(`toolEmptyCopy`). Every one of these lives next to the control it explains.

- **`driver.js` — the least-bad tour library if tours are ever required.** Small, framework-agnostic,
  no React coupling, anchors to element selectors. Effort S, risk M: tour steps hard-code selectors and copy,
  so they break whenever the shell moves — and this shell is actively moving (P18–P31, plus known responsive
  reflows at 1150/721/720 px breakpoints).
- **`react-joyride` — recommend against here.** React-native but owns its own state machine and DOM overlay
  styling; **Inference:** restyling to mint tokens plus keeping steps valid across the three verified
  viewports is more work than the tour is worth.
- **`intro.js` — do not use without a licence review; the licence is the primary risk, not the code.**
  Flagged by the task itself for licence checking. **TODO-VERIFY: read the repository LICENSE file _and_ the
  published package metadata** (a package.json `license` field can read `SEE LICENSE IN ...`, so the package
  field alone is not evidence). Until that is read, treat intro.js as **licence-unknown and excluded**.

**Verdict: skip all three now.** The strongest argument is not size but timing: the presentation authoring
flow is still changing (P18–P31), so any tour authored today is a maintenance liability and, worse, can end up
describing behaviour that does not exist — which this repo's honesty rules forbid. Onboarding value is better
spent on the per-tool empty states that already exist.

### 8. Error and performance observability

- **`@sentry/react` — reject for now.** A hosted SaaS dependency requiring a DSN, sending events off-device,
  purchase/account setup, and network egress from an app whose core promise is "works offline with no cloud
  credentials" (`AGENTS.md`). It also has to be reconciled with the privacy stance around user photos.
  Effort S to wire, risk **M/H** on product fit and data handling. Not authorized by `AGENTS.md` (no new
  purchases/services without authorization).
- **`web-vitals` — cheap, but adopt only with a sink and a question.** It measures LCP/INP/CLS from the
  browser and reports wherever you send it; there is no backend to receive it today. **Inference:** INP on
  brush strokes and drag is the interesting number, and it is better obtained from the repo's own Playwright/
  benchmark harness (which already produced a processing benchmark in `proofs/`) than from a general library
  with nowhere to report. Effort S, value L now.
- **`@opentelemetry/sdk-trace-web` — reject.** Designed to export to an OTLP collector; this app has no
  collector and no server-side trace story. Effort L, risk M, value ≈ 0 now.
- **Highlight.io / equivalent session-replay SaaS — reject** for the same reasons as Sentry (network, account,
  purchase, session data).

**The honest gap isn't a library.** Local failure handling (quota exhaustion, corrupt document versions,
failed writes preserving work) is already specified and unit-tested; what is missing is a _destination_ for
diagnostics, and the repo's existing answer (committed `proofs/` artifacts + Playwright traces) is the right
one until cloud work (P46+) exists.

### 9. i18n

**Repo reality:** the UI is English; the _content_ problem (English + Vietnamese text inside presentations)
is already solved at the font/metrics layer — `ensurePresentationFonts()` with Be Vietnam Pro / Spectral, and
a documented rule that Latin-only sticker fonts must never be used for presentation text.

- **`i18next` + `react-i18next` — the default if a runtime catalog is wanted.** Runtime JSON catalogs, plural/
  interpolation ecosystem, hooks. Cost: runtime + catalog loading into an offline-first app; **Inference:**
  the serializable document model must never contain translated UI strings, which is easy to violate if the
  runtime is available everywhere. Effort M, risk M.
- **`@lingui/core` + `@lingui/react` — macro/compile-time extraction.** Type-safe message catalogues compiled
  into the bundle; excellent fit for a static marketing/UI surface; **Inference:** build-config complexity
  (Babel/compile step) in a Vite 6 setup is the main cost. Effort M, risk M.
- **`typesafe-i18n` — codegen with a tiny runtime and typed keys.** Attractive for correctness; **Inference:**
  a generated file plus a watcher is a new moving part in dev. Effort M, risk S/M.
- **`@inlang/paraglide-js` — compile-time, tree-shaken message functions.** Best-in-class bundle behaviour for
  a mostly-static UI; **Inference:** introduced by a compiler plugin/config, so it needs the same build
  review as Lingui. Effort M, risk M.

**Verdict: add nothing now.** This is a _product_ decision (is the UI Vietnamese?), not a tooling gap, and the
repo's Vietnamese requirement is currently a content/font requirement that is already implemented. When it is
decided, prefer a compile-time approach over a runtime one, and keep localisation strictly out of
`ProjectDocument`/`PresentationDocument`.

### 10. Dev velocity and quality

- **Env validation — do it, but the lazy version is 20 lines.** The repo already uses `.env.example`
  placeholders and Vite `import.meta.env` with the rule "never place service-role keys in frontend code".
  A tiny typed reader that (i) documents which variables are optional (Supabase is optional for local-first
  mode) and (ii) fails loudly on a malformed URL/key prevents the most annoying class of local-setup bug.
  `@t3-oss/env-core` (+ a validator) is the standard library form; **TODO-VERIFY** whether it can be used
  browser-side without the server wrapper. Effort S, risk S. **Inference:** hand-rolled wins on dependency
  count and on expressing "optional unless cloud tests run".
- **MSW — plausible, not needed for P18/P19.** The repo's local flows are already testable with
  `fake-indexeddb`, and the cloud path is deliberately tested against a real project (`npm run test:cloud`).
  MSW earns its keep when you must induce _hostile_ cloud behaviour that a real backend can't produce on
  demand: storage 403s, expired tokens, quota errors, partial failures, offline transitions — all of which the
  P46–P60 catalog work needs, and none of which exists yet. Effort M, risk M (an extra mock layer that can
  drift from the real API). **Adopt at P46+, not before.**
- **Vitest browser mode — evaluate later, and count the runners first.** Browser mode would close the
  jsdom gap for canvas/DOM-adjacent logic, but the repo already has Playwright for real-browser journeys, so
  adopting it means **two browser runners** in CI. **TODO-VERIFY** Vite 6 + Vitest 2 compatibility and the
  provider package name/version. Effort M, risk M. Revisit only if a specific test cannot be expressed in
  either existing runner.
- **Playwright tooling — highest-value dev-velocity item after a11y, and it needs no new dependency.**
  The audit's visual comparisons live in `/tmp/**` and are uncommitted, and 12 desktop overflow assertions are
  known-failing in `proofs/baseline.md`. Playwright's built-in snapshot assertions (plus `--update-snapshots`,
  trace-on-failure) turn the four routes × three viewports into committed regression evidence and force the
  baseline to be either fixed or explicitly recorded. Effort S, risk S (snapshot churn across OSes/fonts —
  mitigate by pinning the viewport set already used: 1440×900, 1024×768, 390×844).
- **Bundle analysis — do it.** Konva is already `React.lazy`-loaded and P40 plans lazy export loading, which
  means someone must actually see the chunks. `rollup-plugin-visualizer` (Vite plugin) or a Vite-only
  analyser are devDependencies; no runtime cost. Effort S, risk S. **TODO-VERIFY** current version/Vite 6
  compatibility.
- **`knip` — worth a trial.** 19k LOC with in-flight refactors (sticker vs presentation families, template/
  pack surfaces) is exactly where dead exports and unused files accumulate. Effort S to run, **M** to triage
  (false positives around dynamic imports — and note this repo _does_ have a dynamic `import()` of
  `KonvaCanvas`, which analyzers routinely get wrong). **TODO-VERIFY** current version and whether it
  understands Vite entry points out of the box.
- **`@total-typescript/ts-reset` — small, optional.** Tightens ambient types (e.g. `JSON.parse`,
  `Array.includes`, `fetch`). Effort S, risk S/M (it can surface new type errors in existing code, which is
  the point). Adopt only if the team wants the stricter ambient types; no product-velocity claim.
- **Typed fetch/API layer — no library.** The only network surfaces are `@supabase/supabase-js` and the Node
  probe endpoint. The correct place to type them is the existing repository interfaces / a small typed
  wrapper, not a generic HTTP client. **Recommend against** adding one.

### 11. Accessibility helpers beyond Radix

**Verified gaps and the cheap wins:**

- **`eslint-plugin-jsx-a11y` is not installed** (`package.json` devDependencies list: `@eslint/js`,
  `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, plus config packages).
  It is the cheapest possible a11y addition — static checks for missing labels, ARIA misuse, click handlers on
  non-interactive elements — and it hooks into the lint command that already runs in verification. Effort S.
  Risk S (**Inference:** expect a small burst of legitimate fixes plus some noise; scope it to `src/`).
  **TODO-VERIFY** current version and flat-config compatibility.
- **`@axe-core/playwright`** — runs axe inside the existing `@playwright/test` suite on the four routes and the
  shared dialogs at the three verified viewports. This maps directly onto `AGENTS.md` ("validate desktop,
  tablet, and mobile layouts", "visible focus, accessible names, dialog focus handling") and onto P76/P77.
  Effort S/M (triaging a first axe run on an existing app always yields a backlog). Risk S.
  **TODO-VERIFY** version and rule-set noise.
- **`vitest-axe`/`jest-axe` for unit tests** — lower value here because the interesting a11y surfaces are
  composite pages and Radix dialogs, which are better exercised in the browser suite. Effort S, risk S.
- **No library solves the hardest case.** The repo's own audit records the real a11y hole: canvas element
  selection is pointer-only until P30, and canvas operations need "keyboard alternatives". **Inference:**
  a generic helper package cannot provide that; what it needs is (i) keyboard-operable equivalents of canvas
  gestures that route through the store commands, and (ii) an `aria-live` region announcing what the command
  did. A drag library with built-in announcements (dnd-kit, React Aria) can contribute (ii); the rest is
  product code.

### 12. Crop / pan / zoom UX for stickers (judged against the existing Konva Transformer)

**Repo reality:** crop and erasure are non-destructive and image-local; masks are stored in image-local
coordinates so they survive scale/rotate/flip/zoom; outlines follow the alpha silhouette; preview and export
share one compositor; zoom/fit has exactly one clamp in `viewGeometry.ts` and the handoff forbids a second
implementation.

- **`react-easy-crop` — reject.** It provides a DOM-based single-image crop with aspect lock, zoom, and
  rotation. Adopting it would introduce a **second crop coordinate system** outside the document, and the
  crop result would then have to be reverse-mapped back into the layer's non-destructive crop fields _and_
  stay consistent with the image-local mask and the alpha-outline pass. Effort M to wire, **H** to keep
  correct. **Inference:** this directly collides with the repo's stated invariants (masks survive transforms;
  preview = export; one compositor).
- **`react-zoom-pan-pinch` — reject.** Wraps DOM content in a pan/zoom transform. The canvas view here is a
  Konva stage with an existing pan/zoom/fit control set and a documented single clamp; adding a DOM transform
  wrapper creates the second zoom implementation `HANDOFF.md` explicitly forbids, and cannot participate in
  document coordinates. Effort S, risk M.
- **`react-advanced-cropper` — reject** (same class, more features: stencils, rotation, canvas-based output).
  Same coordinate-system and second-implementation objections, with more surface to reconcile. Effort M,
  risk H.
- **What is genuinely not covered by any library** (and is therefore product code, consistent with
  `docs/editor-library-research.md`): crop + image-local erase mask + alpha-silhouette outline + filters, all
  transformed together and shared between preview and export.
- **Where a library _idea_ is still useful:** the crop UX itself (rule-of-thirds guides, aspect presets,
  rotate-with-grid, reset). Those are cheap hand-built overlays on top of the existing Transformer and are the
  actual quality gap, not missing packages.

### 13. File-upload UX (judged against the existing validation)

**Repo reality:** `validateUpload.ts` does magic-byte sniffing, declared-vs-sniffed MIME agreement, animated
PNG/WebP rejection, GIF rejection, SVG rejection by name _and_ by markup prefix, 15 MB / 25 MP caps, and
`createImageBitmap` decode with a fallback — all with typed error codes. The tray has a real "upload" button
(`.asset-upload`) and presentations plan "Import Photos"; P54/P58 plan hundreds-file batch uploads with
per-file status and retry.

- **`react-dropzone` — skip for P18; reconsider for P58.** What it adds: drag-over state handling, nested
  drag-counter correctness, click-to-open wiring, and (importantly for admin bulk) directory/folder drops via
  filesystem entries. What it does **not** add: any of the validation above — its `accept`/`maxSize` filters
  are a UX pre-filter, not a trust boundary, so `validateUpload` stays the gate either way. Effort S, risk S.
  **But:** a single `onDragOver`/`onDrop`/`dragleave` handler on the editor workspace plus one state flag is
  roughly 15 lines (Inference) and covers the one-image case; adopting a library for that is unearned. The
  honest trigger for adoption is P58's folder-drop-plus-hundreds-of-files workflow.
- **`uppy` — recommend against.** It is a complete uploader: dashboard UI, its own state machine, and
  resumable/tus-style transfers to a server endpoint, plus provider integrations. This repo's upload truth
  lives in **its own durable job model** (reserved paths, leases, idempotent retries, conditional completion —
  P54/P55/P61) and in its own validation; a client uploader with a parallel state machine would be a second
  source of truth for "did this file upload", and its UI would compete with the token-driven admin grid.
  Effort M to wire, risk **M/H** (two upload state owners). **Inference:** the only genuinely interesting Uppy
  capability is resumable upload, and the right thing to check first is whether the already-installed
  `@supabase/supabase-js` provides resumable uploads for Storage — **TODO-VERIFY (a)** whether it does, and
  **(b)** Uppy's licence/version. If supabase-js covers it, Uppy is redundant.
- **No library covers the validation.** Evidence: I read `validateUpload.ts` in full this session and its
  guarantees are format-animation-aware byte/MIME/decode checks; neither dropzone nor Uppy is positioned to
  provide those (their scopes are described in their own docs — **TODO-VERIFY** the exact wording). Keep the
  hand-rolled validator as the gate and, if a dropzone library is added, make it a _front-end for the same
  function_.

---

## Ranked top recommendations (max 5, highest confidence first)

1. **`eslint-plugin-jsx-a11y` + `@axe-core/playwright` (Effort S).** Impact: medium-high; closes a verified
   tooling gap (plugin absent from `package.json`) and turns the audit's accessibility requirements into
   automated checks inside commands that already run. Confidence: **high** on the gap; the specific versions
   are TODO-VERIFY.
2. **Playwright visual snapshot assertions + traces (Effort S, no new dependency).** Impact: medium-high; the
   audit's screenshot evidence currently lives in uncommitted `/tmp/**` and 12 desktop overflow checks are
   known-failing in `proofs/baseline.md`. Committing the four routes × three viewports turns the visual
   contract into regressions. Confidence: **high**.
3. **`cmdk`-based command palette in the shared shell (Effort S–M).** Impact: medium-high; resolves a
   documented "advertised but not implemented" search affordance and adds the missing keyboard path for
   actions/documents, without a second UI system (build the chrome from existing `DialogContent` + tokens).
   Confidence: **medium-high**; must respect the existing "canvas shortcuts inert inside dialogs/inputs" rule.
4. **Exactly one drag-reorder library, at P23 (slide rail) and P30 (element/layer list) only** — prefer
   `@dnd-kit`, with Atlassian's library as the alternative if a large-list performance need appears
   (Effort M). Impact: medium; keeps the existing keyboard buttons elsewhere and funnels the drag result
   through one store command = one undo entry. Confidence: **medium** — decision gate is TODO-VERIFY React 18
   peer support and measured footprint.
5. **Bundle analysis (`rollup-plugin-visualizer`) + `knip` as devDependencies (Effort S).** Impact: medium;
   Konva is already lazy-loaded and P40 plans lazy export loading, so chunk visibility and dead-code detection
   pay off in a 19k-LOC codebase mid-restructure. Confidence: **medium** (knip triage cost is real, and
   dynamic imports are a known false-positive source).

## Anti-recommendations (popular, examined, rejected — with the reason)

| Rejected                                                            | Reason                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `motion` / `react-spring` (now)                                     | CSS already covers every current transition, and reduced motion is _already_ implemented as a global CSS rule; JS-driven animation escapes that rule and needs its own guard. Value today ≈ 0. |
| `@formkit/auto-animate` (now)                                       | Defer until drag reorder exists; it is a cosmetic add for a list that reorders by button click.                                                                                                |
| `sortablejs`                                                        | Mutates the DOM list directly; conflicts with the store-as-source-of-truth model.                                                                                                              |
| React Aria drag-and-drop / collections                              | Would introduce a second component/collection system beside Radix + hand-rolled primitives, against the reuse rule.                                                                            |
| `kbar`, `hotkeys-js`, `ninja-keys`                                  | Heavier or less composable than cmdk + the existing hand-rolled shortcut isolation.                                                                                                            |
| `react-hook-form`, `@conform-to/react`                              | Two-field dialogs; conform additionally assumes an action/server-form architecture this app does not have.                                                                                     |
| `zod`/`valibot` (now)                                               | Boundary parsing is hand-rolled and already tested against the real invariants; adding a runtime for that is a later, evidence-driven decision.                                                |
| `react-hot-toast` (as first choice)                                 | Sonner's promise/stack ergonomics fit export progress better; but the real constraint is not having two feedback systems.                                                                      |
| `react-joyride`, `intro.js`                                         | Joyride owns a parallel state machine + overlay styling; intro.js is **licence-unknown and excluded pending a LICENSE read** (the task flagged its licence, and I could not verify it).        |
| `@sentry/react`, Highlight.io, OpenTelemetry web                    | Network, account, purchase and session-data implications in an app whose promise is offline-with-no-credentials; no collector or authorized service exists.                                    |
| `i18next`, Lingui, typesafe-i18n, Paraglide (now)                   | UI translation is an unmade product decision; the current Vietnamese requirement is content/font-level and already implemented.                                                                |
| `react-easy-crop`, `react-advanced-cropper`, `react-zoom-pan-pinch` | Each introduces a second crop/zoom coordinate system or DOM transform wrapper, contradicting the non-destructive, mask-aligned, single-clamp invariants.                                       |
| `uppy`                                                              | A second upload state machine overlapping the planned durable server job model (P54/P55); UI competes with token-driven admin surfaces. Check supabase-js resumable upload first.              |
| `react-dropzone` (for P18)                                          | The one-image drop target is ~15 lines; its file filters are not a trust boundary, so the strict validator stays. Reconsider for P58 folder drops.                                             |
| Generic typed-fetch client                                          | Only two network surfaces exist; typing belongs at the repository boundary that already exists.                                                                                                |
| `ts-reset`, Vitest browser mode, MSW                                | Optional/later: ts-reset is a team-preference change, browser mode adds a second browser runner beside Playwright, and MSW's value starts at P46.                                              |

## Where NO good library exists (with the evidence that I looked)

1. **Canvas keyboard operability and reorder announcements bound to this store + undo model.** Drag libraries
   (b) can supply generic announcements, but "one gesture = one undo entry", "selection never dirties", and
   "canvas shortcuts inert inside dialogs/inputs" are product semantics. Evidence: `AGENTS.md` editor
   invariants; `docs/ui-audit.md` ("selection is pointer-only (no keyboard path until the P30 element list)").
2. **Offline-first, no-network error/performance observability.** Every candidate either needs a hosted sink
   and account (Sentry, Highlight) or a collector (OTel); `web-vitals` measures but has nowhere to report.
   Evidence: candidate scopes (**TODO-VERIFY** wording) versus the offline/no-credentials promise in
   `AGENTS.md`.
3. **Tour/onboarding tooling that cannot describe unimplemented behaviour.** No library enforces the repo's
   honesty rule; all three tour libraries hard-code copy and selectors, which drift against an editor under
   active construction (P18–P31). Evidence: driver.js/joyride/intro.js scopes (**TODO-VERIFY**) versus
   `AGENTS.md` ("Unavailable features need an honest explanation, not active-looking dead controls").
4. **Upload validation that understands animated PNG/WebP, SVG smuggling, and MIME/sniff disagreement.**
   Neither dropzone nor Uppy is positioned to be the trust boundary. Evidence: full read of
   `src/features/assets/validateUpload.ts` this session (typed error codes, prefix sniffing, animation flags,
   decode limits) versus the two libraries' documented scopes (**TODO-VERIFY** wording).
5. **Sticker crop + image-local mask + alpha-silhouette outline + filters shared by preview and export.**
   Already established in `docs/editor-library-research.md`; the crop/pan/zoom libraries examined in (l) are
   DOM single-image tools and make it worse, not better.
6. **Virtualization at the sizes this product actually has.** Sticker tray ≈39 items in a horizontal rail, pack
   list bounded to 240 px, 8–10 slide cards per template, with catalog paging planned instead of windowing.
   Evidence: `src/styles.css` measurements and `docs/slides-implementation-plan.md` P59/P62 acceptance
   criteria. No library is missing here — the need is absent.

---

## Part 2 — Facts table (`TODO-VERIFY` cells are intentional; nothing below is guessed)

The five left-hand fact columns are unverified in this session and must be filled by the Part 3 pass.
"Replaces/adds here", "Landing site", "Effort" and "Risk" are **Inference** unless quoted from a repo file.

| Candidate                                                                       | Dimension     | Licence                           | Latest version + release date | React 18 support | Bundle/runtime cost  | Maintenance signal | Replaces / adds in THIS repo                                        | Landing site                    | Effort | Risk                |
| ------------------------------------------------------------------------------- | ------------- | --------------------------------- | ----------------------------- | ---------------- | -------------------- | ------------------ | ------------------------------------------------------------------- | ------------------------------- | ------ | ------------------- |
| `motion`                                                                        | motion        | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Adds JS animation runtime over CSS transitions                      | none yet                        | S      | M                   |
| `react-spring`                                                                  | motion        | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same, larger concept surface                                        | none                            | S      | M                   |
| `@formkit/auto-animate`                                                         | motion        | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | FLIP feedback on list reorder                                       | layer stack, slide rail         | S      | M                   |
| CSS-only (baseline)                                                             | motion        | n/a                               | n/a                           | n/a              | 0                    | n/a                | Already in place; reduced motion already global                     | `src/styles.css`                | —      | —                   |
| `@dnd-kit/core` + `@dnd-kit/sortable`                                           | dnd           | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Replaces up/down reorder; adds drag + announcements                 | layer stack, P23 rail, P30 list | M      | M                   |
| `@atlaskit/pragmatic-drag-and-drop` (+ react/hitbox/auto-scroll/drop-indicator) | dnd           | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same, perf-oriented, multi-package (recall, unverified)             | large lists only                | M      | M                   |
| `react-aria` (`useDragAndDrop`)                                                 | dnd           | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Adds a second collection/component system                           | P30 list                        | L      | M                   |
| `sortablejs`                                                                    | dnd           | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Imperative DOM ordering                                             | any list                        | S      | M                   |
| Native HTML5 DnD                                                                | dnd           | n/a (platform)                    | n/a                           | n/a              | 0                    | n/a                | Zero-dep desktop-only reorder; no touch                             | desktop lists                   | S      | M                   |
| `cmdk`                                                                          | palette       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Implements the advertised-but-unbuilt global search + keyboard path | header/app shell                | S–M    | S/M                 |
| `kbar`                                                                          | palette       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Owns palette UI + animation                                         | header                          | S      | M                   |
| `react-hotkeys-hook`                                                            | shortcuts     | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Replaces hand-rolled keydown isolation                              | editor shell                    | S      | S/M                 |
| `hotkeys-js`                                                                    | shortcuts     | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Vanilla globals, no React lifecycle                                 | editor shell                    | S      | M                   |
| `ninja-keys`                                                                    | palette       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Web-component palette outside React state                           | header                          | S      | M                   |
| `@tanstack/react-virtual`                                                       | virtual       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Windowing for large grids                                           | P59/P62 catalog                 | M      | M                   |
| `virtua`                                                                        | virtual       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same, smaller API                                                   | P59/P62                         | M      | M                   |
| `react-window`                                                                  | virtual       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same, conservative                                                  | P59/P62                         | M      | M                   |
| `react-hook-form`                                                               | forms         | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Owns form state over 1–3 field dialogs                              | pack/dialog forms               | S      | M                   |
| `@conform-to/react`                                                             | forms         | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Action/server-form progressive enhancement                          | n/a here                        | S      | M                   |
| `zod`                                                                           | validation    | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Possible replacement for boundary parsers                           | `model/parse.ts`, P42/P49       | M      | M                   |
| `valibot`                                                                       | validation    | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same, tree-shakeable option                                         | same                            | M      | M                   |
| `standard-schema`                                                               | validation    | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Spec only (swap safety)                                             | n/a                             | —      | —                   |
| `sonner`                                                                        | feedback      | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Adds toasts for async/long flows                                    | P40/P43/P58/P60                 | S      | M                   |
| `react-hot-toast`                                                               | feedback      | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same, older/smaller                                                 | same                            | S      | M                   |
| `driver.js`                                                                     | tours         | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Adds walkthrough steps                                              | presentation editor             | S      | M                   |
| `react-joyride`                                                                 | tours         | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same + own state machine                                            | presentation editor             | S      | M                   |
| `intro.js`                                                                      | tours         | TODO-VERIFY (licence is the risk) | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same                                                                | presentation editor             | S      | H (licence)         |
| `@sentry/react`                                                                 | observability | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Hosted error reporting                                              | app shell                       | S      | H (privacy/offline) |
| `web-vitals`                                                                    | observability | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Field perf metrics (needs a sink)                                   | app shell                       | S      | S                   |
| `@opentelemetry/sdk-trace-web`                                                  | observability | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Trace export (needs a collector)                                    | n/a                             | L      | M                   |
| `i18next` + `react-i18next`                                                     | i18n          | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Runtime UI translation                                              | app shell                       | M      | M                   |
| `@lingui/core` + `@lingui/react`                                                | i18n          | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Compile-time catalogues                                             | app shell                       | M      | M                   |
| `typesafe-i18n`                                                                 | i18n          | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Codegen + typed keys                                                | app shell                       | M      | S/M                 |
| `@inlang/paraglide-js`                                                          | i18n          | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Compile-time, tree-shaken messages                                  | app shell                       | M      | M                   |
| `@t3-oss/env-core`                                                              | dev velocity  | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Validated `VITE_*` env                                              | `src/app/` config               | S      | S                   |
| `msw`                                                                           | dev velocity  | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Induces hostile cloud behaviour in tests                            | P46+ tests                      | M      | M                   |
| `@vitest/browser` (browser mode)                                                | dev velocity  | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Real browser for jsdom-limited tests                                | test config                     | M      | M                   |
| `rollup-plugin-visualizer`                                                      | dev velocity  | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Chunk visibility                                                    | `vite.config.ts`                | S      | S                   |
| `knip`                                                                          | dev velocity  | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Dead files/exports/deps                                             | repo-wide                       | S      | S/M                 |
| `@total-typescript/ts-reset`                                                    | dev velocity  | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Stricter ambient types                                              | `src/` typing                   | S      | S/M                 |
| `eslint-plugin-jsx-a11y`                                                        | a11y          | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Static a11y lint (absent today)                                     | `eslint.config.js`              | S      | S                   |
| `@axe-core/playwright`                                                          | a11y          | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Automated a11y checks in e2e                                        | `e2e/`                          | S/M    | S                   |
| `vitest-axe` / `jest-axe`                                                       | a11y          | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Component-level a11y assertions                                     | unit tests                      | S      | S                   |
| `react-easy-crop`                                                               | crop UX       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Second DOM crop coordinate system                                   | editor canvas                   | M      | H                   |
| `react-advanced-cropper`                                                        | crop UX       | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Same, larger surface                                                | editor canvas                   | M      | H                   |
| `react-zoom-pan-pinch`                                                          | pan/zoom UX   | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | DOM pan/zoom wrapper (second zoom impl.)                            | editor canvas                   | S      | M                   |
| `react-dropzone`                                                                | upload UX     | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Drop plumbing + folder drops; not validation                        | editor workspace / P58          | S      | S                   |
| `uppy`                                                                          | upload UX     | TODO-VERIFY                       | TODO-VERIFY                   | TODO-VERIFY      | TODO-VERIFY          | TODO-VERIFY        | Full uploader state machine + UI                                    | conflicts with P54/P55          | M      | M/H                 |
| `@playwright/test` snapshot assertions                                          | dev velocity  | TODO-VERIFY (already installed)   | TODO-VERIFY                   | n/a              | 0 (already a devDep) | TODO-VERIFY        | Committed visual regression evidence                                | `e2e/`, `proofs/`               | S      | S                   |

---

## Part 3 — Ready-to-run verification checklist (mechanical fact pass)

Run from the repo root. `npm view` needs a registry connection; each block reads the fields that decide the
verdict, in the order that matters (licence and React peer support first).

**0. Fast bulk dump (one line per candidate — do this first).**

```bash
for p in motion react-spring @formkit/auto-animate @dnd-kit/core @dnd-kit/sortable \
  @atlaskit/pragmatic-drag-and-drop react-aria react-aria-components sortablejs cmdk kbar \
  react-hotkeys-hook hotkeys-js ninja-keys @tanstack/react-virtual virtua react-window \
  react-hook-form @conform-to/react zod valibot sonner react-hot-toast driver.js \
  react-joyride intro.js @sentry/react web-vitals @opentelemetry/sdk-trace-web \
  i18next react-i18next @lingui/core @lingui/react typesafe-i18n @inlang/paraglide-js \
  @t3-oss/env-core msw @vitest/browser rollup-plugin-visualizer knip \
  @total-typescript/ts-reset eslint-plugin-jsx-a11y @axe-core/playwright vitest-axe \
  react-easy-crop react-advanced-cropper react-zoom-pan-pinch react-dropzone uppy @standard-schema/spec; do
  printf '%s\t' "$p"
  npm view "$p" version license peerDependencies.react time.modified engines --json | tr -d '\n' | cut -c1-400
  echo
done
```

**1. Per-candidate field rules (what a mechanical pass must record).**

- Licence → `npm view <pkg> license`. **If it is not a plain SPDX id** (`SEE LICENSE IN …`, `UNLICENSED`, or
  empty), open the repository `LICENSE`/`LICENSE.md` and the README licence section. This is mandatory for
  `intro.js` (dual-model suspicion — do not assume) and for anything with a "commercial" tier.
- Latest version + release date → `npm view <pkg> version` plus `npm view <pkg> time --json` (read
  `time[<version>]` and `time.modified`); cross-check `https://registry.npmjs.org/<pkg>/latest`.
- React 18 support → `npm view <pkg> peerDependencies.react`. Treat a peer range that excludes `^18` as
  disqualifying unless it is explicitly flagged (per the task's React-19 rule). Any candidate that requires
  React 19 fails the stack constraint.
- Bundle/runtime cost → `https://bundlephobia.com/package/<pkg>@<version>` (or its JSON API) **plus**
  `npm view <pkg> dist.unpackedSize`; for multi-package candidates (`@atlaskit/pragmatic-drag-and-drop*`,
  `react-aria*`) sum every package actually imported and record the list.
- Maintenance signal → `https://api.github.com/repos/<owner>/<repo>` (`pushed_at`, `license.spdx_id`,
  `open_issues_count`, `archived`), the repository's releases page, and
  `https://api.npmjs.org/downloads/point/last-week/<pkg>`. Record the field, not an impression.
- Ecosystem/lock-in notes → check whether the package ships its own CSS or font assets (kbar, ninja-keys,
  driver.js, joyride) because that decides token-restyle cost.

**2. URL shapes to open for the decision-critical ones.**

| Need                                            | URL shape                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| npm metadata (licence, version, peers)          | `https://registry.npmjs.org/<pkg>` and `https://registry.npmjs.org/<pkg>/latest`   |
| Release date map                                | `https://registry.npmjs.org/<pkg>` → `time` object                                 |
| Repo licence + activity                         | `https://github.com/<owner>/<repo>` → `LICENSE`, `/releases/latest`, `/commits`    |
| Machine-readable repo facts                     | `https://api.github.com/repos/<owner>/<repo>`                                      |
| Bundle size                                     | `https://bundlephobia.com/package/<pkg>@<version>`                                 |
| Weekly downloads                                | `https://api.npmjs.org/downloads/point/last-week/<pkg>`                            |
| Accessibility plugin config                     | flat-config usage docs for `eslint-plugin-jsx-a11y`; `@axe-core/playwright` README |
| Playwright snapshots                            | installed version's docs for `toHaveScreenshot` + `--update-snapshots`             |
| Supabase resumable uploads (Uppy decision gate) | installed `@supabase/supabase-js` Storage docs for resumable/TUS support           |

**3. Repo-side checks that need no network (cheap, do them in the same pass).**

```bash
grep -rn "prefers-reduced-motion" src/styles.css          # confirm the global reduce rule + the no-preference gate
grep -rn "jsx-a11y" eslint.config.* package.json          # confirm the plugin really is absent
grep -rn "ArrowUp\|ArrowDown" src/features/editor/EditorPage.tsx   # confirm button-only reorder sites
grep -rn "ILLUSTRATIONS\|TEMPLATE_PHOTOS" src/features/assets/*.ts # count the real catalogue size
grep -rn "pack_sticker\|packSticker" src/features/packs src/features/persistence 2>/dev/null  # is pack order editable?
npx knip --no-exit-code 2>/dev/null | head -50            # dead code/dex export sample (after TODO-VERIFY of knip)
```

Fetch date rule for the synthesis pass: record the **UTC date of the `npm view`/URL fetch** next to each fact
row. This document fetched nothing (no network tooling in this session), so no fetch date is claimed here; the
repository state inspected is bounded by the working tree, whose latest documented edit is `HANDOFF.md`
("Updated 2026-09-11").

---

## Sources

Local, read in full or in the ranges named (no network sources were fetched in this session):

- `package.json` — dependency reality: no motion/toast/DnD/forms/virtualisation/i18n/palette/observability
  libraries, and no `eslint-plugin-jsx-a11y`.
- `src/features/editor/EditorPage.tsx` (lines 1–120, 600–780) — hand-rolled layer stack with rename input,
  visibility/lock/duplicate/delete and `ArrowUp`/`ArrowDown` reorder; `React.lazy` Konva canvas; Radix
  Dialog/Tabs/Slider usage; `NoticeDialog`; `ingestImageFile`/`validateUpload` call sites.
- `src/features/assets/validateUpload.ts` — the full strict-upload contract (limits, sniffing, animation/GIF/
  SVG rejection, typed error codes, decode path).
- `src/styles.css` (lines 1–1487) — tokens; the global `prefers-reduced-motion: reduce` rule; the
  `no-preference` dialog `reveal` animation; 120–160 ms transitions; `.asset-items`/`.catalog-asset` tray
  geometry; `.layer-stack`/`.layer-row`/`.layer-action-btn`; `.pack-stickers-list`; `.presentation-slide-card`;
  `.search kbd`/`.global-search-*`; responsive breakpoints at 1150/900/720 px.
- `src/features/editor/catalog.ts` (head) — `STICKER_CATALOG` composition and the 25 named cutouts.
- `docs/editor-library-research.md` — already-settled canvas-engine decisions (not reopened).
- `docs/core-tools-plan.md` — one editor/one store/one schema rule; tool-intent status; auto-remove decision.
- `docs/slides-implementation-plan.md` — P18/P19 next, P23 slide reorder, P30 element/layer list, P40 export
  progress, P43 backup UI, P52 collection order, P54–P58 durable batch upload, P59/P62 catalog grid, P76–P77
  audits.
- `docs/ui-audit.md` — one-dialog-system and reuse rules; search/notifications "not implemented"; pointer-only
  canvas selection; uncommitted `/tmp` screenshots; artwork-rights caveat.
- `HANDOFF.md` — current increment, guardrails (single zoom clamp, additive IndexedDB, no second document
  model), verification commands, pre-existing test failures.
- `CONTEXT.md`, `AGENTS.md` — glossary, product invariants, offline-local-first constraint, no unapproved
  purchases, honesty rules.
- Rejected/deprioritised: every library's own docs and npm pages were **not fetched** (no network tooling);
  blog listicles and "awesome" lists were deliberately not consulted.

---

## Fifteen-line summary

1. No motion, toast, DnD, forms, virtualisation, i18n, command-palette, observability, or a11y-lint dependency
   exists in this repo today — verified from `package.json`.
2. Reduced motion is already solved in CSS (a global `reduce` kill switch plus a `no-preference` gate on the
   only keyframe animation), so `motion`/`react-spring` add a runtime and a second animation idiom to escape a
   rule the CSS already enforces; skip until a specific flow needs sequenced motion.
3. Layer reorder today is keyboard buttons (`ArrowUp`/`ArrowDown`) with rename/visibility/lock/duplicate in a
   hand-rolled stack; drag is the only real gap and its landing sites are P23 (slide rail) and P30 (element
   list), not the sticker layer panel.
4. Adopt exactly one drag library there — `@dnd-kit` preferred, Atlassian's pragmatic DnD as the large-list
   alternative — and require it to emit an array move into the existing command/undo path; reject `sortablejs`
   (DOM mutation) and React Aria collections (a second component system).
5. Virtualisation is unnecessary at this product's sizes (≈39-item tray, 240 px pack list, 8–10 slide cards);
   the catalog's answer is paging at P59/P62. Do not install a windowing library without a measurement.
6. Forms and validation libraries are unnecessary now: the dialogs are 1–3 fields, and the real boundary
   parsers are hand-rolled and already tested. `conform` assumes an action-form architecture this app lacks.
7. The highest-value small adds are a command palette (`cmdk`) that finally implements the advertised-but-
   "not implemented" global search, and `eslint-plugin-jsx-a11y` + `@axe-core/playwright` for automated a11y.
8. Committing Playwright screenshot snapshots for the four routes at 1440×900 / 1024×768 / 390×844 closes the
   audit's uncommitted-`/tmp` evidence hole and the 12 known-failing desktop overflow checks — no new dep.
9. Toasts are justified only for the deferred long-running flows (export progress P40, backup P43, batch upload
   P58); two feedback systems for the same event is the redundancy the UI audit already removed once.
10. Tours (driver.js / react-joyride / intro.js) should wait: the presentation editor is still changing
    (P18–P31), and hard-coded tour copy can end up describing behaviour that does not exist.
11. Observability SaaS (Sentry, Highlight) and OTel are rejected: network-dependent, account/purchase-bound,
    and in tension with "works offline with no cloud credentials"; `web-vitals` needs a sink that does not
    exist, and canvas interaction latency is better measured by the repo's own harness.
12. i18n is an unmade product decision, not a tooling gap — Vietnamese support today is content/font-level and
    already implemented; if it changes, prefer a compile-time approach and keep it out of the document model.
13. Crop/pan/zoom libraries (react-easy-crop, react-advanced-cropper, react-zoom-pan-pinch) must not be added:
    they introduce a second crop/zoom coordinate system and violate the single-clamp, mask-aligned,
    one-compositor invariants.
14. Upload UX: keep `validateUpload.ts` as the trust boundary — no library provides animated-format/SVG
    smuggling checks — skip `react-dropzone` for P18 (~15 lines of handlers suffice), reconsider it for P58
    folder drops, and reject `uppy` unless supabase-js resumable upload is proven inadequate.
15. Highest-confidence recommendation: do the three near-zero-risk items first — a11y lint + axe in the
    existing e2e suite, committed Playwright visual snapshots, and bundle analysis/knip as devDependencies —
    then `cmdk`, then one drag library at P23/P30; every licence, version, React-18 peer range and bundle
    number in this brief remains `TODO-VERIFY` and must be filled by the Part 3 pass before a decision is made.
