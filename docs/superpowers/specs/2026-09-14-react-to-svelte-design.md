# Peeloodle React → Svelte migration design

Status: proposed written design for user review. No application implementation has started.

## Goal and authority

Port the implemented behavior and visual identity of `../Peeloodle` into this SvelteKit application. Keep the React source unchanged. Retain Supabase Auth, PostgreSQL, private Storage, existing schemas and cloud protocols; this is not a backend migration. Preserve local-first operation without credentials. Do not copy secrets or modify production configuration/data. Preserve existing target user changes.

Source reference: React main at `54eae61c6e93519f235dd91641da92ca000ae189` (clean, ahead 15 when inspected). The target is currently unversioned; do not initialize Git, commit or configure a remote without approval. Before implementation, capture a local recoverable scaffold backup excluding dependencies/build artifacts. Do not publish or deploy.

## Routing and presentation

Preserve `/`, `/create`, `/editor/:projectId`, `/templates`, `/my-stickers`, `/presentations`, `/presentations/:presentationId`, `/auth/callback`, query-driven editor tools and library views. Verify wildcard behavior against `../Peeloodle/src/app/routes.tsx`. Implement SvelteKit route files, not a React application embedded inside Svelte. Normalize the generated library/showcase scaffold into an app and remove unused demo Better Auth/Drizzle integration from application startup.

Reuse source local artwork/fonts/samples and provenance. Preserve existing tokens, responsive shell, project previews and calm editor controls. Use shared accessible Svelte UI primitives, keyboard-reachable controls, dialog focus restoration and mobile tools/properties panels. Essential save/export actions remain reachable at all breakpoints.

## Data, editing and rendering

Reuse framework-independent TypeScript contracts, validation, repositories, commands, geometry, masks, compositing, exports and tests where compatible. Audit actual imports before classifying modules as reusable: framework-independent does not mean DOM-free. Keep browser-only modules behind client lifecycle boundaries rather than rewriting working algorithms merely to make them server-compatible.

Preserve document versions, stable IDs, database store/key conventions, separate image blobs, immutable originals and image-local masks. Documents remain authoritative; scene graph nodes, object URLs and viewport state are never persisted. Keep sticker and presentation models separate.

Replace React bindings with Svelte 5 runes and scoped context/controllers. Use derived state for computations, explicit commands for edits and effects/attachments only for external synchronization. Keep mutable editor state out of server-global modules. Instantiate IndexedDB, image decoders and Konva on the client; use direct Konva integration without react-konva. Preserve the source editor's rendered/exported semantics and undo gesture boundaries.

Preserve save coordination and revision capture. Flush pending work before replacing a document/repository; a failed flush must retain the draft and prevent unsafe replacement. Do not cancel pending writes on teardown as a substitute for safe flushing. Save completion may only clear the revision actually persisted. Clean up subscriptions, scene nodes and obsolete object URLs after safe lifecycle transitions.

## Supabase and compatibility

Port the existing optional browser Supabase integration and source callback/session/sync behavior. Preserve public configuration naming where practical. Keep private keys out of frontend code; do not add service-role credentials. Retain existing owner RLS and private Storage policies. No new cookie/session-server architecture, identity mapping, schema migration or application backend is required by this port.

Preserve local drafts on auth/sync failure, idempotent guest import, retry queues and conflict copies. Keep presentations local where that is current source behavior; do not invent presentation cloud tables or new cloud features.

IndexedDB is origin-scoped. Matching database names does not transfer data between different origins. Document this limitation; verify source-format compatibility with fixtures/backups. Deployment-origin cutover or additional transfer tooling requires a separate explicit decision, not an automatic production operation.

## Implementation slices and ownership

Use serial writers in the target checkout, with independent review between meaningful milestones. The parent owns source/path discovery through FFF and supplies exact files to children while child FFF registration is unavailable. Children read supplied/imported paths and request additional searches rather than substituting another search utility.

1. **Working sticker vertical slice:** normalize app configuration and tests; reuse domain/storage/render modules; port shell/dashboard and create/reopen routes; deliver upload, image/text transforms, local save/reload/reopen and transparent PNG export together.
2. **Full sticker/library parity:** finish masks/restore, crop/flip, filters/outlines, layers, history, save recovery, tool intents, templates/favorites, packs and ordered ZIP exports.
3. **Presentation parity:** port separate library/controller/editor; preserve implemented slide, rich-text, shape, image, geometry, history and save behavior; sticker snapshots, backup restore, PDF/PPTX/backup exports.
4. **Cloud parity:** port optional Supabase auth/callback and existing sticker/pack cloud persistence, guest import, offline retry and conflicts. Reuse existing backend contracts without live backend mutation.
5. **Parity hardening:** close route/behavior discrepancies, verify assets, responsive layouts, keyboard access, browser lifecycle and production build; update README and migration checklist with honest remaining gaps.

Do not claim a partial milestone is the full port. Presentation templates/admin catalog, public sharing, billing, native messenger installation, automatic background removal and other unimplemented upstream features remain deferred.

## Verification and evidence

Before Svelte work, workers load both Svelte skills and call MCP `list-sections`, then relevant `get-documentation`. Use targeted sections to avoid truncated documentation. Run MCP `svelte-autofixer` on every changed Svelte component/module; resolve actionable findings and record coverage. A clean toy-component autofixer call proves connectivity only, not application correctness.

Each milestone must run target check/lint, focused unit/component tests, relevant Playwright journeys and production build using actual configured scripts. Port reusable source regression tests instead of replacing their contracts with weaker assertions. Independent review inspects source parity and the actual target files.

Acceptance journeys:

- Upload supported PNG/JPEG/static WebP; reject unsupported, oversized and undecodable images. Edit image/text, undo/redo by gesture, save/reload/reopen with assets/fonts intact. Save failures retain recoverable drafts.
- Inspect generated 512/1024 PNGs for source-equivalent artwork bounds, transparency and absence of viewport/selection decorations. Verify transformed masks/crops/outlines match preview and export.
- Template clones remain independent; deleting packs preserves stickers; ZIP image order agrees with manifest; library query views and editor tool intents behave as source.
- Presentations preserve slides, text formatting, shapes/images, transforms and history through reload; sticker snapshots remain immutable; backup restore and exported PDF/PPTX/ZIP contents are verified, not merely download clicks.
- Local-only operation needs no cloud credentials. Test synthetic auth/session and retry/conflict behavior; live cross-user RLS/storage tests require dedicated approved test accounts and environment. Report unavailable live verification explicitly.
- Inspect desktop 1440×900, tablet 1024×768 and mobile 390×844, including empty/populated states, dialogs, keyboard focus and reduced motion where applicable.

## Tooling evidence so far

The design worker successfully called Svelte MCP `list-sections`, `get-documentation` and `svelte-autofixer` on an in-memory rune sample with no findings. No application checks have run and no application files have changed. Parent corrected the worker draft to remove unapproved server-auth/catalog scope and unsafe save-cancellation guidance.
