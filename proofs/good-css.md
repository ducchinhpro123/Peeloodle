# Good CSS migration

Date: 2026-10-09

## Result

Applied Good CSS to the existing Svelte interface. The scrapbook design, assets, navigation, and product copy remain unchanged.

- Replaced physical interface spacing, sizing, and offsets with logical CSS properties.
- Converted CSS colors to OKLCH. Derived shared hover, tint, and shadow colors with `color-mix()`.
- Added a fluid `--page-gutter` token with `clamp()`.
- Replaced dashboard and starter-gallery column-count breakpoints with intrinsic grids. Filtered lists use `auto-fill`.
- Restricted hover styles to devices with hover support and a fine pointer.
- Restored visible focus outlines and added press feedback to enabled controls.
- Restricted movement transitions to `prefers-reduced-motion: no-preference`. Reduced motion disables animations and transitions.
- Used `overflow: clip` for decorative clipping.
- Locked document scrolling behind native modal dialogs.

## Deliberate exceptions

Canvas coordinates remain physical. Konva and text overlays need the same x/y geometry as stored document elements.

Native color inputs, document colors, and image assets keep their data formats. The migration changes interface CSS, not artwork serialization.

Text truncation, resizable fields, and programmatically scrolled editors retain scroll-compatible overflow. Root modal scroll locking also uses `hidden`.

Structural shell and toolbar breakpoints remain. Intrinsic grids replace card-count breakpoints, not layout changes with different content requirements.

Browse pages reserve scrollbar space. Fixed canvas editors use `scrollbar-gutter: auto` to preserve coordinate mapping.

## Verification

| Check                                  | Result                                          |
| -------------------------------------- | ----------------------------------------------- |
| `CI=true npx playwright test`          | 94 passed, 3 skipped; production build included |
| `npm run check`                        | 0 errors, 0 warnings                            |
| `npx eslint .`                         | Passed                                          |
| Prettier on changed source and new E2E | Passed                                          |
| `git diff --check`                     | Passed                                          |

`npm run lint` is not fully clean. Existing formatting warnings remain in five JSON artifacts under `proofs/out/sveltekit-3-migration/`. Those unrelated files were not changed.

The three skipped tests are the existing opt-in P45 capacity-evidence tests in `e2e/presentation-limits-evidence.spec.ts`.

## New test-first evidence

`e2e/good-css.spec.ts` was written before implementation. Its initial run failed on missing press feedback.

The final tests verify:

- Four routes at widths 1440, 1024, 390, and 320 pixels: no page-level horizontal overflow and visible keyboard focus.
- Desktop hover changes the New Pack button background.
- Keyboard press feedback, reduced-motion transition suppression, modal scroll locking, and focus restoration.
- Touch hover does not change the button background. The pack-name field stays in the viewport.

Screenshots and JSON evidence are saved under `proofs/out/good-css/`. The full run log is `proofs/out/good-css/full-e2e.log`.

I inspected the desktop dashboard, narrow presentation library, phone dashboard, and touch dialog screenshots.

## Regressions found and fixed

Shared hover styles initially lost to Tailwind utilities. Moving the shared rules into the utilities layer restored their precedence.

Stable root scrollbar space initially changed editor geometry. The drag test passed on unchanged HEAD and failed after migration. The editor-specific scrollbar exception restored the test without changing canvas code.

## Limits

Browser verification used Playwright Chromium, including emulated touch. Firefox, Safari/WebKit, and physical devices were not tested.

The project documents Chromium evidence in `README.md`. Legacy browsers without OKLCH, `color-mix()`, `:has()`, or `overflow: clip` need separate compatibility work. No legacy fallback was added.

Svelte MCP documentation and autofixer tools were unavailable in this session. Local Svelte checking, ESLint, production builds, and E2E tests were used instead.

This is not a sitewide contrast audit or a click-through of every admin and authenticated control. The after-mode audit is `anti-slop/audit-001-2026-10-09.md`.

At initial verification, the CSS changes were local and uncommitted. The CSS migration added no dependencies. Nothing was deployed.

## Main-branch integration

The CSS migration was committed as `a9c45cd`. The Oxlint migration commit `afacf10` was merged into `main` as `8c287fb`. The merge had no conflicts.

After `npm ci`, the merged code passed:

- `npm run check`: 0 errors and 0 warnings.
- `npm run lint`: exit code 0, with three Oxlint `unicorn(no-useless-spread)` warnings. The new lint configuration ignores the historical proof JSON formatting warnings.
- `CI=true npx playwright test`: 94 passed and 3 skipped, including a production build.

Merge verification logs are `proofs/out/good-css/merged-{check,lint,e2e}.log`.

`npm ci` reported 10 dependency vulnerabilities: 6 moderate and 4 high. No automatic dependency fixes were applied.

The Oxlint worktree and its branch were retained. Nothing was pushed or deployed.

## Repeat

```bash
npm run check
npx eslint .
CI=true npx playwright test
```

Stop any existing preview server on port 4173 before running the CI command. Playwright then builds and starts its own server.
