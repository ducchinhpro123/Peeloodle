# Replace the global layout stylesheet with Tailwind and component-owned CSS

Status: implementation handoff; application code has not been changed.
Date: 2026-09-15.
Scope: the SvelteKit workspace (then `/home/vdc/Projects/Peeloodle-Svelte`, now this repository
root), inspected for this plan.

## 1. Decision and intended result

Remove `src/routes/layout.css` after an incremental migration. Use Tailwind utilities directly in Svelte markup for ordinary layout, spacing, typography, colors, borders, and interaction states. Keep a small global entrypoint for Tailwind, fonts, design tokens, and document defaults. Keep exceptional CSS beside the component that owns it.

This is a visual and behavioral preservation refactor. Preserve the scrapbook appearance, artwork, responsive layouts, keyboard behavior, editor geometry, and existing application workflows. Do not redesign screens, upgrade dependencies, rewrite state management, or change persistence/export logic.

Splitting the current file into globally imported `header.css`, `editor.css`, and similar files would make navigation easier but preserve its cross-component cascade. It is acceptable only as a temporary migration aid, not the final result. Forcing every decorative pseudo-element and canvas integration rule into utilities would make those parts harder to maintain. The selected approach removes the monolith while retaining explicit, small exceptions.

## 2. Verified starting point

- `src/routes/layout.css` contains 5,973 lines. It combines seven font declarations, tokens, document defaults, shell styles, three hero variants, libraries, two editors, dialogs, and responsive overrides.
- Tailwind is already configured: `package.json` declares `tailwindcss` and `@tailwindcss/vite` at `^4.3.0`; `vite.config.js` registers `tailwindcss()`; the stylesheet imports `tailwindcss`. Do not rerun the Tailwind installer or introduce a v3 configuration file.
- `src/routes/+layout.svelte` imports the stylesheet once. Its workspace initialization and recovery behavior must remain intact.
- `prettier.config.js` already loads the Svelte and Tailwind plugins, and its `tailwindStylesheet` points to `./src/routes/layout.css`. Update that path during the final entrypoint change.
- The stylesheet also imports `src/lib/presentations/rendering/presentation-fonts.css`. Preserve that existing rendering resource and its availability to presentation previews/exports.
- Existing component CSS includes `Modal.svelte`, `Slider.svelte`, `DomCanvas.svelte`, `KonvaArtboard.svelte`, and the root layout's draft-recovery banner. Account for both global and scoped rules when calculating current behavior.
- This workspace did not expose a Git repository when inspected. The implementer must determine their actual checkout state before work; do not assume a clean branch or create a repository as part of styling.

Line numbers in this document describe the inspected version and will drift. Selector names and component ownership are the durable references.

## 3. Final file structure and ownership rules

Create:

```text
src/app.css                         # imports only, plus brief entrypoint explanation
src/lib/styles/tokens.css            # existing runtime variables and Tailwind theme aliases
src/lib/styles/base.css              # document defaults, focus, reduced-motion policy
src/lib/styles/fonts.css             # seven font faces currently in layout.css
src/lib/ui/styles.js                 # small shared static utility recipes, primarily buttons
```

`src/app.css` imports Tailwind first, followed by the local fonts, existing presentation font stylesheet, tokens, and base stylesheet. Use paths relative to `src/app.css`. Import it once from `src/routes/+layout.svelte` as `../app.css`. Update Prettier to `./src/app.css`.

Final ownership:

| Styling concern                                                       | Destination                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| Flex/grid, spacing, sizing, typography, simple colors/borders/states  | Utilities on the element that renders them                |
| Repeated button styling on native anchors/buttons                     | Static utility recipes in `src/lib/ui/styles.js`          |
| Shared visual geometry across genuinely reused markup                 | Existing component, or a small extracted visual component |
| Tape, torn-paper outlines, layered gradients, complex pseudo-elements | Owner component's scoped `<style>`                        |
| Native dialog backdrop and reveal animation                           | `Modal.svelte` scoped CSS                                 |
| Konva-generated DOM descendants                                       | Narrow owner-anchored `:global(...)` rules                |
| Runtime positions, transforms, colors, slider percentages             | Existing `style:` directives / runtime inline styles      |
| Fonts, app palette, document-wide defaults                            | The three small global foundation files                   |

Do not introduce a new global feature stylesheet, a large `@apply` library, or a catch-all utility helper. Repetition of a few utilities is preferable to a component abstraction with no meaningful ownership. Do not extract every `div` into a component just to shorten class attributes.

## 4. Inventory before changing the cascade

Create a migration ledger, either alongside this plan or in the implementation PR. Each row needs: selector group, current source locations including media rules, all consumers, state conditions, final owner, destination, verification performed, and remaining work.

Use a CSS parser such as the already installed PostCSS tooling to enumerate rules and their enclosing at-rules. A regular expression alone is insufficient for selector lists, nested rules, and keyframes. Supplement the parsed inventory with source searches across Svelte, JavaScript, TypeScript, tests, and generated-DOM integrations.

For each rule group:

1. Collect every occurrence, including the late responsive blocks and repeated declarations.
2. Identify inherited defaults and more-specific overrides.
3. Identify markup in child components and caller-provided snippets.
4. Search JavaScript and tests for class/attribute selectors before removing any class.
5. Record the effective styles in representative states, not merely the first declaration.
6. Assign every declaration to utilities, a scoped exception, a foundation rule, or verified dead code.

Known repeated selectors include `.rail`, `.empty`, `.asset-tray`, `.collage-stamp`, `.presentation-library-state p`, and mobile `.collage-templates`. Repeated rules may be cumulative or deliberate overrides. Merge only after reconstructing the effective cascade.

Potential leftovers such as `.react-colorful__alpha`, `.overlay`, or `.sheet` require a consumer search; their names alone do not establish that they are unused.

## 5. Tokens and Tailwind mapping

Keep the existing custom property names initially, because scoped styles already consume them. Make those variables the single source of truth and expose color/radius/shadow aliases through top-level `@theme inline`. For example, alias `--color-ink` to `var(--ink)` and `--color-surface` to `var(--surface)`; then use `text-ink` and `bg-surface` in markup. Do not create cycles or maintain duplicate literal values in both systems.

Carry forward all current palette values, including danger, warning, pastel surfaces, icon colors, tape, and scrapbook colors. Preserve `--font-sans`, the 500 default body weight, and `font-synthesis: none`. Use app-specific radius/shadow names, such as `--radius-panel` and `--radius-control`, to avoid silently redefining Tailwind's existing `rounded-sm` meaning.

The primary button is **#00875e**, while `--mint` is **#08b879**. They are different colors. Introduce explicit action tokens for the existing primary, hover, and shadow values rather than replacing them with mint.

### Spacing conversion table

The existing numeric suffixes are not Tailwind's scale:

| Existing token | Current value | Tailwind utility spacing suffix at default 16px root |
| -------------- | ------------- | ---------------------------------------------------- |
| `--space-1`    | 4px           | `1`                                                  |
| `--space-2`    | 8px           | `2`                                                  |
| `--space-3`    | 12px          | `3`                                                  |
| `--space-4`    | 16px          | `4`                                                  |
| `--space-5`    | 24px          | `6`                                                  |
| `--space-6`    | 32px          | `8`                                                  |
| `--space-7`    | 48px          | `12`                                                 |

For strict pixel-equivalent behavior, retain variable-backed arbitrary values such as `gap-[var(--space-5)]` or explicit pixel values. Tailwind's standard spacing is rem-based, so choose deliberately rather than claiming an exact equivalence under every root font size. Never globally redefine Tailwind spacing `5` to mean 24px.

Preserve odd values such as button vertical padding of 11px, title width in `ch`, `clamp(...)`, `min(...)`, `cqw`/`cqi`, and viewport-relative heights. Utility shorthand must not introduce a different line-height: Tailwind font-size utilities often also set line-height. Record and preserve the effective line-height explicitly when translating font-size-only declarations.

Keep runtime `--header-height` changes in `tokens.css`: 80px by default, 72px at max-width 1150px, and 112px at max-width 720px, in that order. This is shared geometry used by the shell and editors.

## 6. Cascade migration protocol

Existing ordinary rules are unlayered. Tailwind utilities live in cascade layers. An unlayered ordinary rule can beat a utility even when the utility looks more specific. Adding utilities while leaving matching legacy declarations is not a completed migration.

For each component-sized slice:

1. Add the new utilities and scoped exceptions.
2. Remove the migrated declarations from every matching legacy rule, including responsive and interaction overrides.
3. For shared selector lists, remove only the migrated consumer's branch; retain styling needed by other consumers.
4. Verify the component and its parent/child contexts before taking the next slice.

Do not move all old rules into `@layer components` in one operation. That would change precedence across the entire app before its consumers are migrated. Keep the shrinking legacy file temporarily unlayered and retire groups in controlled slices.

Document defaults should ultimately live in `@layer base`. Moving the current global `button, input, select, textarea { font: inherit }` and heading defaults there changes their precedence relative to existing utilities, so verify fonts and form controls when performing that move. Preserve the effective document-wide policy first; remove redundant reset rules only after comparison with the installed Preflight output.

Do not use blanket `!important` as a migration strategy. The existing reduced-motion override is a deliberate exception to preserve. Ensure scoped CSS and utilities do not compete for the same property; Svelte adds specificity to scoped selectors.

## 7. Shared controls and component boundaries

### Button recipes

Use a small JavaScript module with JSDoc, matching the repository's current component style. Export complete, statically discoverable class strings and a small selector function if useful. Support the existing ordinary, primary, danger, and icon appearances. Keep native `<a>` and `<button>` elements in their current owners; no new polymorphic button component is required.

Preserve:

- Ordinary button min-height 44px, 11px/16px padding, 14px/700 text, 8px gap, border, radius, and transition behavior.
- Primary normal/hover backgrounds and pressed-looking shadows, including the -1px hover translation.
- Danger normal/hover colors and the current shared hover effects where applicable.
- Disabled opacity 0.6, not-allowed cursor, and hover guards.
- Icon buttons' ordinary 36px geometry, and the explicit 44px or larger overrides used for close/mobile/presentation card actions.
- Anchor hrefs, button types, ARIA labels, data attributes, focus indicators, and event handlers.

Build each variant without conflicting utilities for the same property. Array order or putting a caller class last does not guarantee an override in generated CSS. Make recipe size/variant choices explicit; do not introduce a dependency just to merge conflicting classes.

Tailwind's ordinary hover variant may have pointer-capability gating. Where parity with `:hover:not(:disabled)` matters, use a verified equivalent variant or retain a small owner-scoped rule until tested on mouse and touch.

### Cross-component selectors

- `AppShell.svelte` owns its wrapper and `<main>`, but `Sidebar.svelte` owns the sidebar root. Move `.layout > .sidebar`, editor hiding, and mobile dialog sidebar behavior through an explicit sidebar placement/variant prop or a small class contract. Do not assume a scoped AppShell selector reaches Sidebar's markup.
- `Hero.svelte` currently infers templates/packs styling via `:has(.collage-templates)` and `:has(.collage-packs)`. Add an explicit hero variant (`dashboard`, `templates`, `packs`), update all callers, and let `StickerCollage.svelte` continue owning its matching art variant. Preserve the current default used by the dashboard.
- Hero title, kicker, actions, and points are caller-defined snippets. Put utilities on the markup where each snippet is authored. A style block in Hero does not automatically acquire ownership of caller-authored `<em>` or action links.
- `Modal.svelte` owns the dialog frame, title, description, close control, and footer wrapper. Its forms, alert/status content, and inspector contents come from callers. Move those styles to their rendering owners or introduce a narrow documented shared recipe. Avoid replacing global dialog selectors with ineffective scoped selectors.
- Keep marker classes still used for focus or tests. `PresentationsPage.svelte` queries `.presentation-card-actions button`; presentation thumbnail tests query `.presentation-card-preview` and `.presentation-card-link`. They can remain as non-styling hooks. Changing them requires updating all consumers atomically without weakening assertions.

## 8. File-by-file work packages

Each package includes all its responsive, hover, focus, disabled, selected, and reduced-motion rules, wherever they currently appear.

| Package                 | Existing owners                                                                                       | Selector families / source guide                                                                                           | Completion evidence                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Foundations             | Root layout; new style files                                                                          | Imports/fonts/tokens/defaults, lines 1–157; reduced motion and accessibility helpers near 5151–5186                        | Fonts, focus, defaults, and production entrypoint verified       |
| Shared controls/dialogs | `Modal`, `Slider`, `ColorField`, `AccountDialog`, both `ExportDialog` components                      | `.button`, `.primary`, `.slider*`, `.dialog*`, `.dialog-field`, `.export-sizes`, shared empty/muted patterns               | Dialog cycles, keyboard slider, export/account layouts           |
| Shell                   | `AppShell`, `Header`, `Sidebar`, `CloudBanner`, root recovery banner                                  | `.header`, `.brand`, `.topnav`, `.layout`, `.sidebar`, `.editor-layout`, search/profile/mobile controls; lines 158–576     | Every route plus mobile navigation and restoration states        |
| Dashboard and hero      | `DashboardPage`, `Hero`, `StickerCollage`                                                             | `.hero*`, `.collage*`, `.feature*`, `.split`, `.bottom-banner`, `.walkthrough`; lines 577–1566 plus scattered banner rules | Three hero variants, artwork bounds, dashboard modal             |
| Templates/projects      | `TemplatesPage`, `TemplateRail`, `TemplateCard`, `LocalProjectList`, `ProjectThumb`, `CreateRedirect` | `.rail`, `.template-*`, `.pills`, `.filters`, `.project-*`, `.tool-choice*`, empty states                                  | Search/filter/preview cycles, project opening/deletion           |
| Packs                   | `PacksPage` and embedded thumbnail components                                                         | `.packs-*`, `.pack-*`, `.detail-cover`, `.local-stickers-section`; controls near 1726 and library/detail near 4409–5039    | Empty/populated library, detail, cover variants, CRUD dialogs    |
| Sticker editor          | `EditorWorkspace`, `EditorCanvas`, `EditorInspector`, `AssetTray`, `KonvaArtboard`, `DomCanvas`       | `.editor*`, `.tool-*`, `.canvas-*`, `.artboard-*`, `.inspector*`, `.layer-*`, `.asset-*`; primarily 1838–3097              | Pan/zoom/masks/text/fullscreen, properties dialog, undo gestures |
| Presentation library    | `PresentationsPage`, `PresentationThumb`                                                              | `.presentations-library`, `.presentations-hero`, `.presentation-library-*`, `.presentation-card-*`; 3098–3667              | Empty/search/error/populated states, thumbnails and actions      |
| Presentation editor     | `presentation/PresentationEditorPage` and all its child components                                    | `.presentation-editor*`, toolbars, slide rail, inspector, geometry, canvas, text overlay, selection; 3668–4408             | Responsive titles, selection stability, transforms/text, exports |

Do not mechanically move each contiguous source range to one file. Many ranges mix shared controls and unrelated feature rules. The ledger must account for consumers such as pack detail using project thumbnails and presentation/sticker editors both using generic buttons.

### Decorative extraction guidance

Keep layered backgrounds, `clip-path`, doodles, and pseudo-elements in scoped CSS when utility lists would obscure the artwork. Preserve negative offsets, stacking contexts, transforms, and container declarations supporting `cqw`/`cqi` typography. For a large component, extract an actual visual unit such as a pack cover or presentation hero only when it gives its CSS a clear owner. Preserve existing snippet data and event contracts.

### Editor-specific preservation requirements

- Leave runtime canvas coordinates, transforms, zoom/offset values, font data, and percentages as runtime styles. Do not construct Tailwind classes from document values.
- Keep Konva canvas descendants reachable with narrowly anchored global selectors; Svelte cannot scope DOM created by Konva.
- Preserve `touch-action`, pointer-events, transform origin, overflow, minimum dimensions, and the distinction between canvas hit targets and decorative UI.
- Preserve fullscreen layout overrides across the owning components. An editor parent entering fullscreen can affect an AssetTray child; provide an explicit contract or a narrow documented descendant rule.
- Preserve presentation toolbar wrapping at max-width 1420px. The current comments explain why selection and autosave changes must not move the canvas under the pointer.
- Preserve presentation handle geometry: 14px corner handle, 2px border, current corner offsets, and coarse-pointer/max-1150px pseudo hit-area expansion with inset -17px. Keep the explanatory comments with the relocated rules.
- Retain `TextEditOverlay.svelte` runtime positions, padding, line-height, font family/size/color, and scale. Do not allow generic paragraph/control defaults to change editable text layout.
- Preserve actual thumbnail stacking over decorative paper/tape and the always-visible action controls. These have existing geometry tests.

## 9. Responsive and accessibility contract

Do not substitute Tailwind's default `sm`, `md`, or `lg` breakpoints for the existing pixel boundaries.

| Existing condition                  | Behavior to preserve                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| max-width 1420px                    | Presentation action/status row allocation                                   |
| max-width 1150px                    | 72px header, editor inspector collapse, properties controls, library reflow |
| min-width 721px AND max-width 900px | Header mobile menu visible and top navigation hidden                        |
| max-width 720px                     | 112px/two-row header, desktop sidebar hidden, phone library/editor layouts  |
| max-width 1150px OR pointer coarse  | Expanded presentation transform hit targets                                 |
| reduced-motion no-preference        | Dialog reveal animation                                                     |
| reduced-motion reduce               | Existing transition/scroll suppression                                      |

Use exact media queries in scoped CSS or explicit custom variants with those conditions. If using arbitrary Tailwind max-width variants, inspect emitted CSS: a strict `<` boundary is not identical to the current inclusive `<=` boundary. Do not merge away the 720–721 interval or assume browser viewport dimensions are always integers.

Preserve native dialog semantics, `showModal()`, Escape/focus restoration, label associations, slider input semantics, screen-reader-only labels, ARIA/data state styling, and existing button hit areas. Replace the custom `.sr-only` implementation with Tailwind's utility only after confirming no consumer overrides depend on its old rule.

## 10. Execution sequence

### Phase 0 — establish baseline

- Read applicable `AGENTS.md` and Svelte skills; discover current Svelte docs before editing.
- Capture repository state or a reversible filesystem backup if Git is unavailable.
- Build the rule/consumer ledger and record installed versions.
- Run baseline checks and capture current screenshots/geometry for the matrix below.
- Record existing failures separately; do not silently label them migration regressions or suppress them.

### Phase 1 — extract foundations without feature conversion

- Add the foundation files and theme aliases.
- Move only imports, fonts, tokens, and document defaults; keep legacy feature rules temporarily in `layout.css`.
- Prefer a temporary arrangement where `layout.css` imports the new foundation entrypoint and remains the sole root import until final cutover. This avoids duplicate Tailwind imports. Verify import paths and order.
- Check typography/default precedence before continuing.

### Phase 2 — controls and shell

- Establish button recipes and migrate shared control consumers in manageable groups.
- Migrate Modal/Slider/ColorField, then shell and root gate/recovery UI.
- Remove each retired rule branch after all consumers in that group are migrated.
- At this phase's end, feature-specific legacy styling may remain; the global shell and shared controls must have clear owners.

### Phase 3 — dashboard and libraries

- Migrate explicit Hero variants and collage ownership together.
- Migrate templates/project lists and packs, then presentation library.
- Verify normal, empty, loading, error, selected, and dialog states as available.
- Keep decorative CSS with the relevant visual unit, and retain non-styling selector hooks.

### Phase 4 — editors

- Migrate sticker editor shell/inspector/tray before canvas integration rules.
- Migrate presentation editor shell/toolbars/inspector before selection/text/canvas rules.
- Run the focused editor suites after each editor is complete.
- Preserve source comments explaining geometry and responsive behavior.

### Phase 5 — remove legacy entrypoint

- Resolve every ledger row. Delete verified unused rules rather than copying them into another file.
- Remove the final `layout.css`, switch root import to `../app.css`, and update Prettier's stylesheet path.
- Search the entire authored repository for stale runtime/config references. Historical documentation may still name the removed file; distinguish it from active references.
- Check that shared recipes contain complete literal classes; do not use interpolated fragments such as `bg-${tone}`. Validate rare variants in a production build.
- Format only changed files, run final validation, and report the final ownership and remaining scoped exceptions.

Use one reviewable change/commit per phase or smaller coherent slice where Git is available. Do not defer removal of all legacy declarations until the end: that masks whether utilities actually work.

## 11. Validation plan

### Existing commands

Run from the project root:

```bash
npm run check
npm run lint
npm run test:unit -- --run
npm run build
npx playwright test
```

The regular Playwright configuration already builds and previews production output, uses one worker, and defaults to 1440×900. Avoid attaching to a stale server during comparison. The repository's `npm run test:e2e` also installs Playwright browsers; use it if installation is required, otherwise the direct test command avoids repeating that step.

For account/cloud UI changes, also use the existing `npm run test:e2e:cloud` setup and record its prerequisites/outcome. Never supply production credentials for visual fixtures.

Before finalizing edited Svelte files, run the required Svelte autofixer for each changed component/module supported by the tool and resolve its issues/suggestions. Do not use this refactor to rewrite unrelated logic in response to incidental findings; record pre-existing unrelated findings explicitly.

### Focused existing coverage

| Area                     | Existing coverage to prioritize                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell/dialog/templates   | `src/routes/app-shell.svelte.test.ts`, `src/lib/components/modal-cycle.svelte.test.ts`, `src/routes/templates/templates-catalog.svelte.test.ts`, `e2e/a11y-sweep.spec.ts`              |
| Packs                    | `src/lib/components/packs-page.svelte.test.ts` plus relevant library journeys                                                                                                          |
| Sticker editor           | `src/routes/editor/editor-flow.svelte.test.ts`, `src/lib/components/canvas-space.svelte.test.ts`, `e2e/editor.spec.ts`, `e2e/masks.spec.ts`                                            |
| Presentation library     | `src/lib/components/presentations-page.svelte.test.ts`, `e2e/presentation-library-actions.spec.ts`, `e2e/presentation-library-thumbnails.spec.ts`                                      |
| Presentation editor      | `e2e/presentation-responsive.spec.ts`, `e2e/presentation-transform.spec.ts`, `e2e/presentation-text.spec.ts`, `e2e/presentation-view-state.spec.ts`, `e2e/presentation-slides.spec.ts` |
| Rendering/export/offline | Existing presentation image/export/offline/scale suites and unit tests in `src/lib/presentations`                                                                                      |

Use real test filenames and the existing harness. Add tests only for uncovered behavior affected by this migration, particularly responsive boundaries, shared-style isolation, and geometry. Do not add tests that merely assert long utility class strings.

### Visual and interaction matrix

Capture before/after screenshots using the same browser, viewport, font readiness, seeded data, and animation policy. Wait for fonts, images, and canvas content. Mask only inherently nondeterministic content such as timestamps; do not mask the geometry being validated. Review diffs instead of automatically accepting new snapshots.

Representative widths: 390, 720, 721, 900, 901, 1024, 1150, 1151, 1420, 1421, and 1440 CSS pixels. Use a practical stable height such as 900 for boundary sweeps and retain the existing phone 390×844/tablet 1024×768 checks. Test coarse-pointer behavior separately from width and include reduced motion.

Representative screens and states:

- `/`: hero/artwork, features, project rail, walkthrough dialog, global search, mobile navigation.
- `/templates`: filters, no matches, preview open/close/reopen, favorite control.
- `/my-stickers`: empty and populated packs, pack detail, cover variations, add/rename/delete flows and local sticker thumbnails.
- `/create` and `/editor/[projectId]`: loading/opening, loaded editor, save status, tool selection, properties dialog, mask/text editing, fullscreen, zoom/pan and export dialog.
- `/presentations`: empty and populated library, no search results, long titles, actual rendered thumbnails, visible action buttons, rename/delete/export dialogs.
- `/presentations/[presentationId]`: blank and populated slide, selected image/shape/text, text editing, toolbar wrap, inspector collapse, slide rail, zoom/pan, transform handles, overflow warning, export UI.
- Root workspace restoration/error and unsaved draft recovery; authentication callback/error UI where styling is shared.

Assertions should cover document horizontal overflow, visible/reachable controls, focus restoration, readable titles, expected header height, stable canvas bounds when selection/save status changes, and unchanged thumbnail/frame alignment. Existing responsive tests already cover a long Vietnamese/English title at 1024px and authoring preview reachability at 390px; retain them.

Record emitted production CSS size before and after as supporting evidence, including whether reporting total CSS or the entry chunk. Do not claim a performance gain from source line count or require an arbitrary size reduction that would incentivize removing needed styling.

## 12. Definition of done

- [ ] `src/routes/layout.css` is deleted and no active import/config references remain.
- [ ] Tailwind is imported exactly once through `src/app.css`.
- [ ] Font availability and existing asset paths remain correct in production.
- [ ] Global CSS contains only fonts, tokens/theme aliases, and documented document-wide rules.
- [ ] Ordinary component styling lives in utilities; remaining scoped CSS has a concrete ownership reason.
- [ ] No replacement global feature monolith or large `@apply` compatibility layer exists.
- [ ] Every legacy rule has a ledger disposition, including all media/state overrides.
- [ ] Shared styles no longer rely on accidental child/snippet reach; explicit variants preserve every context.
- [ ] Runtime editor geometry and JavaScript/test selector contracts are preserved.
- [ ] Exact breakpoint behavior, reduced motion, keyboard access, and touch hit areas are verified.
- [ ] Appropriate automated checks and before/after visual review pass, with pre-existing failures distinguished.
- [ ] The handoff report names changed files, scoped exceptions, checks run, visual evidence, and any unresolved validation limitations.

## 13. Reference material

Use installed package behavior and the source tree as the implementation authority. These official references were consulted for the plan:

- [Svelte scoped styles](https://svelte.dev/docs/svelte/scoped-styles): scoping, specificity, and local keyframes.
- [Svelte global styles](https://svelte.dev/docs/svelte/global-styles): narrow integration selectors.
- [Svelte class attributes](https://svelte.dev/docs/svelte/class): class arrays/objects for complete utility choices.
- [Svelte style directives](https://svelte.dev/docs/svelte/style): runtime geometry and CSS variables.
- [Tailwind theme variables](https://tailwindcss.com/docs/theme): theme namespaces and aliases.
- [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files): statically discoverable utility names.
- [Tailwind custom styles](https://tailwindcss.com/docs/adding-custom-styles): base rules, custom CSS, and arbitrary values.

## 14. Prompt for the implementing agent

Implement `docs/superpowers/plans/2026-09-15-tailwind-style-migration.md`. Start with baseline evidence and a rule/consumer ledger. Migrate in the documented order, preserve appearance and behavior, and remove legacy declarations as their owners are converted. The final result must delete `src/routes/layout.css`, use Tailwind for ordinary component styling, and retain only justified scoped CSS plus the small global foundation. Follow repository Svelte documentation/autofixer instructions. Do not redesign screens or change application state/persistence logic. Report completed phases, validation evidence, remaining exceptions, and any blockers honestly.
