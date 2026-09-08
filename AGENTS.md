# StickerLab — Agent Instructions

## Project goal

Build StickerLab: a responsive website for creating editable photo stickers, customizing templates, organizing sticker packs, and exporting images.

Deliver working user flows with a cohesive, original visual identity inspired by the supplied UI references. The primary flow is:

**Dashboard → create sticker → upload → edit → save → reopen → export.**

## Instruction scope and source of truth

This file applies to the repository and its subdirectories. Follow more specific nested `AGENTS.md` instructions where present. Explicit user instructions take precedence over this file.

Before changing code:

1. Inspect the repository, package manifest, lockfile, existing implementation, and applicable instructions.
2. Read `StickerLab-Agent-Brief.md` if present for detailed requirements and acceptance criteria.
3. For UI work, inspect the supplied images in `design/` (linked in `README.md`) and read `docs/ui-audit.md` for the current visual direction and known limitations.
4. Identify the smallest complete implementation milestone and its verification needs.

| Reference | Page |
| --- | --- |
| `image-gen-1.png` | Dashboard |
| `image-gen-2.png` | Create Editor |
| `image-gen-3.png` | Templates |
| `image-gen-4.png` | My Sticker Packs |

The images guide composition and visual character; the brief defines functional requirements. The current design direction below takes precedence over pixel-matching language in the brief. Preserve existing working code and user changes. If references are unavailable, continue independent work and report that visual fidelity is unverified. Do not invent details from unseen images.

## Technical conventions

For a new project, use:

- React, TypeScript with strict checking, and Vite.
- React Router for page navigation.
- shadcn/ui + Tailwind CSS for the interface, with shared CSS custom properties for design tokens. Use shadcn/ui dialogs, tabs, sliders, dropdowns, tooltips, and sheets/sidebars for side panels; customize them to match the supplied mint-green designs.
- Konva/react-konva for canvas interaction and rendering.
- Zustand for editor state and explicit edit commands.
- IndexedDB for local documents and image blobs.
- Supabase Auth, PostgreSQL, and Storage for cloud functionality.
- Vitest for meaningful logic tests and Playwright for critical browser journeys.

Preserve the existing package manager and compatible architecture. Do not migrate frameworks or add a separate backend without a concrete requirement. Verify current APIs against official documentation when needed. Keep dependency changes small and commit the lockfile with package changes.

Use the repository's actual scripts for development, type checking, linting, tests, and builds. If missing, add appropriate scripts and document them in the README. Never claim a command exists or passed without checking.

Suggested feature boundaries:

```text
src/
  app/                  # Routes, providers, application shell
  components/ui/        # Shared accessible UI primitives
  features/
    editor/             # Document commands, canvas, tools, inspector
    assets/             # Uploads, asset catalog, asset loading
    templates/          # Catalog, previews, template cloning
    packs/              # Collections, favorites, pack management
    exports/            # Image rendering and pack ZIP generation
    auth/               # Authentication and session UI
    sharing/            # Read-only shared packs
  lib/persistence/      # Repository interfaces and storage adapters
  styles/               # Tokens, resets, global styles
  types/                # Shared serializable domain contracts
```

Adapt these boundaries to an existing repository rather than moving files solely to match this tree.

## Design requirements

Preserve the StickerLab identity: mint/emerald primary actions, near-white surfaces, dark navy text, rounded cards, pastel accents, and playful outlined sticker artwork.

- Aim for **lively, vivid, and engaging**: original sticker collages, expressive accents, and clear typography. Use the references for inspiration rather than reproducing another app exactly. Keep the editor and forms calmer than promotional areas; decoration must not obscure content or controls.
- Build real components; never render a full-page screenshot as the application.
- Keep design tokens centralized. Avoid scattered copies of colors and spacing values.
- Desktop editor: left tools, central canvas, right inspector, bottom asset tray.
- Mobile editor: accessible tool drawer and properties sheet; keep save/export reachable.
- Validate desktop, tablet, and mobile layouts. Do not scale down the entire desktop interface to fit a phone.
- Use semantic controls, visible focus, accessible names, dialog focus handling, and keyboard alternatives for core canvas operations.
- Use supplied or appropriately licensed assets and record their provenance. Avoid arbitrary remote image hotlinks.

Names, dates, statistics, and subscription labels in screenshots are illustrative. Display real state or clearly identified sample content. Do not imply that sample projects belong to the signed-in user.

### Component reuse and cross-page consistency

Before adding or changing UI, inspect `src/components/ui/`, `src/styles.css`, and existing usages of the same pattern.

- **Reuse first.** Use existing shared buttons, cards, dialogs, sheets, tabs, and sliders instead of creating page-local lookalikes. Compose existing primitives for new patterns. Extract repeated UI when a second real use appears; keep genuinely one-off layouts local.
- **Fix the shared source.** When a visual or interaction defect affects a shared component, correct it there and inspect its callers. Add a small, explicit variant only for a real semantic difference—not to give each page its own padding or button style.
- **Use design tokens.** Spacing, colors, radii, and shadows come from `src/styles.css`. Extend the shared tokens when necessary. Keep one-off geometry for artwork/canvas positioning separate from interface spacing.
- **Keep CSS maintainable.** Edit the owning rule rather than appending competing overrides. Use scoped component classes or existing `data-slot` attributes; reserve inline styles for runtime values, not repeated static layout. Keep selectors specific to the intended element (for example, active tab triggers, not every active Radix node).
- **One dialog system.** Use the shared `DialogContent`, `DialogTitle`, `DialogDescription`, and `DialogFooter` for modals, including destructive confirmations. Preserve action order, readable fields, viewport-bounded scrolling, and reachable close controls. Initially focus the safe action for destructive dialogs; restore focus to the opener or a surviving control after deletion. Keep canvas shortcuts inactive inside dialogs.
- **Preserve actions across breakpoints.** Reflow controls or place them in accessible drawers/dialogs rather than hiding essential actions. Keep touch targets usable, long names wrapping, and intentional horizontal scrolling confined to rails/trays.
- **Reuse artwork responsibly.** Prefer existing local assets and `src/components/StickerCollage.tsx` for decorative collages. Preserve source art, optimize served derivatives, and record provenance. Mark decoration as decorative; never substitute it for real project or template previews. Original styling is not proof of artwork rights.
- **Verify every affected use.** For shared UI changes, inspect each affected route and dialog at the viewports in Verification, including empty/populated states, long content, keyboard focus, and reduced motion where relevant. Extend `e2e/ui-polish.spec.ts` for new regressions; report any unverified cases.

## Editor invariants

The serializable project document is the source of truth. Konva nodes are a rendering layer, not the persistence model.

- Keep document coordinates independent of viewport zoom and pan.
- Use a versioned document schema and stable IDs for projects, layers, and assets.
- Store image blobs separately from document JSON.
- Never persist Konva nodes, DOM objects, functions, or temporary object URLs.
- Keep original images immutable; represent crop and erasure through non-destructive crop data and masks.
- Store masks in image-local coordinates so erase/restore works after scaling, rotation, and zoom.
- Make outlines follow the alpha silhouette rather than the image bounding rectangle.
- Reuse compositing logic for editor previews and exports.
- Route document mutations through explicit commands/actions.
- One completed drag, brush stroke, or continuous slider gesture produces one undo entry.
- Selection, pan, and zoom are view state and do not mark the document dirty.
- Bound history memory and release unused object URLs/rendering resources.
- Do not intercept typing shortcuts inside text fields.

Validate uploads by supported format, decoded dimensions, and size. Initial limits are 15 MB and 25 megapixels per image. Handle decode failures and unsupported formats clearly. Start with PNG, JPEG, and static WebP; do not silently accept animated or SVG uploads.

## Persistence and data integrity

Implement local operation first. Core editing, saving, reopening, and PNG export must work without cloud credentials.

- Put storage access behind typed repository interfaces.
- Autosave after a short debounce and completed gestures.
- Show accurate states: saving, saved locally, saved to cloud, and save failed.
- Preserve local work when a cloud request fails.
- Rehydrate assets and fonts before rendering or exporting.
- Handle invalid or unsupported document versions with a recoverable error.
- Clone templates into independent editable projects.
- Keep pack membership separate from project ownership. Deleting a pack must not implicitly delete its stickers.
- Make guest-to-account migration idempotent and retain local data until cloud persistence succeeds.
- Detect cloud revision conflicts; preserve a conflict copy instead of silently overwriting newer work.

Supabase requires owner-based Row Level Security and private storage policies. Verify cross-user isolation when cloud functionality is implemented. Never place service-role keys or paid-provider secrets in frontend code, browser environment variables, logs, or committed files. Provide only placeholder values in `.env.example`.

## Export and integration boundaries

Core exports are transparent PNG at 512×512 and 1024×1024, plus pack ZIPs containing ordered images and a manifest.

- Preserve composition and aspect ratio.
- Exclude the checkerboard, selection handles, guides, and viewport transforms.
- Wait for assets, fonts, and mask processing before export.
- Avoid clipping outlines and shadows accidentally.
- Inspect generated files during verification; clicking Download alone does not prove correctness.
- Report file generation/download initiation accurately, without claiming the file was saved on the user's device.

A ZIP is not a native WhatsApp sticker pack. WhatsApp/Telegram controls must explain supported downloads until a real platform integration is implemented and verified. Never display simulated integration success.

Manual erase/restore belongs to the core editor. Automatic background removal requires a real provider/model, licensing and resource review, progress, cancellation, and failure handling. Never substitute a sample cutout to imitate processing.

Cloud sharing, if implemented, exposes only explicitly shared read-only outputs through revocable access. Do not expose original uploads, editable private documents, or whole storage buckets.

## Scope and execution order

Work in complete increments:

1. Shared design tokens, application shell, and four page routes.
2. Upload, transforms, text, local save/reopen, and transparent PNG export.
3. Masks, outlines, filters, layers, history, templates, packs, favorites, and ZIP export.
4. Cloud authentication, private persistence, migration/conflicts, and read-only sharing.
5. Visual comparison, responsive corrections, accessibility, and release documentation.

Follow the user's requested milestone when narrower. Billing, community publishing, real-time collaboration, animated stickers, and native messenger installation are deferred unless explicitly requested. Unavailable features need an honest explanation, not active-looking dead controls.

## Verification

Choose checks that address the changed behavior. Do not add tests that only repeat implementation details or run unrelated suites without a concrete reason.

For editor/persistence/export changes, verify relevant invariants:

- Upload → edit → save → reload → reopen preserves the composition.
- Undo/redo correctly restores multi-step edits and gesture boundaries.
- Masks/crops work under transformed images.
- Exports preserve transparency and exclude editing controls.
- Fonts and image assets survive document reload.
- Template edits do not change the original template.
- Pack ordering matches ZIP contents.
- Save failures preserve local work.
- Cloud authorization and conflict behavior work when configured.

For UI changes, inspect affected routes against their corresponding references at matched desktop dimensions and a mobile viewport. Suggested checks: 1440×900, 1024×768, and 390×844. Check touch interactions and keyboard access where relevant.

Before completing a milestone, run applicable type checks, lint, focused tests, and a production build. Report exact checks run and any failures or unavailable dependencies. Do not claim cloud or browser verification that did not occur.

## Collaboration and change discipline

Make routine reversible decisions autonomously and document material assumptions. Ask only when a concrete unresolved issue would substantially change scope or cause irreversible consequences. Continue independent work while blocked.

When multiple agents are explicitly requested, the lead defines shared types and module ownership before parallel edits. Delegate bounded work, avoid concurrent changes to shared files, and integrate each handoff. Each handoff states changed files, interfaces, checks, and remaining gaps. Do not introduce multiple competing document or persistence models.

Do not overwrite unrelated changes, rewrite Git history, perform destructive cleanup, purchase services, publish publicly, or send invitations without applicable authorization. Follow any repository-specific hosting workflow.

At handoff, summarize:

- What changed and which user flow now works.
- How it was verified.
- Any required setup or migrations.
- Remaining limitations or blocked integrations.

Keep the README and implementation checklist consistent with actual behavior. A milestone is complete only when its primary actions work and its relevant acceptance checks pass.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues. Before tracker operations, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging, read `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` and `docs/adr/`. Before exploring, read `docs/agents/domain.md`.
