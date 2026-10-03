# Student trust and first-five-minutes handoff

## Scope

Implements the student-first trust/reliability and onboarding work. Keeps the scrapbook identity, sample cat, personal stickers, and existing browser-local presentation model. No cloud sync, collaboration, AI, presentation mode, deployment, or new dependency was added for this work.

The working tree includes earlier cleanup work. Base commit: `9175794240ee5937eb27efd5bbfda9ed8abeb3da`. This report does not attribute every pending change to the student work. No commit or deployment is part of this handoff.

## Delivered behavior

- Student desk routes class presentations, research defenses, and club pitches to matching starter categories. Quick start explains browser-local saves and backups.
- A student can use a starter, edit it, return home, and reopen the saved deck from Recent presentations.
- Personal stickers remain a first-class entry point. The sample-photo path works without an upload and produces a PNG download.
- Save labels say **Saved in this browser**. Library and editor copy explain that saves are not automatically synced and can be lost when browser data is cleared.
- Backup reminders distinguish a download that has started from a backup that is older than the latest edits. The receipt fingerprints the exported snapshot, not just its revision. A receipt is a device-only hint, not proof that the user retained the file; blocked preference storage does not fail export.
- The stored-revision conflict journey verifies that the local copy is preserved and can be reopened.
- The phone editor remains contained at a 390px viewport. Positioning the Add shape control contains its absolute screen-reader label; the fix does not hide document overflow. Phone copy states that authoring is designed for a laptop or desktop.
- The offline builder-failure journey now waits for the editor to load before disconnecting. This isolates failed-builder recovery from an unrelated race with editor chunks. It does not add cold-start offline support.

## Recorded verification

These are results from the completed runs, not new executions during report preparation.

| Check                                     | Recorded result                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run check`                           | 0 errors, 0 warnings                                                             |
| Default production-build Playwright suite | 91 passed, 3 skipped; 94 tests, one worker, 4.4 minutes                          |
| Isolated corrected offline journey repeat | 12 passed, 52.0 seconds                                                          |
| ESLint log                                | No diagnostic output retained; an empty log alone does not prove its exit status |

The three skipped tests are opt-in P45 capacity probes: media-budget refusal, the 200-element slide ceiling, and the near-8 MiB document JSON ceiling. The default result does not claim these probes ran. Cloud tests are excluded from the default configuration; synthetic cloud checks do not establish a live backend result.

## Repeat commands

From the repository root, with dependencies and the Playwright browser installed:

```sh
npm run check
CI=1 npx playwright test
npx playwright test e2e/student-start.spec.ts e2e/presentation-responsive.spec.ts e2e/presentations.spec.ts
npx playwright test e2e/presentation-offline.spec.ts --grep 'builder' --repeat-each=12
# Optional capacity evidence, not included in the recorded default result:
P45_EVIDENCE=1 npx playwright test e2e/presentation-limits-evidence.spec.ts
```

Playwright's default server command is `npm run build && npm run preview`, on port 4173. `CI=1` prevents reuse of an existing server; ensure that port is free. An optional `PLAYWRIGHT_CHROMIUM_PATH` selects a local browser executable. Do not use the obsolete `playwright.preview.config.ts` path.

## Durable evidence

Files are copied from the completed runs into `proofs/out/student-trust-onboarding/`:

- `peeloodle-student-verify-e2e.log`: full default-suite result.
- `peeloodle-student-verify-check.log`: Svelte diagnostics result.
- `peeloodle-student-verify-eslint.log`: retained empty lint output, with the limitation above.
- `peeloodle-student-offline-fixed.log`: 12-run offline result.
- `student-desk-phone.png`: student dashboard at phone width.
- `student-starter.png`: starter presentation editor.
- `sample-personal-sticker.png`: downloaded sample sticker.
- `phone-editor-after.png`: contained phone editor.
- `phone-presentation.stickerlab.zip`: phone backup journey output.
- `export-journey.stickerlab.zip`: export/restore journey output.
- `captured-not-live.stickerlab.zip`: snapshot export journey output.
- `SHA256SUMS`: checksums for the copied logs and artifacts.

Verify copied evidence from the repository root:

```sh
sha256sum -c proofs/out/student-trust-onboarding/SHA256SUMS
```

The backups were produced by passing E2E journeys. Copying them for this report did not perform an additional restore run. Other suite artifacts remain under `/tmp/peeloodle-student-verify-e2e/` and are not durable repository evidence.

## Open launch gates — not completed by automation

- Run the P82 session with three students, without coaching. Observe starter discovery, editing, return-to-work, and backup/restore understanding.
- Test actual phones and target desktop browsers. Chromium viewport checks are not physical-device or cross-browser approval.
- Confirm a real browser download is retained, locate the file, and restore it on another device. The UI deliberately says download started, not backup safely stored.
- Confirm live hosted catalog/account behavior with real configuration before a production release. Default local tests do not provide that evidence.
- Cold offline startup/reload remains unsupported: no service worker or app-shell cache. A failed module import can require an online reload. Warmed-session offline checks do not remove this limit.
- Complete deployment, operational, and legal/content checks separately. This handoff is not a production-readiness declaration.
