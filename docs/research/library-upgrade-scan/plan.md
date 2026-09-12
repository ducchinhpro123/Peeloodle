# Research Plan: stickerlab-library-upgrades

Topic: which libraries (or platform features) would materially raise the ceiling of
StickerLab — the local-first sticker editor plus the in-progress student presentation
editor — without replacing the document model, the framework, or local-first operation.

## Questions

1. **Image / canvas capability** — what can meaningfully deepen the sticker pipeline
   (masking, alpha outline, filters, decode, background removal, perf) beyond hand-rolled
   code, without swapping Konva or the `ProjectDocument` model?
2. **Slides / document content** — what is available for text shaping + measurement
   consistency, and for slide content primitives (charts, tables, diagrams, PPTX
   fidelity/import), given PPTX + PDF export already exist?
3. **Persistence / sync / collaboration** — is there a local-first sync layer that fits
   the existing repository interfaces, IndexedDB stores, revision conflicts, and Supabase
   auth/storage (guest → account migration), and what does undo/history tooling offer?
4. **Product velocity / UX quality** — which libraries buy real product surface
   (motion, sorting, command palette, virtualization, forms, toasts, onboarding, error
   reporting, i18n, testing) for a small dependency cost?
5. **Anti-recommendations** — which popular libraries in these spaces would actively hurt
   this repo (React 19-only, cloud-required, licence traps, bundle bloat, model ownership
   conflicts)?

## Strategy

- **Round 1 (4 parallel `researcher` subagents), disjoint dimensions** — canvas and image
  processing; slides, text and document content; persistence, sync and collaboration;
  product velocity and UX quality.
- Each researcher read the repo's constraints first (`AGENTS.md`, `CONTEXT.md`, `HANDOFF.md`,
  `docs/editor-library-research.md`, `docs/core-tools-plan.md`,
  `docs/slides-implementation-plan.md`, `docs/ui-audit.md`, `package.json`).
  `docs/editor-library-research.md` already settled canvas *engines*, so that question was
  closed to researchers in advance.
- **Fact pass (lead, not a subagent)** — every licence, version, release date, peer range and
  service-model claim was fetched from npm packuments, first-party docs and model APIs by the
  lead, because the researcher runtime exposed no network tool. Results are stored verbatim in
  `registry-facts.tsv` and `fetched-quotes.md`.
- **Round 2 — verification.** An `evidence-auditor` cross-checked every stated value against
  the stored retrieved data, and a `reviewer` re-derived the repository-side claims against the
  working tree and hunted for overstated confidence.
- **Round 3 — bounded second pass** over five untouched dimensions (offline packaging,
  server-state fetching, collection/table primitives, paste/import sanitisation, test coverage)
  after the reviewer showed the first pass had overreached its search space.
- Rounds run: **3**.

## Acceptance criteria — final status

- [x] Key questions answered, each with traced sources rather than recall
- [x] Contradictions and corrections recorded (two claims corrected after review: one licence,
      one factual claim about search)
- [~] ≥2 independent sources per load-bearing claim — **partly met.** Package facts come from a
      single first-party source (the npm packument). Independent cross-checking was impossible
      because the auditor had no network access; it verified against the lead's stored data
      instead. Licence conclusions rest on quoted first-party text and are sound; the *level of
      independence* behind them is lower than the original criterion asked for.
- [x] Evasion of single-source claims on licence decisions (all licence traps are quoted)
- [x] Anti-recommendations recorded with reasons
- [x] Search-space bound stated on the headline claim (added in round 3)

## Task ledger — final

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher | Canvas + image processing capability scan | **done** | `library-upgrade-scan-research-canvas.md` |
| T2 | researcher | Slides, text shaping, document content scan | **done** | `library-upgrade-scan-research-slides.md` |
| T3 | researcher | Persistence, sync, collaboration, undo scan | **done** | `library-upgrade-scan-research-sync.md` |
| T4 | researcher | Product velocity + UX quality scan | **done** | `library-upgrade-scan-research-ux.md` |
| T5 | lead | Draft brief from R1–R4 | **done** | `draft-pre-review.md` |
| T6 | evidence-auditor | Citation + URL + licence verification | **done, scoped** | `library-upgrade-scan-citations.md` — cross-checked stored data, could not independently re-fetch (no network in its runtime) |
| T7 | reviewer | Gap / confidence verification pass | **done** | `library-upgrade-scan-verification.md` — verdict FATAL on a false repo claim, which was then fixed |
| T8 | lead | Final brief + provenance | **done** | `docs/library-upgrade-scan.md`, `docs/library-upgrade-scan.provenance.md` |
| T9 | lead | Second pass over previously untouched dimensions | **done** (bounded) | folded into the brief (§10 and the trigger table) |
| T10 | lead | Correct the offline-shell framing after user review | **done** | §1 of the brief; an offline app shell is an enhancement, not part of the promised offline behaviour |

Deviations from the original plan, recorded rather than hidden: the workflow's `verifier` agent
does not exist in this harness (`evidence-auditor` filled the role), `memory_remember` was
unavailable so this file is the durable record, four researchers had no network access so the lead
performed the entire fact pass, and `exa` search was rate-limited throughout, which is why the fact
pass used registries and documentation directly.

## Verification log — final

| Item | Method | Status | Evidence |
|---|---|---|---|
| Each recommended library's licence and version | first-party packument fetch | **verified** | `registry-facts.tsv` (101 rows), retrieved 2026-09-12 |
| React 18 / Vite compatibility claims | `peerDependencies` read from the packument | **verified** | same file; e.g. `sonner` peers `^18.0.0 \|\| ^19.0.0`, `vite-plugin-pwa` peers `vite ^3.1–^7` |
| Maintenance signal | latest release date + weekly downloads | **verified** | same file; no benchmark or bundle size was ever measured |
| AGPL / MPL / CC-BY-NC licence traps | verbatim first-party licence text | **verified** | `fetched-quotes.md` §2–5 |
| Service requirements (PowerSync, Electric, Zero) | verbatim first-party documentation | **verified** | `fetched-quotes.md` §6 |
| Deployed cross-origin headers | raw `HEAD` response capture | **verified** | `fetched-quotes.md` §7 — no COOP/COEP |
| `@supabase/storage-js` has no resumable upload | installed package read from the working tree | **verified** | `fetched-quotes.md` §9 |
| Search already ships | repo source + e2e spec read | **verified** | `fetched-quotes.md` §11 — this corrected a draft recommendation |
| "No library exists for X" conclusions | bounded by the libraries examined | **NOT verified** | no exhaustive registry sweep was possible; the brief labels these as bounded |
| InstantDB / Jazz / Triplit service models | first-party pages unreachable or unreadable | **unverified** | flagged as inference in the brief's Open Questions |
| ONNX model sizes (~105 MiB / ~322 MiB) | summed from repository file listings | **derived** | not stated on any model card; labelled as derived |

## Recommendation risks (added after user review)

| Recommendation | Evidence quality | Principal risk |
| --- | --- | --- |
| Offline app shell (`vite-plugin-pwa`) | licence and version verified; the absence of any service worker/manifest verified in the repo | **Framing risk, now corrected:** this is an *enhancement beyond* the documented offline promise, not a broken promise. A service worker also changes app-wide caching semantics, and stale-version handling is an ongoing support cost (recorded as caveats in §1) |
| a11y tooling (`eslint-plugin-jsx-a11y`, `@axe-core/playwright`) | licence and version verified; absence of the plugin verified | `@axe-core/playwright` and `axe-core` are **MPL-2.0** (file-level copyleft) — acceptable for devDependencies, but a licence decision to record; a first axe run on an existing app yields a triage backlog |
| Search at catalogue scale (`fuse.js` / `minisearch`) | licence and version verified; today's substring matching verified in source | Trigger-based and **unmeasured**: no catalogue exists at that scale yet, so the benefit is inferred, not demonstrated |
| Drag reorder (`@dnd-kit`) | licence and version verified; landing sites verified | Its newest release is ~21 months old at the research date (recorded against the actively-released Atlassian alternative); a pointer-only implementation would regress keyboard access |
| `sonner` toasts | licence and version verified | Introduces a second feedback system unless the "never for save state" rule is enforced — inference about team discipline, not a technical guarantee |
| Visual regression and bundle tooling | licence and version verified | Playwright snapshot churn across environments; `knip` false positives around this repo's dynamic imports |
| "Keep the hand-rolled sync layer" | repository evidence re-derived line by line by an independent reviewer | The engine-side rows rest on inference for RxDB, Liveblocks, Yjs/Loro/Automerge, Jazz and Triplit (only PowerSync, Electric and Zero have first-party quotations) — labelled as such in §7 |
| "Adding a second text engine would break parity" | measured parity proof in the repo | Inference about *this* architecture, not a general claim about those libraries |

## Decision log

- Slug: `library-upgrade-scan`. Artifacts live in `docs/research/library-upgrade-scan/`, with the
  durable brief at `docs/library-upgrade-scan.md` (matching the repo's `docs/` convention for
  research notes rather than a scratch directory).
- Scope deliberately excluded: canvas-engine replacement (already researched in
  `docs/editor-library-research.md`), framework migration, native mobile, and anything requiring a
  paid licence quote or a server backend for core editing.
- After review, the headline was bounded explicitly: four dimensions were searched in depth and five
  more in a second pass, but no exhaustive registry sweep was performed.
- **Correction (2026-09-12, after user review):** §1 originally framed offline app-shell support as
  "the promise the app does not yet keep". The documented promise is that core editing, saving,
  reopening and PNG export work without cloud credentials — a promise the app *does* keep. An
  installable, offline-loading shell is a valuable enhancement beyond that promise, and it is now
  described as one.
