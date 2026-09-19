# P76/P77 — student and admin route audits at desktop, tablet and phone widths

**Date:** 2026-09-19
**Plan rows:** P76 — student routes at 1440×900, 1024×768 and 390×844; desktop/tablet
actions reachable, phone messaging does not promise cross-device local access or full editing.
P77 — admin routes with long metadata, failed jobs and destructive dialogs at the same
sizes; keyboard/focus, scroll containment, status labels and reduced motion verified with
shared UI.
**Result:** both audits pass at all three viewports, with **two real containment defects
found and fixed** (long unbroken collection names overflowed the collections list and the
collection `<select>` grew to its longest option).

## P76 — student routes (production build, Chromium)

Spec: `e2e/p76-student-route-audit.spec.ts` (runs in the default e2e suite; `P76_EVIDENCE=1`
also writes screenshots and `proofs/out/p76-student-routes-report.json`).

```bash
P76_EVIDENCE=1 npx playwright test e2e/p76-student-route-audit.spec.ts
```

| Route                     | 1440×900    | 1024×768    | 390×844   | Actions asserted                                                                          |
| ------------------------- | ----------- | ----------- | --------- | ----------------------------------------------------------------------------------------- |
| `/`                       | 1440 / 1440 | 1024 / 1024 | 390 / 390 | h1 visible                                                                                |
| `/presentations`          | 1440 / 1440 | 1024 / 1024 | 390 / 390 | create/open control visible                                                               |
| `/presentations/<id>`     | 1440 / 1440 | 1024 / 1024 | 390 / 390 | canvas, Add text, Export and Save visible                                                 |
| `/presentation-templates` | 1440 / 1440 | 1024 / 1024 | 390 / 390 | unconfigured copy (“Deck templates need the catalog…”) instead of a misleading empty list |

Cells are `scrollWidth / clientWidth` of `documentElement`; equal values mean no horizontal
overflow. At 390 the editor’s mobile note is asserted to say the work is “designed for a laptop
or desktop” and that “this preview remains available”; the audit fails if the copy mentions
sync, cross-device access or full editing. Screenshots: `proofs/out/p76-{dashboard,library,editor,templates}-{1440,1024,390}.png`.

## P77 — admin screens with hostile metadata (Vitest browser, real viewports)

Spec: `src/lib/components/catalog/admin-route-audit.svelte.test.ts`, run with
`npx vitest run src/lib/components/catalog/admin-route-audit.svelte.test.ts`.

The audit loads the real stylesheet (`src/app.css`) — component tests otherwise render unstyled —
and calls `page.viewport()` for each size. Screens are rendered against `MemoryCatalog` seeds at
the schema’s real maxima: collection/asset/template names of 200 characters, descriptions of
10 000 characters, 50 long tags, a version whose validation is pending, and a failed upload job
created through the real RPC-shaped lifecycle (`createUploadBatch → uploadSource → claimUploadJob
→ failUploadJob`).

| Screen                          | Checked at 1440/1024/390                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Collections list                | containment, New collection + Search reachable, long-name heading wraps                                                       |
| Assets list                     | containment, Apply filter reachable                                                                                           |
| Templates list                  | containment, Search + Open reachable                                                                                          |
| Template detail                 | containment, Edit metadata + Archive template reachable                                                                       |
| Collections dialog              | Archive dialog fits the viewport (390×844), `.dialog-scroll` scrolls when needed, focus stays inside, Escape closes           |
| Uploads batch with a failed job | failed stage label, `decode_failed` reason, `Retry broken-chart.png` reachable, containment at 390, collection select clamped |

### Defects found and fixed

| Defect                                                                                                                                                                                              | Evidence                                                                                               | Fix                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 200-character unbroken collection name made the document 3 242 px wide at every viewport (the schema allows 1–200 characters; `name text not null check (length(trim(name)) between 1 and 200)`). | `h2` scrollWidth 3202 at 390; the same 3242 appeared at 1440 because the name exceeded both viewports. | `[overflow-wrap:anywhere]` on the collections heading, its tag/revision metadata and its description; the same on the templates list heading and the template detail title/metadata/description (`AdminCollectionsPage.svelte`, `AdminTemplatesPage.svelte`, `AdminTemplateDetailPage.svelte`). |
| The “Collection” `<select>` sized itself to its longest option, so a 200-character collection name made the uploads page 1 505 px wide at 390.                                                      | `select` rect width 1505 = the option text width.                                                      | `[min-width:0]` on the label and `[min-width:0] [max-width:100%]` on the selects in `AdminUploadsPage.svelte`, `AdminAssetsPage.svelte` (filter and asset dialog).                                                                                                                              |

The audit now also asserts the _computed_ `overflow-wrap: anywhere` on the long-name heading and a
bounded `max-width` on the collection select, so the fixes cannot silently regress.

**Reproduce:** `npx vitest run src/lib/components/catalog/admin-route-audit.svelte.test.ts` and
`P76_EVIDENCE=1 npx playwright test e2e/p76-student-route-audit.spec.ts`.

## Boundaries

- The admin screens are driven by `MemoryCatalog`, not by a live signed-in Supabase session; the
  live RLS path is P53/P79 (`proofs/p53-live-catalog-isolation.md`, updated there).
- Reduced motion for the shared `Modal` is asserted by `e2e/a11y-sweep.spec.ts`
  (`prefers-reduced-motion: reduce` removes the animation and leaves the dialog usable); the P77
  audit pins containment and Escape behaviour at the three widths instead of duplicating it.
- P82 (three students, unaided) is a human session and remains open; this audit is the
  agent-run portion of Milestone 7's route checks.
