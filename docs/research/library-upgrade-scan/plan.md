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

- **Round 1 (4 parallel `researcher` subagents), disjoint dimensions**
  - R1 canvas-and-image-processing
  - R2 slides-text-and-document
  - R3 persistence-sync-collaboration
  - R4 ux-velocity-and-quality
- Each researcher reads the repo's own constraints first (`AGENTS.md`, `CONTEXT.md`,
  `HANDOFF.md`, `docs/editor-library-research.md`, `docs/core-tools-plan.md`,
  `docs/slides-implementation-plan.md`, `docs/ui-audit.md`, `package.json`).
- `docs/editor-library-research.md` already settles *canvas engines* (Konva vs Fabric vs
  Polotno vs CE.SDK vs tldraw). Researchers must not redo that.
- **Round 2** — `evidence-auditor` checks the draft's critical claims against sources;
  `reviewer` checks for logical gaps and overstated confidence. Fix FATAL findings.
- Expected rounds: 2.

## Acceptance Criteria

- [ ] Every question answered with ≥2 independent sources (primary docs/repos preferred)
- [ ] Each recommendation carries: licence, version/release recency, maintenance signal,
      React 18 + Vite 6 compatibility, and the concrete thing it replaces or adds
- [ ] Effort and risk stated per recommendation; "inference" labelled as such
- [ ] Anti-recommendations included with a reason
- [ ] Contradictions between sources identified and addressed
- [ ] No single-source claims on any load-bearing recommendation

## Task Ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher | Canvas + image processing capability scan | todo | outputs/library-upgrade-scan-research-canvas.md |
| T2 | researcher | Slides, text shaping, document content scan | todo | outputs/library-upgrade-scan-research-slides.md |
| T3 | researcher | Persistence, sync, collaboration, undo scan | todo | outputs/library-upgrade-scan-research-sync.md |
| T4 | researcher | Product velocity + UX quality scan | todo | outputs/library-upgrade-scan-research-ux.md |
| T5 | lead | Draft brief from R1–R4 | todo | outputs/.drafts/library-upgrade-scan-draft.md |
| T6 | evidence-auditor | Citation + URL verification of draft | todo | outputs/library-upgrade-scan-citations.md |
| T7 | reviewer | Gap / confidence verification pass | todo | outputs/library-upgrade-scan-verification.md |
| T8 | lead | Final brief + provenance | todo | outputs/library-upgrade-scan.md |

## Verification Log

| Item | Method | Status | Evidence |
|---|---|---|---|
| Each recommended library's licence + latest release | direct fetch of npm/GitHub/first-party docs | pending | |
| React 18 / Vite 6 compatibility claims | peerDependencies + changelog check | pending | |
| Maintenance signal (last release, open-issue trend) | repo + npm metadata | pending | |
| Every cited URL resolves | evidence-auditor pass | pending | |
| "Fits existing repository interface" claims | repo file read (`src/lib/persistence/**`, `src/features/**/store.ts`) | pending | |

## Decision Log

- Slug: `library-upgrade-scan`. Deliverables live under `outputs/` (scratch, gitignored);
  the repo's durable research-notes convention is `docs/`, so the user may promote the
  final brief there.
- `memory_remember` (step 1 of the workflow) is unavailable in this harness — the plan
  artifact is the durable record instead.
- The workflow's `verifier` agent does not exist here; `evidence-auditor` fills that role,
  and `reviewer` covers step 7. Both are read-only, so the lead applies fixes and writes
  the final brief.
- Scope deliberately excludes: canvas-engine replacement (already researched), framework
  migration, native mobile, and anything requiring a paid licence quote or a server
  backend for core editing.
