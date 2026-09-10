# Slides planning interview

Status: interview complete; the owner confirmed the shared scope on 2026-09-10. The deliverables are the [implementation plan](slides-implementation-plan.md) and [architecture](slides-architecture.md). This file retains the agreed product direction and design reference; it is not a feature completion checklist.

## Confirmed direction

- Add a section for creating presentations, with PDF and editable PPTX output.
- First audience: university students.
- The site is a personal project developed over the past few days and has no users yet. Demand for presentations is an unvalidated hypothesis.
- One developer will implement the work incrementally. The final plan must contain small, independently verifiable steps with explicit dependencies.
- This session produces planning documents; feature implementation happens later.
- Intended use cases include class presentations, research defenses, and club pitches.
- Proposed attraction: a ready-to-use collection of stickers and icons. The eligible asset inventory remains unresolved.
- PPTX must preserve editable text, independently movable images, and editable basic shapes. Decorative stickers can remain individual images.
- Start with solo editing, local save/reopen, and exported PPTX handoff. Account-based cross-device access comes later; simultaneous editing is deferred.
- Laptop/desktop editing first; full touch editing is a separate milestone.
- Initial template catalog: three complete presentation templates (class presentation, research defense, club pitch), each with 8–10 useful slide layouts.
- Bundled catalog assets are free to insert and export for now. The larger collection has not been added; the plan must explicitly design how collections are added later.
- Creation starts from a template or a blank presentation. PPTX/PDF import and AI generation are deferred.
- Initial content tools: wrapped text, bullets, alignment, mixed bold/italic, links, images, stickers, and basic shapes. Charts and equations can initially be supplied as images. Target English and Vietnamese writing. Native academic content tools remain later work.
- Downloads are sufficient initially; browser presentation mode is deferred.
- Clarification superseding the earlier mobile promise: students transfer exported PDF/PPTX files to phones themselves. Access to laptop-saved presentations inside the mobile website follows cross-device storage.
- An admin dashboard is required for adding asset collections; the developer-only ingestion proposal was rejected.
- Free placement with alignment guides and optional locking; initially one presentation size, 16:9 widescreen.
- Use a small tested font set and document PPTX font requirements. No missing content or overflow in the supported test environment; PDF is the fixed-visual output. Aim for standard PPTX compatibility and record actual tested applications during implementation; no specific PowerPoint installation is assumed available.
- Provide a portable editable presentation backup containing its document and images, with restoration into the website. This does not imply arbitrary PPTX/PDF import.
- One administrator manages both assets and presentation templates, with draft/published/archived states. Inserted assets remain saved copies so catalog changes preserve existing presentations.
- Initial collection scale: hundreds of assets; bulk uploads of PNG, WebP, and SVG are required.
- User requested a generated admin dashboard UI concept included in the plan; see below.
- SVG artwork behaves as one movable/resizable/rotatable image initially; preserve originals and generate validated display/export derivatives.
- Administrators author templates in the shared presentation editor, then manage metadata, previews and publication through the admin dashboard.
- Personal stickers can be inserted as independent snapshots; later source edits do not change the presentation.
- Test the first complete release with three university students creating, reopening and exporting real presentations before expanding scope.

## Admin dashboard design reference

![StickerLab admin dashboard concept with assets, template previews, publication controls, and bulk upload results](design/admin-dashboard-concept.png)

Generated with the built-in imagegen tool on 2026-09-10. Exact prompt: [admin-dashboard-prompt.txt](design/admin-dashboard-prompt.txt). This is a visual concept with sample content, not implemented UI, a real catalog, or evidence that artwork has publication permission.

The concept shows the asset library, collection navigation, presentation template navigation, search/filtering, publication states, a selected-asset inspector, and per-file upload results with retries. The implementation plan must cover the dedicated template-management screen as well as this asset screen. Reuse the existing UI primitives and tokens when implementing.

Inspection notes: the generated cards show all three format badges on every asset; actual UI must show only formats actually available. The generated provenance field says “internal use” while the panel says ready to publish; actual publication must require permission for distribution in exported presentations. Replace generic readiness copy with concrete validation results. No generated claim is authoritative metadata.

## Agreed backend direction

Extend the existing Supabase backend with PostgreSQL catalog metadata, Storage for artwork, Auth for administrators, and database/storage authorization. Build the admin interface with the existing React/TypeScript UI stack. Keep student presentation saving local in the first release; an online catalog does not require cloud storage for student documents.

Use privileged server operations only where the catalog workflow requires them. The architecture now specifies a small Node processing endpoint for trusted media validation/derivatives, with a deployment proof before implementing ingestion. Admin membership must be controlled on the backend, not by a hidden route or user-editable profile field.

Official references: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [database RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Existing implementation constraints

Repository inspection found a sticker-specific document with one square transparent artboard. Document validation enforces those assumptions; current user PNG exports trim visible artwork, while fixed-artboard probes still exist. Presentation creation requires a new document/workflow with fixed rectangular export pages, rather than only additional download formats.

Existing UI primitives, asset handling, rendering utilities, undo gesture conventions, and repository patterns may be reusable. Text currently lacks the paragraph and layout behavior needed for typical presentations. Cloud sync currently models sticker projects and packs.

## Implementation evidence still required

The interview is complete. Export/text feasibility, actual tested readers, processor deployment and measured size limits remain implementation proof tasks, not unanswered product questions. The larger artwork collection has not yet been supplied. Proposed library adapters and engineering defaults are documented in the architecture and must pass the early proof gates.

Architectural decisions: [separate presentation documents](adr/0001-separate-presentation-documents.md), [local presentations and hosted catalog](adr/0002-local-presentations-hosted-catalog.md), [independent artwork copies](adr/0003-snapshot-catalog-insertions.md).
