# Tailwind style migration ledger

Companion to [the migration plan](./2026-09-15-tailwind-style-migration.md). One row per selector
group; a row is only closed when every media/state override is accounted for. Regenerate the
selector outline with:

```bash
node -e "const p=require('postcss'),f=require('fs');p.parse(f.readFileSync('src/routes/layout.css','utf8')).walkRules(r=>console.log(r.selector.replace(/\s+/g,' '),'['+r.source.start.line+']'))"
```

## Baseline (branch `refactor/tailwind-style-migration`, 2026-09-15)

| Metric                       | Value                                         |
| ---------------------------- | --------------------------------------------- |
| `src/routes/layout.css`      | 5,973 lines; 744 top-level rules; 3,767 decls |
| Rules inside 7 media blocks  | 201                                           |
| `@font-face`                 | 15 (7 app + 8 presentation)                   |
| Entry CSS chunk `0.*.css`    | 109,590 bytes                                 |
| Total client CSS             | 111,139 bytes                                 |
| `npm run check`              | 0 errors, 0 warnings                          |
| `npm run test:unit -- --run` | 530 passed (59 files)                         |
| `npx playwright test`        | 68 passed (17 files)                          |

## Phase 1 — foundations (done)

| Selector group                                      | Was                          | Owner              | Destination                              | Verification                               |
| --------------------------------------------------- | ---------------------------- | ------------------ | ---------------------------------------- | ------------------------------------------ |
| `@font-face` (7)                                    | `layout.css` 4–62            | document           | `src/lib/styles/fonts.css`               | 15 faces still emitted                     |
| `@theme --font-sans`                                | `layout.css` 64–66           | document           | `src/lib/styles/tokens.css` (non-inline) | `--font-sans` still emitted                |
| `:root` palette (38 custom properties)              | `layout.css` 68–111          | document           | `src/lib/styles/tokens.css`              | `--ink` etc. byte-identical; screenshots   |
| `:root --header-height` 80/72/112px                 | `layout.css` 113, 5041, 5222 | document           | `src/lib/styles/tokens.css`              | all three emitted                          |
| `h1, h2, h3 { font-weight: 800 }`                   | `layout.css` 116–119         | document           | `base.css` `@layer base`                 | no `font-weight-*` utilities in markup yet |
| `button, input, select, textarea { font: inherit }` | `layout.css` 128–133         | document           | `base.css` `@layer base`                 | screenshots; form controls unchanged       |
| `input[type=checkbox/radio]`                        | `layout.css` 134–139         | document           | `base.css` `@layer base`                 | **changed precedence — see below**         |
| `textarea`, `p`, `svg`, `button` defaults           | `layout.css` 141–152         | document           | `base.css` `@layer base`                 | screenshots; no conflicting utilities      |
| `:focus-visible`                                    | `layout.css` 153–156         | document           | `base.css` `@layer base`                 | rule emitted; `#00875e` → `var(--primary)` |
| `prefers-reduced-motion: reduce`                    | `layout.css` 5165–5171       | document           | `base.css`, deliberately **unlayered**   | rule still last-wins with `!important`     |
| `.sr-only`                                          | `layout.css` 5176–5185       | document           | deleted — Tailwind's identical built-in  | 5 consumers unchanged; test still passes   |
| `* { box-sizing: border-box }`                      | `layout.css` 122–124         | Tailwind preflight | deleted as redundant                     | `*,:after,:before,::backdrop` in output    |
| `body { margin: 0 }`                                | `layout.css` 125–127         | document           | `base.css` **restored, not redundant**   | preflight v4 does not reset it             |

### Phase 1 findings

1. **Tailwind v4 preflight no longer sets `body { margin: 0 }`.** Deleting it as a reset added the
   browser's 8px body margin. It is kept in `base.css` with a comment. `box-sizing: border-box` _is_
   supplied by preflight and was safely removed.
2. **Precedence bug exposed by the `@layer base` move — fixed.** `input[type='checkbox']` carries
   specificity (0,1,1) and used to be unlayered, so it beat `.inspector-switch-input` (0,1,0). Once
   it moved into `@layer base` the latter won. That rule sets `position: absolute; inset: 0; width:
100%; height: 100%` but `EditorInspector.svelte:239` renders **no `.inspector-switch` wrapper**, so
   the input has no positioned ancestor and resolved against the initial containing block: measured
   **1440×900 at z-index 1**, an invisible full-viewport click catcher that broke 14 e2e tests.
   `.inspector-switch-input` is now in-flow (18×18, inside its label). The orphaned `.inspector-switch`
   / `::after` knob / `:has()` rules at `layout.css` 2654–2697 are **verified dead** (no element has
   that class) and are left untouched pending the product decision recorded in _Open questions_.
3. **`@theme inline` still emits referenced variables.** Only `--color-ink`, `--color-surface`, and
   `--radius-panel` are emitted into `:root`; unreferenced aliases cost nothing. Total client CSS grew
   181 bytes (111,139 → 111,320), which is the alias definitions plus Tailwind's `sr-only`.

### Phase 1 verification

| Check                            | Result                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                  | 0 errors, 0 warnings                                                                                                                           |
| `npm run lint`                   | clean (Prettier + ESLint)                                                                                                                      |
| `npm run test:unit -- --run`     | 530 passed                                                                                                                                     |
| `npx playwright test`            | 68 passed (2.3m, down from 9.0m with the click catcher present)                                                                                |
| `npm run build`                  | ok; 15 `@font-face`, three `--header-height` values present                                                                                    |
| Visual diff, 5 routes × 5 widths | 19/25 pixel-identical; 5 sub-pixel AA; 1 was an offline-status timing race ("Ready for offline use." vs "Preparing offline use…"), not styling |

## Phases 2–5 — component ownership and cutover (done)

Source line numbers below refer to the deleted pre-migration stylesheet.

| Phase | Package                 | Destination owners                                                                              | Selector families                                                               | Status |
| ----- | ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| 2     | Shared controls/dialogs | `Modal`, `Slider`, `ColorField`, `AccountDialog`, both `ExportDialog`                           | `.button`, `.primary`, `.slider*`, `.dialog*`, `.dialog-field`, `.export-sizes` | done   |
| 2     | Shell                   | `AppShell`, `Header`, `Sidebar`, `CloudBanner`, root layout                                     | `.header`, `.brand`, `.topnav`, `.layout`, `.sidebar`, `.editor-layout`         | done   |
| 3     | Dashboard and hero      | `DashboardPage`, `Hero`, `StickerCollage`                                                       | `.hero*`, `.collage*`, `.feature*`, `.split`, `.banner*`, `.walkthrough`        | done   |
| 3     | Templates/projects      | `TemplatesPage`, `TemplateRail`, `TemplateCard`, `LocalProjectList`, `ProjectThumb`             | `.rail`, `.template-*`, `.pills`, `.filters`, `.project-*`, `.tool-choice*`     | done   |
| 3     | Packs                   | `PacksPage`                                                                                     | `.packs-*`, `.pack-*`, `.detail-cover`, `.local-stickers-section`               | done   |
| 3     | Presentation library    | `PresentationsPage`, `PresentationThumb`                                                        | `.presentations-library`, `.presentations-hero`, `.presentation-library-*`      | done   |
| 4     | Sticker editor          | `EditorWorkspace`, `EditorCanvas`, `EditorInspector`, `AssetTray`, `KonvaArtboard`, `DomCanvas` | `.editor*`, `.tool-*`, `.canvas-*`, `.inspector*`, `.layer-*`, `.asset-*`       | done   |
| 4     | Presentation editor     | `presentation/PresentationEditorPage` and children                                              | `.presentation-editor*`, toolbars, slide rail, geometry, handles, text overlay  | done   |
| 5     | Cutover                 | `src/app.css` and component owners                                                              | deleted `layout.css`; root imports `../app.css`                                 | done   |

### Ownership decisions

- Repeated buttons use the small static recipes in `src/lib/ui/styles.js`; ordinary one-owner
  declarations that map directly are Tailwind utilities in markup (including exact arbitrary values).
- Responsive, pseudo-element, state-machine, container-query, canvas/Konva and decorative artwork
  rules remain scoped in the owning component. This keeps the original behavior without creating a
  utility abstraction for one-off artwork.
- Snippet or child-component DOM uses owner-anchored `:global(...)` selectors only where Svelte scope
  cannot cross the boundary. `StickerCollage` owns its positioning and click-through behavior.
- `Hero` exposes only the three real visual variants (`dashboard`, `templates`, `packs`). Header
  account chrome is an explicit `header` variant owned by `AccountDialog`.
- The dialog reveal keyframes use Svelte's `-global-` keyframe escape so the browser-visible name
  remains `reveal`; reduced-motion behavior is unchanged.
- Verified dead `.inspector-switch`, notification/search header, and orphaned legacy selector rules
  disappeared with `layout.css`; no speculative replacement UI was added.

### Final verification

| Check                                      | Result                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/routes/layout.css`                    | deleted; no production import remains                                                           |
| `npm run check`                            | 0 errors, 0 warnings                                                                            |
| `npm run lint`                             | clean                                                                                           |
| `npm run test:unit -- --run`               | 530 passed                                                                                      |
| `npx playwright test`                      | 68 passed                                                                                       |
| `npm run build`                            | ok                                                                                              |
| Svelte autofixer                           | run over every changed `.svelte` file; migration files introduced no compiler diagnostics       |
| Visual spot check, 5 routes × 5 widths     | before/after captures reviewed at 390, 720, 721, 1150 and 1440px; no material layout regression |
| Entry CSS chunk                            | 109,590 → 27,221 bytes; global CSS is now foundations and generated utilities only              |
| Total emitted client CSS across all routes | 111,139 → 136,903 bytes; expected route-split scoped CSS duplication, not all loaded once       |
