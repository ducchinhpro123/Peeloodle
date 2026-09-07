# StickerLab — implementation prompt for coding agents

You are the lead engineer implementing StickerLab, a responsive web application for turning photos into editable stickers and organizing them into packs. Build the working product from the supplied UI references. Carry implementation through integration and verification; do not stop at a plan or static mockup.

## 1. Inputs and source of truth

Read repository instructions and inspect existing code before changing anything. Preserve useful existing work and the current package manager. For a new repository, use the stack below. If an existing architecture conflicts with it, explain the practical difference before proposing a migration.

Inspect these four supplied design images yourself:

| Reference | Page | Visual requirements |
| --- | --- | --- |
| image-gen-1.png | Dashboard | StickerLab logo; top navigation and search; left sidebar; large mint hero with photo-cutout collage; four pastel tool cards; recent projects; trending templates; bottom promotional banner. |
| image-gen-2.png | Create Editor | Left tool navigation; central checkerboard canvas; title and save status; zoom controls; right properties inspector; bottom asset tray; Save and Export actions. |
| image-gen-3.png | Templates | Mint-to-lavender banner with dog/cat cutouts; category pills; filter row; trending pack cards; category grid; additional templates. |
| image-gen-4.png | My Sticker Packs | Mint banner; New Pack, Import Photos, and Share Pack actions; collection tabs and search; pack cards; favorites and shared collections; selected-pack detail panel on the right. |

The shared conversation is https://chatgpt.com/share/6a9dfc42-6830-83ec-9b9f-758ceb844b45. The app inspiration is https://play.google.com/store/apps/details?id=com.sticker.maker.emojifun.wastickers. The four images are the visual source of truth, not an assumed feature list from the mobile application. If a link is inaccessible, use the attached images. If images are missing, continue foundational work but explicitly report that visual fidelity is unverified.

Preserve the StickerLab identity, mint/emerald primary actions, near-white surfaces, dark navy text, rounded cards, pastel accents, playful mascot, and photo stickers with white cutout borders. Implement layouts using real components, text, and controls. Do not use a screenshot as the whole webpage. Extract reusable design tokens; approximate colors from references and document them as estimates. Use a consistent sans-serif UI font and reserve handwritten styling for decorative artwork.

Screenshot labels such as Alex Parker, historical dates, counts, download totals, Published, and Pro are illustrative. Derive real user data and counts from application state. Correct generated-image text artifacts. Do not invent successful uploads, real customers, subscriptions, or platform integrations.

## 2. Stack and architecture

- React, TypeScript in strict mode, and Vite.
- React Router for navigation and direct-link support.
- shadcn/ui + Tailwind CSS for the interface: dialogs, tabs, sliders, dropdowns, tooltips, and sheets/sidebars for side panels. Customize these components to match the supplied mint-green designs, using shared CSS variables for colors, spacing, typography, radii, and shadows.
- Konva/react-konva for the canvas scene and transformations.
- Zustand for editor state and explicit undo/redo commands.
- IndexedDB for local project documents and image blobs; use a small maintained wrapper if useful.
- Supabase Auth, PostgreSQL, and Storage for the cloud phase.
- Vitest for document/history/export logic and Playwright for essential user journeys and visual checks.

Check official documentation for current supported APIs and compatible stable package versions. Commit the lockfile. Keep business state independent of Konva nodes. Avoid adding a separate API server unless an implemented requirement needs it. Keep paid AI calls and privileged secrets off the browser.

Suggested module boundaries: app routing and shell; shared UI/design tokens; editor document/commands/rendering; assets; templates; packs; persistence; auth; exports; sharing. Prefer feature modules over a large generic components folder.

## 3. Scope and delivery order

Deliver a usable local application first, then cloud features. The core milestone must support the complete path: open Dashboard → create sticker → upload image → edit → save → reopen from My Stickers → export a transparent image or pack ZIP.

Core scope: four reference pages, photo upload, crop/rotate/flip, text, curated emoji/decorations, layer management, manual erase/restore, outline/shadow, basic filters, undo/redo, local autosave, template customization, packs, favorites, and PNG export.

Cloud scope: sign-in, private project/asset storage, saving across devices, read-only shared packs, and real export history. Automatic background removal is a separately integrated enhancement with a real processing path, never a simulated success.

Defer billing, subscription enforcement, community publishing/moderation, real-time collaboration, animated stickers, AI image generation, and native WhatsApp/Telegram pack installation. Show these only as clearly explained unavailable features when needed to preserve reference navigation. Do not add payment forms or active-looking dead buttons.

## 4. Routes and page behavior

### Dashboard — /

Match reference 1. Top navigation: Home, Create, Templates, My Stickers, Explore. Sidebar follows the screenshot, with active states. Explore can reuse the curated template catalog. Global search searches real available templates and packs; support Ctrl/Cmd+K if shown. Hide the notification bell until notifications exist or give it an honest empty state.

Create a Sticker starts a new editable document. Tool cards open the editor with the relevant tool selected. Recent Projects come from saved documents. Template cards open previews. Watch How It Works opens an accessible short walkthrough, not a nonexistent video. Guest identity replaces the screenshot's sample profile when signed out.

### Editor — /create and /editor/:projectId

Match reference 2. Use a three-column desktop layout with a bottom asset tray. Keep logical document coordinates independent of viewport zoom. Start with a 1024×1024 logical artboard; fit it within the rectangular canvas viewport without stretching the document. The checkerboard indicates transparency and must never be baked into exports.

Tools and required behavior:

- Upload: select or drop PNG, JPEG, and static WebP; validate decoded content, not only extensions. Initial limits: 15 MB and 25 megapixels per image. Explain rejected files. Normalize orientation and create an editor-resolution derivative while retaining a source where feasible.
- Crop & Rotate: rectangular non-destructive crop, 90-degree rotation, horizontal/vertical flip, and reset. Store crop data relative to the source image.
- Brush / Restore: edit an alpha mask in image-local coordinates. Erase and restore must work after zoom, rotation, and resize. Keep the original source immutable.
- Outline & Border: adjustable color and width following the actual alpha silhouette, not the image's rectangular bounding box. Pad rendering to avoid clipping the border.
- Shadow: color, opacity, blur, and offset with sensible bounds.
- Text: add and edit text, choose supplied fonts, size, color, alignment, and basic outline. Edit through an accessible DOM control. Wait for fonts before export.
- Emoji & Stickers: curated reusable graphics, shapes, and decorations. Use licensed vector/image assets for consistent rendering; record asset provenance.
- Filters & Effects: brightness, contrast, saturation, and grayscale with reset, shared by preview and export.
- Layers: select, rename, reorder, hide/show, lock/unlock, duplicate, and delete. Locked layers cannot be manipulated on canvas. Provide accessible reorder controls.
- Canvas interactions: select, drag, resize, rotate, zoom, and pan. Support touch input. Show selection handles only on selected objects; do not copy the screenshot's multiple independent selections unless multiselect is implemented.
- Undo/Redo: cover edits, masks, insertion, deletion, ordering, and properties. One drag or continuous slider interaction creates one history entry. Selection and viewport changes are not document edits. Bound history memory.

Keyboard shortcuts: undo/redo, duplicate, delete, arrow-key nudge, and Escape. Do not intercept editing shortcuts inside text inputs. Autosave document changes after a short debounce and on completed gestures. Show Saving, Saved locally, Saved to cloud, or Save failed accurately. Never discard local work after a cloud failure.

Bottom tray tabs: Recent Uploads, Stickers, Emojis, Shapes, Text Styles, Decorations. Each tab displays relevant usable content. Right inspector changes with selected layer type; image-only settings must not appear as functional for text.

### Templates — /templates

Match reference 3. Seed at least 12 usable templates across several pictured categories. These must contain editable document data, not only flattened previews. Categories, search, sorting, and implemented filters change actual results. Use only filter options backed by metadata. Counts reflect the dataset; do not copy the screenshot's 1,240 templates or download totals.

Preview opens an accessible dialog with a larger image, category, asset information, and Use Template. Using a template clones it into a new project with independent IDs. Editing that project must not mutate the original. Favorites persist. Include no-results and reset-filters states. All seed content can be free; explain Pro as a future feature rather than pretending to charge.

### My Sticker Packs — /my-stickers

Match reference 4. Create, rename, duplicate, and delete packs; edit description/cover; add existing stickers; import photos; reorder pack contents. Deleting a pack removes membership by default, not the underlying projects. Confirm destructive actions. A duplicated pack gets an independent membership list; document whether editing a shared project affects multiple packs and offer Duplicate Sticker for independent edits.

Selecting a pack opens its right-hand detail panel; use a sheet or full page on small screens. Search and Recent/Name sorting operate on actual data. Implement All Packs, My Packs, Favorites, Shared with Me, and Export History as relevant views. Shared with Me has a truthful empty/setup state before cloud sharing is available. Replace Published with Local/Private/Shared statuses matching implemented behavior.

## 5. Document model and persistence contracts

Define shared types before parallel work begins:

- ProjectDocument: schemaVersion, id, title, artboard dimensions/background, ordered layer array, asset references, createdAt, updatedAt, revision.
- Layer discriminated union: image, text, shape; common id/name/transform/opacity/visibility/lock fields. Image layers hold source asset ID, crop, mask reference, outline/shadow/filter settings. Text layers hold content/font/style. Shapes hold typed geometry and style.
- Asset: id, MIME type, pixel dimensions, local blob key, optional cloud object path, and provenance. Do not store expiring signed URLs as permanent identifiers.
- Pack: id, owner if authenticated, title, description, cover reference, visibility, timestamps.
- PackItem: pack ID, project ID, position. Enforce one membership per project per pack unless duplicate entries are explicitly supported.
- Template: id, title, tags/category, preview asset, versioned document.
- Favorite and ExportRecord: user/local scope, target reference, timestamps, and export options/status as appropriate.

Persist serializable data and blobs separately. Never serialize HTMLImageElement, Konva nodes, runtime functions, or transient object URLs. Rehydrate assets and fonts before rendering/exporting. Version the schema and handle invalid/unsupported documents with a recoverable error. Save project and asset references consistently so a refresh does not produce a broken project.

Define repository interfaces for get/list/save/delete projects, packs, and assets. Implement the local adapter first; add cloud behavior without rewriting editor components. Supabase tables should cover projects (document JSONB plus revision), assets, packs, pack_items, favorites, export_records, and pack shares. Store binaries in Storage, not base64 database columns.

Cloud requirements: owner-based Row Level Security and private storage policies; never ship service-role credentials to the frontend. Verify cross-user isolation. Upload assets before committing document references. Use expected revision checks to detect concurrent edits; preserve a conflict copy rather than silently overwriting newer work. Guest-to-account migration must be explicit, idempotent, and retain the local copy until cloud success. Keep user identity out of illustrative seed content.

## 6. Export and sharing

Export current sticker as transparent PNG at selectable 512×512 and 1024×1024 sizes. Keep the full composition and correct aspect ratio. Selection handles, checkerboard, grid, guides, and viewport transforms must not affect the output. Wait for image/font/mask operations to complete. Reuse the same compositing logic for previews and exports.

Download a pack ZIP containing ordered, safely named PNG files and a simple manifest. A generic ZIP is not a native WhatsApp pack. Record export success only after successful file generation/download initiation; do not claim the user saved the file on disk.

WebP is optional after capability and output validation. For WhatsApp and Telegram buttons pictured in the references, open an export-options/help dialog explaining supported downloads and manual steps. Verify current official platform requirements before promising native import. Never show an Add to WhatsApp success toast without a real supported integration. Relevant source: https://github.com/WhatsApp/stickers.

Cloud sharing should create a read-only snapshot of a pack with an unguessable, revocable link. Do not expose original source photos, editable private project documents, or whole storage buckets. A narrow server/edge endpoint can validate a hashed token and return only permitted snapshot exports with short-lived URLs. Add limits and handle revocation. Link recipients may preview/download and explicitly save a shared pack reference; live collaboration is excluded.

## 7. Background-removal enhancement

Manual erase/restore is required for the core milestone. For automatic removal, investigate a maintained browser model or server provider and document license, model download size, mobile memory behavior, costs, and privacy implications before selecting one. Keep this behind a provider interface so the editor is independent of the implementation. Preserve original image and resulting mask for restoration.

Provide real progress, cancellation, retry, and failure states. Keep the UI responsive using a worker where supported. Never pretend removal happened by swapping in a sample cutout. If no suitable service/model can be configured, finish manual removal and clearly mark automatic removal as unavailable with a useful explanation.

## 8. Responsive design, accessibility, and assets

Use the supplied 16:9 desktop images as composition references, not fixed-size containers. Validate around 1440×900, 1024×768, and 390×844. Desktop keeps sidebar and inspector; tablet collapses secondary panels; mobile uses a compact header, tool drawer, and properties sheet. Keep save/export reachable and horizontal scrolling contained to asset trays. Do not shrink the whole desktop page to fit mobile.

Use semantic buttons/inputs, accessible names for icon controls, visible focus, dialog focus management, sufficient contrast, and touch targets around 44 px. Provide DOM controls for core canvas operations so important editing functions are keyboard-accessible. Respect reduced motion.

Reference photos and decorative art strongly affect fidelity. Use supplied reusable assets or licensed replacements with similar silhouettes and proportions. Do not hotlink arbitrary images or silently reuse stock previews as user content. Keep imported raster data controlled to avoid tainted-canvas export failures. Reject unsupported animated and SVG uploads in the first version with an explanation.

## 9. Agent work packages and dependencies

If multiple coding agents are available, the lead may delegate these bounded packages after agreeing on shared types and design tokens. If only one agent is available, follow the same order sequentially.

| Owner | Responsibility | Boundary / dependency |
| --- | --- | --- |
| Lead / Integrator | Repo audit, contracts, routing, task coordination, integration, final verification | Own shared types, package files, route registration; resolve cross-module changes. |
| UI Agent | Shell, design tokens, Dashboard, responsive layouts, template/pack presentation | Use agreed repositories; do not build a second editor state system. |
| Editor Agent | Document commands, Konva rendering, inspector, masking, history, interaction | Own editor feature; coordinate export rendering contracts. |
| Data Agent | IndexedDB, Supabase schema/migrations/policies, repositories, migration/conflicts | Own persistence/auth; UI consumes interfaces. |
| Export / QA Agent | PNG/ZIP, shared read-only view, integration tests and visual regression findings | Begin against agreed fixtures; integrate real renderer before declaring export complete. |

Avoid concurrent edits to shared files. Agree on contracts before dependent implementation; temporary adapters must be replaced before final acceptance. Each handoff states changed files, exported interfaces, checks run, and known limitations. The lead owns working end-to-end behavior, not just combining individually completed tasks.

## 10. Milestones and acceptance gates

1. Foundation: inspect all references, document UI mapping and scope, define types, scaffold routes and tokens. Gate: all four pages reachable with coherent navigation and responsive shells.
2. First working slice: upload → move/resize → text → save locally → reopen → PNG. Gate: a fresh browser session restores composition and exports the same artwork on a transparent background.
3. Complete local product: masks, outlines, filters, layers/history, template cloning, packs/favorites, ZIP. Gate: pictured core actions are functional; state persists and malformed inputs fail cleanly.
4. Cloud: auth, private storage, migration, conflicts, read-only share snapshots. Gate: two-user isolation verified, cloud failures preserve local data, revoked links stop new access.
5. Visual and release pass: compare each route with its exact reference at matched viewport size, resolve layout/asset discrepancies, check mobile/touch, document setup and remaining optional integrations.

Meaningful checks must cover: history after a multi-step edit; no history entry per drag frame; crop/mask behavior under transformed images; alpha outline and transparent export; export without selection controls; asset/font reload; template independence; pack ordering in ZIP; save failure recovery; cloud authorization and conflicts when configured. Use end-to-end tests for the main create/save/reopen/export journey and template-to-pack journey. Inspect the exported file, not only a clicked Download button.

Run typecheck, lint, relevant tests, and production build. Inspect the app in a browser and record actual viewport/device conditions for performance observations. With roughly 30 layers and a normalized photo, dragging and brush work should feel responsive without blocking the UI; investigate observable stalls rather than claiming unmeasured frame rates.

## 11. Final deliverables and operating rules

Deliver source, lockfile, sample licensed assets/templates, schema migrations/policies, .env.example without secrets, setup README, focused tests, and an implementation-status checklist. Document local-only operation when Supabase is unconfigured. Do not call cloud functionality verified without running it against a configured environment.

Start by stating the understood four-page design and the first implementation milestone, then implement. Make routine reversible decisions autonomously and record assumptions. Ask only about a concrete blocker that cannot be resolved from the repository or references; continue independent work while blocked. Never overwrite unrelated changes. Do not purchase services, publish publicly, or send invitations without applicable authorization.

At completion, report what works, how it was verified, exact setup commands, and remaining gaps. Do not call the project finished while primary actions are inert or use fake success states.
