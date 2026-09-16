# Milestone 6: Template authoring and publishing

## Goal

Deliver the final catalog surface from the presentation architecture: an administrator turns an existing local presentation into a catalog template, edits and publishes immutable template versions through the shared presentation editor, and students clone complete independent presentations or insert individual layouts.

Milestone 6 covers P65–P75 in `docs/slides-implementation-plan.md`. It does not add cloud storage for student presentations, linked master slides, native chart editing, or unattended background processing.

## Delivery sequence

Implement the milestone in dependency order:

1. P65: save a local presentation as a template draft.
2. P66: administer template metadata and edit drafts in the shared editor.
3. P67: generate cover and per-slide previews from an immutable draft snapshot.
4. P68: validate, publish, and archive templates.
5. P69–P71: browse, clone, and insert template layouts on the student side.
6. P72–P75: author three complete templates and verify their full student journey.

Each increment remains independently testable and should be committed only after its focused checks pass.

## Existing foundation

Reuse the catalog schema and repositories delivered in milestones 4 and 5:

- `catalog_templates` stores stable metadata, state, revision, and the published-version pointer.
- `catalog_template_versions` stores immutable document snapshots, hashes, preview paths, font requirements, and validation state.
- `catalog_template_dependencies` pins exact catalog asset/version pairs through composite foreign keys.
- Catalog publish/archive operations already enforce revision and dependency guards.
- `CatalogRepository` already exposes published template reads; `CatalogAdminRepository` is extended rather than replaced.
- Presentation parsing, local persistence, media storage, rasterization, PDF/PPTX export, and the presentation editor remain the authoritative implementations.

No second presentation editor or parallel document model is introduced.

## P65: save as template draft

Add an administrator-only “Save as template” action to the existing presentation editor. The operation captures one coherent presentation snapshot after flushing pending edits, validates it with the existing parser, hashes the serialized document, and identifies every referenced media dependency.

Resolve every document asset before committing a template record. Assets already inserted from the catalog reuse their exact catalog item/version provenance after verifying the stored hash. Uploads and personal sticker snapshots become draft catalog assets through the existing upload/processing path in an administrator-chosen collection; the template draft pins those resulting versions. No template-only media store is added.

Then call one guarded RPC that creates the stable template and its immutable draft version, records its dependency rows, and advances the template revision atomically. If any upload, validation, permission check, or commit fails, no usable template draft is created and the local presentation remains unchanged. Newly uploaded but unreferenced draft assets remain ordinary reviewable drafts; they are never published implicitly.

The initial draft has no previews. Adjust the schema so `cover_path` and `cover_sha256` may both be null only while a version is not validated; keep the pair all-null or all-present. The document, hash, dependencies, and every version row remain immutable.

The local presentation is the source of a copy, never a live catalog pointer. Its ID, revision, media ownership, and future edits remain independent from the template draft.

## P66: template administration and shared editing

Add `/admin/templates` and `/admin/templates/:id` within the existing admin shell. The list supports status/use-case filtering and displays real metadata. The detail screen shows metadata, current version state, validation facts, and available lifecycle actions.

“Edit draft” opens the existing presentation editor in template mode. Template mode changes persistence and surrounding actions, not editing behavior or document semantics. Saving creates a new immutable draft version against the expected template revision. A revision conflict preserves the administrator’s work and requires reload or an explicit retry against current state; it never silently overwrites another tab.

Published versions remain immutable while a newer draft is edited.

## P67: previews

Generate the cover and ordered slide previews from the exact immutable draft document and its resolved media. Reuse the fixed-page slide rasterizer so previews agree with PDF rendering and editor composition.

Preview records are bound to the document SHA-256. Preview generation does not update the pending version: after all preview objects upload successfully, one guarded RPC creates a successor immutable version containing the same document/hash/dependencies plus the preview manifest and chosen cover. The superseded pending version remains non-publishable. A later draft edit creates another pending snapshot, so prior previews are ineligible for validation or publication. Cover selection references one generated slide preview rather than introducing an unrelated image workflow.

Native rasterization requires a server route, like catalog asset processing. Static deployments report preview generation as unavailable; they do not claim background processing. The route authenticates the caller and uses their catalog permissions. It does not expose a service-role credential to the client.

## P68: validation and lifecycle

Template validation checks:

- supported presentation schema and centralized document limits;
- every referenced media item has bytes, expected hash, and a pinned immutable catalog version whose asset is published;
- cover and preview fields are complete rather than the nullable pending-draft form;
- required fonts are in the supported bundled set and recorded explicitly;
- cover and slide previews match the current document hash and slide order;
- no temporary signed URL, private source path, arbitrary HTML, or unresolved reference appears in document JSON.

Publication is one guarded operation against the expected template revision. It points the stable template to the validated immutable version only when every check succeeds. Failure leaves the prior published version untouched.

Archiving removes the template from new discovery. Existing student clones remain valid because they own copied bytes. Catalog asset archiving continues to respect template dependency pins; a rights takedown requires an explicit affected-template action rather than silently breaking a live template.

## P69–P71: student use

Expose published templates through the public template browser with use-case filters, loading/error/empty states, cover cards, and an all-slide preview. Display actual template contents and supported editability; do not imply native chart or table editing.

Cloning first downloads and verifies every dependency, then remaps the presentation, slide, element, and asset IDs. Commit the new document and all media to the local presentation repository in one atomic operation. Any unavailable or invalid dependency leaves no half-created presentation. Two clones share no mutable state.

Layout insertion uses the same dependency-download and ID-remapping logic for selected slides. It inserts at the chosen position as one undoable editor command. Existing theme behavior stays copy-based: inserted elements retain their explicit styles, while future elements use the destination document’s defaults.

## P72–P75: shipped content

Author three templates with 8–10 useful layouts each:

- Class presentation: title, agenda, concept, text/image, comparison, example, summary, references, and closing.
- Research defense: problem, question, method, results image area, discussion, limitations, references, and Q&A.
- Club pitch: mission, problem, proposal, activities, timeline, team, impact, and call to action.

Use original or documented reusable artwork. Mark all sample text as sample content. Chart-like designs use ordinary shapes/text or image placeholders and clearly avoid a native-data-editing promise. Build editable slides before generating covers.

For each template, verify clone → replace English/Vietnamese content and sample images → save → reload → reopen → PDF/PPTX. Confirm the catalog source and another clone remain unchanged, and surface existing overflow warnings for content that does not fit.

## Failure handling

Operations fail before mutation wherever possible. Multi-step media work may leave bounded unreferenced staging objects, which the existing orphan-cleanup rules may remove; it must not leave a discoverable template or incomplete local presentation.

Errors use existing explicit result categories for permission, not found, validation, conflict, unavailable processing, download failure, and local persistence failure. UI copy names the failed stage and preserves recoverable work.

## Verification

Use the smallest check that proves each boundary:

- SQL harness: atomic draft creation, immutable versions, dependency pins, revision conflicts, publication guards, and archive behavior.
- Repository contract tests: strict wire parsing, public published-only reads, admin mutations, and in-memory/remote parity.
- Unit tests: snapshot hashing, dependency collection, ID remapping, clone/layout atomicity, and preview-hash validation.
- Component/browser tests: editor action, admin list/detail, shared editor mode, public browsing, all-slide preview, failure states, and keyboard operation.
- Whole journeys: all three templates cloned, edited, persisted, reopened, and exported with inspected PDF/PPTX artifacts.
- Svelte checks: run the Svelte autofixer on every touched component until it reports no issues, then run the project check, lint, build, unit, SQL, and applicable browser suites.

P53’s live Supabase isolation check remains blocked without a dedicated test project. Record that gap in milestone evidence; do not substitute service-role or synthetic tests and call it live verification.
