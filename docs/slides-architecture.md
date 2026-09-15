# Presentation and catalog architecture

Planning baseline: 2026-09-10. Product scope was confirmed after the interview. This document specifies future work; none of these presentation/admin capabilities are implemented by this planning session. Follow the task sequence in [the implementation plan](slides-implementation-plan.md).

## Boundaries and stack

| Boundary                 | Choice                                                                                                                                                            | Responsibility                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Student interface        | Existing React, TypeScript, Vite, Router, shared Radix/shadcn-style components and tokens                                                                         | Presentation library, editor, exports, backup restore                    |
| Presentation interaction | Konva/react-konva plus DOM text editing; Zustand commands                                                                                                         | Slide interaction and view state; never the persisted document           |
| Local persistence        | Typed presentation repository backed by IndexedDB                                                                                                                 | Atomic document/media saves; independent of student sign-in              |
| Catalog/admin            | Existing Supabase Auth, PostgreSQL and Storage; React admin routes                                                                                                | Curated assets, collections, presentation templates, admin authorization |
| Trusted media processing | Small TypeScript Node function on the existing Vercel deployment; Sharp for raster decoding and derivatives, SVG parser/renderer selected in the processing proof | Validate and normalize one staged asset per invocation                   |
| PPTX                     | PptxGenJS adapter, added after the export proof                                                                                                                   | Editable text, pictures and basic shapes                                 |
| PDF                      | pdf-lib adapter                                                                                                                                                   | Initially one fixed-visual raster slide per PDF page                     |
| Portable backup          | Versioned JSON + media ZIP; fflate candidate                                                                                                                      | Download and restore complete local editable work                        |

Use npm and commit lockfile changes when implementation adds dependencies. No new frontend framework, ORM, Redis, generic CMS, separate Express/Nest application, or cloud student-document schema is needed for this release. The Node endpoint is specifically required for trusted image processing; it is not a second general backend. Keep native processing dependencies out of the browser bundle.

PptxGenJS documents browser output and structured text runs, bullets and links; these are reasons to evaluate it, not proof that our layouts already export correctly. Its image documentation describes SVG compatibility limitations, reinforcing the initial PNG picture export choice. [Text](https://gitbrent.github.io/PptxGenJS/docs/api-text/), [saving](https://gitbrent.github.io/PptxGenJS/docs/usage-saving/), [images](https://gitbrent.github.io/PptxGenJS/docs/api-images/).

pdf-lib supports PNG embedding, sufficient for the fixed-visual PDF path. fflate offers ZIP compression/decompression, but our importer must enforce its own archive limits. [PDFDocument](https://pdf-lib.js.org/docs/api/classes/pdfdocument), [fflate](https://github.com/101arrowz/fflate).

Supabase's documented Edge limits include 256 MB memory, two seconds of CPU per request, and unsupported native multithreaded libraries such as Sharp. Use a Node runtime for this processing rather than assuming background Edge execution removes the limits. [Edge limits](https://supabase.com/docs/guides/functions/limits), [Sharp](https://sharp.pixelplumbing.com/).

Vercel Function request/response bodies have a documented 4.5 MB limit. Upload bytes directly to restricted Supabase Storage; the processing endpoint accepts an upload job ID, retrieves the assigned object, stores results, and returns small status JSON. Verify native-module packaging and configured memory/time limits in a preview deployment before committing to the endpoint implementation. [Vercel limits](https://vercel.com/docs/functions/limitations).

## Existing code to preserve

- `src/types/domain.ts` and `src/lib/persistence/document.ts` describe and validate the existing square transparent sticker document. Add a presentation schema instead of weakening sticker validation or converting saved stickers.
- Sticker user PNG exports in `src/features/exports/renderDocument.ts` trim to visible artwork; fixed-artboard probes remain available. Presentations need fixed rectangular pages with no artwork trimming. Do not reuse the sticker download contract.
- `src/features/editor/draftSaving.ts`, `useDraftAutosave.ts` and repository adapters provide save/asset-retention patterns. Reuse small independent helpers when appropriate; do not parameterize the entire sticker editor prematurely.
- `src/features/editor/KonvaCanvas.tsx` is bound to the sticker store. Build a presentation renderer; share lower-level image and geometry helpers only where semantics agree.
- `src/features/auth/client.ts`, `Workspace.tsx`, `src/types/database.ts` and `supabase/migrations/` supply identity and authorization patterns. Current cloud resource kinds and document checks are sticker-specific.
- `src/features/editor/catalog.ts` is a bundled catalog, not the planned hosted catalog. Adapt the catalog browser without removing existing working assets.
- `src/components/ui/` and `src/styles.css` own interface primitives/tokens. New presentation/admin screens use them.
- Existing untracked `docs/editor-library-research.md` is unrelated work and must be preserved.

Suggested additions, not a repo-wide move:

```text
src/features/presentations/
  model/             # Schema, parser, commands, history, geometry
  editor/            # Canvas, DOM text bridge, tools, slide rail, inspector
  library/           # Create, list, rename, duplicate, delete, restore
  rendering/         # Text layout, asset preparation, visual slide rendering
  exports/           # PPTX, PDF, portable backup adapters
src/features/catalog/ # Public catalog queries, paging, asset ingestion
src/features/admin/   # Asset, collection, batch and template management
src/lib/persistence/presentations/ # Interface, memory and IndexedDB adapters
server/catalog/       # Node-only auth, processing, storage and job helpers
api/catalog-process.ts # Small Node deployment entrypoint
supabase/migrations/  # Additive catalog/admin migrations
```

## Serializable presentation model

Use a separate `PresentationDocument` discriminant and version. Initial geometry is 1280×720 document units, independent of zoom and display pixels. It maps to 13⅓×7½ inches in PPTX at 96 document units/inch; text sizes are stored in document units and convert explicitly to points. Centralize conversions and test them.

```text
PresentationDocument
  kind: presentation; schemaVersion; id; title; revision; timestamps
  pageSize: width=1280, height=720
  theme: font choices and named colors copied into this document
  slides: ordered Slide[] (at least one)
  assets: document-local immutable asset references
Slide
  id; name; background color; ordered Element[]
Element base
  id; name; x; y; width; height; rotation; opacity; visible; locked
Text element
  paragraphs[]: alignment, bullet kind/level, spacing, runs[]
  run: text, font ID, size, color, bold, italic, optional safe hyperlink
  padding; line height; vertical alignment
Image element
  document asset ID; normalized non-destructive crop; flipX/flipY; alt text
Shape element
  supported shape kind; fill; stroke color/width
Document asset
  ID; blob key; hash; actual MIME; width/height; provenance snapshot
  optional catalog item/version or source sticker ID (informational only)
```

Only copy formats covered by the export contract into the schema. Initial shapes: rectangle, rounded rectangle, ellipse, line and arrow. Keep advanced effects in inserted image snapshots. There is no requirement to expose every sticker-editor effect as a live presentation effect.

The parser rejects unknown versions, duplicate IDs, non-finite geometry, invalid text runs, unsafe link schemes, missing references and oversized input. No DOM nodes, Konva objects, URLs with temporary credentials, or arbitrary HTML belong in document JSON. Use stable IDs during editing, and new IDs when duplicating documents/slides or cloning templates.

`PresentationRepository` operations: list summaries, load complete document/media, atomically save snapshot, duplicate, remove. `CatalogRepository`: list published items with filters/page cursor, fetch a published immutable version, fetch its display bytes. `CatalogAdminRepository`: draft CRUD, upload-batch status, guarded publish/archive and template version operations. Keep explicit result/error types for missing media, quota, permissions, unsupported schema and revision conflicts.

Commands include slide add/duplicate/reorder/remove; element insert/update/transform/reorder/delete/lock; rich-text change; background/theme change. Keep active slide, selection, zoom, pan and open panels outside the document. One completed drag, slider gesture or text-edit session makes one undo entry. Use 50 history entries plus a memory ceiling; retain blobs referenced by current state or history. Switching slides doesn't clear undo. Prevent two open tabs silently overwriting a newer revision: compare local revisions and preserve a conflict copy or require explicit reload.

## Text and visual rendering

This is the highest editor/export risk. A paragraph/run model, not HTML, is authoritative. DOM editing handles caret selection, mixed formatting, paste normalization and English/Vietnamese IME composition. An adapter converts to/from the document model. Never persist pasted markup or use a raw `contenteditable` DOM tree as the source of truth.

A shared text-layout service measures the tested fonts, applies wrapping and paragraph metrics, and exposes overflow/bounds. Use its layout for canvas previews and raster exports. The DOM editing overlay must match those metrics. PPTX maps the same document into native text objects; allow small antialiasing/metric differences but fail the supported test fixtures on missing text, unintended overflow, bullet loss or broken diacritics. Do not silently shrink or rasterize ordinary text to hide mismatches.

Start with two font families with regular/bold/italic coverage and English/Vietnamese glyphs, verified during the proof. Do not assume existing playful sticker fonts cover academic text or every language. Bundle permitted font files, record provenance, and await loading. Store stable font IDs in documents/backups. PPTX font embedding is not promised until independently proven; give precise font requirements. Microsoft documents font substitution and embedding implications. [Microsoft font guidance](https://support.microsoft.com/en-us/office/benefits-of-embedding-custom-fonts-cb3982aa-ea76-4323-b008-86670f222dbc).

## Save, backup and export contracts

| Operation     | Required behavior                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local save    | Debounced ~750 ms after completed edits; explicit Save flushes pending text/gestures and media writes. Report saving/saved locally/failed accurately.                                            |
| Reload/reopen | Rehydrate media and font dependencies before display/export; preserve composition and slide order.                                                                                               |
| Backup        | ZIP containing manifest, presentation JSON and every required image; font identity/version/license information and permitted font bytes where needed for portable restoration.                   |
| Restore       | Validate everything before committing; create a new presentation with remapped IDs. Invalid/oversized archives leave existing work untouched.                                                    |
| PDF           | Ordered 16:9 pages, initially rendered at 1920×1080 per slide; full background/composition, no editor controls. This version is image-based: text selection and PDF hyperlinks are not promised. |
| PPTX          | Native editable text, basic shapes and individually movable image objects; background and order preserved. SVG and personal sticker artwork become PNG pictures.                                 |
| All exports   | Freeze a coherent snapshot after flushing edits; await assets/fonts; show progress/failure and release resources. A partial failure never downloads a misleading complete file.                  |

Keep each exported image's aspect ratio and alpha. Crop/flip/opacity that cannot be represented consistently may be baked into that image's pixels, while it remains an independently movable picture. Never flatten the entire PPTX slide. Contents outside the slide are intentionally clipped to the fixed page in visual output; constrain/validate native PPTX objects so on-slide appearance remains consistent. Warn about text overflow and unresolved media before export.

Archive restore must limit file count, compressed and expanded size, path names, individual image dimensions, nesting and compression ratios. Reject duplicate archive paths, external references, unsupported formats, encrypted archives and newer versions recoverably. Check hashes for corruption; hashes alone do not establish trust. Browser quota checks are advisory; failed writes preserve the previous save and keep backup download available.

Local-first means already downloaded presentation media survive a catalog outage. It does not promise that a closed website can launch offline without a separately implemented app-shell cache. Initial offline acceptance is editing/exporting already-loaded local work with network disabled.

## Admin catalog data and authorization

| Table/concept                                    | Core fields and invariants                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `catalog_admins`                                 | Backend-controlled user ID membership; no self-enrollment or profile-based role assignment                              |
| `catalog_collections`                            | Stable ID, name, description, tags, order, state, revision                                                              |
| `catalog_assets`                                 | Stable item ID, collection ID, searchable metadata, published-version pointer, state, revision                          |
| `catalog_asset_versions`                         | Immutable version ID, validated source hash/metadata, derivative paths/hashes/dimensions, provenance, validation result |
| `catalog_templates`                              | Stable template ID, use case, title/tags, publication state, published-version pointer, revision                        |
| `catalog_template_versions`                      | Immutable presentation snapshot, copied asset/version dependencies, rendered previews and font requirements             |
| `catalog_upload_batches` / `catalog_upload_jobs` | Batch ID, item ID, source path, stage, progress, attempt, lease/token, errors, timestamps                               |
| `catalog_events`                                 | Actor, operation, item/version and outcome for publish/archive/processing diagnostics; no image bytes or credentials    |

Ordinary and anonymous users may read published catalog metadata and approved derivatives only. Admins may edit catalog drafts. Student private sticker tables/buckets stay private and separate. Supabase supports Auth-backed row policies and Storage access policies; design and test both rather than relying on route hiding. [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access](https://supabase.com/docs/guides/storage/security/access-control).

Keep sources/drafts in a private bucket. Published derivatives also use a private bucket with read policies tied to the currently published version/dependencies; support anonymous reads through short-lived signed download URLs if required by the client API. Do not assume a public bucket enforces archive revocation. Already downloaded/signed/cached files cannot be recalled; archive prevents new catalog discovery/insertion after authorization/cache expiry, not deletion of student copies.

Only trusted processing can mark a version validated. Only guarded server/database operations can switch a published-version pointer. Require expected revisions for admin edits, even with one administrator who may have multiple tabs. Admin membership bootstrap is a controlled SQL/setup step; no public bootstrap endpoint. Verify JWTs server-side and query current membership for privileged endpoint calls. Service credentials stay server-only, with fixed allowed buckets/paths and operations.

## Bulk upload and processing

1. Admin creates a draft collection and selects multiple files. Create stable batch/job IDs; show per-file results instead of one blocking batch outcome.
2. Preflight file count, bytes and claimed types in the browser. Reserve restricted source object paths via an authorized operation; upload directly to private Storage. A client check is UX, not publication authorization.
3. Each finished upload becomes a durable `queued` job. A processing request carries only its job ID. The Node function authenticates the administrator, claims the job with a lease, and resolves its trusted source path from the database. Never accept arbitrary fetch URLs.
4. Decode/inspect actual bytes with hard resource limits. PNG/static WebP normalize to approved PNG and thumbnail WebP derivatives. SVG must pass a strict static subset policy: no scripts, event handlers, external resources, foreignObject, DTD/entities or animation. Bound dimensions/node complexity; unsupported filters/features get a clear review error. Keep original bytes private; render the allowed SVG to PNG for insertion/export. Do not use regex as an SVG sanitizer.
5. Store immutable, hashed derivatives before finalizing the ready version. Conditional finalize checks the lease token so an expired worker cannot overwrite a retry. Idempotent retries reuse a completed result.
6. Admin reviews names, tags, previews and source/permission metadata. Publication requires successful server validation and complete usable media. Failed items do not block unrelated ready drafts from individual publication.
7. The dashboard polls/reloads durable job state. Close-tab behavior is honest: the active request may finish; unstarted jobs remain queued until admin resumes. No unattended background processing guarantee in v1. Cancellation prevents pending/future processing and publication; it does not claim to interrupt every native decode instantly.
8. Initial dashboard allows at most two processing requests concurrently, one file each. Persist retryable errors; automatically reclaim only expired leases with attempt limits. Add a bounded orphan-cleanup operation for abandoned staging/derivatives, never originals still referenced by versions/templates.

Starting engineering limits, adjustable after measured fixtures: 100 files per batch; 15 MB and 25 MP per raster (matching existing upload constraints); SVG 2 MB, bounded 4096px maximum rendered edge and 25 MP output; 50 slides, 200 elements/slide, 200 MB unique compressed media/presentation. Enforce expanded-memory/output limits too; process slide exports sequentially. These are initial implementation defaults, not measured capacity claims. Make limits centralized and show actionable errors before insertion/import. Test on representative laptops before raising them. Each image asset record carries the compressed byte length of its stored blob, so the media budget is summed from the document itself and survives reload, duplication and backup restore; a document written before that field existed counts its artwork as unknown (0 bytes) until it is re-saved.

Starting backup limits: 250 MB archive bytes, 300 MB cumulative expanded entry bytes, 5,000 entries, no nested archives, plus per-image decoding limits. Enforce limits during streaming extraction rather than after full decompression. Compressed image size is not decoded pixel memory; process images sequentially and bound retained canvases. Reconcile these limits with actual font/media overhead in P06/P45 before exposing them as supported capacity.

## Publication and template workflow

Draft edits never mutate a published immutable version. Publish creates a validated version and atomically points the item to it. Archive removes it from browsing. Students inserting an asset first download and save the bytes/provenance locally, then commit the element; a failed download does not create an apparently complete image layer.

Build presentation templates in the same presentation editor. An admin action copies a local presentation into a server draft, including its media; it never publishes a live pointer into personal work. The admin adds use-case metadata, chooses a cover and renders per-slide previews from that exact snapshot. Validate the uploaded schema/media on the server; keep client-generated previews bound to the snapshot revision/hash and require admin review. Re-edit by loading a draft into the shared editor and saving a new draft revision.

Published templates pin their own immutable media dependencies. Archiving a catalog asset alone must not silently break a published template using it: preserve the pinned dependency for the template, or require explicit template replacement/archive before withdrawing that dependency. An asset rights takedown needs an explicit affected-template action; it cannot retroactively erase student backups. Ordinary catalog archiving and source-file deletion are different operations.

Cloning downloads all template dependencies and commits a new local presentation atomically with new IDs. Edits do not affect the source, another clone, or personal stickers. Theme/font/color changes affect a document copy; no remotely linked master slides in v1.

## UI design reference

![Admin dashboard concept](design/admin-dashboard-concept.png)

Generated with the built-in imagegen tool; [exact prompt](design/admin-dashboard-prompt.txt). Sample content only. The concept shows the asset library, selected-asset inspector, template entry points and bulk queue. It is not a production catalog or proof of asset rights.

Implement the owning screens with real shared components:

- `/presentations`: local presentation cards, blank/template creation, restore backup, rename/duplicate/delete.
- `/presentations/:id`: top title/save/history/export, left slide rail, central fixed slide, tools/catalog panel, right properties. Keep a keyboard-accessible layer list and slide reorder controls.
- `/presentation-templates`: three initial template families, preview all slides, clone. Clear offline/unavailable states.
- `/admin/assets`, `/admin/collections`, `/admin/uploads`: paged search, real counts, metadata, drafts, bulk upload and retry.
- `/admin/templates`: use-case/status filters; deck covers; new-from-presentation, edit draft, slide preview/reorder through shared editor, validation, publish, archive.
- `/admin/templates/:id`: title/use case/tags, version status, all slide previews, missing asset/font checks and safe publication actions.

At 1440×900 use the desktop editor; at 1024×768 collapse tools/properties into shared sheets while preserving save/export. Student phone routes explain desktop editing and locally saved work accurately. Admin tablet layouts may use stacked inspector/queue; phone access must retain readable status/sign-out and clearly state desktop-only authoring where applicable.

Generated-reference corrections: format badges show actual available formats, not all formats on every item. “Internal use” provenance cannot imply permission to distribute. Replace generic “ready” copy with real validation checks. A static image cannot prove focus, keyboard access or responsive behavior.

## Release evidence and remaining setup

No PDF/PPTX generation, admin authorization, processing deployment, or presentation persistence was executed in this planning session. The export proof must generate actual files, inspect PPTX package contents, and open/render representative outputs. Record application/version/OS for each verification. Test in desktop PowerPoint when available and an independent available reader such as LibreOffice; browser PowerPoint may be added. Do not claim all supporting apps render identically. If desktop PowerPoint is unavailable, record that gap and keep compatibility provisional.

Supabase and Vercel are already in the repo, but current production credentials, SMTP, quotas and live permissions were not revalidated. Implementation needs additive migrations, admin bootstrap, private buckets, Node-only credentials and a preview deployment check. Do not purchase or publish as part of implementing this document without applicable authorization.
